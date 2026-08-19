import {
  generateMonthlyReportInputSchema,
  monthlyReportActionInputSchema,
  type GenerateMonthlyReportInput,
} from '@damina/contracts';
import { schema, withActor, withServiceActor, type Actor, type ActorTx } from '@damina/db';
import {
  canIssueMaintenanceInvoice,
  reportProgress,
  reportTransition,
  type ReportProgress,
  type ReportStatus,
} from '@damina/domain';
import { enqueue, reportsMonthly } from '@damina/jobs';
import { AppError, Period, uuidv7 } from '@damina/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

/**
 * Raportul lunar catre client (pasul 10, §3.6).
 *
 * **Modul de sine statator, nu un export.** Diferenta se vede in trei locuri:
 * raportul are stare proprie, are versiuni, si are un moment dupa care nu se
 * mai schimba. Un export s-ar fi recalculat la fiecare deschidere — adica
 * hartia din mana clientului si ecranul din birou ar fi putut spune, peste doua
 * luni, lucruri diferite despre aceeasi luna. Iar in baza raportului se
 * plateste.
 *
 * Ce intra in raport NU se alege de pe ecran: e tot ce s-a validat in luna, pe
 * contractul care plateste. Legatura fisa → contract vine din **alocarea de
 * finantare**, nu din `contract_objective_id`: alocarea e cea care spune cine
 * plateste, si tot ea se muta cand rutarea se schimba.
 *
 * Fisele nevalidate ale lunii se numara separat, ca „neincluse", cu link. Nu
 * dispar tacut — un raport care ascunde ce n-a fost validat produce exact
 * discutia pe care raportul ar trebui s-o inchida.
 */

// ── Compozitia lunii ─────────────────────────────────────────────────────────

export interface ReportSheetRow {
  readonly workUnitId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: 'inspectie' | 'interventie';
  readonly performedOn: string;
}

export interface ReportComposition {
  readonly contractId: string;
  readonly contractCode: string;
  readonly clientName: string;
  readonly companyId: string;
  readonly periodId: string;
  readonly year: number;
  readonly month: number;
  readonly periodClosed: boolean;
  readonly inspections: number;
  readonly interventions: number;
  readonly journals: number;
  readonly photos: number;
  /** Unitatile de lucru care intra in raport — fotografia continutului. */
  readonly includedWorkUnitIds: readonly string[];
  /** Fisele lunii care NU intra, pentru ca n-au fost validate. Cu link. */
  readonly unvalidated: readonly ReportSheetRow[];
}

interface ContractPeriodRow extends Record<string, unknown> {
  contract_code: string;
  company_id: string;
  client_name: string;
  year: number;
  month: number;
  status: string;
}

/**
 * Capul raportului: contractul si luna, citite prin RLS.
 *
 * Daca oricare dintre ele nu e vizibil, interogarea nu intoarce niciun rand —
 * si atunci raspunsul e „nu exista (sau nu-ti e vizibil)", nu o lista goala de
 * fise. Diferenta conteaza: una inseamna „luna n-a avut activitate", cealalta
 * „nu ai ce cauta aici".
 */
async function contractPeriod(
  tx: ActorTx,
  contractId: string,
  periodId: string,
): Promise<ContractPeriodRow> {
  const rows = await tx.execute<ContractPeriodRow>(sql`
    select c.code as contract_code, c.company_id, cl.name as client_name,
           p.year, p.month, p.status
      from app.contracts c
      join app.clients cl on cl.id = c.client_id
      cross join app.periods p
     where c.id = ${contractId}::uuid and p.id = ${periodId}::uuid`);

  const row = rows.rows[0];
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Contractul sau luna nu există (sau nu-ți sunt vizibile).');
  }
  return row;
}

