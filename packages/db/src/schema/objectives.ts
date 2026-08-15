import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { contracts } from './contracts';
import { app } from './enums';

/**
 * Obiectivele si profilele de inspectie (Anexa C.4).
 *
 * Doua reguli care nu se negociaza, si care se contrazic cu intuitia:
 *
 * 1. **Obiectivul NU are `company_id`.** E nomenclator comun celor 5 firme, ca
 *    produsele si clientii. Aceeasi statie de pompare poate fi in contractul
 *    firmei A anul asta si in al firmei B la anul; daca ar fi duplicata per
 *    firma, istoricul ei — exact ecranul cerut explicit — s-ar rupe in cinci.
 *
 * 2. **Profilul de inspectie sta pe LEGATURA, nu pe obiectiv.** Acelasi bazin
 *    poate cere inspectie lunara pe un contract si trimestriala pe altul. Pus pe
 *    obiectiv, al doilea contract l-ar suprascrie pe primul.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Tipurile de obiectiv folosite azi. Text, nu enum: lista creste cu clientii. */
export const OBJECTIVE_KINDS = [
  'cladire',
  'statie_pompare',
  'bazin',
  'rezervor',
  'gura_canal',
  'retea',
  'altul',
] as const;

export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

export const objectives = app.table(
  'objectives',
  {
    id: id(),
    /** Codul din teren. Unic indiferent de scris (index pe `lower(btrim(...))`). */
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    address: jsonb('address'),
    /** Coordonatele. Se seteaza si prin click pe harta, nu doar tastate. */
    geoLat: numeric('geo_lat', { precision: 10, scale: 7 }),
    geoLng: numeric('geo_lng', { precision: 10, scale: 7 }),
    areaSqm: numeric('area_sqm', { precision: 14, scale: 2 }),
    /** Folderul de documente al obiectivului. `app.nodes` vine in pasul 07. */
    rootNodeId: uuid('root_node_id'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('objectives_name_idx').on(t.name),
    index('objectives_kind_idx').on(t.kind),
    check('objectives_code_not_blank', sql`length(btrim(${t.code})) > 0`),
    check('objectives_kind_not_blank', sql`length(btrim(${t.kind})) > 0`),
    // Coordonatele gresite nu produc eroare, produc un pin in Golful Guineei.
    check('objectives_lat_range', sql`${t.geoLat} is null or ${t.geoLat} between -90 and 90`),
    check('objectives_lng_range', sql`${t.geoLng} is null or ${t.geoLng} between -180 and 180`),
    // Ori amandoua, ori niciuna: o latitudine singura nu se poate desena.
    check('objectives_geo_complete', sql`num_nonnulls(${t.geoLat}, ${t.geoLng}) <> 1`),
    check('objectives_area_non_negative', sql`${t.areaSqm} is null or ${t.areaSqm} >= 0`),
  ],
);

/**
 * Fisele de verificare, VERSIONATE.
 *
 * O fisa completata pastreaza versiunea cu care a fost completata (pasul 09), ca
 * sa ramana interpretabila peste doi ani. De aceea o modificare de continut
 * inseamna o versiune noua, nu un `update` pe punctele existente — altfel un
 * raport din 2026 s-ar citi cu intrebarile din 2028.
 */
export const checklists = app.table(
  'checklists',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Pentru ce tip de obiectiv e fisa. Null = generica. */
    objectiveKind: text('objective_kind'),
    version: smallint('version').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique('checklists_code_version_unique').on(t.code, t.version),
    check('checklists_code_not_blank', sql`length(btrim(${t.code})) > 0`),
    check('checklists_version_positive', sql`${t.version} > 0`),
  ],
);

export const checklistItems = app.table(
  'checklist_items',
  {
    id: id(),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    text: text('text').notNull(),
    /** Punctul cere poza. Terenul nu poate raspunde fara ea (pasul 09). */
    requiresPhoto: boolean('requires_photo').notNull().default(false),
    /** Un „nu” pe un punct critic genereaza automat constatare, nu observatie. */
    isCritical: boolean('is_critical').notNull().default(false),
  },
  (t) => [
    unique('checklist_items_position_unique').on(t.checklistId, t.position),
    check('checklist_items_text_not_blank', sql`length(btrim(${t.text})) > 0`),
    check('checklist_items_position_positive', sql`${t.position} > 0`),
  ],
);

/** Profilul: „ce se verifica la obiectivul asta, si cat de des”. */
export const inspectionProfiles = app.table(
  'inspection_profiles',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique('inspection_profiles_name_unique').on(t.name),
    check('inspection_profiles_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  ],
);

/**
 * Fisele dintr-un profil, fiecare cu frecventa ei.
 *
 * Are `id` propriu desi cheia naturala e (profil, fisa): trigger-ul de audit
 * deriva `record_id` din coloana `id`, iar o tabela de legatura fara ea nu poate
 * fi auditata. Vezi nota din migrarea 0009.
 */
export const inspectionProfileItems = app.table(
  'inspection_profile_items',
  {
    id: id(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => inspectionProfiles.id, { onDelete: 'cascade' }),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => checklists.id),
    /** Din cate in cate luni. 1 = lunar, 3 = trimestrial, 12 = anual. */
    frequencyMonths: smallint('frequency_months').notNull(),
  },
  (t) => [
    unique('inspection_profile_items_unique').on(t.profileId, t.checklistId),
    check('inspection_profile_items_frequency_range', sql`${t.frequencyMonths} between 1 and 60`),
  ],
);

/**
 * Legatura contract ↔ obiectiv. **E o entitate proprie**, nu o coloana.
 *
 * Obiectivele intra si ies din contract in cei 4 ani, iar intrebarea reala nu e
 * „ce obiective are contractul” ci „ce obiective avea in martie”. O coloana
 * `contract_id` pe obiectiv ar raspunde doar la prima, si ar sterge trecutul la
 * fiecare mutare.
 *
 * Constrangerea `exclude` (in migrare) interzice doua legaturi suprapuse pe
 * ACELASI contract. Doua contracte diferite in acelasi timp raman permise — e
 * cazul real, si de aceea `contract_id` intra in cheia de excludere.
 */
export const contractObjectives = app.table(
  'contract_objectives',
  {
    id: id(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => objectives.id),
    validFrom: date('valid_from').notNull(),
    /** Null = obiectivul e inca in contract. */
    validTo: date('valid_to'),
    inspectionProfileId: uuid('inspection_profile_id').references(() => inspectionProfiles.id),
    createdAt: createdAt(),
  },
  (t) => [
    // „Pe ce contracte a fost obiectivul asta” — tab-ul Contracte al obiectivului.
    index('contract_objectives_objective_idx').on(t.objectiveId),
    check(
      'contract_objectives_valid_range',
      sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`,
    ),
  ],
);

export type Objective = typeof objectives.$inferSelect;
export type NewObjective = typeof objectives.$inferInsert;
export type Checklist = typeof checklists.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type InspectionProfile = typeof inspectionProfiles.$inferSelect;
export type InspectionProfileItem = typeof inspectionProfileItems.$inferSelect;
export type ContractObjective = typeof contractObjectives.$inferSelect;
export type NewContractObjective = typeof contractObjectives.$inferInsert;
