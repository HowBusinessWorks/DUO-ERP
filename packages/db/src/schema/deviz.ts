import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  jsonb,
  numeric,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { app } from './enums';
import { normedArticles } from './normed-articles';
import { persons } from './organization';
import { workStages, workUnits } from './work-units';

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Devizul (pasul 11, §8 din business).
 *
 * **Doua devize, si doar unul se versioneaza.** Cel al clientului e oferta —
 * hartia pe baza careia se semneaza si se factureaza, deci fiecare stare
 * trimisa afara ramane citibila pentru totdeauna. Cel intern e al PM-ului: ce
 * trebuie facut efectiv, cu material si manopera separate, si NU ajunge
 * niciodata la client (§8.1). Consecinta nu e o simetrie ratata, ci una
 * refuzata dinadins: un document strict intern n-are nevoie de versionare
 * oficiala, iar o tabela de versiuni intretinuta degeaba e cost curat.
 *
 * `kind` si `status` sunt text cu `check`, nu enum-uri de Postgres: listele
 * sunt ale noastre si se schimba mai des decat merita o migrare de tip —
 * aceeasi alegere ca la `contracts.status` si `monthly_reports.status`.
 *
 * Indirectele si profitul stau AICI, la nivel de deviz, ca procent, si doar pe
 * cel client: sunt un pachet negociat pe oferta, nu o proprietate a unei linii.
 * `check`-ul le refuza pe `intern` — un cost direct cu profit in el ar face
 * marja sa arate bine tocmai unde trebuie sa doara.
 */
export const DEVIZ_KINDS = ['client', 'intern'] as const;
export type DevizKind = (typeof DEVIZ_KINDS)[number];

export const DEVIZ_STATUSES = ['draft', 'activ', 'anulat'] as const;
export type DevizStatus = (typeof DEVIZ_STATUSES)[number];

export const devize = app.table(
  'devize',
  {
    id: id(),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => workUnits.id, { onDelete: 'cascade' }),
    /**
     * Denormalizata din unitatea de lucru, ca peste tot unde RLS filtreaza pe
     * firma: politica citeste `app.work_unit_in_scope`, dar listele si indecsii
     * au nevoie de firma pe rand, fara join.
     */
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('draft'),
    /** Indirecte, ca fractie: 0.0800 = 8%. Doar pe devizul client. */
    indirectPct: numeric('indirect_pct', { precision: 6, scale: 4 }),
    /** Profit, ca fractie. Idem. Se aplica DUPA indirecte, compus. */
    profitPct: numeric('profit_pct', { precision: 6, scale: 4 }),
    createdBy: uuid('created_by').references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    // O lucrare are cel mult un deviz client si cel mult unul intern. Al doilea
    // n-ar fi a doua parere, ar fi a doua oferta pe aceeasi munca.
    unique('devize_work_unit_kind_unique').on(t.workUnitId, t.kind),
    index('devize_company_idx').on(t.companyId, t.status),
    check('devize_kind_known', sql`${t.kind} in ('client','intern')`),
    check('devize_status_known', sql`${t.status} in ('draft','activ','anulat')`),
    check(
      'devize_pct_range',
      sql`(${t.indirectPct} is null or (${t.indirectPct} >= 0 and ${t.indirectPct} <= 1))
          and (${t.profitPct} is null or (${t.profitPct} >= 0 and ${t.profitPct} <= 1))`,
    ),
    // Regula care nu se negociaza: indirecte si profit doar pe devizul client.
    check(
      'devize_intern_has_no_markup',
      sql`${t.kind} = 'client' or (${t.indirectPct} is null and ${t.profitPct} is null)`,
    ),
  ],
);

