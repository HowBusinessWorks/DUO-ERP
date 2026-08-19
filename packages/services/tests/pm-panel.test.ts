import { closeConnections, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { readPmPanel } from '../src/pm-panel';
import { TEST_PERSON_ID } from './global-setup';
import { officeActor } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Verificarile #27 si #28 ale pasului 10, capat la capat.
 *
 * Ce nu poate prinde testul de domeniu: ca cifrele chiar ies din tabelele bune.
 * `aggregateDeltaFill` e testat separat, pe numere; aici se verifica drumul —
 * plafon din `component_ceilings`, consum din `cost_lines`, progres din
 * `work_stages` — si ca cele trei se intalnesc pe acelasi rand de panou.
 */

interface Ground {
  readonly companyId: string;
  readonly contractId: string;
  readonly objectiveId: string;
  readonly contractObjectiveId: string;
  readonly mentenanta: string;
  readonly delta: string;
  readonly periodId: string;
  readonly year: number;
  readonly month: number;
}

/**
 * Luna de test e cea curenta: `deltaFill` judeca ritmul fata de ceas, iar o luna
 * fixa ar fi „incheiata" si ar da mereu 0 zile ramase.
 */
async function ground(options: { readonly owned: boolean } = { owned: true }): Promise<Ground> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const contractId = uuidv7();
  const objectiveId = uuidv7();
  const contractObjectiveId = uuidv7();
  const mentenanta = uuidv7();
  const delta = uuidv7();
  const periodId = uuidv7();
  const tag = companyId.slice(-8);
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  await withActor(officeActor('pregatire teren de test'), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`,
    );
    await tx.execute(
      sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`,
    );
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status, owner_person_id)
      values (${contractId}, ${companyId}, ${clientId}, ${`C-${tag}`},
              'mentenanta_multianual', '2020-01-01', '2035-12-31', 'activ',
              ${options.owned ? TEST_PERSON_ID : null})`);
    await tx.execute(sql`
      insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
      values (${mentenanta}, ${contractId}, 'mentenanta', 'Mentenanta', 'lunar', false),
             (${delta}, ${contractId}, 'delta', 'Delta', 'lunar', true)`);
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
    objectiveId,
    contractObjectiveId,
    mentenanta,
    delta,
    periodId,
    year,
    month,
  };
}

async function setDelta(base: Ground, ceiling: string, allocated: string): Promise<void> {
  await withActor(officeActor('plafon de venit pentru test'), async (tx) => {
    await tx.execute(sql`
      insert into app.component_ceilings (id, component_id, period_id, revenue_ceiling, allocated_revenue, set_by)
      values (${uuidv7()}, ${base.delta}, ${base.periodId}, ${ceiling}, ${allocated}, ${TEST_PERSON_ID})`);
  });
}

/** O lucrare cu buget, cu etape si cu consum real in registru. */
async function lucrare(
  base: Ground,
  input: {
    readonly costBudget: string;
    readonly consumed: string;
    /** Cate etape din cele patru sunt terminate. */
    readonly stagesDone: number;
  },
): Promise<string> {
  const workUnitId = uuidv7();
  const stageIds = [uuidv7(), uuidv7(), uuidv7(), uuidv7()];
  const tag = workUnitId.slice(-8);
  const today = new Date().toISOString().slice(0, 10);

  await withActor(officeActor('lucrare de test'), async (tx) => {
    await tx.execute(sql`
      insert into app.work_units
        (id, company_id, type, code, name, objective_id, contract_objective_id, status, starts_on, cost_budget)
      values (${workUnitId}, ${base.companyId}, 'lucrare', ${`L-${tag}`}, 'Inlocuire conducta',
              ${base.objectiveId}, ${base.contractObjectiveId}, 'in_executie', ${today},
              ${input.costBudget})`);

    for (const [index, stageId] of stageIds.entries()) {
      const done = index < input.stagesDone;
      await tx.execute(sql`
        insert into app.work_stages (id, work_unit_id, position, name, pct_of_work, actual_start, actual_end)
        values (${stageId}, ${workUnitId}, ${index + 1}, ${`Etapa ${String(index + 1)}`}, '0.2500',
                ${today}, ${done ? today : null})`);
    }

    // Linia de cost: `period_id` se completeaza din trigger, dupa `effect_date`.
    await tx.execute(sql`
      insert into app.cost_lines
        (id, company_id, document_date, effect_date, used_contract_id, used_component_id,
         objective_id, work_unit_id, stage_id, charged_contract_id, charged_component_id,
         expense_type, amount, stage, document_type, document_id, created_by)
      values (${uuidv7()}, ${base.companyId}, ${today}, ${today}, ${base.contractId}, ${base.mentenanta},
              ${base.objectiveId}, ${workUnitId}, ${stageIds[0] ?? null}, ${base.contractId}, ${base.mentenanta},
              'material', ${input.consumed}, 'consumat', 'bon_consum', ${uuidv7()}, ${TEST_PERSON_ID})`);
  });

  return workUnitId;
}

describe('readPmPanel — Delta (verificarea #27)', () => {
  it('gauge-ul se umple, si leii liberi sunt cei care se pierd daca luna se inchide asa', async () => {
    const base = await ground();
    await setDelta(base, '12000.00', '8040.00');

    const panel = await readPmPanel(
      officeActor(),
      TEST_PERSON_ID,
      [base.companyId],
      base.year,
      base.month,
    );

    expect(panel.scope).toBe('mine');
    expect(Math.round(panel.delta.fillPercent)).toBe(67);
    expect(panel.delta.unfilled.toDbString()).toBe('3960.00');
    // Zilele ramase se numara INCLUSIV ziua curenta — regula lui `deltaFill`.
    expect(panel.delta.daysLeft).toBeGreaterThan(0);

    const card = panel.contracts.find((row) => row.contractId === base.contractId);
    expect(card?.fill?.unfilled.toDbString()).toBe('3960.00');
  });

  it('plafonul nesetat nu se numara ca zero — se numara separat', async () => {
    const base = await ground();

    const panel = await readPmPanel(
      officeActor(),
      TEST_PERSON_ID,
      [base.companyId],
      base.year,
      base.month,
    );

    expect(panel.delta.state).toBe('nesetat');
    expect(panel.deltaUnset).toBe(1);
  });

  it('fara contracte pe numele meu, panoul spune ca arata toate contractele', async () => {
    const base = await ground({ owned: false });
    await setDelta(base, '10000.00', '1000.00');

    const panel = await readPmPanel(
      officeActor(),
      uuidv7(),
      [base.companyId],
      base.year,
      base.month,
    );

    expect(panel.scope).toBe('toate');
    expect(panel.contracts.map((row) => row.contractId)).toContain(base.contractId);
  });
});

describe('readPmPanel — lucrari in risc (verificarea #28)', () => {
  it('consum 68% peste progres 50% intra in lista, cu decalajul scris', async () => {
    const base = await ground();
    // Doua etape din patru, ponderate egal: 50% executat. Consumat: 6.800 din 10.000.
    const workUnitId = await lucrare(base, {
      costBudget: '10000.00',
      consumed: '6800.00',
      stagesDone: 2,
    });

    const panel = await readPmPanel(
      officeActor(),
      TEST_PERSON_ID,
      [base.companyId],
      base.year,
      base.month,
    );

    const row = panel.atRisk.find((item) => item.workUnitId === workUnitId);
    expect(row).toBeDefined();
    expect(Math.round(row?.consumedPercent ?? 0)).toBe(68);
    expect(Math.round(row?.progressPercent ?? 0)).toBe(50);
    expect(Math.round(row?.risk.gap ?? 0)).toBe(18);
    expect(row?.risk.severity).toBe('critic');
    // Ponderile sunt scrise pe etape, si ecranul trebuie sa poata spune asta.
    expect(row?.weighted).toBe(true);
  });

  it('munca inaintea banilor nu e risc', async () => {
    const base = await ground();
    const workUnitId = await lucrare(base, {
      costBudget: '10000.00',
      consumed: '2000.00',
      stagesDone: 3,
    });

    const panel = await readPmPanel(
      officeActor(),
      TEST_PERSON_ID,
      [base.companyId],
      base.year,
      base.month,
    );

    expect(panel.atRisk.map((row) => row.workUnitId)).not.toContain(workUnitId);
  });
});

describe('readPmPanel — de aprobat', () => {
  it('numara fisele nevalidate si nu le arata pe cele validate', async () => {
    const base = await ground();
    const workUnitId = uuidv7();
    const tag = workUnitId.slice(-8);
    const today = new Date().toISOString().slice(0, 10);

    await withActor(officeActor('interventie de test'), async (tx) => {
      await tx.execute(sql`
        insert into app.work_units
          (id, company_id, type, code, name, objective_id, contract_objective_id, status, starts_on)
        values (${workUnitId}, ${base.companyId}, 'interventie', ${`V-${tag}`}, 'Schimbat garnitura',
                ${base.objectiveId}, ${base.contractObjectiveId}, 'in_executie', ${today})`);
      // Randul de fisa se naste din trigger (migrarea 0028).
      await tx.execute(sql`
        update app.interventions set description = 'Test' where work_unit_id = ${workUnitId}`);
    });

    const panel = await readPmPanel(
      officeActor(),
      TEST_PERSON_ID,
      [base.companyId],
      base.year,
      base.month,
    );

    const interventions = panel.approvals.find((row) => row.kind === 'interventii');
    expect(interventions?.count).toBe(1);
    // Cardul arata doar ce are ceva de aratat: zero nu ocupa un rand.
    expect(panel.approvals.every((row) => row.count > 0)).toBe(true);
  });

  it('firme neselectate inseamna panou gol, nu panou pe tot grupul', async () => {
    const panel = await readPmPanel(officeActor(), TEST_PERSON_ID, [], 2026, 8);

    expect(panel.contracts).toEqual([]);
    expect(panel.approvals).toEqual([]);
    expect(panel.atRisk).toEqual([]);
    expect(panel.delta.state).toBe('nesetat');
  });
});
