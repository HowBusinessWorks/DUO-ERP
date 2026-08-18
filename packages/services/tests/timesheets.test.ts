import { closeConnections, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  declareSubcontractorAttendance,
  listSubcontractorAttendance,
  listTimesheetWeek,
  listUnvalidatedTimesheets,
  saveTimesheet,
  validateTimesheets,
} from '../src/timesheets';
import { createStage, createWorkUnit } from '../src/work-units';
import { officeActor, rejection } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce apara fisierul asta: cele doua reguli ale pontajului (§3.3).
 *
 *  - **ziua se imparte pe mai multe unitati**, iar maximul de 24 se verifica pe
 *    TOTALUL zilei, nu pe linie (verificarile #12, #13);
 *  - **tariful se ingheata la validare**, cu cel valabil la ziua lucrata — de
 *    acolo, o schimbare de tarif nu mai atinge un cost deja raportat (#14, #15).
 *
 * Al treilea lucru pe care il apara e o omisiune deliberata: prezenta
 * subcontractantului **nu produce cost** (regula 6). E instrument de control,
 * nu de plata, iar un test care verifica absenta e singurul fel de a o pastra.
 */

interface Ground {
  readonly companyId: string;
  readonly personId: string;
  readonly subcontractorId: string;
  readonly unitA: string;
  readonly unitB: string;
  readonly stageA: string;
  readonly stageB: string;
  readonly workDate: string;
  readonly nextDate: string;
  readonly qualificationId: string;
}

async function ground(): Promise<Ground> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const contractId = uuidv7();
  const componentId = uuidv7();
  const objectiveId = uuidv7();
  const contractObjectiveId = uuidv7();
  const periodId = uuidv7();
  const qualificationId = uuidv7();
  const personId = uuidv7();
  const subcontractorId = uuidv7();
  const tag = companyId.slice(-8);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const workDate = `${String(year)}-${String(month).padStart(2, '0')}-10`;
  const nextDate = `${String(year)}-${String(month).padStart(2, '0')}-11`;

  await withActor(officeActor('pregatire teren de test'), async (tx) => {
    await tx.execute(sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`);
    await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`);
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
      values (${contractId}, ${companyId}, ${clientId}, ${`C-${tag}`},
              'mentenanta_multianual', '2020-01-01', '2035-12-31', 'activ')`);
    await tx.execute(sql`
      insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
      values (${componentId}, ${contractId}, 'lucrari', 'Lucrari', 'lunar', false)`);
    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`OB-${tag}`}, 'Statia de pompare', 'statie_pompare')`);
    await tx.execute(sql`
      insert into app.contract_objectives (id, contract_id, objective_id, valid_from)
      values (${contractObjectiveId}, ${contractId}, ${objectiveId}, '2020-01-01')`);
    await tx.execute(sql`
      insert into app.periods (id, company_id, year, month)
      values (${periodId}, ${companyId}, ${year}, ${month})`);
    await tx.execute(sql`
      insert into app.document_series (id, company_id, document_type, series, next_number)
      values (${uuidv7()}, ${companyId}, 'lucrare', 'L', 1)`);

    await tx.execute(sql`
      insert into app.qualifications (id, code, name) values (${qualificationId}, ${`Q-${tag}`}, 'Instalator')`);
    // 40 × 1,45 × 1,15 = 66,70 lei/ora.
    await tx.execute(sql`
      insert into app.rate_cards
        (id, qualification_id, valid_from, valid_to, hourly_salary, tax_coefficient, unproductivity_coefficient)
      values (${uuidv7()}, ${qualificationId}, '2020-01-01', null, '40.00', '0.4500', '0.1500')`);
    await tx.execute(sql`
      insert into app.persons (id, persona, category, full_name, qualification_id)
      values (${personId}, 'field', 'angajat', ${`Muncitor ${tag}`}, ${qualificationId})`);
    await tx.execute(sql`
      insert into app.person_company_access (person_id, company_id) values (${personId}, ${companyId})`);
    await tx.execute(sql`
      insert into app.person_authorizations (id, person_id, kind, issued_at, expires_at)
      values (${uuidv7()}, ${personId}, 'ssm', '2020-01-01', '2035-12-31')`);
    await tx.execute(sql`
      insert into app.subcontractors (id, name) values (${subcontractorId}, ${`Sub ${tag}`})`);
  });

  const unitOf = async (name: string): Promise<string> => {
    const created = await createWorkUnit(officeActor(), {
      workUnit: {
        companyId,
        type: 'lucrare',
        name,
        objectiveId,
        contractObjectiveId,
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
          contractId,
          componentId,
          periodId,
          allocatedAmount: '2000',
          allocatedPct: '',
          reason: 'Finantare de test.',
        },
      ],
      assignments: [{ personId, role: 'echipa', validFrom: '', validTo: '' }],
    });
    return created.id;
  };

  const unitA = await unitOf('Lucrarea A');
  const unitB = await unitOf('Lucrarea B');

  const stageOf = async (workUnitId: string): Promise<string> => {
    const created = await createStage(officeActor(), {
      workUnitId,
      name: 'Etapa unica',
      plannedStart: '',
      plannedEnd: '',
      materialBudget: '',
      laborBudget: '',
      pctOfWork: '',
    });
    return created.id;
  };

  return {
    companyId,
    personId,
    subcontractorId,
    unitA,
    unitB,
    stageA: await stageOf(unitA),
    stageB: await stageOf(unitB),
    workDate,
    nextDate,
    qualificationId,
  };
}

