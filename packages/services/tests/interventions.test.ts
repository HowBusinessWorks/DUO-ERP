import { closeConnections, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createIntervention,
  getInterventionSheet,
  listInterventionHours,
  listInterventionMaterials,
  saveIntervention,
  validateIntervention,
} from '../src/interventions';
import { createWorkUnit } from '../src/work-units';
import { officeActor, pgMessage, rejection } from './helpers';
import { TEST_PERSON_ID } from './global-setup';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce apara fisierul asta: **regula 8 a pasului** — validarea unei interventii
 * produce, intr-o singura tranzactie, bonul de consum, miscarile de stoc,
 * liniile de cost si comparatia asteptat-vs-real. Sau niciunul.
 *
 * Plus doua invariante descoperite pe date reale la 09b-2, amandoua tacute:
 *
 *  - randul de fisa se naste din TRIGGER, deci o interventie creata pe drumul
 *    generic (sau din decizia de rutare) are fisa (0028);
 *  - a doua salvare a aceleiasi fise nu dubleaza liniile — `saveIntervention`
 *    inlocuieste, nu adauga.
 */

interface Ground {
  readonly companyId: string;
  readonly contractId: string;
  readonly componentId: string;
  readonly objectiveId: string;
  readonly contractObjectiveId: string;
  readonly periodId: string;
  readonly qualificationId: string;
  readonly personId: string;
  readonly operationId: string;
  readonly productId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly workDate: string;
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
  const operationId = uuidv7();
  const productId = uuidv7();
  const teamId = uuidv7();
  const locationId = uuidv7();
  const tag = companyId.slice(-8);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const workDate = `${String(year)}-${String(month).padStart(2, '0')}-15`;

