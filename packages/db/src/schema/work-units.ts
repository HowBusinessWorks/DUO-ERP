import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { contractComponents, contracts } from './contracts';
import {
  allocationStatusEnum,
  app,
  executorTypeEnum,
  workUnitStatusEnum,
  workUnitTypeEnum,
} from './enums';
import { contractObjectives, objectives } from './objectives';
import { persons, subcontractors } from './organization';
import { periods } from './periods';

/**
 * Unitatea de Lucru — inima modelului (Anexa C.5, §6).
 *
 * O SINGURA entitate cu trei tipuri (inspectie / interventie / lucrare), nu trei
 * tabele: toate trei se leaga la un obiectiv, consuma materiale si manopera,
 * produc costuri, au poze si documente. Difera doar structura de detaliu.
 *
 * Cuvantul „Unitate de Lucru" nu apare NICIODATA pe ecran — acolo apare tipul
 * concret. E limbaj intern de arhitectura.
 *
 * Cele trei reguli de aur ale pasului, si unde se vede fiecare in schema:
 *
 *   1. **Finantarea NU e un camp aici.** E `funding_allocations`, mai jos, cu un
 *      rand pe fiecare componenta × luna. O lucrare finantata din Delta pe trei
 *      luni consecutive are trei randuri, nu unul. Daca vreodata apare un
 *      `contract_id` pe `work_units` ca sursa de finantare, e greseala.
 *   2. **Promovarea pastreaza ID-ul.** O interventie care se dovedeste mai mare
 *      decat parea devine lucrare prin `update type`, nu prin rand nou: pozele,
 *      orele si folderul ramin unde sunt. `promoted_from_id` e doar pentru cazul
 *      rar de scindare.
 *   3. **Alocarile nu se rescriu**, se supersedeaza. Un trigger in migrare
 *      interzice `update` pe orice coloana in afara de `status` si
 *      `superseded_by`.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Rolul pe care il joaca o persoana pe o unitate de lucru.
 *
 * Text cu `check`, nu enum: lista e a noastra si se schimba mai des decat merita
 * o migrare de tip — aceeasi alegere ca la `contracts.status`.
 */
export const WORK_UNIT_ASSIGNMENT_ROLES = ['sef_santier', 'inspector', 'echipa'] as const;

export type WorkUnitAssignmentRole = (typeof WORK_UNIT_ASSIGNMENT_ROLES)[number];

