/**
 * Harness aruncabil pentru 09b-3: pontajul, stocul si bonul de consum manual,
 * chemate pe date reale INAINTE de ecrane. Se sterge dupa.
 */
import { closeConnections, loadEnvFiles, schema, withActor, type Actor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  createConsumptionNote,
  createLocation,
  listConsumptionNotes,
  listLocations,
  listStock,
  listTeamOptions,
} from '../src/inventory';
import {
  declareSubcontractorAttendance,
  listSubcontractorAttendance,
  listTimesheetWeek,
  listUnvalidatedTimesheets,
  saveTimesheet,
  validateTimesheets,
} from '../src/timesheets';
import { createStage, createWorkUnit } from '../src/work-units';

loadEnvFiles();

const COMPANY = '01950000-0000-7000-8000-000001000001';
const OBJECTIVE = '01950000-0000-7000-8000-000007000001';
const CONTRACT = '01950000-0000-7000-8000-000004000001';
const CONTRACT_OBJECTIVE = '01a00f46-2ea3-7000-b3b3-785878c01937';
const COMPONENT = '01a00f46-1786-7000-84cb-255b26b7fcc0';
const PM = '01950000-0000-7000-8000-000003000001';
const TAG = String(Date.now()).slice(-6);

const office: Actor = {
  personId: PM,
  persona: 'office',
  pgRole: 'app_office',
  claims: { persona: 'office', person_id: PM, office_roles: ['admin'] },
};
const service: Actor = {
  personId: PM,
  persona: 'office',
  pgRole: 'app_service',
  claims: { persona: 'office', person_id: PM, office_roles: ['admin'] },
  reason: 'smoke 09b-3',
};

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = ''): void {
  console.log(`${ok ? 'OK  ' : 'PICA'}  ${label}${detail === '' ? '' : `  -> ${String(detail)}`}`);
  if (!ok) failures += 1;
}

/** Mesajul Postgres de sub ambalajul drizzle. */
function why(error: unknown): string {
  let current: unknown = error;
  let last = '';
  while (current instanceof Error) {
    last = current.message;
    current = current.cause;
  }
  return last;
}

