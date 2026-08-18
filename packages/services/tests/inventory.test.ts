import { closeConnections, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  consumptionAnalyticsFor,
  createConsumptionNote,
  createLocation,
  listConsumptionNotes,
  listLocations,
  listStock,
  listTeamOptions,
  verifyStockBalances,
} from '../src/inventory';
import { createWorkUnit } from '../src/work-units';
import { officeActor, pgMessage, rejection } from './helpers';
import { TEST_PERSON_ID } from './global-setup';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce apara fisierul asta: **gestiunea e un loc fizic** (regula 3), soldul e un
 * rollup intretinut de trigger, si bonul de consum e singura poarta prin care
 * un material devine cheltuiala.
 *
 * Verificarea #16 e testata NEGATIV, si nu se poate altfel: nu exista drum prin
 * care sa iasa o „gestiune de contract", fiindca `location_type` n-are valoarea.
 * Ce se poate testa e egalitatea tip↔titular, care e mecanismul care tine lista
 * curata pe termen lung.
 */

interface Ground {
  readonly companyId: string;
  readonly contractId: string;
  readonly componentId: string;
  readonly objectiveId: string;
  readonly teamId: string;
  readonly locationId: string;
  readonly productId: string;
  readonly workUnitId: string;
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
  const teamId = uuidv7();
  const locationId = uuidv7();
  const productId = uuidv7();
  const tag = companyId.slice(-8);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const workDate = `${String(year)}-${String(month).padStart(2, '0')}-10`;

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
      insert into app.periods (id, company_id, year, month) values (${periodId}, ${companyId}, ${year}, ${month})`);
    await tx.execute(sql`
      insert into app.document_series (id, company_id, document_type, series, next_number)
      values (${uuidv7()}, ${companyId}, 'interventie', 'IV', 1),
             (${uuidv7()}, ${companyId}, 'bon_consum', 'BC', 1)`);
    await tx.execute(sql`
      insert into app.teams (id, company_id, name) values (${teamId}, ${companyId}, ${`Echipa ${tag}`})`);
    await tx.execute(sql`
      insert into app.products (id, code, name, uom) values (${productId}, ${`P-${tag}`}, 'Garnitura', 'buc')`);
    await tx.execute(sql`
      insert into app.locations (id, company_id, type, name, code, team_id)
      values (${locationId}, ${companyId}, 'echipa', ${`Gestiune ${tag}`}, ${`G-${tag}`}, ${teamId})`);
    // 40 buc a 25 lei.
    await tx.execute(sql`
      insert into app.stock_movements
        (id, company_id, document_type, document_id, from_location_id, to_location_id,
         product_id, quantity, unit_cost, effect_date, created_by)
      values (${uuidv7()}, ${companyId}, 'nir', ${uuidv7()}, null, ${locationId},
              ${productId}, '40', '25', ${workDate}, ${TEST_PERSON_ID})`);
  });

  const unit = await createWorkUnit(officeActor(), {
    workUnit: {
      companyId,
      type: 'interventie',
      name: 'Interventia care consuma',
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
    series: 'IV',
    allocations: [
      {
        contractId,
        componentId,
        periodId,
        allocatedAmount: '3000',
        allocatedPct: '',
        reason: 'Finantare de test.',
      },
    ],
    assignments: [],
  });

  return {
    companyId,
    contractId,
    componentId,
    objectiveId,
    teamId,
    locationId,
    productId,
    workUnitId: unit.id,
    workDate,
  };
}

const note = (base: Ground, quantity: string) => ({
  companyId: base.companyId,
  series: 'BC',
  locationId: base.locationId,
  workUnitId: base.workUnitId,
  stageId: '',
  contractId: base.contractId,
  componentId: base.componentId,
  objectiveId: base.objectiveId,
  documentDate: base.workDate,
  effectDate: base.workDate,
  lines: [{ productId: base.productId, lotId: '', quantity }],
});

describe('gestiuni și stoc', () => {
  it('intrarea produce sold și CMP, iar disponibilul se calculează la citire', async () => {
    const base = await ground();

    const stock = await listStock(officeActor(), {
      companyIds: [base.companyId],
      locationId: base.locationId,
    });
    expect(stock).toHaveLength(1);
    expect(stock[0]?.physical.toDbString()).toBe('40.0000');
    expect(stock[0]?.reserved.toDbString()).toBe('0.0000');
    expect(stock[0]?.available.toDbString()).toBe('40.0000');
    expect(stock[0]?.avgCost?.toDbString()).toBe('25.00');
  });

  it('tipul și titularul merg împreună, în ambele sensuri', async () => {
    const base = await ground();
    const tag = base.locationId.slice(-6);

    // Gestiune de echipa FARA echipa.
    const orphan = await rejection(
      createLocation(officeActor(), {
        companyId: base.companyId,
        type: 'echipa',
        name: 'Fara echipa',
        code: `X1-${tag}`,
        parentLocationId: '',
        teamId: '',
        workUnitId: '',
        subcontractorId: '',
        supplierId: '',
        isCustody: false,
      }),
    );
    expect(orphan).toBeDefined();

    // Magazie CU echipa — greseala care se descopera tarziu, deci se refuza acum.
    const mismatched = await rejection(
      createLocation(officeActor(), {
        companyId: base.companyId,
        type: 'magazie_centrala',
        name: 'Magazie cu echipa',
        code: `X2-${tag}`,
        parentLocationId: '',
        teamId: base.teamId,
        workUnitId: '',
        subcontractorId: '',
        supplierId: '',
        isCustody: false,
      }),
    );
    expect(mismatched).toBeDefined();
  });

  it('echipa își știe gestiunea, iar lista de gestiuni o găsește', async () => {
    const base = await ground();

    const teams = await listTeamOptions(officeActor(), [base.companyId]);
    const team = teams.find((candidate) => candidate.id === base.teamId);
    expect(team?.locationId).toBe(base.locationId);

    const locations = await listLocations(officeActor(), {
      companyIds: [base.companyId],
      type: 'echipa',
    });
    expect(locations.map((location) => location.id)).toContain(base.locationId);
  });

  it('bonul manual scade soldul și produce cost, într-o singură tranzacție', async () => {
    const base = await ground();

    const issued = await createConsumptionNote(officeActor(), note(base, '6'));
    expect(issued.total.toDbString()).toBe('150.00');

    const after = await withActor(officeActor(), async (tx) => {
      const balance = await tx.execute<{ qty: string }>(sql`
        select qty_physical as qty from app.stock_balances
         where location_id = ${base.locationId} and product_id = ${base.productId}`);
      const costs = await tx.execute<{ amount: string; expense_type: string; stage: string }>(sql`
        select amount, expense_type, stage from app.cost_lines
         where document_type = 'bon_consum' and work_unit_id = ${base.workUnitId}`);
      return { balance: balance.rows[0], costs: costs.rows };
    });

    expect(after.balance?.qty).toBe('34.0000');
    expect(after.costs).toEqual([
      { amount: '150.00', expense_type: 'material', stage: 'consumat' },
    ]);

    const listed = await listConsumptionNotes(officeActor(), {
      companyIds: [base.companyId],
      workUnitId: base.workUnitId,
    });
    expect(listed).toHaveLength(1);
  });

  it('consumul peste disponibil e blocat, cu soldul în mesaj (#11)', async () => {
    const base = await ground();

    const failure = await rejection(createConsumptionNote(officeActor(), note(base, '999')));
    expect(failure).toBeDefined();
    // Mesajul spune CAT e disponibil: altfel omul incearca a doua oara la ghici.
    expect(pgMessage(failure)).toMatch(/40|disponibil/i);

    const untouched = await withActor(officeActor(), async (tx) =>
      tx.execute<{ qty: string; notes: string }>(sql`
        select (select qty_physical from app.stock_balances
                 where location_id = ${base.locationId} and product_id = ${base.productId}) as qty,
               (select count(*)::text from app.consumption_notes
                 where work_unit_id = ${base.workUnitId}) as notes`),
    );
    expect(untouched.rows[0]?.qty).toBe('40.0000');
    expect(untouched.rows[0]?.notes).toBe('0');
  });

  it('analitica bonului vine din finanțarea unității, nu din formular', async () => {
    const base = await ground();

    const analytics = await consumptionAnalyticsFor(officeActor(), base.workUnitId);
    expect(analytics).toEqual({
      companyId: base.companyId,
      objectiveId: base.objectiveId,
      contractId: base.contractId,
      componentId: base.componentId,
    });
  });

  it('soldurile corecte nu produc nicio divergență', async () => {
    const base = await ground();
    await createConsumptionNote(officeActor(), note(base, '6'));

    const divergences = await verifyStockBalances(officeActor());
    expect(divergences.filter((row) => row.locationId === base.locationId)).toHaveLength(0);
  });
});
