import { closeConnections, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { markPulled, pruneAppliedMutations, pushMutations, readCursor } from '../src/field-sync';
import { createStage, createWorkUnit } from '../src/work-units';
import { actorFor, officeActor } from './helpers';
import { TEST_PERSON_ID } from './global-setup';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce apără fișierul ăsta: cele trei garanții pe care se sprijină toată
 * aplicația de teren (pasul 10, §3.2), și toate trei există pentru același
 * fapt — **conexiunea cade la jumătatea cererii, în subsol**:
 *
 *  - aceeași mutație trimisă de N ori are UN singur efect (#5, #6);
 *  - coada **se oprește** la prima eroare de business, nu sare peste ea (#7);
 *  - cursorul e per DISPOZITIV, nu per om.
 *
 * Testele nu ating rețeaua și nu depind de R2: motorul de sincronizare e cod
 * pur peste use-case-uri care există deja.
 */

interface Ground {
  readonly companyId: string;
  readonly personId: string;
  readonly workUnitId: string;
  readonly stageId: string;
  readonly locationId: string;
  readonly productId: string;
  readonly contractId: string;
  readonly componentId: string;
  readonly objectiveId: string;
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
  const teamId = uuidv7();
  const locationId = uuidv7();
  const productId = uuidv7();
  const tag = companyId.slice(-8);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const workDate = `${String(year)}-${String(month).padStart(2, '0')}-12`;

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
      values (${uuidv7()}, ${companyId}, 'lucrare', 'L', 1),
             (${uuidv7()}, ${companyId}, 'bon_consum', 'BC', 1)`);
    await tx.execute(sql`
      insert into app.qualifications (id, code, name) values (${qualificationId}, ${`Q-${tag}`}, 'Instalator')`);
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
      insert into app.teams (id, company_id, name) values (${teamId}, ${companyId}, ${`Echipa ${tag}`})`);
    await tx.execute(sql`
      insert into app.products (id, code, name, uom) values (${productId}, ${`P-${tag}`}, 'Garnitura', 'buc')`);
    await tx.execute(sql`
      insert into app.locations (id, company_id, type, name, code, team_id)
      values (${locationId}, ${companyId}, 'echipa', ${`Gestiune ${tag}`}, ${`G-${tag}`}, ${teamId})`);
    // 10 buc: destul pentru o mutație bună și prea puțin pentru cea care trebuie să pice.
    await tx.execute(sql`
      insert into app.stock_movements
        (id, company_id, document_type, document_id, from_location_id, to_location_id,
         product_id, quantity, unit_cost, effect_date, created_by)
      values (${uuidv7()}, ${companyId}, 'nir', ${uuidv7()}, null, ${locationId},
              ${productId}, '10', '5', ${workDate}, ${TEST_PERSON_ID})`);
  });

  const unit = await createWorkUnit(officeActor(), {
    workUnit: {
      companyId,
      type: 'lucrare',
      name: 'Lucrarea de sincronizare',
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
        allocatedAmount: '900',
        allocatedPct: '',
        reason: 'Finantare de test.',
      },
    ],
    assignments: [{ personId, role: 'echipa', validFrom: '', validTo: '' }],
  });

  const stage = await createStage(officeActor(), {
    workUnitId: unit.id,
    name: 'Etapa unica',
    plannedStart: '',
    plannedEnd: '',
    materialBudget: '',
    laborBudget: '',
    pctOfWork: '',
  });

  return {
    companyId,
    personId,
    workUnitId: unit.id,
    stageId: stage.id,
    locationId,
    productId,
    contractId,
    componentId,
    objectiveId,
    workDate,
  };
}

const fieldFor = (personId: string, companyId: string) => ({
  ...actorFor('field', 'app_field', undefined, {
    person_id: personId,
    company_ids: [companyId],
  }),
  personId,
});

/**
 * O inspectie cu un punct, pe terenul de test.
 *
 * Exista pentru un singur motiv: **forma pe care o trimite ecranul de teren**.
 * `photoNodeId`, `estimatedValue` si `validUntil` pleaca de acolo ca siruri
 * GOALE, nu lipsa — asa completeaza un formular campurile optionale. Daca
 * schemele s-ar schimba maine ca sa ceara `null` sau absenta, fisa ar pica in
 * subsol, iar omul ar afla a doua zi.
 */