export async function readReportComposition(
  actor: Actor,
  contractId: string,
  periodId: string,
): Promise<ReportComposition> {
  return withActor(actor, async (tx) => {
    const head = await contractPeriod(tx, contractId, periodId);
    const period = Period.of(head.year, head.month);
    const from = period.firstDay();
    const to = period.lastDay();

    /*
     * O singura interogare pentru tot ce se numara, cu `funded` calculat o data.
     * Alternativa — cate un `select count(*)` de fiecare fel — ar fi insemnat
     * cinci drumuri la baza pentru un ecran deschis de cateva ori pe zi, pe un
     * contract cu mii de alocari.
     */
    const rows = await tx.execute<{
      included: string[] | null;
      inspections: number;
      interventions: number;
      journals: number;
      photos: number;
    }>(sql`
      with funded as (
        select distinct fa.work_unit_id
          from app.funding_allocations fa
         where fa.contract_id = ${contractId}::uuid and fa.status = 'active'
      ),
      included as (
        select i.work_unit_id, 1 as is_inspection, 0 as is_intervention
          from app.inspections i
         where i.work_unit_id in (select work_unit_id from funded)
           and i.effect_date between ${from}::date and ${to}::date
        union all
        select v.work_unit_id, 0, 1
          from app.interventions v
         where v.work_unit_id in (select work_unit_id from funded)
           and v.effect_date between ${from}::date and ${to}::date
      )
      select
        (select array_agg(distinct work_unit_id) from included) as included,
        (select coalesce(sum(is_inspection), 0) from included)::int as inspections,
        (select coalesce(sum(is_intervention), 0) from included)::int as interventions,
        (select count(*) from app.journal_entries j
          where j.work_unit_id in (select work_unit_id from funded)
            and j.entry_date between ${from}::date and ${to}::date)::int as journals,
        (select count(*) from app.file_versions fv
           join app.nodes n on n.id = fv.node_id
          where n.work_unit_id in (select work_unit_id from included)
            and n.deleted_at is null
            and fv.state = 'ready'
            and fv.mime like 'image/%')::int as photos`);

    const totals = rows.rows[0];

    /*
     * Nevalidatele lunii se cauta pe ALOCARE, nu pe `effect_date`: o fisa
     * nevalidata n-are data de efect (regula 3 din 0026), deci n-ar avea cum sa
     * apara intr-o cautare pe luna. Luna ei e luna in care a fost finantata.
     */
    const pending = await tx.execute<{
      work_unit_id: string;
      code: string;
      name: string;
      kind: 'inspectie' | 'interventie';
      performed_on: string;
    }>(sql`
      with funded as (
        select distinct fa.work_unit_id
          from app.funding_allocations fa
         where fa.contract_id = ${contractId}::uuid
           and fa.period_id = ${periodId}::uuid
           and fa.status = 'active'
      )
      select wu.id as work_unit_id, wu.code, wu.name, 'inspectie' as kind, i.performed_on
        from app.inspections i
        join app.work_units wu on wu.id = i.work_unit_id
       where i.work_unit_id in (select work_unit_id from funded) and i.validated_at is null
      union all
      select wu.id, wu.code, wu.name, 'interventie', v.performed_on
        from app.interventions v
        join app.work_units wu on wu.id = v.work_unit_id
       where v.work_unit_id in (select work_unit_id from funded) and v.validated_at is null
       order by performed_on`);

    return {
      contractId,
      contractCode: head.contract_code,
      clientName: head.client_name,
      companyId: head.company_id,
      periodId,
      year: head.year,
      month: head.month,
      periodClosed: head.status === 'closed',
      inspections: totals?.inspections ?? 0,
      interventions: totals?.interventions ?? 0,
      journals: totals?.journals ?? 0,
      photos: totals?.photos ?? 0,
      includedWorkUnitIds: totals?.included ?? [],
      unvalidated: pending.rows.map((row) => ({
        workUnitId: row.work_unit_id,
        code: row.code,
        name: row.name,
        kind: row.kind,
        performedOn: row.performed_on,
      })),
    };
  });
}

// ── Capul raportului, cu versiunile lui ──────────────────────────────────────

export interface ReportVersionRow {
  readonly id: string;
  readonly version: number;
  readonly webToken: string;
  readonly webTokenExpiresAt: Date;
  readonly artifactNodeId: string | null;
  readonly photoCount: number;
  readonly sizeBytes: number;
  readonly generatedAt: Date;
}