export const workUnits = app.table(
  'work_units',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** `L-000233`, `I-009022` — alocat prin `app.allocate_document_number`. */
    code: text('code').notNull(),
    type: workUnitTypeEnum('type').notNull(),
    /**
     * Denumirea din lista: „Inlocuire pompa SP-14".
     *
     * Nu e in Anexa C.5, dar coloana „denumire" e ceruta explicit de vederea
     * unificata (§3.4). Fara ea, lista ar arata numai coduri.
     */
    name: text('name').notNull(),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => objectives.id),
    /**
     * Legatura obiectiv × contract prin care se executa. Nullabila: o inspectie
     * poate exista inaintea deciziei de rutare (pasul 08), iar contractul care
     * PLATESTE vine oricum din alocare, nu de aici.
     */
    contractObjectiveId: uuid('contract_objective_id').references(() => contractObjectives.id),
    status: workUnitStatusEnum('status').notNull().default('draft'),
    /** PM sau sef de santier: cine raspunde. */
    responsiblePersonId: uuid('responsible_person_id').references(() => persons.id),
    executorType: executorTypeEnum('executor_type').notNull().default('echipa_proprie'),
    executorSubcontractorId: uuid('executor_subcontractor_id').references(() => subcontractors.id),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    /** Cat se estimeaza c-o sa valoreze. Bani: nu se acorda in afara biroului. */
    estimatedValue: numeric('estimated_value', { precision: 14, scale: 2 }),
    /** Cat avem voie sa cheltuim pe ea. Idem. */
    costBudget: numeric('cost_budget', { precision: 14, scale: 2 }),
    /** Cererea din care s-a nascut. FK-ul vine in pasul 08, cu tabela. */
    sourceRequestId: uuid('source_request_id'),
    /** DOAR pentru scindare. Promovarea normala pastreaza randul. */
    promotedFromId: uuid('promoted_from_id').references((): AnyPgColumn => workUnits.id),
    /** Folderul auto-generat. FK-ul vine in pasul 07, cu `app.nodes`. */
    rootNodeId: uuid('root_node_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('work_units_company_code_unique').on(t.companyId, t.code),
    // Vederea unificata filtreaza pe tip si pe status, in cadrul firmei.
    index('work_units_company_status_idx').on(t.companyId, t.status),
    index('work_units_company_type_idx').on(t.companyId, t.type),
    // Tab-ul Istoric al obiectivului: „ce s-a intamplat aici, in ordine".
    index('work_units_objective_idx').on(t.objectiveId),
    index('work_units_contract_objective_idx').on(t.contractObjectiveId),
    index('work_units_responsible_idx').on(t.responsiblePersonId),
    check('work_units_code_not_blank', sql`length(btrim(${t.code})) > 0`),
    check('work_units_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    // Coerenta temporala se impune in model, nu prin instruire (§4.7). Ambele
    // capete sunt opuse: o inspectie planificata n-are inca date.
    check(
      'work_units_period_valid',
      sql`${t.endsOn} is null or ${t.startsOn} is null or ${t.endsOn} >= ${t.startsOn}`,
    ),
    /*
     * Executantul si subcontractantul merg impreuna, in ambele sensuri: o UL
     * data in subcontractare fara firma nu spune cine executa, iar una cu echipa
     * proprie si un subcontractant atasat spune doua lucruri diferite despre
     * acelasi lucru. Egalitate, nu implicatie — ca la `is_fill_target` din 0009.
     */
    check(
      'work_units_executor_consistent',
      sql`(${t.executorType} = 'subcontractant') = (${t.executorSubcontractorId} is not null)`,
    ),
    check(
      'work_units_estimated_value_non_negative',
      sql`${t.estimatedValue} is null or ${t.estimatedValue} >= 0`,
    ),
    check(
      'work_units_cost_budget_non_negative',
      sql`${t.costBudget} is null or ${t.costBudget} >= 0`,
    ),
    // Cine a inchis si cand se scriu deodata: jumatate din informatie n-ar
    // permite nici sa se afle cine, nici sa se stie daca e chiar inchisa.
    check('work_units_closed_complete', sql`num_nonnulls(${t.closedAt}, ${t.closedBy}) <> 1`),
    check('work_units_not_promoted_from_self', sql`${t.promotedFromId} is distinct from ${t.id}`),
  ],
);

/**
 * Cine lucreaza pe UL, si in ce interval.
 *
 * Istoricizat prin `valid_from` / `valid_to`, nu prin stergere: pontajul de luna
 * trecuta trebuie sa se poata explica si dupa ce omul a fost mutat pe alt
 * santier. Un trigger in migrare blocheaza asignarea unei persoane fara
 * autorizatie SSM valabila — blocheaza, nu avertizeaza.
 */
export const workUnitAssignments = app.table(
  'work_unit_assignments',
  {
    id: id(),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => workUnits.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    role: text('role').notNull(),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    createdAt: createdAt(),
  },
  (t) => [
    index('work_unit_assignments_work_unit_idx').on(t.workUnitId),
    // Ecranul de teren intreaba invers: „ce am eu de facut". Indexul e pe el.
    index('work_unit_assignments_person_idx').on(t.personId),
    check(
      'work_unit_assignments_role_known',
      sql`${t.role} in ('sef_santier', 'inspector', 'echipa')`,
    ),
    check(
      'work_unit_assignments_period_valid',
      sql`${t.validTo} is null or ${t.validFrom} is null or ${t.validTo} >= ${t.validFrom}`,
    ),
  ],
);

/**
 * Etapele unei lucrari (§9). DOAR pe lucrari — un trigger in migrare respinge o
 * etapa pe inspectie sau pe interventie.
 *
 * Etapa e ea insasi o entitate cu pagina proprie si tab-uri proprii, prin
 * acelasi `entityRegistry`. Recursivitatea aia e testul real al pasului 03.
 */