async function inspectionGround(base: Ground): Promise<{
  workUnitId: string;
  checklistItemId: string;
}> {
  const checklistId = uuidv7();
  const checklistItemId = uuidv7();
  const workUnitId = uuidv7();
  const tag = workUnitId.slice(-8);

  await withActor(officeActor('inspectie de sincronizare'), async (tx) => {
    const link = await tx.execute<{ id: string }>(sql`
      select id from app.contract_objectives where objective_id = ${base.objectiveId} limit 1`);
    await tx.execute(sql`
      insert into app.checklists (id, code, name, objective_kind, version, is_active)
      values (${checklistId}, ${`CHK-${tag}`}, 'Fisa de sincronizare', 'statie_pompare', 1, true)`);
    await tx.execute(sql`
      insert into app.checklist_items (id, checklist_id, position, text)
      values (${checklistItemId}, ${checklistId}, 1, 'Punctul unic')`);
    await tx.execute(sql`
      insert into app.work_units
        (id, company_id, type, code, name, objective_id, contract_objective_id, status, starts_on)
      values (${workUnitId}, ${base.companyId}, 'inspectie', ${`I-${tag}`}, 'Inspectia de sincronizare',
              ${base.objectiveId}, ${link.rows[0]?.id ?? null}, 'in_executie', ${base.workDate})`);
    await tx.execute(sql`
      insert into app.inspections (work_unit_id, checklist_id, checklist_version, performed_on)
      values (${workUnitId}, ${checklistId}, 1, ${base.workDate})
      on conflict (work_unit_id) do nothing`);
    await tx.execute(sql`
      insert into app.work_unit_assignments (id, work_unit_id, person_id, role)
      values (${uuidv7()}, ${workUnitId}, ${base.personId}, 'echipa')`);
  });

  return { workUnitId, checklistItemId };
}

const at = (seconds: number): string => new Date(Date.UTC(2026, 7, 18, 9, seconds)).toISOString();

const timesheetMutation = (base: Ground, id: string) => ({
  id,
  type: 'timesheet.save' as const,
  payload: {
    companyId: base.companyId,
    personId: base.personId,
    workDate: base.workDate,
    lines: [{ workUnitId: base.workUnitId, stageId: base.stageId, hours: '8' }],
  },
  createdAt: at(0),
});

/**
 * O interventie a mea, gata de completat.
 *
 * A inlocuit bonul de consum in testele de coada, si nu din intamplare:
 * `consumption.save` a fost scos din `MUTATION_TYPES` la 10c-3. Testele lui
 * rulau cu `officeActor()` si de asta n-au aratat niciodata ca din rolul de
 * teren drumul cadea cu 42501 — emiterea bonului citeste CMP si scrie in
 * registrul de cost, adica exact ce n-are voie terenul.
 *
 * De aici incolo, **toate** testele de coada folosesc actorul de teren.
 */
async function interventionGround(base: Ground): Promise<string> {
  const workUnitId = uuidv7();
  const tag = workUnitId.slice(-8);

  await withActor(officeActor('interventie de coada'), async (tx) => {
    const link = await tx.execute<{ id: string }>(sql`
      select id from app.contract_objectives where objective_id = ${base.objectiveId} limit 1`);
    await tx.execute(sql`
      insert into app.work_units
        (id, company_id, type, code, name, objective_id, contract_objective_id, status, starts_on)
      values (${workUnitId}, ${base.companyId}, 'interventie', ${`V-${tag}`}, 'Interventia de coada',
              ${base.objectiveId}, ${link.rows[0]?.id ?? null}, 'in_executie', ${base.workDate})`);
    await tx.execute(sql`
      insert into app.work_unit_assignments (id, work_unit_id, person_id, role)
      values (${uuidv7()}, ${workUnitId}, ${base.personId}, 'echipa')`);
  });

  return workUnitId;
}

/**
 * O mutatie de interventie. Cu `workUnitId` inexistent, pica cu `NOT_FOUND` —
 * adica o eroare de BUSINESS, exact ce trebuie ca sa se vada oprirea cozii.
 */