const splitDay = (base: Ground) => ({
  companyId: base.companyId,
  personId: base.personId,
  workDate: base.workDate,
  lines: [
    { workUnitId: base.unitA, stageId: base.stageA, hours: '5' },
    { workUnitId: base.unitB, stageId: base.stageB, hours: '3' },
  ],
});

describe('pontajul', () => {
  it('împarte ziua pe mai multe unități și o rescrie la a doua salvare', async () => {
    const base = await ground();

    const first = await saveTimesheet(officeActor(), splitDay(base));
    expect(first.totalHours.toDbString()).toBe('8.0000');

    const second = await saveTimesheet(officeActor(), splitDay(base));
    // Acelasi pontaj, nu un al doilea pe aceeasi zi.
    expect(second.id).toBe(first.id);

    const week = await listTimesheetWeek(officeActor(), {
      companyIds: [base.companyId],
      from: base.workDate,
      to: base.nextDate,
      personId: base.personId,
    });
    expect(week.sheets).toHaveLength(1);
    expect(week.sheets[0]?.lines).toHaveLength(2);
    expect(week.byPerson.get(base.personId)?.toDbString()).toBe('8.0000');
    expect(week.byWorkUnit.get(base.unitA)?.toDbString()).toBe('5.0000');
  });

  it('verifică maximul de 24 pe TOTALUL zilei, nu pe linie', async () => {
    const base = await ground();

    // Nicio linie nu depaseste singura 24; suma lor, da.
    const failure = await rejection(
      saveTimesheet(officeActor(), {
        ...splitDay(base),
        lines: [
          { workUnitId: base.unitA, stageId: base.stageA, hours: '20' },
          { workUnitId: base.unitB, stageId: base.stageB, hours: '6' },
        ],
      }),
    );
    expect((failure as { code?: string }).code).toBe('VALIDATION_FAILED');
    expect((failure as Error).message).toMatch(/24/);
  });

  it('pontajul pe o lucrare cere etapă', async () => {
    const base = await ground();

    const failure = await rejection(
      saveTimesheet(officeActor(), {
        companyId: base.companyId,
        personId: base.personId,
        workDate: base.workDate,
        lines: [{ workUnitId: base.unitA, stageId: '', hours: '8' }],
      }),
    );
    expect(failure).toBeDefined();
    expect((failure as { code?: string }).code).toBe('VALIDATION_FAILED');
  });

  it('validarea îngheață tariful zilei lucrate și produce cost pe fiecare linie', async () => {
    const base = await ground();
    await saveTimesheet(officeActor(), splitDay(base));

    const pending = await listUnvalidatedTimesheets(officeActor(), {
      companyIds: [base.companyId],
      from: base.workDate,
      to: base.nextDate,
    });
    expect(pending).toHaveLength(1);

    const result = await validateTimesheets(officeActor(), {
      timesheetIds: pending.map((row) => row.id),
      effectDate: '',
    });
    expect(result).toMatchObject({ validated: 1, costLines: 2, failures: [] });

    const frozen = await withActor(officeActor(), async (tx) => {
      const lines = await tx.execute<{ hourly_cost: string }>(sql`
        select tl.hourly_cost from app.timesheet_lines tl
          join app.timesheets t on t.id = tl.timesheet_id
         where t.person_id = ${base.personId} order by tl.hours desc`);
      const costs = await tx.execute<{ amount: string; expense_type: string }>(sql`
        select amount, expense_type from app.cost_lines
         where document_type = 'pontaj' and work_unit_id = ${base.unitA}`);
      return { lines: lines.rows, costs: costs.rows };
    });

    expect(frozen.lines.every((line) => line.hourly_cost === '66.70')).toBe(true);
    // 5 ore × 66,70 = 333,50.
    expect(frozen.costs).toEqual([{ amount: '333.50', expense_type: 'manopera_proprie' }]);
  });

  it('o schimbare de tarif de după validare nu mai atinge costul (#15)', async () => {
    const base = await ground();
    await saveTimesheet(officeActor(), splitDay(base));
    const pending = await listUnvalidatedTimesheets(officeActor(), {
      companyIds: [base.companyId],
      from: base.workDate,
      to: base.nextDate,
    });
    await validateTimesheets(officeActor(), {
      timesheetIds: pending.map((row) => row.id),
      effectDate: '',
    });

    await withActor(officeActor('marire de tarif'), async (tx) => {
      await tx.execute(sql`
        update app.rate_cards set valid_to = ${base.workDate}
         where qualification_id = ${base.qualificationId}`);
      await tx.execute(sql`
        insert into app.rate_cards
          (id, qualification_id, valid_from, valid_to, hourly_salary, tax_coefficient, unproductivity_coefficient)
        values (${uuidv7()}, ${base.qualificationId}, ${base.workDate}, null, '80.00', '0.4500', '0.1500')`);
    });

    const after = await withActor(officeActor(), async (tx) =>
      tx.execute<{ amount: string }>(sql`
        select amount from app.cost_lines
         where document_type = 'pontaj' and work_unit_id = ${base.unitA}`),
    );
    expect(after.rows[0]?.amount).toBe('333.50');
  });

  it('o zi validată nu se mai schimbă și nu se mai validează', async () => {
    const base = await ground();
    const saved = await saveTimesheet(officeActor(), splitDay(base));
    await validateTimesheets(officeActor(), { timesheetIds: [saved.id], effectDate: '' });

    const again = await validateTimesheets(officeActor(), {
      timesheetIds: [saved.id],
      effectDate: '',
    });
    expect(again.validated).toBe(0);
    expect(again.failures).toHaveLength(1);

    const write = await rejection(saveTimesheet(officeActor(), splitDay(base)));
    expect((write as { code?: string }).code).toBe('CONFLICT');
  });

  it('prezența subcontractantului se rescrie pe (unitate, firmă, zi) și NU produce cost', async () => {
    const base = await ground();

    await declareSubcontractorAttendance(officeActor(), {
      workUnitId: base.unitA,
      subcontractorId: base.subcontractorId,
      workDate: base.workDate,
      headcount: 4,
    });
    await declareSubcontractorAttendance(officeActor(), {
      workUnitId: base.unitA,
      subcontractorId: base.subcontractorId,
      workDate: base.workDate,
      headcount: 6,
    });

    const rows = await listSubcontractorAttendance(officeActor(), base.unitA);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.headcount).toBe(6);

    // Regula 6: instrument de control, nu de plata.
    const costs = await withActor(officeActor(), async (tx) =>
      tx.execute<{ n: string }>(sql`
        select count(*)::text as n from app.cost_lines where work_unit_id = ${base.unitA}`),
    );
    expect(costs.rows[0]?.n).toBe('0');
  });
});