export const workStages = app.table(
  'work_stages',
  {
    id: id(),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => workUnits.id, { onDelete: 'cascade' }),
    /** 1..N, in ordinea de executie. Reordonarea rescrie pozitiile. */
    position: smallint('position').notNull(),
    name: text('name').notNull(),
    plannedStart: date('planned_start'),
    plannedEnd: date('planned_end'),
    /** Buget de material. Bani: nu se acorda in afara biroului. */
    materialBudget: numeric('material_budget', { precision: 14, scale: 2 }),
    /** Buget de manopera. Idem. */
    laborBudget: numeric('labor_budget', { precision: 14, scale: 2 }),
    /** Cat cantareste etapa in lucrare. Fractie, nu procent: 0.2500 = 25%. */
    pctOfWork: numeric('pct_of_work', { precision: 6, scale: 4 }),
    actualStart: date('actual_start'),
    actualEnd: date('actual_end'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('work_stages_work_unit_position_unique').on(t.workUnitId, t.position),
    check('work_stages_position_positive', sql`${t.position} > 0`),
    check('work_stages_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    // Coerenta temporala in model (§4.7): fara finalizare inaintea inceputului.
    check(
      'work_stages_planned_range',
      sql`${t.plannedEnd} is null or ${t.plannedStart} is null or ${t.plannedEnd} >= ${t.plannedStart}`,
    ),
    check(
      'work_stages_actual_range',
      sql`${t.actualEnd} is null or ${t.actualStart} is null or ${t.actualEnd} >= ${t.actualStart}`,
    ),
    check(
      'work_stages_material_budget_non_negative',
      sql`${t.materialBudget} is null or ${t.materialBudget} >= 0`,
    ),
    check(
      'work_stages_labor_budget_non_negative',
      sql`${t.laborBudget} is null or ${t.laborBudget} >= 0`,
    ),
    check(
      'work_stages_pct_range',
      sql`${t.pctOfWork} is null or (${t.pctOfWork} >= 0 and ${t.pctOfWork} <= 1)`,
    ),
  ],
);

/**
 * Finantarea unei UL (§4.9, §13). Tabela care rezolva simultan Delta pe mai
 * multe luni, mutarile intre contracte si promovarile.
 *
 * Un rand = „atata din UL asta se plateste din componenta X, in luna Y". De
 * aceea o lucrare mare taiata pe trei Delta are trei randuri, iar una finantata
 * din doua contracte simultan are doua randuri cu procente.
 *
 * **Istoricizata prin `superseded_by`, niciodata prin `UPDATE`.** Cifra alocata,
 * componenta, luna si motivul unui rand nu se mai ating dupa ce randul exista;
 * singura tranzitie permisa e `active` → `superseded`, si e impusa de trigger.
 */
export const fundingAllocations = app.table(
  'funding_allocations',
  {
    id: id(),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => workUnits.id),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    componentId: uuid('component_id')
      .notNull()
      .references(() => contractComponents.id),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id),
    /** Suma din UL finantata din componenta asta, in luna asta. */
    allocatedAmount: numeric('allocated_amount', { precision: 14, scale: 2 }),
    /** Alternativa la suma: fractie, nu procent. 0.6000 = 60%. */
    allocatedPct: numeric('allocated_pct', { precision: 6, scale: 4 }),
    status: allocationStatusEnum('status').notNull().default('active'),
    /** Alocarea care a luat locul acesteia. Se completeaza o singura data. */
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => fundingAllocations.id),
    /** Motiv scris, obligatoriu de la primul rand (regula 4 din pas). */
    reason: text('reason').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    /*
     * O singura alocare ACTIVA pe aceeasi UL × contract × componenta × luna.
     * Doua ar fi acelasi lucru scris de doua ori: cine citeste „cat se plateste
     * din Delta august" ar primi doua raspunsuri si ar trebui sa le adune, ceea
     * ce nimeni nu face la fel de doua ori. Modificarea trece prin supersedare.
     */
    uniqueIndex('funding_allocations_active_unique')
      .on(t.workUnitId, t.contractId, t.componentId, t.periodId)
      .where(sql`status = 'active'`),
    index('funding_allocations_work_unit_idx').on(t.workUnitId),
    // „Ce UL-uri se plateasc din Delta august" — banda din pasul 04, si
    // verificarea #14 a pasului asta.
    index('funding_allocations_component_period_idx').on(t.componentId, t.periodId),
    index('funding_allocations_period_idx').on(t.periodId),
    check(
      'funding_allocations_amount_or_pct',
      sql`${t.allocatedAmount} is not null or ${t.allocatedPct} is not null`,
    ),
    check(
      'funding_allocations_amount_non_negative',
      sql`${t.allocatedAmount} is null or ${t.allocatedAmount} >= 0`,
    ),
    check(
      'funding_allocations_pct_range',
      sql`${t.allocatedPct} is null or (${t.allocatedPct} > 0 and ${t.allocatedPct} <= 1)`,
    ),
    check('funding_allocations_reason_not_blank', sql`length(btrim(${t.reason})) > 0`),
    check('funding_allocations_not_superseded_by_self', sql`${t.supersededBy} is distinct from ${t.id}`),
    /*
     * Implicatie, nu egalitate: un rand care arata spre succesorul lui e
     * obligatoriu supersedat, dar unul supersedat poate sa n-aiba succesor —
     * finantarea se poate si retrage, nu doar muta.
     */
    check(
      'funding_allocations_superseded_has_status',
      sql`${t.supersededBy} is null or ${t.status} = 'superseded'`,
    ),
  ],
);