/**
 * Istoricul devizului CLIENT. **Imutabil**, ca versiunile raportului lunar.
 *
 * `lines` e copia liniilor la momentul inghetarii, nu o legatura catre ele: o
 * versiune care ar arata catre randurile vii ar spune, peste un an, altceva
 * decat hartia semnata — adica exact ce nu trebuie sa poata face un document
 * de oferta.
 *
 * `reason` e `not null`: inghetarea e singura operatie ireversibila a pasului,
 * si ca plafoanele de la 04 cere motiv scris.
 */
export const devizVersions = app.table(
  'deviz_versions',
  {
    id: id(),
    devizId: uuid('deviz_id')
      .notNull()
      .references(() => devize.id, { onDelete: 'cascade' }),
    version: smallint('version').notNull(),
    /** Copia liniilor, cu categoriile lor, exact cum aratau la inghetare. */
    lines: jsonb('lines').notNull(),
    /** Totalul inghetat, cu indirecte si profit aplicate. */
    total: numeric('total', { precision: 14, scale: 2 }).notNull(),
    indirectPct: numeric('indirect_pct', { precision: 6, scale: 4 }),
    profitPct: numeric('profit_pct', { precision: 6, scale: 4 }),
    reason: text('reason').notNull(),
    frozenAt: timestamp('frozen_at', { withTimezone: true }).notNull().defaultNow(),
    frozenBy: uuid('frozen_by').references(() => persons.id),
  },
  (t) => [
    unique('deviz_versions_deviz_version_unique').on(t.devizId, t.version),
    index('deviz_versions_deviz_idx').on(t.devizId, sql`version desc`),
    check('deviz_versions_version_positive', sql`${t.version} >= 1`),
    check('deviz_versions_reason_not_blank', sql`length(btrim(${t.reason})) > 0`),
  ],
);

/**
 * Arborele devizului, pe DOUA niveluri: categorie -> operatiune (§12.1).
 *
 * Adancimea se impune prin trigger, nu prin conventie: un al treilea nivel ar
 * intra fara sa se planga nimeni, iar editorul si totalurile pe categorie —
 * scrise pentru doua niveluri — ar incepe sa piarda linii tacut.
 */
