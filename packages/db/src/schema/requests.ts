import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { check, date, index, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext } from './citext';
import { companies } from './companies';
import { contractComponents, contracts } from './contracts';
import {
  app,
  requestSourceEnum,
  requestStatusEnum,
  requestTypeEnum,
  routingChoiceEnum,
} from './enums';
import { operationCatalog } from './operation-catalog';
import { contractObjectives, objectives } from './objectives';
import { persons } from './organization';
import { workUnits } from './work-units';

/**
 * Cererea — o singura entitate, cinci tipuri (pasul 08, §0).
 *
 * Tot ce intra in firma ca „ceva de facut" trece pe aici, indiferent de sursa:
 * tichet de client, solicitare interna, constatare de inspectie, propunere sau
 * solicitare de utilaj. UN singur modul, nu cinci — regula 1 din pas.
 *
 * **Decizia de rutare NU e un camp aici.** E `request_decisions`, mai jos: se
 * pastreaza si propunerea sistemului, si alegerea omului, ca sa se vada cat de
 * des diverg (regula 4). Daca `routeRequest` (`@damina/domain`) e gresita, abia
 * asa se afla.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const requests = app.table(
  'requests',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    type: requestTypeEnum('type').notNull(),
    source: requestSourceEnum('source').notNull(),
    status: requestStatusEnum('status').notNull().default('neprocesata'),
    objectiveId: uuid('objective_id').references(() => objectives.id),
    contractId: uuid('contract_id').references(() => contracts.id),
    contractObjectiveId: uuid('contract_objective_id').references(() => contractObjectives.id),
    title: text('title').notNull(),
    description: text('description'),
    /** Punctul NOK de origine. FK-ul vine in pasul 09, cu tabela fiselor. */
    sourceInspectionFindingId: uuid('source_inspection_finding_id'),
    /** Utilajul de origine (faza 4). Coloana exista, ecranul nu — regula 5 din §5. */
    sourceEquipmentId: uuid('source_equipment_id'),
    /** Cat se estimeaza c-o sa coste. Bani: nu se acorda in afara biroului. */
    estimatedValue: numeric('estimated_value', { precision: 14, scale: 2 }),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    // Inbox-ul si badge-ul din sidebar filtreaza exact asa: firma + status.
    index('requests_company_status_idx').on(t.companyId, t.status),
    index('requests_company_type_idx').on(t.companyId, t.type),
    index('requests_objective_idx').on(t.objectiveId),
    index('requests_contract_idx').on(t.contractId),
    index('requests_sla_idx').on(t.slaDueAt),
    check('requests_title_not_blank', sql`length(btrim(${t.title})) > 0`),
    check(
      'requests_estimated_value_non_negative',
      sql`${t.estimatedValue} is null or ${t.estimatedValue} >= 0`,
    ),
  ],
);

/**
 * Emailul original — DOVADA solicitarii (regula 5 din pas). Ramane permanent in
 * R2, chiar daca cererea e ulterior anulata sau respinsa.
 */
export const requestEmails = app.table(
  'request_emails',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    /** Deduplicare: acelasi mesaj primit de doua ori produce o singura cerere. */
    messageId: text('message_id').notNull().unique(),
    fromAddress: citext('from_address').notNull(),
    toAddress: citext('to_address'),
    subject: text('subject'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    bodyText: text('body_text'),
    bodyHtml: text('body_html'),
    /**
     * `.eml` integral, in R2. FK-ul catre `app.nodes` se pune de mana in
     * migrare — declarat aici ar deschide un ciclu de import (`files.ts` nu
     * cunoaste cererile).
     */
    rawNodeId: uuid('raw_node_id'),
    createdAt: createdAt(),
  },
  (t) => [index('request_emails_request_idx').on(t.requestId)],
);

/** Liniile de evaluare: operatiune din catalog × cantitate → cost estimat. */
export const requestEstimateLines = app.table(
  'request_estimate_lines',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operationCatalog.id),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    estimatedLabor: numeric('estimated_labor', { precision: 14, scale: 2 }).notNull(),
    estimatedMaterial: numeric('estimated_material', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
  },
  (t) => [
    index('request_estimate_lines_request_idx').on(t.requestId),
    check('request_estimate_lines_quantity_positive', sql`${t.quantity} > 0`),
    check('request_estimate_lines_labor_non_negative', sql`${t.estimatedLabor} >= 0`),
    check('request_estimate_lines_material_non_negative', sql`${t.estimatedMaterial} >= 0`),
  ],
);