const interventionMutation = (workUnitId: string, id: string, seconds: number) => ({
  id,
  type: 'intervention.save' as const,
  payload: {
    workUnitId,
    description: 'Completata de pe teren.',
    operationId: '',
    teamId: '',
    declaredHours: '2',
    materials: [],
    hours: [],
  },
  createdAt: at(seconds),
});

describe('sincronizarea de teren', () => {
  it('aceeași mutație trimisă de trei ori are un singur efect (#5, #6)', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);
    const mutation = timesheetMutation(base, uuidv7());

    const first = await pushMutations(field, { deviceId: 'telefon-1', mutations: [mutation] });
    expect(first.applied).toBe(1);
    expect(first.outcomes[0]?.status).toBe('applied');

    const second = await pushMutations(field, { deviceId: 'telefon-1', mutations: [mutation] });
    const third = await pushMutations(field, { deviceId: 'telefon-1', mutations: [mutation] });

    expect(second.outcomes[0]?.status).toBe('duplicate');
    expect(third.outcomes[0]?.status).toBe('duplicate');
    expect(second.applied).toBe(0);
    // Răspunsurile 2 și 3 sunt cele MEMORATE, nu recalculate.
    expect(second.outcomes[0]?.result).toEqual(first.outcomes[0]?.result);

    const sheets = await withActor(officeActor(), async (tx) =>
      tx.execute<{ n: string }>(sql`
        select count(*)::text as n from app.timesheets where person_id = ${base.personId}`),
    );
    expect(sheets.rows[0]?.n).toBe('1');
  });

  it('fișa de inspecție trimisă exact cum o compune ecranul de teren', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);
    const sheet = await inspectionGround(base);

    /*
     * Payload-ul de mai jos e copiat din ce construieste `FieldInspectionSheet`,
     * inclusiv sirurile goale. Nu e un test al schemei: e testul ca ecranul si
     * schema vorbesc aceeasi limba, verificat din rolul `app_field`, pe date
     * reale. Zece defecte tacute au fost gasite exact asa.
     */
    const result = await pushMutations(field, {
      deviceId: 'telefon-1',
      mutations: [
        {
          id: uuidv7(),
          type: 'inspection.save',
          payload: {
            workUnitId: sheet.workUnitId,
            answers: [
              {
                checklistItemId: sheet.checklistItemId,
                answer: 'nok',
                note: 'Se aude o bataie.',
                photoNodeId: '',
                finding: {
                  outcome: 'interventie',
                  resolutionNote: '',
                  estimatedValue: '',
                  validUntil: '',
                },
              },
            ],
          },
          createdAt: at(0),
        },
      ],
    });

    expect(result.outcomes[0]?.status).toBe('applied');

    const saved = await withActor(officeActor(), async (tx) =>
      tx.execute<{ answer: string; outcome: string | null }>(sql`
        select a.answer::text as answer, f.outcome::text as outcome
          from app.inspection_answers a
          left join app.inspection_findings f on f.answer_id = a.id
         where a.work_unit_id = ${sheet.workUnitId}`),
    );
    expect(saved.rows[0]?.answer).toBe('nok');
    // Iesirea obligatorie a unui NOK a ajuns intreaga, nu doar raspunsul.
    expect(saved.rows[0]?.outcome).toBe('interventie');
  });

  it('fișa de intervenție trimisă exact cum o compune ecranul de teren', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);
    const workUnitId = uuidv7();
    const tag = workUnitId.slice(-8);

    await withActor(officeActor('interventie de sincronizare'), async (tx) => {
      const link = await tx.execute<{ id: string }>(sql`
        select id from app.contract_objectives where objective_id = ${base.objectiveId} limit 1`);
      await tx.execute(sql`
        insert into app.work_units
          (id, company_id, type, code, name, objective_id, contract_objective_id, status, starts_on)
        values (${workUnitId}, ${base.companyId}, 'interventie', ${`V-${tag}`}, 'Interventia de sincronizare',
                ${base.objectiveId}, ${link.rows[0]?.id ?? null}, 'in_executie', ${base.workDate})`);
      await tx.execute(sql`
        insert into app.work_unit_assignments (id, work_unit_id, person_id, role)
        values (${uuidv7()}, ${workUnitId}, ${base.personId}, 'echipa')`);
    });

    // `lotId`, `operationId` si `teamId` pleaca de pe ecran ca siruri GOALE.
    const result = await pushMutations(field, {
      deviceId: 'telefon-1',
      mutations: [
        {
          id: uuidv7(),
          type: 'intervention.save',
          payload: {
            workUnitId,
            description: 'Schimbat garnitura.',
            operationId: '',
            teamId: '',
            declaredHours: '4',
            materials: [
              {
                productId: base.productId,
                lotId: '',
                quantity: '2',
                locationId: base.locationId,
              },
            ],
            hours: [{ personId: base.personId, hours: '4', workDate: base.workDate }],
          },
          createdAt: at(0),
        },
      ],
    });

    expect(result.outcomes[0]?.status).toBe('applied');

    const lines = await withActor(officeActor(), async (tx) =>
      tx.execute<{ materials: string; hours: string }>(sql`
        select
          (select count(*)::text from app.intervention_materials where work_unit_id = ${workUnitId}) as materials,
          (select count(*)::text from app.intervention_hours where work_unit_id = ${workUnitId}) as hours`),
    );
    expect(lines.rows[0]?.materials).toBe('1');
    expect(lines.rows[0]?.hours).toBe('1');
  });

  it('necesarul de material pleacă din teren, exact cum îl compune ecranul', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);

    /*
     * `material.request` exista in `MUTATION_TYPES` de la 10a, are executant si
     * era testat — dar NICIODATA din rolul de teren. Pana la migrarea 0032,
     * `app.requests` avea doar `select` pentru `app_field`, deci prima cerere
     * trimisa de pe un telefon ar fi cazut cu 42501.
     */
    const result = await pushMutations(field, {
      deviceId: 'telefon-1',
      mutations: [
        {
          id: uuidv7(),
          type: 'material.request',
          payload: {
            companyId: base.companyId,
            type: 'solicitare',
            source: 'manual',
            objectiveId: base.objectiveId,
            contractId: '',
            contractObjectiveId: '',
            title: '20 m teava PEHD 63',
            description: 'Cerut de pe teren.',
            estimatedValue: '',
            slaDueAt: '',
          },
          createdAt: at(0),
        },
      ],
    });

    expect(result.outcomes[0]?.status).toBe('applied');

    const saved = await withActor(officeActor(), async (tx) =>
      tx.execute<{ title: string; estimated: string | null }>(sql`
        select title, estimated_value::text as estimated
          from app.requests where created_by = ${base.personId}`),
    );
    expect(saved.rows[0]?.title).toBe('20 m teava PEHD 63');
    // Terenul naste cererea, dar nu-i pune pret: coloana nici nu e in grant.
    expect(saved.rows[0]?.estimated).toBeNull();
  });

  it('coada se oprește la prima eroare de business și nu sare peste ea (#7)', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);
    const mine = await interventionGround(base);
    const good = uuidv7();
    const bad = uuidv7();
    const after = uuidv7();

    const batch = await pushMutations(field, {
      deviceId: 'telefon-2',
      mutations: [
        interventionMutation(mine, good, 10),
        // Unitate inexistenta: `NOT_FOUND`, deci eroare de business, nu de retea.
        interventionMutation(uuidv7(), bad, 20),
        interventionMutation(mine, after, 30),
      ],
    });

    expect(batch.outcomes.map((outcome) => outcome.status)).toEqual([
      'applied',
      'failed',
      'skipped',
    ]);
    expect(batch.blocked).toBe(true);
    expect(batch.outcomes[1]?.message ?? '').not.toBe('');

    // Cea dinaintea erorii CHIAR s-a scris: oprirea nu da inapoi ce a mers.
    const saved = await withActor(officeActor(), async (tx) =>
      tx.execute<{ description: string | null }>(sql`
        select description from app.interventions where work_unit_id = ${mine}`),
    );
    expect(saved.rows[0]?.description).toBe('Completata de pe teren.');
  });

  it('o mutație respinsă rămâne respinsă, fără să se reexecute', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);
    const bad = uuidv7();
    const missing = uuidv7();

    const first = await pushMutations(field, {
      deviceId: 'telefon-3',
      mutations: [interventionMutation(missing, bad, 10)],
    });
    expect(first.outcomes[0]?.status).toBe('failed');

    const again = await pushMutations(field, {
      deviceId: 'telefon-3',
      mutations: [interventionMutation(missing, bad, 10)],
    });
    expect(again.outcomes[0]?.status).toBe('failed');
    expect(again.outcomes[0]?.message).toBe(first.outcomes[0]?.message);
  });

  it('mutațiile se aplică în ordinea creării, nu în cea din listă', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);
    const mine = await interventionGround(base);
    const first = uuidv7();
    const second = uuidv7();

    // Trimise invers: cea de la secunda 30 înaintea celei de la 10.
    const batch = await pushMutations(field, {
      deviceId: 'telefon-4',
      mutations: [
        interventionMutation(uuidv7(), second, 30),
        interventionMutation(mine, first, 10),
      ],
    });

    // Cea creată prima trece; cea creată a doua pică — deci s-au aplicat în
    // ordinea creării, nu în cea în care au sosit.
    const byId = new Map(batch.outcomes.map((outcome) => [outcome.id, outcome.status]));
    expect(byId.get(first)).toBe('applied');
    expect(byId.get(second)).toBe('failed');
  });

  it('un payload invalid pică singur, fără să scoată tot lotul din joc', async () => {
    const base = await ground();
    const broken = uuidv7();

    const batch = await pushMutations(fieldFor(base.personId, base.companyId), {
      deviceId: 'telefon-5',
      mutations: [
        {
          id: broken,
          type: 'timesheet.save',
          payload: { companyId: base.companyId, personId: base.personId, lines: [] },
          createdAt: at(0),
        },
      ],
    });

    expect(batch.outcomes[0]?.status).toBe('failed');
    expect(batch.outcomes[0]?.code).toBe('VALIDATION_FAILED');
  });

  it('cursorul e per dispozitiv, nu per om', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);

    expect(await readCursor(field, 'telefon-A')).toBeNull();

    const pulled = await markPulled(field, 'telefon-A');
    expect((await readCursor(field, 'telefon-A'))?.cursor).toBe(pulled.cursor);
    // Al doilea telefon al aceluiași om n-a primit nimic.
    expect(await readCursor(field, 'telefon-B')).toBeNull();
  });

  it('jurnalul mai vechi de retenție se uită, iar mutația se reexecută (#11)', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);
    const mutation = timesheetMutation(base, uuidv7());

    await pushMutations(field, { deviceId: 'telefon-C', mutations: [mutation] });

    await withActor(officeActor('imbatranire pentru test'), async (tx) => {
      await tx.execute(sql`
        update app.applied_mutations
           set applied_at = now() - interval '91 days'
         where id = ${mutation.id}`);
    });

    const pruned = await pruneAppliedMutations(actorFor('office', 'app_service', 'retentie'), 90);
    expect(pruned).toBeGreaterThanOrEqual(1);

    /*
     * După uitare, mutația se REEXECUTĂ. Aici nu doare, fiindcă `saveTimesheet`
     * e idempotent pe cheia lui naturală (om, zi). Unde ar durea e un bon de
     * consum — de asta retenția e o alegere, nu o valoare implicită.
     */
    const replay = await pushMutations(field, { deviceId: 'telefon-C', mutations: [mutation] });
    expect(replay.outcomes[0]?.status).toBe('applied');

    const sheets = await withActor(officeActor(), async (tx) =>
      tx.execute<{ n: string }>(sql`
        select count(*)::text as n from app.timesheets where person_id = ${base.personId}`),
    );
    expect(sheets.rows[0]?.n).toBe('1');
  });

  it('jurnalul păstrează cine și de pe ce telefon a trimis', async () => {
    const base = await ground();
    const field = fieldFor(base.personId, base.companyId);
    const mutation = timesheetMutation(base, uuidv7());

    await pushMutations(field, { deviceId: 'telefon-D', mutations: [mutation] });

    const [row] = await withActor(officeActor(), async (tx) =>
      tx.execute<{ person_id: string; device_id: string; type: string }>(sql`
        select person_id, device_id, type from app.applied_mutations
         where id = ${mutation.id}`),
    ).then((result) => result.rows);

    expect(row?.person_id).toBe(base.personId);
    expect(row?.device_id).toBe('telefon-D');
    expect(row?.type).toBe('timesheet.save');
  });
});