export const devizCategories = app.table(
  'deviz_categories',
  {
    id: id(),
    devizId: uuid('deviz_id')
      .notNull()
      .references(() => devize.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => devizCategories.id, {
      onDelete: 'cascade',
    }),
    position: smallint('position').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('deviz_categories_deviz_idx').on(t.devizId, t.parentId, t.position),
    check('deviz_categories_position_positive', sql`${t.position} > 0`),
    check('deviz_categories_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  ],
);

/**
 * Pozitiile devizului. **Aici stau coloanele de pret.**
 *
 * Cele patru costuri si `unit_price` sunt valori PE UNITATE DE MASURA, iar
 * `total` e intotdeauna `cantitate x pret unitar`. Regula asta o tine un
 * trigger, nu serviciul: un `insert` scris de mana, un import sau un ecran
 * viitor ar produce altfel un total care nu mai da cu suma liniilor, si nimeni
 * n-ar sti care din cele doua cifre e cea buna.
 *
 * Pe devizul intern, `unit_price` nu se scrie de om — triggerul il calculeaza
 * ca suma celor patru componente. Un pret unitar intern scris separat de
 * componentele lui ar fi a doua sursa de adevar pentru acelasi numar.
 */
export const devizLines = app.table(
  'deviz_lines',
  {
    id: id(),
    devizId: uuid('deviz_id')
      .notNull()
      .references(() => devize.id, { onDelete: 'cascade' }),
    /** Operatiunea (nivelul 2) sau categoria (nivelul 1) sub care sta linia. */
    categoryId: uuid('category_id').references(() => devizCategories.id, { onDelete: 'set null' }),
    position: smallint('position').notNull(),
    /** Codul articolului, cand exista: din biblioteca sau din devizul-sursa. */
    code: text('code'),
    name: text('name').notNull(),
    uom: text('uom').notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull().default('0'),
    /** Etapa lucrarii, cand lucrarea are etape. Optionala: o UL simpla n-are. */
    stageId: uuid('stage_id').references(() => workStages.id),
    /**
     * Articolul normat din care s-a explodat linia. FK-ul intra in migrarea
     * `0041`, odata cu biblioteca: coloana exista de la `0040`, fiindca liniile
     * se scriu inainte sa existe biblioteca.
     *
     * Din coloana asta se calculeaza „de cate ori a fost folosit articolul si
     * in ce lucrari" (functional sec. 17) — cifra care justifica intretinerea
     * bibliotecii. Nu se tine ca si contor denormalizat: un contor se
     * desincronizeaza tacut, si tocmai el n-are voie.
     */
    normedArticleId: uuid('normed_article_id').references(() => normedArticles.id),

    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull().default('0'),
    materialCost: numeric('material_cost', { precision: 14, scale: 2 }).notNull().default('0'),
    laborCost: numeric('labor_cost', { precision: 14, scale: 2 }).notNull().default('0'),
    equipmentCost: numeric('equipment_cost', { precision: 14, scale: 2 }).notNull().default('0'),
    transportCost: numeric('transport_cost', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    createdAt: createdAt(),
  },
  (t) => [
    index('deviz_lines_deviz_idx').on(t.devizId, t.position),
    index('deviz_lines_category_idx').on(t.categoryId),
    index('deviz_lines_stage_idx').on(t.stageId),
    index('deviz_lines_normed_article_idx').on(t.normedArticleId),
    check('deviz_lines_position_positive', sql`${t.position} > 0`),
    check('deviz_lines_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('deviz_lines_uom_not_blank', sql`length(btrim(${t.uom})) > 0`),
    check('deviz_lines_quantity_non_negative', sql`${t.quantity} >= 0`),
    check(
      'deviz_lines_costs_non_negative',
      sql`${t.unitPrice} >= 0 and ${t.materialCost} >= 0 and ${t.laborCost} >= 0
          and ${t.equipmentCost} >= 0 and ${t.transportCost} >= 0`,
    ),
  ],
);

/**
 * Maparea N:M client <-> intern (§8.1). **Motivul pentru care exista pasul.**
 *
 * O pozitie client se poate sparge in cinci interne, sau trei client pot cadea
 * pe una interna. Fara tabela asta, lantul se rupe exact la capat: ai cantitati
 * declarate de subcontractant si aprobate pe intern, si nimic care sa le duca
 * in situatia de lucrari catre client (pasul 14).
 *
 * `coefficient` spune cat din pozitia interna urca in cea client. La „preia ca
 * deviz intern" e 1 peste tot; la o pozitie sparta, suma coeficientilor ar
 * trebui sa dea 1 — dar asta se RAPORTEAZA, nu se impune: o mapare incompleta
 * e o stare de lucru normala in timpul redactarii (regula 6 a pasului).
 */
export const devizLineMappings = app.table(
  'deviz_line_mappings',
  {
    id: id(),
    clientLineId: uuid('client_line_id')
      .notNull()
      .references(() => devizLines.id, { onDelete: 'cascade' }),
    internLineId: uuid('intern_line_id')
      .notNull()
      .references(() => devizLines.id, { onDelete: 'cascade' }),
    coefficient: numeric('coefficient', { precision: 10, scale: 4 }).notNull().default('1'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('deviz_line_mappings_pair_unique').on(t.clientLineId, t.internLineId),
    index('deviz_line_mappings_intern_idx').on(t.internLineId),
    check('deviz_line_mappings_coefficient_positive', sql`${t.coefficient} > 0`),
  ],
);

export type Deviz = typeof devize.$inferSelect;
export type NewDeviz = typeof devize.$inferInsert;
export type DevizVersion = typeof devizVersions.$inferSelect;
export type DevizCategory = typeof devizCategories.$inferSelect;
export type DevizLine = typeof devizLines.$inferSelect;
export type DevizLineMapping = typeof devizLineMappings.$inferSelect;
