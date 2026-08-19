import { closeConnections, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  approveMonthlyReport,
  completeReportVersion,
  freezeMonthlyReport,
  maintenanceInvoiceGate,
  newReportToken,
  readMonthlyReport,
  readPublicReport,
  readReportComposition,
  readReportSheets,
  requestMonthlyReport,
  sendMonthlyReport,
} from '../src/monthly-reports';
import { TEST_PERSON_ID } from './global-setup';
import { officeActor, rejection } from './helpers';

/** Rapoartele create aici, ca sa le putem curata joburile la final. */
const created: string[] = [];

afterAll(async () => {
  if (created.length > 0) {
    // Pe o baza cu worker pornit (dezvoltare), joburile testului ar fi executate
    // pe bune, cu R2 cu tot. Se sterg imediat ce testul si-a luat raspunsul.
    await withActor(officeActor('curatenie dupa test'), async (tx) => {
      await tx.execute(sql`
        delete from jobs.job
         where name = 'reports.monthly'
           and data->>'reportId' = any(${sql.raw(`array[${created.map((id) => `'${id}'`).join(',')}]::text[]`)})`);
    });
  }

  await closeConnections();
});

/**
 * Raportul lunar (pasul 10, §3.6) — verificarile #21–#24 si #26.
 *
 * Ce nu poate prinde testul de domeniu: ca fisele chiar ies din tabelele bune si
 * pe legatura buna. Legatura fisa → contract e **alocarea de finantare**, iar
 * asta e presupunerea care ar trece neobservata daca s-ar strica: raportul ar
 * ramane gol si ar parea ca luna n-a avut activitate.
 */

interface Ground {
  readonly companyId: string;
  readonly contractId: string;
  readonly componentId: string;
  readonly objectiveId: string;
  readonly contractObjectiveId: string;
  readonly periodId: string;
  readonly year: number;
  readonly month: number;
  readonly firstDay: string;
}

async function ground(): Promise<Ground> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const contractId = uuidv7();
  const componentId = uuidv7();
  const objectiveId = uuidv7();
  const contractObjectiveId = uuidv7();
  const periodId = uuidv7();
  const tag = companyId.slice(-8);
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const firstDay = `${String(year)}-${String(month).padStart(2, '0')}-01`;

  await withActor(officeActor('teren de test pentru raportul lunar'), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`,
    );
    await tx.execute(
      sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`,
    );
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status, owner_person_id)
      values (${contractId}, ${companyId}, ${clientId}, ${`C-${tag}`},
              'mentenanta_multianual', '2020-01-01', '2035-12-31', 'activ', ${TEST_PERSON_ID})`);
    await tx.execute(sql`
      insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
      values (${componentId}, ${contractId}, 'mentenanta', 'Mentenanta', 'lunar', false)`);
    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`OB-${tag}`}, 'Statia de pompare', 'statie_pompare')`);
    await tx.execute(sql`
      insert into app.contract_objectives (id, contract_id, objective_id, valid_from)
      values (${contractObjectiveId}, ${contractId}, ${objectiveId}, '2020-01-01')`);
    await tx.execute(sql`
      insert into app.periods (id, company_id, year, month)
      values (${periodId}, ${companyId}, ${year}, ${month})`);
  });

  return {
    companyId,
    contractId,
    componentId,
    objectiveId,
    contractObjectiveId,
    periodId,
    year,
    month,
    firstDay,
  };
}

