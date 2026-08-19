import { closeConnections, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { pullFieldSnapshot } from '../src/field-snapshot';
import { createWorkUnit } from '../src/work-units';
import { actorFor, officeActor } from './helpers';
import { TEST_PERSON_ID } from './global-setup';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce apără fișierul ăsta: **regula 2 a pasului 10 — zero lei pe teren, la nivel
 * de date.** Nu ascunse la afișare: necerute.
 *
 * Verificarea se uită la **chei**, recursiv, nu la orice șir din felie. Prima
 * variantă căuta cuvintele în tot JSON-ul și pica pe „Ulei hidraulic", care
 * conține „lei" — iar un test care dă alarme false pe numele produselor e un
 * test pe care îl dezactivează cineva peste două luni.
 */

/*
 * `value` a intrat in lista la 10c-2, si nu din exces de zel: `estimated_value`
 * de pe iesirea unei inspectii e bani si NU se potrivea cu niciun cuvant de mai
 * sus. Verificarea trecea peste el. Felia n-are nicio cheie generica de tip
 * „value", deci cuvantul nu produce alarme false.
 */
const MONEY_KEYS = /(cost|price|pret|amount|margin|salary|budget|valoare|value|tarif|rate)/i;

/** Toate căile din obiect a căror ULTIMĂ cheie miroase a bani. */
function moneyKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => moneyKeys(entry, `${path}[${String(index)}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => {
      const here = path === '' ? key : `${path}.${key}`;
      return MONEY_KEYS.test(key) ? [here] : moneyKeys(nested, here);
    });
  }
  return [];
}

interface Ground {
  readonly companyId: string;
  readonly personId: string;
  readonly workUnitId: string;
  readonly locationId: string;
  readonly objectiveId: string;
  readonly contractObjectiveId: string;
  readonly teamId: string;
  readonly productId: string;
}

async function ground(): Promise<Ground> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const contractId = uuidv7();
  const componentId = uuidv7();
  const objectiveId = uuidv7();
  const contractObjectiveId = uuidv7();
  const periodId = uuidv7();
  const personId = uuidv7();
  const teamId = uuidv7();
  const locationId = uuidv7();
  const productId = uuidv7();
  const tag = companyId.slice(-8);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const today = now.toISOString().slice(0, 10);

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
      values (${objectiveId}, ${`OB-${tag}`}, 'Statia', 'statie_pompare')`);
    await tx.execute(sql`
      insert into app.contract_objectives (id, contract_id, objective_id, valid_from)
      values (${contractObjectiveId}, ${contractId}, ${objectiveId}, '2020-01-01')`);
    await tx.execute(sql`
      insert into app.periods (id, company_id, year, month) values (${periodId}, ${companyId}, ${year}, ${month})`);
    await tx.execute(sql`
      insert into app.document_series (id, company_id, document_type, series, next_number)
      values (${uuidv7()}, ${companyId}, 'lucrare', 'L', 1)`);
    await tx.execute(sql`
      insert into app.persons (id, persona, category, full_name)
      values (${personId}, 'field', 'angajat', ${`Muncitor ${tag}`})`);
    await tx.execute(sql`
      insert into app.person_company_access (person_id, company_id) values (${personId}, ${companyId})`);
    await tx.execute(sql`
      insert into app.person_authorizations (id, person_id, kind, issued_at, expires_at)
      values (${uuidv7()}, ${personId}, 'ssm', '2020-01-01', '2035-12-31')`);
    await tx.execute(sql`
      insert into app.teams (id, company_id, name) values (${teamId}, ${companyId}, ${`Echipa ${tag}`})`);
    // Numele conține „lei" dinadins: verificarea de bani se uită la CHEI.
    await tx.execute(sql`
      insert into app.products (id, code, name, uom)
      values (${productId}, ${`P-${tag}`}, 'Ulei hidraulic', 'l')`);
    await tx.execute(sql`
      insert into app.locations (id, company_id, type, name, code, team_id)
      values (${locationId}, ${companyId}, 'echipa', ${`Gestiune ${tag}`}, ${`G-${tag}`}, ${teamId})`);
    await tx.execute(sql`
      insert into app.stock_movements
        (id, company_id, document_type, document_id, from_location_id, to_location_id,
         product_id, quantity, unit_cost, effect_date, created_by)
      values (${uuidv7()}, ${companyId}, 'nir', ${uuidv7()}, null, ${locationId},
              ${productId}, '40', '25', ${today}, ${TEST_PERSON_ID})`);
  });

  const unit = await createWorkUnit(officeActor(), {
    workUnit: {
      companyId,
      type: 'lucrare',
      name: 'Lucrarea din felie',
      objectiveId,
      contractObjectiveId,
      responsiblePersonId: '',
      executorType: 'echipa_proprie',
      executorSubcontractorId: '',
      startsOn: today,
      endsOn: '',
      estimatedValue: '5000.00',
      costBudget: '4000.00',
    },
    series: 'L',
    allocations: [
      {
        contractId,
        componentId,
        periodId,
        allocatedAmount: '900',
        allocatedPct: '',
        reason: 'Finantare de test.',
      },
    ],
    assignments: [{ personId, role: 'echipa', validFrom: '', validTo: '' }],
  });

  return {
    companyId,
    personId,
    workUnitId: unit.id,
    locationId,
    objectiveId,
    contractObjectiveId,
    teamId,
    productId,
  };
}