export interface MonthlyReportView {
  readonly id: string;
  readonly contractId: string;
  readonly periodId: string;
  readonly status: ReportStatus;
  readonly templateId: string;
  readonly progressDone: number;
  readonly progressTotal: number;
  /** Progresul gata de afisat. Se calculeaza aici pentru ca aplicatia web
   * n-are voie sa importe `domain` (regula de granite). */
  readonly progress: ReportProgress;
  readonly lastError: string | null;
  readonly approvedAt: Date | null;
  readonly frozenAt: Date | null;
  readonly sentAt: Date | null;
  readonly versions: readonly ReportVersionRow[];
}

export async function readMonthlyReport(
  actor: Actor,
  contractId: string,
  periodId: string,
): Promise<MonthlyReportView | null> {
  return withActor(actor, async (tx) => {
    const head = await tx
      .select()
      .from(schema.monthlyReports)
      .where(
        and(
          eq(schema.monthlyReports.contractId, contractId),
          eq(schema.monthlyReports.periodId, periodId),
        ),
      )
      .limit(1);

    const report = head[0];
    if (report === undefined) {
      return null;
    }

    const versions = await tx
      .select()
      .from(schema.monthlyReportVersions)
      .where(eq(schema.monthlyReportVersions.reportId, report.id))
      .orderBy(desc(schema.monthlyReportVersions.version));

    return {
      id: report.id,
      contractId: report.contractId,
      periodId: report.periodId,
      status: report.status as ReportStatus,
      templateId: report.templateId,
      progressDone: report.progressDone,
      progressTotal: report.progressTotal,
      progress: reportProgress(report.progressDone, report.progressTotal),
      lastError: report.lastError,
      approvedAt: report.approvedAt,
      frozenAt: report.frozenAt,
      sentAt: report.sentAt,
      versions: versions.map((row) => ({
        id: row.id,
        version: row.version,
        webToken: row.webToken,
        webTokenExpiresAt: row.webTokenExpiresAt,
        artifactNodeId: row.artifactNodeId,
        photoCount: row.photoCount,
        sizeBytes: row.sizeBytes,
        generatedAt: row.generatedAt,
      })),
    };
  });
}

/** Contractele active ale lunii, cu starea raportului — ecranul de lista. */
export interface ReportListRow {
  readonly contractId: string;
  readonly code: string;
  readonly clientName: string;
  readonly periodId: string;
  readonly status: ReportStatus | null;
  readonly latestVersion: number | null;
}

export async function listMonthlyReports(
  actor: Actor,
  companyIds: readonly string[],
  year: number,
  month: number,
): Promise<readonly ReportListRow[]> {
  if (companyIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{
      contract_id: string;
      code: string;
      client_name: string;
      period_id: string;
      status: string | null;
      latest_version: number | null;
    }>(sql`
      select c.id as contract_id, c.code, cl.name as client_name,
             p.id as period_id, r.status,
             (select max(v.version) from app.monthly_report_versions v
               where v.report_id = r.id) as latest_version
        from app.contracts c
        join app.clients cl on cl.id = c.client_id
        join app.periods p
          on p.company_id = c.company_id and p.year = ${year} and p.month = ${month}
        left join app.monthly_reports r on r.contract_id = c.id and r.period_id = p.id
       where c.status = 'activ'
         and c.company_id = any(${uuidArray(companyIds)})
       order by c.code`);

    return rows.rows.map((row) => ({
      contractId: row.contract_id,
      code: row.code,
      clientName: row.client_name,
      periodId: row.period_id,
      status: row.status === null ? null : (row.status as ReportStatus),
      latestVersion: row.latest_version,
    }));
  });
}

// ── Generarea ────────────────────────────────────────────────────────────────

export interface GenerationRequested {
  readonly reportId: string;
  readonly version: number;
  /** Fals cand jobul a fost respins ca duplicat — adica exact ce cere #26. */
  readonly queued: boolean;
}