/**
 * Documentul de re-alocare (§13.1). Mecanismul lunii INCHISE.
 *
 * Cand luna din care se muta finantarea e inchisa, liniile originale ramin
 * datate in luna lor — o luna raportata nu se rescrie. In luna CURENTA se emite
 * documentul asta: scoate suma din componenta veche, o pune pe cea noua, si
 * **ambele miscari ramin vizibile**.
 *
 * Ce nu se schimba niciodata la mutare: data documentului, obiectivul si
 * analitica „folosit". Istoricul obiectivului e sacru.
 *
 * Randul e imuabil: un trigger in migrare respinge `update` si `delete`. Un
 * document contabil emis nu se corecteaza, se contra-inregistreaza.
 */
export const reallocationDocuments = app.table(
  'reallocation_documents',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** `NRA-000001`, din `app.allocate_document_number`. */
    number: text('number').notNull(),
    /** Luna CURENTA, in care se emite documentul. Nu cea din care se muta. */
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => workUnits.id),
    fromContractId: uuid('from_contract_id')
      .notNull()
      .references(() => contracts.id),
    fromComponentId: uuid('from_component_id')
      .notNull()
      .references(() => contractComponents.id),
    fromPeriodId: uuid('from_period_id')
      .notNull()
      .references(() => periods.id),
    toContractId: uuid('to_contract_id')
      .notNull()
      .references(() => contracts.id),
    toComponentId: uuid('to_component_id')
      .notNull()
      .references(() => contractComponents.id),
    toPeriodId: uuid('to_period_id')
      .notNull()
      .references(() => periods.id),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('reallocation_documents_company_number_unique').on(t.companyId, t.number),
    // Ecranul „Bani › Re-alocarile lunii" (verificarea #15) citeste exact asa.
    index('reallocation_documents_period_idx').on(t.periodId),
    index('reallocation_documents_work_unit_idx').on(t.workUnitId),
    check('reallocation_documents_number_not_blank', sql`length(btrim(${t.number})) > 0`),
    check('reallocation_documents_reason_not_blank', sql`length(btrim(${t.reason})) > 0`),
    // Zero lei mutati nu e un document, e o apasare de buton din greseala.
    check('reallocation_documents_amount_positive', sql`${t.amount} > 0`),
    // Un document care muta banii de unde sunt, unde sunt, n-are ce sa arate pe
    // lista lunii — si lista lunii e chiar motivul pentru care exista tabela.
    check(
      'reallocation_documents_moves_somewhere',
      sql`${t.fromComponentId} <> ${t.toComponentId} or ${t.fromPeriodId} <> ${t.toPeriodId}`,
    ),
  ],
);

export type WorkUnit = typeof workUnits.$inferSelect;
export type NewWorkUnit = typeof workUnits.$inferInsert;
export type WorkUnitAssignment = typeof workUnitAssignments.$inferSelect;
export type NewWorkUnitAssignment = typeof workUnitAssignments.$inferInsert;
export type WorkStage = typeof workStages.$inferSelect;
export type NewWorkStage = typeof workStages.$inferInsert;
export type FundingAllocation = typeof fundingAllocations.$inferSelect;
export type NewFundingAllocation = typeof fundingAllocations.$inferInsert;
export type ReallocationDocument = typeof reallocationDocuments.$inferSelect;
export type NewReallocationDocument = typeof reallocationDocuments.$inferInsert;