async function main(): Promise<void> {
  const period = await withActor(office, async (tx) => {
    const rows = await tx.execute<{ id: string; year: number; month: number }>(
      sql`select id, year, month from app.periods
          where company_id = ${COMPANY} and status = 'open' order by year desc, month desc limit 1`,
    );
    return rows.rows[0];
  });
  if (period === undefined) throw new Error('nicio perioada deschisa');

  const workDate = `${period.year}-${String(period.month).padStart(2, '0')}-10`;
  const secondDate = `${period.year}-${String(period.month).padStart(2, '0')}-11`;
  console.log(`perioada ${period.year}-${period.month}, zile ${workDate} si ${secondDate}`);

  const qualificationId = await withActor(office, async (tx) => {
    const rows = await tx.execute<{ id: string }>(
      sql`select rc.qualification_id as id from app.rate_cards rc
          where rc.valid_from <= ${workDate}::date
            and (rc.valid_to is null or rc.valid_to > ${workDate}::date)
          limit 1`,
    );
    return rows.rows[0]?.id;
  });
  if (qualificationId === undefined) throw new Error(`niciun tarif valabil la ${workDate}`);

  // ── Pregatire: om, echipa, gestiune, produs, stoc, doua unitati de lucru ──
  const personId = uuidv7();
  const teamId = uuidv7();
  const productId = uuidv7();
  await withActor(service, async (tx) => {
    await tx.insert(schema.persons).values({
      id: personId,
      persona: 'field',
      category: 'angajat',
      fullName: `Muncitor 09b3 ${TAG}`,
      qualificationId,
    });
    await tx.insert(schema.personCompanyAccess).values({ personId, companyId: COMPANY });
    await tx.insert(schema.personAuthorizations).values({
      id: uuidv7(),
      personId,
      kind: 'ssm',
      issuedAt: '2026-01-01',
      expiresAt: '2027-12-31',
    });
    await tx
      .insert(schema.teams)
      .values({ id: teamId, companyId: COMPANY, name: `Echipa 09b3 ${TAG}` });
    await tx.insert(schema.products).values({
      id: productId,
      code: `SM3-${TAG}`,
      name: `Material 09b3 ${TAG}`,
      uom: 'buc',
      isStockItem: true,
    });
  });

  const location = await createLocation(office, {
    companyId: COMPANY,
    type: 'echipa',
    name: `Gestiune 09b3 ${TAG}`,
    code: `G09B3-${TAG}`,
    parentLocationId: '',
    teamId,
    workUnitId: '',
    subcontractorId: '',
    supplierId: '',
    isCustody: false,
  } as never);

  await withActor(service, async (tx) => {
    await tx.insert(schema.stockMovements).values({
      id: uuidv7(),
      companyId: COMPANY,
      documentType: 'nir',
      documentId: uuidv7(),
      documentLineId: null,
      fromLocationId: null,
      toLocationId: location.id,
      productId,
      lotId: null,
      quantity: '50',
      unitCost: '20',
      effectDate: workDate,
      createdBy: PM,
    });
  });

  const unitOf = async (name: string): Promise<string> => {
    const created = await createWorkUnit(office, {
      workUnit: {
        companyId: COMPANY,
        type: 'lucrare',
        name,
        objectiveId: OBJECTIVE,
        contractObjectiveId: CONTRACT_OBJECTIVE,
        responsiblePersonId: '',
        executorType: 'echipa_proprie',
        executorSubcontractorId: '',
        startsOn: workDate,
        endsOn: '',
        estimatedValue: '',
        costBudget: '',
      },
      series: 'L',
      allocations: [
        {
          contractId: CONTRACT,
          componentId: COMPONENT,
          periodId: period.id,
          allocatedAmount: '2000',
          allocatedPct: '',
          reason: 'Smoke 09b-3.',
        },
      ],
      assignments: [{ personId, role: 'echipa', validFrom: '', validTo: '' }],
    } as never);
    return created.id;
  };

  const unitA = await unitOf(`SMOKE 09b3 A ${TAG}`);
  const unitB = await unitOf(`SMOKE 09b3 B ${TAG}`);
  check('A doua unitati de lucru, cu om asignat pe ele', unitA !== unitB);

  // Pontajul pe o LUCRARE cere etapa (trigger din 0026). Nu e un detaliu de
  // harness: e regula pe care ecranul trebuie s-o respecte, deci si aici.
  const stageOf = async (workUnitId: string): Promise<string> => {
    const created = await createStage(office, {
      workUnitId,
      name: 'Etapa unica',
      plannedStart: '',
      plannedEnd: '',
      materialBudget: '',
      laborBudget: '',
      pctOfWork: '',
    } as never);
    return created.id;
  };
  const stageA = await stageOf(unitA);
  const stageB = await stageOf(unitB);

  const field: Actor = {
    personId,
    persona: 'field',
    pgRole: 'app_field',
    claims: { persona: 'field', person_id: personId, company_ids: [COMPANY] },
  };

  // ── 1. Ziua se imparte pe doua unitati ────────────────────────────────────
  const dayPayload = {
    companyId: COMPANY,
    personId,
    workDate,
    lines: [
      { workUnitId: unitA, stageId: stageA, hours: '5' },
      { workUnitId: unitB, stageId: stageB, hours: '3' },
    ],
  };
  const saved = await saveTimesheet(office, dayPayload as never);
  check('B saveTimesheet imparte ziua pe doua unitati', saved.totalHours.toDbString() === '8.0000', saved.totalHours.toDbString());

  const again = await saveTimesheet(office, dayPayload as never);
  check('B2 a doua salvare rescrie, nu adauga', again.id === saved.id, `${again.id === saved.id ? 'acelasi pontaj' : 'pontaj nou'}`);

  const week = await listTimesheetWeek(office, {
    companyIds: [COMPANY],
    from: workDate,
    to: secondDate,
  });
  const mine = week.sheets.filter((s) => s.personId === personId);
  check('B3 saptamana are o zi cu doua linii', mine.length === 1 && mine[0]?.lines.length === 2, `${mine.length} zile`);
  check('B4 totalul pe om e 8', week.byPerson.get(personId)?.toDbString() === '8.0000', week.byPerson.get(personId)?.toDbString());

  // ── 2. Peste 24 de ore pe zi ──────────────────────────────────────────────
  const tooMuch = await saveTimesheet(office, {
    ...dayPayload,
    workDate: secondDate,
    lines: [
      { workUnitId: unitA, stageId: stageA, hours: '20' },
      { workUnitId: unitB, stageId: stageB, hours: '6' },
    ],
  } as never).catch((error: unknown) => error);
  check('C 26 de ore intr-o zi sunt refuzate', tooMuch instanceof Error, tooMuch instanceof Error ? why(tooMuch) : 'a trecut');

  // ── 3. Terenul isi scrie propriul pontaj ──────────────────────────────────
  const fieldSave = await saveTimesheet(field, {
    companyId: COMPANY,
    personId,
    workDate: secondDate,
    lines: [{ workUnitId: unitA, stageId: stageA, hours: '7' }],
  } as never).catch((error: unknown) => error);
  check(
    'D terenul isi scrie pontajul',
    !(fieldSave instanceof Error),
    fieldSave instanceof Error ? why(fieldSave) : 'salvat',
  );

  // ── 4. Validarea ingheata tariful si produce cost ─────────────────────────
  const pending = await listUnvalidatedTimesheets(office, {
    companyIds: [COMPANY],
    from: workDate,
    to: secondDate,
  });
  const ids = pending.filter((p) => p.personName.includes(TAG)).map((p) => p.id);
  check('E pontajele nevalidate sunt listate', ids.length >= 1, `${ids.length}`);

  const result = await validateTimesheets(office, {
    timesheetIds: ids,
    effectDate: '',
  } as never);
  check(
    'F validateTimesheets',
    result.validated === ids.length && result.failures.length === 0,
    JSON.stringify(result),
  );

  const frozen = await withActor(office, async (tx) => {
    const lines = await tx.execute<{ n: string; nulls: string }>(sql`
      select count(*)::text as n,
             count(*) filter (where tl.hourly_cost is null)::text as nulls
        from app.timesheet_lines tl
        join app.timesheets t on t.id = tl.timesheet_id
       where t.person_id = ${personId}`);
    const costs = await tx.execute<{ n: string; total: string }>(sql`
      select count(*)::text as n, coalesce(sum(amount), 0)::text as total
        from app.cost_lines
       where document_type = 'pontaj' and work_unit_id in (${unitA}, ${unitB})`);
    return { lines: lines.rows[0], costs: costs.rows[0] };
  });
  check('F2 tariful e inghetat pe fiecare linie', frozen.lines?.nulls === '0', `${frozen.lines?.nulls} linii fara tarif`);
  check('F3 fiecare linie a produs o linie de cost', frozen.costs?.n === frozen.lines?.n, `${frozen.costs?.n} costuri / ${frozen.lines?.n} linii`);

  const revalidate = await validateTimesheets(office, { timesheetIds: ids, effectDate: '' } as never);
  check('G a doua validare nu mai valideaza nimic', revalidate.validated === 0 && revalidate.failures.length === ids.length, JSON.stringify(revalidate));

  const afterValidation = await saveTimesheet(office, dayPayload as never).catch(
    (error: unknown) => error,
  );
  check(
    'G2 o zi validata nu se mai schimba',
    afterValidation instanceof Error && (afterValidation as { code?: string }).code === 'CONFLICT',
    afterValidation instanceof Error ? why(afterValidation) : 'a trecut',
  );

  // ── 5. Prezenta subcontractantului ────────────────────────────────────────
  const subcontractorId = await withActor(office, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`select id from app.subcontractors limit 1`);
    return rows.rows[0]?.id;
  });
  if (subcontractorId === undefined) {
    check('H exista un subcontractant de test', false, 'niciunul in baza');
  } else {
    await declareSubcontractorAttendance(office, {
      workUnitId: unitA,
      subcontractorId,
      workDate,
      headcount: 4,
    } as never);
    await declareSubcontractorAttendance(office, {
      workUnitId: unitA,
      subcontractorId,
      workDate,
      headcount: 6,
    } as never);
    const attendance = await listSubcontractorAttendance(office, unitA);
    check(
      'H prezenta se rescrie pe (unitate, firma, zi)',
      attendance.length === 1 && attendance[0]?.headcount === 6,
      JSON.stringify(attendance),
    );

    const noCost = await withActor(office, async (tx) =>
      tx.execute<{ n: string }>(sql`
        select count(*)::text as n from app.cost_lines
         where work_unit_id = ${unitA} and subcontractor_id = ${subcontractorId}`),
    );
    check('H2 prezenta NU produce cost (regula 6)', noCost.rows[0]?.n === '0', noCost.rows[0]?.n);
  }

  // ── 6. Gestiuni si stoc ───────────────────────────────────────────────────
  const locations = await listLocations(office, { companyIds: [COMPANY], type: 'echipa' });
  check('I gestiunile de echipa se listeaza', locations.some((l) => l.id === location.id), `${locations.length}`);

  const teams = await listTeamOptions(office, [COMPANY]);
  const team = teams.find((t) => t.id === teamId);
  check('I2 echipa isi stie gestiunea', team?.locationId === location.id, team?.locationName ?? 'fara gestiune');

  const stock = await listStock(office, { companyIds: [COMPANY], locationId: location.id });
  const line = stock.find((s) => s.productId === productId);
  check(
    'J stocul are fizic / rezervat / disponibil',
    line?.physical.toDbString() === '50.0000' && line?.available.toDbString() === '50.0000',
    JSON.stringify({ fizic: line?.physical.toDbString(), disponibil: line?.available.toDbString(), cmp: line?.avgCost?.toDbString() }),
  );

  const fieldStock = await listStock(field, {
    companyIds: [COMPANY],
    locationId: location.id,
    withCost: false,
  }).catch((error: unknown) => error);
  check(
    'J2 terenul vede stocul fara CMP',
    Array.isArray(fieldStock) && fieldStock.every((s) => s.avgCost === null),
    Array.isArray(fieldStock) ? `${fieldStock.length} randuri` : why(fieldStock),
  );

  const fieldStockMoney = await listStock(field, {
    companyIds: [COMPANY],
    locationId: location.id,
  }).catch((error: unknown) => error);
  check(
    'J3 acelasi stoc CU cost e refuzat terenului',
    fieldStockMoney instanceof Error,
    fieldStockMoney instanceof Error ? why(fieldStockMoney) : 'a trecut',
  );

  // ── 7. Bonul de consum manual ─────────────────────────────────────────────
  const note = await createConsumptionNote(office, {
    companyId: COMPANY,
    series: 'BC',
    locationId: location.id,
    workUnitId: unitA,
    stageId: stageA,
    contractId: CONTRACT,
    componentId: COMPONENT,
    objectiveId: OBJECTIVE,
    documentDate: workDate,
    effectDate: workDate,
    lines: [{ productId, lotId: '', quantity: '5' }],
  } as never).catch((error: unknown) => error);
  check(
    'K bonul manual se emite',
    !(note instanceof Error),
    note instanceof Error ? why(note) : `${(note as { number: string }).number}, total ${(note as { total: { toDbString: () => string } }).total.toDbString()}`,
  );

  if (!(note instanceof Error)) {
    const after = await withActor(office, async (tx) => {
      const balance = await tx.execute<{ qty: string }>(sql`
        select qty_physical as qty from app.stock_balances
         where location_id = ${location.id} and product_id = ${productId}`);
      const costs = await tx.execute<{ n: string; amount: string }>(sql`
        select count(*)::text as n, coalesce(sum(amount), 0)::text as amount
          from app.cost_lines
         where document_type = 'bon_consum' and work_unit_id = ${unitA}`);
      return { balance: balance.rows[0], costs: costs.rows[0] };
    });
    check('K2 soldul a scazut cu 5', after.balance?.qty === '45.0000', after.balance?.qty);
    check('K3 bonul a produs cost 5 x 20 = 100', after.costs?.amount === '100.00', after.costs?.amount);

    const listed = await listConsumptionNotes(office, { companyIds: [COMPANY], workUnitId: unitA });
    check('K4 bonul se regaseste pe unitate', listed.length === 1, `${listed.length}`);
  }

  const overdraft = await createConsumptionNote(office, {
    companyId: COMPANY,
    series: 'BC',
    locationId: location.id,
    workUnitId: unitA,
    stageId: stageA,
    contractId: CONTRACT,
    componentId: COMPONENT,
    objectiveId: OBJECTIVE,
    documentDate: workDate,
    effectDate: workDate,
    lines: [{ productId, lotId: '', quantity: '999' }],
  } as never).catch((error: unknown) => error);
  check(
    'L consumul peste disponibil e refuzat',
    overdraft instanceof Error,
    overdraft instanceof Error ? why(overdraft) : 'a trecut',
  );

  console.log(`\n${failures === 0 ? 'TOATE VERDE' : `${failures} PICATE`}`);
}

await main();
await closeConnections();
process.exit(failures === 0 ? 0 : 1);