/**
 * Decizia de rutare (§0, regula centrala a pasului). Se salveaza atat
 * propunerea sistemului cat si alegerea omului — niciodata doar rezultatul.
 *
 * `created_work_unit_id` e completat DOAR cand alegerea creeaza o UL (nu la
 * `amanata_backlog`); creatia + alocarea + legatura sunt atomice, in acelasi
 * `withActor` din `packages/services`.
 */
export const requestDecisions = app.table(
  'request_decisions',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    choice: routingChoiceEnum('choice').notNull(),
    systemProposal: routingChoiceEnum('system_proposal').notNull(),
    targetContractId: uuid('target_contract_id').references(() => contracts.id),
    targetComponentId: uuid('target_component_id').references(() => contractComponents.id),
    /** 1..3 luni de Delta, in ordine. Null pentru alegerile care nu sunt Delta. */
    targetPeriods: date('target_periods').array(),
    createdWorkUnitId: uuid('created_work_unit_id').references(() => workUnits.id),
    /** Motiv scris, obligatoriu (regula 3 din pas). */
    reason: text('reason').notNull(),
    decidedBy: uuid('decided_by')
      .notNull()
      .references(() => persons.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('request_decisions_request_idx').on(t.requestId),
    check('request_decisions_reason_not_blank', sql`length(btrim(${t.reason})) > 0`),
  ],
);

/**
 * Backlogul de propuneri (§0, „umplerea Deltei"). Constatarile NOK amanate si
 * cererile amanate ajung aici cu valoare estimata, re-evaluabile pana sunt
 * promovate, respinse sau expira.
 */
export const backlogProposals = app.table(
  'backlog_proposals',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => objectives.id),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    title: text('title').notNull(),
    estimatedValue: numeric('estimated_value', { precision: 14, scale: 2 }).notNull(),
    /** `inspectie | tichet | amanata` — text cu `check`, lista mica si a noastra. */
    sourceKind: text('source_kind').notNull(),
    /** Constatarea de origine. FK-ul vine in pasul 09, cu tabela fiselor. */
    sourceInspectionId: uuid('source_inspection_id'),
    status: text('status').notNull().default('open'),
    promotedWorkUnitId: uuid('promoted_work_unit_id').references(() => workUnits.id),
    validUntil: date('valid_until'),
    createdAt: createdAt(),
  },
  (t) => [
    // Ecranul de backlog: „propunerile deschise ale contractului X, cele mai
    // mari primele" — exact indexul cerut de §3.1.
    index('backlog_proposals_contract_status_value_idx').on(
      t.contractId,
      t.status,
      t.estimatedValue,
    ),
    index('backlog_proposals_request_idx').on(t.requestId),
    check('backlog_proposals_title_not_blank', sql`length(btrim(${t.title})) > 0`),
    check('backlog_proposals_estimated_value_non_negative', sql`${t.estimatedValue} >= 0`),
    check(
      'backlog_proposals_source_kind_known',
      sql`${t.sourceKind} in ('inspectie', 'tichet', 'amanata')`,
    ),
    check(
      'backlog_proposals_status_known',
      sql`${t.status} in ('open', 'promoted', 'dropped', 'expired')`,
    ),
  ],
);

export type Request = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
export type RequestEmail = typeof requestEmails.$inferSelect;
export type NewRequestEmail = typeof requestEmails.$inferInsert;
export type RequestEstimateLine = typeof requestEstimateLines.$inferSelect;
export type NewRequestEstimateLine = typeof requestEstimateLines.$inferInsert;
export type RequestDecision = typeof requestDecisions.$inferSelect;
export type NewRequestDecision = typeof requestDecisions.$inferInsert;
export type BacklogProposal = typeof backlogProposals.$inferSelect;
export type NewBacklogProposal = typeof backlogProposals.$inferInsert;
