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
  uuid,
} from 'drizzle-orm/pg-core';
import { app, checklistAnswerEnum, findingOutcomeEnum } from './enums';
import { consumptionNotes, locations } from './inventory';
import { checklistItems, checklists } from './objectives';
import { operationCatalog } from './operation-catalog';
import { persons, teams } from './organization';
import { products } from './products';
import { backlogProposals, requests } from './requests';
import { workUnits } from './work-units';

/**
 * Fisele de lucru: inspectia si interventia (pasul 09, §3.1 si §3.2).
 *
 * Amandoua sunt **extensii 1:1 pe `app.work_units`**, nu entitati paralele:
 * cheia primara E `work_unit_id`. Asa raman valabile toate regulile pasului 05
 * — codul din serie, folderul generat prin trigger, finantarea din alocari,
 * promovarea care pastreaza ID-ul — fara sa fie rescrise aici.
 *
 * Trei reguli traiesc in migrare, ca triggere, nu in formulare:
 *
 *   1. **Fiecare NOK are iesire obligatorie.** `validated_at` nu se poate seta
 *      cat timp exista un raspuns `nok` fara rand in `inspection_findings`.
 *   2. **Un punct cu `requires_photo` blocheaza validarea fara poza.** Poza se
 *      cauta in arborele din pasul 07, in folderul `Poze` al unitatii.
 *   3. **`effect_date` se seteaza LA VALIDARE** si e separata de `performed_on`.
 *      Toate agregarile lunare merg pe ea. O fisa din 28 iulie validata pe 3
 *      august se raporteaza in august, iar data de pe hartie ramane 28 iulie.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ── Inspectia ────────────────────────────────────────────────────────────────

/**
 * Fisa de inspectie.
 *
 * `checklist_id` + `checklist_version` se scriu la creare, din **profilul de
 * inspectie al legaturii contract↔obiectiv** — nu de pe obiectiv. Acelasi bazin
 * se inspecteaza diferit pe contracte diferite, si asta e chiar cazul real.
 *
 * Versiunea se ingheata pe fisa dinadins: peste doi ani, o inspectie din 2026
 * trebuie sa se citeasca cu intrebarile din 2026, nu cu cele de atunci.
 */
export const inspections = app.table(
  'inspections',
  {
    workUnitId: uuid('work_unit_id')
      .primaryKey()
      .references(() => workUnits.id, { onDelete: 'cascade' }),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => checklists.id),
    checklistVersion: smallint('checklist_version').notNull(),
    performedOn: date('performed_on').notNull(),
    performedBy: uuid('performed_by').references(() => persons.id),
    /** Luna de raportare. Null pana la validare — regula 3. */
    effectDate: date('effect_date'),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    validatedBy: uuid('validated_by').references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('inspections_performed_on_idx').on(t.performedOn),
    index('inspections_effect_date_idx').on(t.effectDate),
    check('inspections_checklist_version_positive', sql`${t.checklistVersion} > 0`),
    // Cine a validat si cand se scriu deodata, ca `closed_at`/`closed_by` pe UL.
    check(
      'inspections_validated_complete',
      sql`num_nonnulls(${t.validatedAt}, ${t.validatedBy}) <> 1`,
    ),
    // Data de efect exista exact cat timp fisa e validata: regula 3, in model.
    check(
      'inspections_effect_date_with_validation',
      sql`(${t.effectDate} is not null) = (${t.validatedAt} is not null)`,
    ),
  ],
);

