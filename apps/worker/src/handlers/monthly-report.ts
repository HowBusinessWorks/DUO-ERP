import { serviceActor } from '@damina/db';
import { reportsMonthly } from '@damina/jobs';
import {
  applyReportProgress,
  attachReportArtifact,
  completeReportVersion,
  failReport,
  newReportToken,
  readReportBuildHead,
  readReportJournal,
  readReportPhotos,
  readReportSheets,
  type ReportComposition,
  type ReportJournalRow,
  type ReportPhotoRow,
  type ReportSheetDetail,
} from '@damina/services';
import { Period } from '@damina/shared';
import { logger } from '@damina/shared/logger';
import { blobKey, putObject, reportKey } from '@damina/storage';
import type PgBoss from 'pg-boss';

/**
 * Generarea raportului lunar catre client (pasul 10, §3.6).
 *
 * **Asincron, cu progres real.** Sute de poze inseamna minute, iar un spinner
 * care se invarte doua minute e indistinct de o aplicatie blocata. Jobul scrie
 * „X din Y" pe raport la fiecare pagina de poze, si ecranul citeste chiar
 * numarul ala — nu o estimare facuta in browser.
 *
 * **Artefactul e HTML, nu PDF**, si asta e alegerea explicita din plan pentru
 * contractele cu multe poze: un PDF cu 312 fotografii inglobate trece de 400 MB
 * si nu se deschide pe telefonul nimanui. Raportul web e o pagina care se
 * incarca instant si trage pozele la cerere, prin acelasi token.
 *
 * **Pozele nu se ingloba in artefact**, ci se refera prin `/raport/<token>/poza/
 * <versiune>`. Doua motive: artefactul ramane de ordinul zecilor de kilobytes,
 * si o poza stearsa din greseala din arbore nu poate rescrie ce s-a trimis —
 * versiunea inghetata isi poarta lista de unitati incluse, iar ruta publica
 * verifica apartenenta la ea.
 */
export async function registerMonthlyReports(boss: PgBoss): Promise<void> {
  await boss.work(reportsMonthly.name, async (jobs) => {
    for (const job of jobs) {
      const payload = reportsMonthly.schema.parse(job.data);
      await buildReport(payload, job.id);
    }
  });
}

/** Cate poze intr-o pagina. Numarul e si pasul cu care avanseaza progresul. */
const PHOTO_PAGE = 100;

/** Cat traieste linkul trimis clientului. Sase luni: o factura se discuta luni. */
const TOKEN_DAYS = 180;

async function buildReport(
  payload: { reportId: string; version: number; requestedBy?: string },
  jobId: string,
): Promise<void> {
  const actor = serviceActor(reportsMonthly.name);
  const head = await readReportBuildHead(actor, payload.reportId);

  if (head === null) {
    // Raportul a disparut intre enqueue si executie. Nu e o eroare de job.
    logger.info(
      { use_case: reportsMonthly.name, job_id: jobId, report_id: payload.reportId },
      'raport inexistent, nimic de generat',
    );
    return;
  }

  try {
    const composition = head.composition;
    const period = Period.of(composition.year, composition.month);
    const workUnitIds = composition.includedWorkUnitIds;

    const [sheets, journal] = await Promise.all([
      readReportSheets(actor, workUnitIds, period.firstDay(), period.lastDay()),
      readReportJournal(actor, workUnitIds, period.firstDay(), period.lastDay()),
    ]);

    await applyReportProgress(actor, payload.reportId, 0, composition.photos);

    const token = newReportToken();
    const photoBlocks: string[] = [];
    let done = 0;

    for (let offset = 0; offset < composition.photos; offset += PHOTO_PAGE) {
      const page = await readReportPhotos(actor, workUnitIds, offset, PHOTO_PAGE);
      if (page.length === 0) {
        break;
      }
      photoBlocks.push(page.map((photo) => photoFigure(photo, token)).join('\n'));
      done += page.length;
      // Progresul se scrie pe pagina, nu pe poza: 480 de update-uri pentru o
      // cifra pe care omul o citeste din 5 in 5 secunde ar fi 480 de tranzactii
      // degeaba.
      await applyReportProgress(actor, payload.reportId, done, composition.photos);
    }

    const html = renderReport({
      composition,
      sheets,
      journal,
      photos: photoBlocks.join('\n'),
      photoCount: done,
      version: payload.version,
    });

    const bytes = Buffer.from(html, 'utf8');

    // Intai arhiva — dovada. Nodul din arbore e comoditate, si daca nu se poate
    // face (contract fara folder), raportul exista oricum.
    const archiveKey = reportKey(payload.reportId, payload.version);
    await putObject('archive', archiveKey, bytes, 'text/html; charset=utf-8');

    let artifactNodeId: string | null = null;
    if (payload.requestedBy !== undefined) {
      const key = blobKey();
      await putObject('docs', key, bytes, 'text/html; charset=utf-8');
      artifactNodeId = await attachReportArtifact(actor, {
        contractId: composition.contractId,
        filename: `Raport ${composition.contractCode} ${period.toKey()} v${String(payload.version)}.html`,
        blobKey: key,
        size: bytes.byteLength,
        createdBy: payload.requestedBy,
      });
    }

    const expiresAt = new Date(Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000);

    await completeReportVersion(actor, {
      reportId: payload.reportId,
      version: payload.version,
      archiveKey,
      artifactNodeId,
      webToken: token,
      webTokenExpiresAt: expiresAt,
      includedWorkUnitIds: workUnitIds,
      inspectionCount: composition.inspections,
      interventionCount: composition.interventions,
      journalCount: composition.journals,
      photoCount: done,
      sizeBytes: bytes.byteLength,
      generatedBy: payload.requestedBy ?? null,
    });

    logger.info(
      {
        use_case: reportsMonthly.name,
        job_id: jobId,
        report_id: payload.reportId,
        version: payload.version,
        poze: done,
        octeti: bytes.byteLength,
      },
      'raport lunar generat',
    );
  } catch (error) {
    // Raportul nu ramane in `building` pe vecie: starea spune ce s-a intamplat,
    // in romana, iar pg-boss reia jobul dupa politica cozii.
    await failReport(
      actor,
      payload.reportId,
      'Generarea a eșuat. Încearcă din nou; dacă se repetă, anunță administratorul.',
    ).catch(() => undefined);
    throw error;
  }
}