/**
 * „Generează" — creeaza raportul daca nu exista si pune jobul in coada.
 *
 * Enqueue-ul e in ACEEASI tranzactie cu scrierea starii: daca tranzactia cade,
 * jobul dispare cu ea si raportul nu ramane in `building` fara nimic care sa-l
 * duca mai departe.
 *
 * Numarul versiunii se calculeaza aici, nu in worker, si intra in
 * `singletonKey`: doua apasari pe buton cer aceeasi versiune, deci al doilea
 * job e respins ca duplicat (#26). O regenerare de dupa inghet cere versiunea
 * urmatoare, deci NU e inghitita ca duplicat (#24).
 *
 * Luna inchisa nu blocheaza nimic aici, si asta e dinadins: raportul se
 * genereaza tocmai DUPA ce luna s-a inchis si cifrele nu se mai misca.
 */
export async function requestMonthlyReport(
  actor: Actor,
  input: GenerateMonthlyReportInput,
): Promise<GenerationRequested> {
  const values = generateMonthlyReportInputSchema.parse(input);

  return withActor(actor, async (tx) => {
    // Verifica vizibilitatea contractului si a lunii inainte de orice scriere.
    await contractPeriod(tx, values.contractId, values.periodId);

    const existing = await tx
      .select()
      .from(schema.monthlyReports)
      .where(
        and(
          eq(schema.monthlyReports.contractId, values.contractId),
          eq(schema.monthlyReports.periodId, values.periodId),
        ),
      )
      .limit(1);

    let reportId: string;
    const report = existing[0];
    if (report === undefined) {
      reportId = uuidv7();
      await tx.insert(schema.monthlyReports).values({
        id: reportId,
        contractId: values.contractId,
        periodId: values.periodId,
        status: 'building',
        templateId: values.templateId,
      });
    } else {
      const transition = reportTransition(report.status as ReportStatus, 'generate');
      if (!transition.ok) {
        throw new AppError('CONFLICT', transition.reason ?? 'Raportul nu se poate regenera acum.');
      }
      reportId = report.id;
      await tx
        .update(schema.monthlyReports)
        .set({
          status: 'building',
          templateId: values.templateId,
          progressDone: 0,
          progressTotal: 0,
          lastError: null,
        })
        .where(eq(schema.monthlyReports.id, reportId));
    }

    const versions = await tx.execute<{ next: number }>(sql`
      select coalesce(max(version), 0) + 1 as next
        from app.monthly_report_versions where report_id = ${reportId}::uuid`);
    const version = versions.rows[0]?.next ?? 1;

    const queued = await enqueue(tx, reportsMonthly, {
      reportId,
      version,
      requestedBy: actor.personId,
    });

    return { reportId, version, queued };
  });
}

// ── Ce foloseste worker-ul ───────────────────────────────────────────────────

export interface ReportBuildHead {
  readonly reportId: string;
  readonly status: ReportStatus;
  readonly templateId: string;
  readonly composition: ReportComposition;
}

export async function readReportBuildHead(
  actor: Actor,
  reportId: string,
): Promise<ReportBuildHead | null> {
  const head = await withActor(actor, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.monthlyReports)
      .where(eq(schema.monthlyReports.id, reportId))
      .limit(1);
    return rows[0] ?? null;
  });

  if (head === null) {
    return null;
  }

  const composition = await readReportComposition(actor, head.contractId, head.periodId);
  return {
    reportId: head.id,
    status: head.status as ReportStatus,
    templateId: head.templateId,
    composition,
  };
}

/** Fisele lunii, cu detaliile care apar in raport. Nicio coloana de pret. */
export interface ReportSheetDetail {
  readonly workUnitId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: 'inspectie' | 'interventie';
  readonly objectiveName: string;
  readonly performedOn: string;
  readonly effectDate: string;
  readonly description: string | null;
  readonly findings: number;
}