/** O inspectie finantata din contract, validata sau nu. */
async function inspectie(base: Ground, validated: boolean): Promise<string> {
  const workUnitId = uuidv7();
  const checklistId = uuidv7();
  const tag = workUnitId.slice(-8);

  await withActor(officeActor('inspectie de test'), async (tx) => {
    await tx.execute(sql`
      insert into app.checklists (id, code, name, objective_kind, version, is_active)
      values (${checklistId}, ${`CHK-${tag}`}, 'Fisa de test', 'statie_pompare', 1, true)`);
    await tx.execute(sql`
      insert into app.work_units
        (id, company_id, type, code, name, objective_id, contract_objective_id, status, starts_on)
      values (${workUnitId}, ${base.companyId}, 'inspectie', ${`I-${tag}`}, 'Inspectia de test',
              ${base.objectiveId}, ${base.contractObjectiveId}, 'in_executie', ${base.firstDay})`);
    await tx.execute(sql`
      insert into app.inspections
        (work_unit_id, checklist_id, checklist_version, performed_on, effect_date, validated_at, validated_by)
      values (${workUnitId}, ${checklistId}, 1, ${base.firstDay},
              ${validated ? base.firstDay : null},
              ${validated ? new Date().toISOString() : null},
              ${validated ? TEST_PERSON_ID : null})`);
    await tx.execute(sql`
      insert into app.funding_allocations
        (id, work_unit_id, contract_id, component_id, period_id, allocated_amount, reason, created_by)
      values (${uuidv7()}, ${workUnitId}, ${base.contractId}, ${base.componentId}, ${base.periodId},
              '100.00', 'finantare de test', ${TEST_PERSON_ID})`);
  });

  return workUnitId;
}

/** Ce face worker-ul dupa ce a randat artefactul, fara sa atinga R2. */
async function generatedVersion(
  reportId: string,
  version: number,
  workUnitIds: readonly string[],
): Promise<string> {
  const token = newReportToken();
  await completeReportVersion(officeActor('versiune de test'), {
    reportId,
    version,
    archiveKey: `reports/${reportId}/v${String(version)}.html`,
    artifactNodeId: null,
    webToken: token,
    webTokenExpiresAt: new Date(Date.now() + 86_400_000),
    includedWorkUnitIds: workUnitIds,
    inspectionCount: workUnitIds.length,
    interventionCount: 0,
    journalCount: 0,
    photoCount: 0,
    sizeBytes: 1024,
    generatedBy: TEST_PERSON_ID,
  });
  return token;
}

/** `requestMonthlyReport`, cu raportul retinut pentru curatenia de la final. */
async function askForReport(base: Ground): Promise<{ reportId: string; version: number }> {
  const result = await requestMonthlyReport(officeActor(), {
    contractId: base.contractId,
    periodId: base.periodId,
    templateId: 'standard',
  });
  created.push(result.reportId);
  return { reportId: result.reportId, version: result.version };
}

describe('readReportComposition — ce intra si ce nu (verificarea #21)', () => {
  it('numara fisele validate ale lunii si le tine separat pe cele nevalidate', async () => {
    const base = await ground();
    const included = await inspectie(base, true);
    const pending = await inspectie(base, false);

    const composition = await readReportComposition(officeActor(), base.contractId, base.periodId);

    expect(composition.inspections).toBe(1);
    expect(composition.includedWorkUnitIds).toEqual([included]);
    expect(composition.unvalidated.map((row) => row.workUnitId)).toEqual([pending]);
    // Fisa nevalidata are link, adica are cod si nume — nu doar un numar.
    expect(composition.unvalidated[0]?.code).toMatch(/^I-/);
  });

  it('fisele lunii intra prin ALOCARE, nu prin legatura obiectiv × contract', async () => {
    const base = await ground();
    const workUnitId = await inspectie(base, true);

    await withActor(officeActor('retragerea finantarii'), async (tx) => {
      await tx.execute(sql`
        update app.funding_allocations set status = 'superseded'
         where work_unit_id = ${workUnitId}`);
    });

    const composition = await readReportComposition(officeActor(), base.contractId, base.periodId);

    expect(composition.inspections).toBe(0);
    expect(composition.includedWorkUnitIds).toEqual([]);
  });

  it('detaliile fiselor incluse se citesc fara nicio coloana de pret', async () => {
    const base = await ground();
    const workUnitId = await inspectie(base, true);

    const sheets = await readReportSheets(
      officeActor(),
      [workUnitId],
      base.firstDay,
      base.firstDay,
    );

    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.kind).toBe('inspectie');
    expect(sheets[0]?.objectiveName).toBe('Statia de pompare');
    expect(Object.keys(sheets[0] ?? {})).not.toContain('amount');
  });
});