  await withActor(officeActor('pregatire teren de test'), async (tx) => {
    await tx.execute(sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`);
    await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`);
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
      values (${contractId}, ${companyId}, ${clientId}, ${`C-${tag}`},
              'mentenanta_multianual', '2020-01-01', '2035-12-31', 'activ')`);
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
    await tx.execute(sql`
      insert into app.document_series (id, company_id, document_type, series, next_number)
      values (${uuidv7()}, ${companyId}, 'interventie', 'IV', 1),
             (${uuidv7()}, ${companyId}, 'bon_consum', 'BC', 1)`);

    await tx.execute(sql`
      insert into app.qualifications (id, code, name)
      values (${qualificationId}, ${`Q-${tag}`}, 'Instalator')`);
    await tx.execute(sql`
      insert into app.rate_cards
        (id, qualification_id, valid_from, valid_to, hourly_salary, tax_coefficient, unproductivity_coefficient)
      values (${uuidv7()}, ${qualificationId}, '2020-01-01', null, '40.00', '0.4500', '0.1500')`);
    await tx.execute(sql`
      insert into app.persons (id, persona, category, full_name, qualification_id)
      values (${personId}, 'field', 'angajat', ${`Muncitor ${tag}`}, ${qualificationId})`);
    await tx.execute(sql`
      insert into app.person_company_access (person_id, company_id)
      values (${personId}, ${companyId})`);

    await tx.execute(sql`
      insert into app.operation_catalog
        (id, code, name, standard_hours, qualification_id, estimated_labor, estimated_material, is_active)
      values (${operationId}, ${`OP-${tag}`}, 'Inlocuire garnitura', 4,
              ${qualificationId}, '266.80', '200.00', true)`);

    await tx.execute(sql`
      insert into app.products (id, code, name, uom) values (${productId}, ${`P-${tag}`}, 'Garnitura', 'buc')`);
    await tx.execute(sql`
      insert into app.teams (id, company_id, name) values (${teamId}, ${companyId}, ${`Echipa ${tag}`})`);
    await tx.execute(sql`
      insert into app.locations (id, company_id, type, name, code, team_id)
      values (${locationId}, ${companyId}, 'echipa', ${`Gestiune ${tag}`}, ${`G-${tag}`}, ${teamId})`);

    // Intrare de stoc: 100 buc a 10 lei. Soldul si CMP-ul le face trigger-ul.
    await tx.execute(sql`
      insert into app.stock_movements
        (id, company_id, document_type, document_id, from_location_id, to_location_id,
         product_id, quantity, unit_cost, effect_date, created_by)
      values (${uuidv7()}, ${companyId}, 'nir', ${uuidv7()}, null, ${locationId},
              ${productId}, '100', '10', ${workDate}, ${TEST_PERSON_ID})`);
  });

  return {
    companyId,
    contractId,
    componentId,
    objectiveId,
    contractObjectiveId,
    periodId,
    qualificationId,
    personId,
    operationId,
    productId,
    teamId,
    locationId,
    workDate,
  };
}

async function newIntervention(base: Ground, name = 'Interventie de test'): Promise<string> {
  const created = await createIntervention(officeActor(), {
    companyId: base.companyId,
    objectiveId: base.objectiveId,
    contractObjectiveId: base.contractObjectiveId,
    name,
    series: 'IV',
    performedOn: base.workDate,
    description: '',
    operationId: base.operationId,
    teamId: base.teamId,
    sourceRequestId: '',
    responsiblePersonId: '',
    fundingContractId: base.contractId,
    fundingComponentId: base.componentId,
    fundingPeriodId: base.periodId,
    fundingAmount: '5000',
    fundingReason: 'Mentenanta curenta.',
  });
  return created.id;
}

const fullSheet = (base: Ground, workUnitId: string) => ({
  workUnitId,
  description: 'Inlocuit garnitura.',
  operationId: base.operationId,
  teamId: base.teamId,
  declaredHours: '6',
  materials: [{ productId: base.productId, lotId: '', quantity: '4', locationId: base.locationId }],
  hours: [{ personId: base.personId, hours: '6', workDate: base.workDate }],
});

describe('fisa de interventie', () => {
  it('se naste odata cu unitatea, si pe drumul generic de creare', async () => {
    const base = await ground();

    // Nu prin `createIntervention`: exact drumul pe care fisa lipsea inainte de
    // 0028 — formularul generic de Activitate si decizia de rutare din pasul 08.
    const created = await createWorkUnit(officeActor(), {
      workUnit: {
        companyId: base.companyId,
        type: 'interventie',
        name: 'Interventie pe drumul generic',
        objectiveId: base.objectiveId,
        contractObjectiveId: base.contractObjectiveId,
        responsiblePersonId: '',
        executorType: 'echipa_proprie',
        executorSubcontractorId: '',
        startsOn: base.workDate,
        endsOn: '',
        estimatedValue: '',
        costBudget: '',
      },
      series: 'IV',
      allocations: [
        {
          contractId: base.contractId,
          componentId: base.componentId,
          periodId: base.periodId,
          allocatedAmount: '500',
          allocatedPct: '',
          reason: 'Finantare de test.',
        },
      ],
      assignments: [],
    });

    const sheet = await getInterventionSheet(officeActor(), created.id);
    expect(sheet.performedOn).toBe(base.workDate);
    expect(sheet.validatedAt).toBeNull();
  });

  it('a doua salvare inlocuieste liniile, nu le adauga', async () => {
    const base = await ground();
    const workUnitId = await newIntervention(base);

    await saveIntervention(officeActor(), fullSheet(base, workUnitId));
    await saveIntervention(officeActor(), fullSheet(base, workUnitId));

    const materials = await listInterventionMaterials(officeActor(), workUnitId);
    const hours = await listInterventionHours(officeActor(), workUnitId);
    expect(materials).toHaveLength(1);
    expect(hours).toHaveLength(1);
    // Pana la validare fisa e o declaratie: costul nu exista inca.
    expect(materials[0]?.unitCost).toBeNull();
  });

  it('validarea produce bon, miscare de stoc si cost — toate odata', async () => {
    const base = await ground();
    const workUnitId = await newIntervention(base);
    await saveIntervention(officeActor(), fullSheet(base, workUnitId));

    const result = await validateIntervention(officeActor(), {
      workUnitId,
      effectDate: base.workDate,
      consumptionSeries: 'BC',
    });

    expect(result.consumptionNoteNumber).not.toBeNull();
    // 4 buc × 10 lei din CMP-ul gestiunii.
    expect(result.materialCost.toDbString()).toBe('40.00');
    // 6 ore × 66,70.
    expect(result.laborCost.toDbString()).toBe('400.20');
    expect(result.realCost.toDbString()).toBe('440.20');

    const after = await withActor(officeActor(), async (tx) => {
      const balance = await tx.execute<{ qty: string }>(sql`
        select qty_physical as qty from app.stock_balances
         where location_id = ${base.locationId} and product_id = ${base.productId}`);
      const costs = await tx.execute<{ expense_type: string; amount: string; stage: string }>(sql`
        select expense_type, amount, stage from app.cost_lines
         where work_unit_id = ${workUnitId} order by expense_type`);
      const movements = await tx.execute<{ n: string }>(sql`
        select count(*)::text as n from app.stock_movements
         where document_type = 'bon_consum' and from_location_id = ${base.locationId}`);
      return { balance: balance.rows[0], costs: costs.rows, movements: movements.rows[0] };
    });

    expect(after.balance?.qty).toBe('96.0000');
    expect(after.movements?.n).toBe('1');
    expect(after.costs).toEqual([
      { expense_type: 'material', amount: '40.00', stage: 'consumat' },
      { expense_type: 'manopera_proprie', amount: '400.20', stage: 'consumat' },
    ]);

    // CMP-ul se ingheata pe linie, la validare — nu la scrierea ei.
    const materials = await listInterventionMaterials(officeActor(), workUnitId);
    expect(materials[0]?.unitCost?.toDbString()).toBe('10.00');
  });

  it('compara realul cu asteptatul din catalog si il scrie pe fisa', async () => {
    const base = await ground();
    const workUnitId = await newIntervention(base);
    await saveIntervention(officeActor(), fullSheet(base, workUnitId));

    await validateIntervention(officeActor(), {
      workUnitId,
      effectDate: base.workDate,
      consumptionSeries: 'BC',
    });

    const sheet = await getInterventionSheet(officeActor(), workUnitId);
    // 266,80 manopera + 200 material = 466,80 asteptat, fata de 440,20 real.
    expect(sheet.variance?.expectedCost?.toDbString()).toBe('466.80');
    expect(sheet.variance?.realCost.toDbString()).toBe('440.20');
    expect(sheet.variance?.variancePct).not.toBeNull();
  });

  it('o fisa validata nu se mai valideaza si nu se mai completeaza', async () => {
    const base = await ground();
    const workUnitId = await newIntervention(base);
    await saveIntervention(officeActor(), fullSheet(base, workUnitId));
    await validateIntervention(officeActor(), {
      workUnitId,
      effectDate: base.workDate,
      consumptionSeries: 'BC',
    });

    const second = await rejection(
      validateIntervention(officeActor(), {
        workUnitId,
        effectDate: base.workDate,
        consumptionSeries: 'BC',
      }),
    );
    expect((second as { code?: string }).code).toBe('CONFLICT');

    const save = await rejection(saveIntervention(officeActor(), fullSheet(base, workUnitId)));
    expect((save as { code?: string }).code).toBe('CONFLICT');
  });

  it('fara stoc destul, validarea nu lasa nimic in urma', async () => {
    const base = await ground();
    const workUnitId = await newIntervention(base);
    await saveIntervention(officeActor(), {
      ...fullSheet(base, workUnitId),
      // 400 din 100 disponibile.
      materials: [
        { productId: base.productId, lotId: '', quantity: '400', locationId: base.locationId },
      ],
    });

    const failure = await rejection(
      validateIntervention(officeActor(), {
        workUnitId,
        effectDate: base.workDate,
        consumptionSeries: 'BC',
      }),
    );
    expect(failure).toBeDefined();
    expect(pgMessage(failure)).toMatch(/stoc|disponibil/i);

    // Regula 8, privita invers (verificarea #9): nici bon, nici cost, nici
    // fisa validata. O tranzactie care cade pe ultimul pas trebuie sa nu fi
    // lasat nimic din primii.
    const leftovers = await withActor(officeActor(), async (tx) => {
      const notes = await tx.execute<{ n: string }>(sql`
        select count(*)::text as n from app.consumption_notes where work_unit_id = ${workUnitId}`);
      const costs = await tx.execute<{ n: string }>(sql`
        select count(*)::text as n from app.cost_lines where work_unit_id = ${workUnitId}`);
      const balance = await tx.execute<{ qty: string }>(sql`
        select qty_physical as qty from app.stock_balances
         where location_id = ${base.locationId} and product_id = ${base.productId}`);
      return { notes: notes.rows[0], costs: costs.rows[0], balance: balance.rows[0] };
    });

    expect(leftovers.notes?.n).toBe('0');
    expect(leftovers.costs?.n).toBe('0');
    expect(leftovers.balance?.qty).toBe('100.0000');

    const sheet = await getInterventionSheet(officeActor(), workUnitId);
    expect(sheet.validatedAt).toBeNull();
  });

  it('o interventie fara materiale se valideaza doar cu ore', async () => {
    const base = await ground();
    const workUnitId = await newIntervention(base);
    await saveIntervention(officeActor(), { ...fullSheet(base, workUnitId), materials: [] });

    const result = await validateIntervention(officeActor(), {
      workUnitId,
      effectDate: base.workDate,
      consumptionSeries: 'BC',
    });

    expect(result.consumptionNoteNumber).toBeNull();
    expect(result.materialCost.toDbString()).toBe('0.00');
    expect(result.laborCost.toDbString()).toBe('400.20');
  });
});