export async function readReportSheets(
  actor: Actor,
  workUnitIds: readonly string[],
  from: string,
  to: string,
): Promise<readonly ReportSheetDetail[]> {
  if (workUnitIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{
      work_unit_id: string;
      code: string;
      name: string;
      kind: 'inspectie' | 'interventie';
      objective_name: string;
      performed_on: string;
      effect_date: string;
      description: string | null;
      findings: number;
    }>(sql`
      select wu.id as work_unit_id, wu.code, wu.name, 'inspectie' as kind,
             o.name as objective_name, i.performed_on, i.effect_date,
             null::text as description,
             (select count(*) from app.inspection_findings f
               where f.work_unit_id = wu.id)::int as findings
        from app.inspections i
        join app.work_units wu on wu.id = i.work_unit_id
        join app.objectives o on o.id = wu.objective_id
       where wu.id = any(${uuidArray(workUnitIds)})
         and i.effect_date between ${from}::date and ${to}::date
      union all
      select wu.id, wu.code, wu.name, 'interventie',
             o.name, v.performed_on, v.effect_date, v.description, 0
        from app.interventions v
        join app.work_units wu on wu.id = v.work_unit_id
        join app.objectives o on o.id = wu.objective_id
       where wu.id = any(${uuidArray(workUnitIds)})
         and v.effect_date between ${from}::date and ${to}::date
       order by effect_date, code`);

    return rows.rows.map((row) => ({
      workUnitId: row.work_unit_id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      objectiveName: row.objective_name,
      performedOn: row.performed_on,
      effectDate: row.effect_date,
      description: row.description,
      findings: row.findings,
    }));
  });
}

export interface ReportJournalRow {
  readonly code: string;
  readonly entryDate: string;
  readonly text: string;
  readonly author: string;
}

export async function readReportJournal(
  actor: Actor,
  workUnitIds: readonly string[],
  from: string,
  to: string,
): Promise<readonly ReportJournalRow[]> {
  if (workUnitIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{
      code: string;
      entry_date: string;
      text: string;
      author: string;
    }>(sql`
      select wu.code, j.entry_date, j.text, p.full_name as author
        from app.journal_entries j
        join app.work_units wu on wu.id = j.work_unit_id
        join app.persons p on p.id = j.person_id
       where j.work_unit_id = any(${uuidArray(workUnitIds)})
         and j.entry_date between ${from}::date and ${to}::date
       order by j.entry_date, wu.code`);

    return rows.rows.map((row) => ({
      code: row.code,
      entryDate: row.entry_date,
      text: row.text,
      author: row.author,
    }));
  });
}

export interface ReportPhotoRow {
  readonly versionId: string;
  readonly name: string;
  readonly workUnitCode: string;
  readonly capturedAt: Date | null;
  readonly lat: string | null;
  readonly lng: string | null;
}

/**
 * Pozele raportului, pe pagini.
 *
 * Paginat dinadins: 312 poze intr-un singur `select` ar merge, 3.000 nu — iar
 * progresul raportat (§3.6) are nevoie oricum de bucati, ca sa aiba ce numara.
 */
export async function readReportPhotos(
  actor: Actor,
  workUnitIds: readonly string[],
  offset: number,
  limit: number,
): Promise<readonly ReportPhotoRow[]> {
  if (workUnitIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{
      version_id: string;
      name: string;
      code: string;
      captured_at: Date | null;
      geo_lat: string | null;
      geo_lng: string | null;
    }>(sql`
      select fv.id as version_id, n.name, wu.code, fv.captured_at, fv.geo_lat, fv.geo_lng
        from app.file_versions fv
        join app.nodes n on n.id = fv.node_id
        join app.work_units wu on wu.id = n.work_unit_id
       where n.work_unit_id = any(${uuidArray(workUnitIds)})
         and n.deleted_at is null
         and fv.state = 'ready'
         and fv.mime like 'image/%'
       order by fv.captured_at nulls last, fv.id
       limit ${limit} offset ${offset}`);

    return rows.rows.map((row) => ({
      versionId: row.version_id,
      name: row.name,
      workUnitCode: row.code,
      capturedAt: row.captured_at,
      lat: row.geo_lat,
      lng: row.geo_lng,
    }));
  });
}