export const inspectionAnswers = app.table(
  'inspection_answers',
  {
    id: id(),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => inspections.workUnitId, { onDelete: 'cascade' }),
    checklistItemId: uuid('checklist_item_id')
      .notNull()
      .references(() => checklistItems.id),
    answer: checklistAnswerEnum('answer').notNull(),
    note: text('note'),
    /**
     * Poza punctului, in arborele din pasul 07.
     *
     * Sta pe RASPUNS, nu pe fisa: un punct cu `requires_photo` trebuie sa poata
     * fi verificat individual, iar „exista o poza undeva pe fisa" n-ar dovedi
     * nimic despre punctul 7. FK-ul catre `app.nodes` se pune in migrare, ca la
     * `work_units.root_node_id`: declarat aici ar inchide un ciclu de import.
     */
    photoNodeId: uuid('photo_node_id'),
  },
  (t) => [
    // Un punct, un raspuns. Doua ar insemna ca fisa spune „si da, si nu".
    unique('inspection_answers_item_unique').on(t.workUnitId, t.checklistItemId),
    index('inspection_answers_work_unit_idx').on(t.workUnitId),
  ],
);

/**
 * Iesirea obligatorie a unui NOK. **Mecanismul care tine tot sistemul de
 * propuneri**: fara el, backlogul ramane gol si Delta se umple reactiv.
 *
 * `interventie` naste o **Cerere tip „constatare"** (pasul 08); `propunere`
 * naste o propunere de backlog cu valoare estimata; `rezolvat_pe_loc` cere doar
 * descrierea a ce s-a facut. Un `check` de mai jos impune ca fiecare varianta
 * sa-si aiba capatul completat — altfel „am creat intervenție" ar putea sa nu
 * arate spre nicio intervenție.
 */
export const inspectionFindings = app.table(
  'inspection_findings',
  {
    id: id(),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => inspections.workUnitId, { onDelete: 'cascade' }),
    answerId: uuid('answer_id')
      .notNull()
      .references(() => inspectionAnswers.id, { onDelete: 'cascade' }),
    outcome: findingOutcomeEnum('outcome').notNull(),
    resolutionNote: text('resolution_note'),
    createdRequestId: uuid('created_request_id').references(() => requests.id),
    backlogProposalId: uuid('backlog_proposal_id').references(() => backlogProposals.id),
    estimatedValue: numeric('estimated_value', { precision: 14, scale: 2 }),
    createdAt: createdAt(),
  },
  (t) => [
    // O iesire per raspuns: doua ar insemna doua decizii pentru acelasi NOK.
    unique('inspection_findings_answer_unique').on(t.answerId),
    index('inspection_findings_work_unit_idx').on(t.workUnitId),
    check(
      'inspection_findings_estimated_value_non_negative',
      sql`${t.estimatedValue} is null or ${t.estimatedValue} >= 0`,
    ),
    /*
     * Fiecare iesire isi are capatul ei. Scrise ca implicatii, nu ca egalitati:
     * randul se insereaza INAINTE ca cererea sau propunerea sa existe (le
     * creeaza acelasi use-case, in aceeasi tranzactie), deci legatura se
     * completeaza printr-un `update` imediat urmator. Ce se verifica aici e ca
     * un rand NU poate arata simultan spre amandoua.
     */
    check(
      'inspection_findings_one_target',
      sql`num_nonnulls(${t.createdRequestId}, ${t.backlogProposalId}) <= 1`,
    ),
    check(
      'inspection_findings_resolved_has_note',
      sql`${t.outcome} <> 'rezolvat_pe_loc' or length(btrim(coalesce(${t.resolutionNote}, ''))) > 0`,
    ),
    check(
      'inspection_findings_proposal_has_value',
      sql`${t.outcome} <> 'propunere' or ${t.estimatedValue} is not null`,
    ),
  ],
);

// ── Interventia ──────────────────────────────────────────────────────────────

/**
 * Fisa de interventie: reparatia punctuala, tipic sub pragul de 2.000 lei.
 *
 * `operation_id` si `team_id` exista pentru **comparatia asteptat vs real** —
 * cel mai bun mecanism anti-furt din sistem, si traieste PE FISA, nu intr-un
 * raport pe care nu-l citeste nimeni. La validare se calculeaza costul real din
 * materialele si orele efective, se compara cu estimarea din catalog si, daca
 * abaterea trece pragul, ramane marcata aici, vizibila la fiecare deschidere.
 *
 * Cifrele de comparatie se STOCHEAZA, nu se recalculeaza la citire: catalogul se
 * schimba, iar o fisa validata acum nu trebuie sa-si schimbe verdictul maine.
 */