/**
 * O interventie cu material si ore, pe terenul lui `ground`.
 *
 * Exista pentru ca primele sase teste NU atingeau interogarile de interventie:
 * felia lor n-avea nicio interventie, deci `interventionIds` era gol si trei
 * `select`-uri nu se executau niciodata. Un grant lipsa pe `intervention_*` ar
 * fi trecut nevazut pana pe telefonul cuiva.
 */
async function seedIntervention(base: Ground): Promise<{ workUnitId: string }> {
  const workUnitId = uuidv7();
  const tag = workUnitId.slice(-8);
  const today = new Date().toISOString().slice(0, 10);

  await withActor(officeActor('interventie de test'), async (tx) => {
    await tx.execute(sql`
      insert into app.work_units
        (id, company_id, type, code, name, objective_id, contract_objective_id, status, starts_on)
      values (${workUnitId}, ${base.companyId}, 'interventie', ${`V-${tag}`}, 'Interventia de test',
              ${base.objectiveId}, ${base.contractObjectiveId}, 'in_executie', ${today})`);
    // Randul de fisa se naste din trigger (migrarea 0028); aici doar se completeaza.
    await tx.execute(sql`
      update app.interventions
         set description = 'Schimbat garnitura.', team_id = ${base.teamId}, declared_hours = '4'
       where work_unit_id = ${workUnitId}`);
    await tx.execute(sql`
      insert into app.work_unit_assignments (id, work_unit_id, person_id, role)
      values (${uuidv7()}, ${workUnitId}, ${base.personId}, 'echipa')`);
    await tx.execute(sql`
      insert into app.intervention_materials
        (id, work_unit_id, product_id, quantity, location_id, unit_cost)
      values (${uuidv7()}, ${workUnitId}, ${base.productId}, '3', ${base.locationId}, '25')`);
    await tx.execute(sql`
      insert into app.intervention_hours (id, work_unit_id, person_id, hours, work_date)
      values (${uuidv7()}, ${workUnitId}, ${base.personId}, '4', ${today})`);
  });

  return { workUnitId };
}

/**
 * O inspectie cu un punct raspuns NOK si iesire, pe terenul lui `ground`.
 *
 * Se scrie direct in baza, cu rolul de birou: ce se verifica aici e ce IESE din
 * felie, nu drumul prin serviciu — pe acela il acopera testele inspectiilor.
 */
async function seedAnswer(base: Ground): Promise<{ checklistItemId: string }> {
  const checklistId = uuidv7();
  const checklistItemId = uuidv7();
  const workUnitId = uuidv7();
  const answerId = uuidv7();
  const tag = workUnitId.slice(-8);
  const today = new Date().toISOString().slice(0, 10);

  await withActor(officeActor('inspectie de test'), async (tx) => {
    await tx.execute(sql`
      insert into app.checklists (id, code, name, objective_kind, version, is_active)
      values (${checklistId}, ${`CHK-${tag}`}, 'Fisa de test', 'statie_pompare', 1, true)`);
    await tx.execute(sql`
      insert into app.checklist_items (id, checklist_id, position, text)
      values (${checklistItemId}, ${checklistId}, 1, 'Punctul unic')`);
    await tx.execute(sql`
      insert into app.work_units
        (id, company_id, type, code, name, objective_id, contract_objective_id, status, starts_on)
      values (${workUnitId}, ${base.companyId}, 'inspectie', ${`I-${tag}`}, 'Inspectia de test',
              ${base.objectiveId}, ${base.contractObjectiveId}, 'in_executie', ${today})`);
    await tx.execute(sql`
      insert into app.inspections (work_unit_id, checklist_id, checklist_version, performed_on)
      values (${workUnitId}, ${checklistId}, 1, ${today})
      on conflict (work_unit_id) do update set checklist_id = excluded.checklist_id`);
    await tx.execute(sql`
      insert into app.work_unit_assignments (id, work_unit_id, person_id, role)
      values (${uuidv7()}, ${workUnitId}, ${base.personId}, 'echipa')`);
    await tx.execute(sql`
      insert into app.inspection_answers (id, work_unit_id, checklist_item_id, answer, note)
      values (${answerId}, ${workUnitId}, ${checklistItemId}, 'nok', 'Se aude o bataie.')`);
    await tx.execute(sql`
      insert into app.inspection_findings (id, work_unit_id, answer_id, outcome)
      values (${uuidv7()}, ${workUnitId}, ${answerId}, 'interventie')`);
  });

  return { checklistItemId };
}