describe('requestMonthlyReport — coada si versiunile (#24, #26)', () => {
  it('a doua cerere in timp ce prima ruleaza e refuzata, nu produce a doua versiune', async () => {
    const base = await ground();
    await inspectie(base, true);

    const first = await askForReport(base);

    expect(first.version).toBe(1);

    const error = await rejection(askForReport(base));

    expect(String(error)).toContain('generează deja');
  });

  it('regenerarea dupa inghet produce versiunea 2, iar versiunea 1 ramane intacta', async () => {
    const base = await ground();
    const workUnitId = await inspectie(base, true);

    const first = await askForReport(base);
    const tokenV1 = await generatedVersion(first.reportId, first.version, [workUnitId]);

    await approveMonthlyReport(officeActor(), first.reportId);
    await freezeMonthlyReport(officeActor(), first.reportId);
    await sendMonthlyReport(officeActor(), first.reportId);

    const second = await askForReport(base);
    expect(second.version).toBe(2);
    expect(second.reportId).toBe(first.reportId);

    await generatedVersion(second.reportId, second.version, [workUnitId]);

    const report = await readMonthlyReport(officeActor(), base.contractId, base.periodId);
    expect(report?.versions.map((row) => row.version)).toEqual([2, 1]);

    // Versiunea 1 se deschide in continuare cu tokenul ei — asta e #24.
    const published = await readPublicReport(tokenV1);
    expect(published?.version).toBe(1);
    expect(published?.expired).toBe(false);
  });
});

describe('ordinea starilor si blocajul facturii (#22, precondiția din §3.6)', () => {
  it('nu se ingheata fara aprobare, si nu se trimite fara inghet', async () => {
    const base = await ground();
    const workUnitId = await inspectie(base, true);

    const requested = await askForReport(base);
    await generatedVersion(requested.reportId, requested.version, [workUnitId]);

    expect(
      String(await rejection(freezeMonthlyReport(officeActor(), requested.reportId))),
    ).toContain('aprobat');

    await approveMonthlyReport(officeActor(), requested.reportId);

    expect(String(await rejection(sendMonthlyReport(officeActor(), requested.reportId)))).toContain(
      'înghețat',
    );

    await freezeMonthlyReport(officeActor(), requested.reportId);
    expect(await sendMonthlyReport(officeActor(), requested.reportId)).toBe('sent');
  });

  it('factura de mentenanta e blocata pana la aprobarea interna', async () => {
    const base = await ground();
    const workUnitId = await inspectie(base, true);

    const before = await maintenanceInvoiceGate(officeActor(), base.contractId, base.periodId);
    expect(before.allowed).toBe(false);
    expect(before.reason).toContain('nu e generat');

    const requested = await askForReport(base);
    await generatedVersion(requested.reportId, requested.version, [workUnitId]);

    const generated = await maintenanceInvoiceGate(officeActor(), base.contractId, base.periodId);
    expect(generated.allowed).toBe(false);

    await approveMonthlyReport(officeActor(), requested.reportId);

    const approved = await maintenanceInvoiceGate(officeActor(), base.contractId, base.periodId);
    expect(approved.allowed).toBe(true);
  });
});

describe('readPublicReport — linkul tokenizat (#25)', () => {
  it('tokenul expirat se recunoaste ca expirat, nu ca inexistent', async () => {
    const base = await ground();
    const workUnitId = await inspectie(base, true);

    const requested = await askForReport(base);

    const token = newReportToken();
    await completeReportVersion(officeActor('versiune expirata'), {
      reportId: requested.reportId,
      version: requested.version,
      archiveKey: `reports/${requested.reportId}/v1.html`,
      artifactNodeId: null,
      webToken: token,
      webTokenExpiresAt: new Date(Date.now() - 1000),
      includedWorkUnitIds: [workUnitId],
      inspectionCount: 1,
      interventionCount: 0,
      journalCount: 0,
      photoCount: 0,
      sizeBytes: 512,
      generatedBy: TEST_PERSON_ID,
    });

    const published = await readPublicReport(token);
    expect(published).not.toBeNull();
    expect(published?.expired).toBe(true);

    expect(await readPublicReport('token-care-nu-exista-dar-are-forma')).toBeNull();
  });
});