/** Progresul jobului, scris cat lucreaza. Ecranul il citeste la fiecare refresh. */
export async function applyReportProgress(
  actor: Actor,
  reportId: string,
  done: number,
  total: number,
): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .update(schema.monthlyReports)
      .set({ progressDone: done, progressTotal: total })
      .where(eq(schema.monthlyReports.id, reportId));
  });
}

/**
 * Pune artefactul raportului ca fisier in folderul contractului.
 *
 * A doua copie, langa cea din `archive`, si amandoua isi au rostul: arhiva e
 * dovada — nu se sterge din explorer si nu depinde de arbore —, iar nodul asta
 * e ce deschide omul de la birou, cu drepturile arborelui, langa restul
 * documentelor contractului.
 *
 * `createdBy` e persoana care a cerut generarea, nu actorul de serviciu:
 * `app.persons` n-are rand pentru worker, iar o coloana `created_by` care ar
 * minti e mai rea decat una care spune „cine a apasat".
 */
export interface AttachReportArtifactInput {
  readonly contractId: string;
  readonly filename: string;
  readonly blobKey: string;
  readonly size: number;
  readonly createdBy: string;
}

export async function attachReportArtifact(
  actor: Actor,
  input: AttachReportArtifactInput,
): Promise<string | null> {
  return withActor(actor, async (tx) => {
    const folders = await tx.execute<{ id: string; company_id: string }>(sql`
      select id, company_id from app.nodes
       where node_role = 'contract'::app.node_role
         and contract_id = ${input.contractId}::uuid
         and deleted_at is null
       limit 1`);

    const folder = folders.rows[0];
    if (folder === undefined) {
      // Contractul fara folder e un contract mai vechi decat arborele. Raportul
      // exista si asa: arhiva si linkul web nu depind de nodul asta.
      return null;
    }

    const existing = await tx.execute<{ id: string }>(sql`
      select id from app.nodes
       where parent_id = ${folder.id}::uuid and name = ${input.filename}
         and deleted_at is null limit 1`);

    let nodeId = existing.rows[0]?.id;
    if (nodeId === undefined) {
      nodeId = uuidv7();
      await tx.insert(schema.nodes).values({
        id: nodeId,
        parentId: folder.id,
        companyId: folder.company_id,
        kind: 'file',
        name: input.filename,
        nodeRole: 'user',
        contractId: input.contractId,
        createdBy: input.createdBy,
      });
    }

    const versionId = uuidv7();
    await tx.insert(schema.fileVersions).values({
      id: versionId,
      nodeId,
      blobKey: input.blobKey,
      size: input.size,
      mime: 'text/html',
      state: 'ready',
      createdBy: input.createdBy,
    });

    await tx
      .update(schema.nodes)
      .set({ currentVersionId: versionId })
      .where(eq(schema.nodes.id, nodeId));

    return nodeId;
  });
}

export interface CompleteReportVersionInput {
  readonly reportId: string;
  readonly version: number;
  readonly archiveKey: string;
  readonly artifactNodeId: string | null;
  readonly webToken: string;
  readonly webTokenExpiresAt: Date;
  readonly includedWorkUnitIds: readonly string[];
  readonly inspectionCount: number;
  readonly interventionCount: number;
  readonly journalCount: number;
  readonly photoCount: number;
  readonly sizeBytes: number;
  readonly generatedBy: string | null;
}