const fieldFor = (personId: string, companyId: string) => ({
  ...actorFor('field', 'app_field', undefined, {
    person_id: personId,
    company_ids: [companyId],
  }),
  personId,
});

describe('felia de date a terenului', () => {
  it('nu conține niciun câmp de bani (regula 2, verificarea #16)', async () => {
    const base = await ground();
    const snapshot = await pullFieldSnapshot(fieldFor(base.personId, base.companyId));

    expect(moneyKeys(snapshot)).toEqual([]);

    /*
     * Unitatea de lucru ARE `estimated_value` și `cost_budget` în bază — le-am
     * scris în `ground` dinadins. Felia nu le cere, deci nu apar. Dacă cineva
     * adaugă mâine `estimatedValue` în `FieldWorkUnit` „ca să fie", testul cade.
     */
    const unit = snapshot.workUnits.find((row) => row.id === base.workUnitId);
    expect(unit).toBeDefined();
    expect(Object.keys(unit ?? {})).not.toContain('estimatedValue');
    expect(Object.keys(unit ?? {})).not.toContain('costBudget');
  });

  it('nu confundă un nume de produs cu un câmp de bani', async () => {
    const base = await ground();
    const snapshot = await pullFieldSnapshot(fieldFor(base.personId, base.companyId));

    // „Ulei hidraulic" conține „lei". E un nume, nu un preț.
    const line = snapshot.stock.find((row) => row.locationId === base.locationId);
    expect(line?.productName).toBe('Ulei hidraulic');
    expect(moneyKeys(snapshot)).toEqual([]);
  });

  it('stocul vine fără CMP, doar cu disponibilul', async () => {
    const base = await ground();
    const snapshot = await pullFieldSnapshot(fieldFor(base.personId, base.companyId));

    const line = snapshot.stock.find((row) => row.locationId === base.locationId);
    expect(line?.available).toBe('40.0000');
    expect(Object.keys(line ?? {})).not.toContain('avgCost');
  });

  it('rămâne mult sub 2 MB comprimat (verificarea #10)', async () => {
    const base = await ground();
    const snapshot = await pullFieldSnapshot(fieldFor(base.personId, base.companyId));

    const gzipped = gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8')).byteLength;
    expect(gzipped).toBeLessThan(2 * 1024 * 1024);
  });

  it('aduce răspunsurile deja completate, ca ecranul să nu le șteargă', async () => {
    const base = await ground();

    /*
     * Ce apara testul asta: `saveInspection` REScrie tot setul de raspunsuri.
     * Daca felia n-ar aduce ce exista, un ecran de teren care porneste gol si
     * salveaza ar sterge munca altcuiva — tacut, si abia la sincronizare.
     */
    const answer = await seedAnswer(base);
    const snapshot = await pullFieldSnapshot(fieldFor(base.personId, base.companyId));

    const found = snapshot.answers.find(
      (row) => row.checklistItemId === answer.checklistItemId,
    );
    expect(found?.answer).toBe('nok');
    expect(found?.outcome).toBe('interventie');
    // Iesirea vine fara valoarea estimata: `app_field` n-are grant pe coloana.
    expect(Object.keys(found ?? {})).not.toContain('estimatedValue');
    expect(moneyKeys(snapshot)).toEqual([]);
  });

  it('aduce fișa de intervenție cu materiale și ore, fără costul unitar', async () => {
    const base = await ground();
    const seeded = await seedIntervention(base);
    const snapshot = await pullFieldSnapshot(fieldFor(base.personId, base.companyId));

    const sheet = snapshot.interventions.find((row) => row.workUnitId === seeded.workUnitId);
    expect(sheet?.description).toBe('Schimbat garnitura.');
    expect(sheet?.declaredHours).toBe('4.0000');
    expect(sheet?.materials).toHaveLength(1);
    expect(sheet?.materials[0]?.quantity).toBe('3.0000');
    expect(sheet?.hours).toHaveLength(1);

    /*
     * `unit_cost` e scris in baza — dinadins, in seed. Nu apare in felie fiindca
     * nu se cere, iar rolul `app_field` n-are nici grant pe coloana. Daca cineva
     * adauga maine `unitCost` in `FieldInterventionMaterial` „ca sa fie",
     * verificarea de bani cade prima.
     */
    expect(Object.keys(sheet?.materials[0] ?? {})).not.toContain('unitCost');
    expect(moneyKeys(snapshot)).toEqual([]);
  });

  it('aduce unitatea, etapele ei și seriile firmei', async () => {
    const base = await ground();
    const snapshot = await pullFieldSnapshot(fieldFor(base.personId, base.companyId));

    expect(snapshot.workUnits.map((row) => row.id)).toContain(base.workUnitId);
    expect(snapshot.series.some((row) => row.series === 'L')).toBe(true);
    // Fără serii, prima fișă scrisă în subsol n-ar avea din ce lua numărul.
    expect(snapshot.series.length).toBeGreaterThan(0);
  });
});