// ── Randarea ─────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function photoFigure(photo: ReportPhotoRow, token: string): string {
  const geo =
    photo.lat === null || photo.lng === null
      ? ''
      : ` · ${Number(photo.lat).toFixed(5)}, ${Number(photo.lng).toFixed(5)}`;
  const when =
    photo.capturedAt === null ? '' : photo.capturedAt.toISOString().slice(0, 16).replace('T', ' ');

  return `<figure>
  <img loading="lazy" src="/raport/${token}/poza/${photo.versionId}" alt="${escapeHtml(photo.name)}">
  <figcaption>${escapeHtml(photo.workUnitCode)} · ${escapeHtml(when)}${escapeHtml(geo)}</figcaption>
</figure>`;
}

function sheetRow(sheet: ReportSheetDetail): string {
  return `<tr>
  <td>${escapeHtml(sheet.code)}</td>
  <td>${escapeHtml(sheet.kind === 'inspectie' ? 'Inspecție' : 'Intervenție')}</td>
  <td>${escapeHtml(sheet.objectiveName)}</td>
  <td>${escapeHtml(sheet.name)}${sheet.description === null ? '' : `<br><small>${escapeHtml(sheet.description)}</small>`}</td>
  <td>${escapeHtml(sheet.performedOn)}</td>
  <td>${sheet.findings === 0 ? '—' : String(sheet.findings)}</td>
</tr>`;
}

function journalRow(entry: ReportJournalRow): string {
  return `<tr>
  <td>${escapeHtml(entry.entryDate)}</td>
  <td>${escapeHtml(entry.code)}</td>
  <td>${escapeHtml(entry.text)}</td>
  <td>${escapeHtml(entry.author)}</td>
</tr>`;
}

const MONTHS = [
  'ianuarie',
  'februarie',
  'martie',
  'aprilie',
  'mai',
  'iunie',
  'iulie',
  'august',
  'septembrie',
  'octombrie',
  'noiembrie',
  'decembrie',
];

/**
 * Raportul, ca document.
 *
 * **Nicio cifra in lei.** Nu din prudenta, ci pentru ca raportul si factura
 * sunt doua hartii diferite: asta dovedeste ce s-a facut, cealalta cere banii.
 * Amestecate, orice discutie despre o poza devine o discutie despre suma.
 */
function renderReport(input: {
  composition: ReportComposition;
  sheets: readonly ReportSheetDetail[];
  journal: readonly ReportJournalRow[];
  photos: string;
  photoCount: number;
  version: number;
}): string {
  const { composition: c } = input;
  const title = `Raport lunar · ${c.contractCode} · ${MONTHS[c.month - 1] ?? ''} ${String(c.year)}`;

  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; font: 15px/1.5 system-ui, sans-serif; color: #16181d; background: #fff; }
  header { border-bottom: 2px solid #16181d; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 28px 0 10px; }
  .meta { color: #5b6472; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #e3e6eb; vertical-align: top; }
  th { background: #f6f7f9; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  figure { margin: 0; }
  figure img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 6px; background: #f0f1f4; }
  figcaption { font-size: 12px; color: #5b6472; margin-top: 4px; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e3e6eb; color: #5b6472; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Client: ${escapeHtml(c.clientName)} · versiunea ${String(input.version)} ·
     ${String(c.inspections)} inspecții, ${String(c.interventions)} intervenții,
     ${String(c.journals)} intrări de jurnal, ${String(input.photoCount)} fotografii</p>
</header>

<h2>Fișe incluse</h2>
${
  input.sheets.length === 0
    ? '<p class="meta">Luna nu are fișe validate pe acest contract.</p>'
    : `<table><thead><tr><th>Cod</th><th>Tip</th><th>Obiectiv</th><th>Lucrare</th><th>Executată</th><th>Constatări</th></tr></thead>
<tbody>${input.sheets.map(sheetRow).join('\n')}</tbody></table>`
}

${
  input.journal.length === 0
    ? ''
    : `<h2>Jurnal de șantier</h2>
<table><thead><tr><th>Data</th><th>Lucrare</th><th>Consemnare</th><th>Autor</th></tr></thead>
<tbody>${input.journal.map(journalRow).join('\n')}</tbody></table>`
}

${
  input.photoCount === 0
    ? ''
    : `<h2>Fotografii (${String(input.photoCount)})</h2>
<div class="grid">
${input.photos}
</div>`
}

${
  c.unvalidated.length === 0
    ? ''
    : `<h2>Neincluse</h2>
<p class="meta">${String(c.unvalidated.length)} fișe ale lunii nu erau validate la momentul generării și nu apar mai sus.</p>`
}

<footer>
  Document generat automat din evidența de teren. Versiunea ${String(input.version)}, înghețată la emitere.
  Corecțiile ulterioare apar în raportul lunii următoare, ca ajustare.
</footer>
</body>
</html>`;
}