export const interventions = app.table(
  'interventions',
  {
    workUnitId: uuid('work_unit_id')
      .primaryKey()
      .references(() => workUnits.id, { onDelete: 'cascade' }),
    sourceRequestId: uuid('source_request_id').references(() => requests.id),
    performedOn: date('performed_on').notNull(),
    /** Luna de raportare. Null pana la validare — regula 3. */
    effectDate: date('effect_date'),
    description: text('description'),
    declaredHours: numeric('declared_hours', { precision: 14, scale: 4 }),
    operationId: uuid('operation_id').references(() => operationCatalog.id),
    /** Echipa care a executat — dimensiunea din `operation_actuals`. */
    teamId: uuid('team_id').references(() => teams.id),
    /** Rezultatul comparatiei, inghetat la validare. */
    expectedCost: numeric('expected_cost', { precision: 14, scale: 2 }),
    realCost: numeric('real_cost', { precision: 14, scale: 2 }),
    /** Fractie cu semn: 0.1800 = +18% fata de estimat. */
    variancePct: numeric('variance_pct', { precision: 6, scale: 4 }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    validatedBy: uuid('validated_by').references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('interventions_performed_on_idx').on(t.performedOn),
    index('interventions_effect_date_idx').on(t.effectDate),
    index('interventions_operation_idx').on(t.operationId),
    check(
      'interventions_declared_hours_non_negative',
      sql`${t.declaredHours} is null or ${t.declaredHours} >= 0`,
    ),
    check(
      'interventions_validated_complete',
      sql`num_nonnulls(${t.validatedAt}, ${t.validatedBy}) <> 1`,
    ),
    check(
      'interventions_effect_date_with_validation',
      sql`(${t.effectDate} is not null) = (${t.validatedAt} is not null)`,
    ),
  ],
);

/**
 * Materialele consumate, declarate pe teren din gestiunea echipei.
 *
 * `consumption_note_id` se completeaza LA VALIDARE, cand se emite bonul. O linie
 * fara bon e o declaratie; una cu bon a miscat stocul si a produs cost.
 */
export const interventionMaterials = app.table(
  'intervention_materials',
  {
    id: id(),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => interventions.workUnitId, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    lotId: uuid('lot_id'),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    /** Din ce gestiune se scoate. Obligatorie: fara ea nu se poate scadea nimic. */
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    consumptionNoteId: uuid('consumption_note_id').references(() => consumptionNotes.id),
    /** CMP-ul gestiunii, inghetat la validare. Coloana de bani: office-only. */
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('intervention_materials_work_unit_idx').on(t.workUnitId),
    check('intervention_materials_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'intervention_materials_unit_cost_non_negative',
      sql`${t.unitCost} is null or ${t.unitCost} >= 0`,
    ),
  ],
);

/** Orele declarate pe fisa. Pontajul propriu-zis e alta tabela, alt flux. */
export const interventionHours = app.table(
  'intervention_hours',
  {
    id: id(),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => interventions.workUnitId, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    hours: numeric('hours', { precision: 14, scale: 4 }).notNull(),
    workDate: date('work_date').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('intervention_hours_work_unit_idx').on(t.workUnitId),
    check('intervention_hours_positive', sql`${t.hours} > 0 and ${t.hours} <= 24`),
  ],
);

export type Inspection = typeof inspections.$inferSelect;
export type NewInspection = typeof inspections.$inferInsert;
export type InspectionAnswer = typeof inspectionAnswers.$inferSelect;
export type InspectionFinding = typeof inspectionFindings.$inferSelect;
export type Intervention = typeof interventions.$inferSelect;
export type NewIntervention = typeof interventions.$inferInsert;
export type InterventionMaterial = typeof interventionMaterials.$inferSelect;
export type InterventionHour = typeof interventionHours.$inferSelect;