export async function completeReportVersion(
  actor: Actor,
  input: CompleteReportVersionInput,
): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.insert(schema.monthlyReportVersions).values({
      id: uuidv7(),
      reportId: input.reportId,
      version: input.version,
      archiveKey: input.archiveKey,
      artifactNodeId: input.artifactNodeId,
      webToken: input.webToken,
      webTokenExpiresAt: input.webTokenExpiresAt,
      includedWorkUnitIds: [...input.includedWorkUnitIds],
      inspectionCount: input.inspectionCount,
      interventionCount: input.interventionCount,
      journalCount: input.journalCount,
      photoCount: input.photoCount,
      sizeBytes: input.sizeBytes,
      generatedBy: input.generatedBy,
    });

    /*
     * Capul se intoarce in `review`, chiar daca raportul era inghetat: ce s-a
     * inghetat ramane inghetat in VERSIUNEA lui, cu artefactul si tokenul ei.
     * Capul spune ce se citeste acum, nu ce s-a trimis atunci — de-aia
     * versiunile sunt un tabel, si nu doua coloane pe raport.
     */
    await tx
      .update(schema.monthlyReports)
      .set({
        status: 'review',
        progressDone: input.photoCount,
        progressTotal: input.photoCount,
        lastError: null,
        approvedAt: null,
        approvedBy: null,
        frozenAt: null,
        sentAt: null,
      })
      .where(eq(schema.monthlyReports.id, input.reportId));
  });
}

/** Jobul a cazut: raportul nu ramane in `building` pe vecie, si spune de ce. */
export async function failReport(actor: Actor, reportId: string, message: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.execute(sql`
      update app.monthly_reports r
         set last_error = ${message},
             status = case
               when exists (select 1 from app.monthly_report_versions v where v.report_id = r.id)
                 then 'review' else r.status end
       where r.id = ${reportId}::uuid`);
  });
}

// ── Aprobare, inghet, trimitere ──────────────────────────────────────────────

async function transitionReport(
  actor: Actor,
  reportId: string,
  action: 'approve' | 'freeze' | 'send',
): Promise<ReportStatus> {
  const values = monthlyReportActionInputSchema.parse({ reportId });

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.monthlyReports)
      .where(eq(schema.monthlyReports.id, values.reportId))
      .limit(1);

    const report = rows[0];
    if (report === undefined) {
      throw new AppError('NOT_FOUND', 'Raportul nu există sau nu-ți e vizibil.');
    }

    const transition = reportTransition(report.status as ReportStatus, action);
    if (!transition.ok) {
      throw new AppError('CONFLICT', transition.reason ?? 'Acțiunea nu e permisă acum.');
    }

    if (action === 'approve') {
      // Nu se aproba un raport fara nicio versiune generata: ar fi o semnatura
      // pe o hartie goala.
      const versions = await tx.execute<{ count: number }>(sql`
        select count(*)::int as count
          from app.monthly_report_versions where report_id = ${values.reportId}::uuid`);
      if ((versions.rows[0]?.count ?? 0) === 0) {
        throw new AppError('CONFLICT', 'Raportul n-are nicio versiune generată.');
      }
    }

    await tx
      .update(schema.monthlyReports)
      .set({
        status: transition.next,
        ...(action === 'approve'
          ? { approvedAt: new Date(), approvedBy: actor.personId }
          : action === 'freeze'
            ? { frozenAt: new Date() }
            : { sentAt: new Date() }),
      })
      .where(eq(schema.monthlyReports.id, values.reportId));

    return transition.next;
  });
}

export const approveMonthlyReport = (actor: Actor, reportId: string): Promise<ReportStatus> =>
  transitionReport(actor, reportId, 'approve');

export const freezeMonthlyReport = (actor: Actor, reportId: string): Promise<ReportStatus> =>
  transitionReport(actor, reportId, 'freeze');

export const sendMonthlyReport = (actor: Actor, reportId: string): Promise<ReportStatus> =>
  transitionReport(actor, reportId, 'send');

/**
 * Poate pleca factura de mentenanta pe contractul si luna asta?
 *
 * Ecranul de facturare e faza 5. Regula se implementeaza acum, ca precondition
 * verificabila — altfel ar fi o propozitie din plan pe care n-o citeste nimeni
 * peste un an, cand se scrie factura.
 */
export async function maintenanceInvoiceGate(
  actor: Actor,
  contractId: string,
  periodId: string,
): Promise<{ readonly allowed: boolean; readonly reason?: string }> {
  const report = await readMonthlyReport(actor, contractId, periodId);
  if (canIssueMaintenanceInvoice(report?.status ?? null)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason:
      report === null
        ? 'Raportul lunar nu e generat. Factura de mentenanță se emite pe baza lui.'
        : 'Raportul lunar nu e aprobat intern. Factura de mentenanță așteaptă aprobarea.',
  };
}

// ── Raportul web, prin link tokenizat ────────────────────────────────────────

export interface PublicReportVersion {
  readonly reportId: string;
  readonly versionId: string;
  readonly version: number;
  readonly archiveKey: string;
  readonly includedWorkUnitIds: readonly string[];
  readonly expired: boolean;
}

/**
 * Citirea prin token, fara cont.
 *
 * Ruleaza pe actorul de serviciu dinadins: cine deschide linkul n-are sesiune,
 * deci n-are nici scope. **Tokenul E autorizarea**, si de aceea e aleatoriu pe
 * 32 de octeti si are expirare proprie.
 *
 * Un token expirat intoarce `expired`, nu `null`: pagina trebuie sa spuna
 * „linkul a expirat", nu „nu exista" — omul are linkul in mana, si diferenta il
 * scuteste de un telefon.
 */
export async function readPublicReport(token: string): Promise<PublicReportVersion | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    return null;
  }

  return withServiceActor('reports.public', async (tx) => {
    const rows = await tx.execute<{
      id: string;
      report_id: string;
      version: number;
      archive_key: string;
      included_work_unit_ids: string[];
      /*
       * `string`, nu `Date`: pe interogarile scrise de mana (`tx.execute`)
       * driverul intoarce timestamp-ul asa cum vine de pe fir, iar tiparea lui
       * ca `Date` a fost exact felul de minciuna care trece de typecheck si
       * cade la prima rulare. Se converteste explicit mai jos.
       */
      expires_at: string;
    }>(sql`
      select id, report_id, version, archive_key, included_work_unit_ids,
             web_token_expires_at as expires_at
        from app.monthly_report_versions where web_token = ${token} limit 1`);

    const row = rows.rows[0];
    if (row === undefined) {
      return null;
    }

    return {
      reportId: row.report_id,
      versionId: row.id,
      version: row.version,
      archiveKey: row.archive_key,
      includedWorkUnitIds: row.included_work_unit_ids,
      expired: new Date(row.expires_at).getTime() < Date.now(),
    };
  });
}

/**
 * Poza ceruta din raportul web: e chiar dintre cele incluse in versiunea asta?
 *
 * Verificarea nu e o formalitate. Fara ea, un token de raport ar deveni o cheie
 * catre orice fisier din ERP, cu un `versionId` ghicit — adica exact modelul de
 * scurgere pe care il evita tot pasul 07.
 */
export async function resolvePublicReportPhoto(
  token: string,
  versionId: string,
): Promise<{ readonly blobKey: string; readonly mime: string } | null> {
  const report = await readPublicReport(token);
  if (report === null || report.expired || report.includedWorkUnitIds.length === 0) {
    return null;
  }

  return withServiceActor('reports.public', async (tx) => {
    const rows = await tx.execute<{ blob_key: string; mime: string }>(sql`
      select fv.blob_key, fv.mime
        from app.file_versions fv
        join app.nodes n on n.id = fv.node_id
       where fv.id = ${versionId}::uuid
         and fv.state = 'ready'
         and n.deleted_at is null
         and n.work_unit_id = any(${uuidArray(report.includedWorkUnitIds)})
       limit 1`);

    const row = rows.rows[0];
    return row === undefined ? null : { blobKey: row.blob_key, mime: row.mime };
  });
}

/** Token de link public: 32 de octeti aleatori, in base64url. */
export function newReportToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * `any(array[...]::uuid[])` scris ca literal.
 *
 * Id-urile vin din baza, nu de la utilizator; filtrul de forma e plasa de
 * siguranta care face ca lucrul asta sa ramana adevarat si daca maine cheama
 * cineva functia cu altceva.
 */
function uuidArray(ids: readonly string[]): ReturnType<typeof sql.raw> {
  const safe = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id));
  return sql.raw(`array[${safe.map((id) => `'${id}'`).join(',')}]::uuid[]`);
}
