import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  numeric,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { app } from './enums';
import { persons, qualifications } from './organization';
import { products } from './products';

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Biblioteca de articole normate (pasul 11, sec. 3.2; functional sec. 17).
 *
 * **E tinta, nu una din patru optiuni.** Un deviz se poate porni din sablon,
 * din alt proiect sau din Excel, dar de fiecare data sistemul propune salvarea
 * pozitiilor noi ca articole aici. Asa biblioteca creste din munca zilnica, in
 * loc sa depinda de un proiect de „normare" care nu se face niciodata.
 *
 * Codul e unic **pe firma**, nu global: doua firme din grup pot avea fiecare
 * articolul `HZ-02` cu continut diferit, iar un cod global le-ar fi obligat sa
 * negocieze un nomenclator comun inainte de a putea folosi modulul.
 */
export const normedArticles = app.table(
  'normed_articles',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    uom: text('uom').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('normed_articles_company_code_unique').on(t.companyId, t.code),
    index('normed_articles_company_idx').on(t.companyId, t.isActive),
    check('normed_articles_code_not_blank', sql`length(btrim(${t.code})) > 0`),
    check('normed_articles_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('normed_articles_uom_not_blank', sql`length(btrim(${t.uom})) > 0`),
  ],
);

/**
 * Ce intra intr-un articol normat, pe unitatea lui de masura.
 *
 * `quantity_per_uom` e cantitatea pentru UN singur `uom` al articolului: 1 mp
 * de hidroizolatie cere 2,4 kg bitum si 0,35 ore de izolator. La punerea in
 * deviz se inmulteste cu cantitatea liniei — asta face `explodeNormedArticle`.
 *
 * **Fara nicio coloana de bani.** Pretul materialului vine din nomenclator, iar
 * al manoperei din `rate_cards`, ambele istoricizate. Un pret copiat aici ar fi
 * inghetat in ziua in care s-a scris articolul si ar minti la prima scumpire.
 */
export const NORMED_COMPONENT_KINDS = ['material', 'manopera', 'utilaj', 'transport'] as const;
export type NormedComponentKind = (typeof NORMED_COMPONENT_KINDS)[number];

export const normedArticleComponents = app.table(
  'normed_article_components',
  {
    id: id(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => normedArticles.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    productId: uuid('product_id').references(() => products.id),
    qualificationId: uuid('qualification_id').references(() => qualifications.id),
    position: smallint('position').notNull(),
    /** Cantitatea pe o unitate de masura a articolului. */
    quantityPerUom: numeric('quantity_per_uom', { precision: 14, scale: 4 }).notNull(),
    /** Norma de timp, pentru componentele de manopera. */
    normHours: numeric('norm_hours', { precision: 10, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('normed_article_components_article_idx').on(t.articleId, t.position),
    check('normed_article_components_kind_known', sql`${t.kind} in ('material','manopera','utilaj','transport')`),
    check('normed_article_components_position_positive', sql`${t.position} > 0`),
    check('normed_article_components_quantity_positive', sql`${t.quantityPerUom} > 0`),
    check(
      'normed_article_components_norm_hours_non_negative',
      sql`${t.normHours} is null or ${t.normHours} >= 0`,
    ),
    /*
     * Legatura catre nomenclator ramane OPTIONALA, dinadins.
     *
     * Tentatia e sa ceri `product_id` pe material si `qualification_id` pe
     * manopera — un articol complet chiar le are pe amandoua. Dar articolele se
     * nasc, in cea mai mare parte, din butonul „salveaza pozitia ca articol
     * normat" apasat peste o linie de deviz scrisa liber (sec. 3.2). Daca
     * legatura ar fi obligatorie acolo, drumul prin care biblioteca creste
     * singura s-ar inchide, si ar ramane doar proiectul de normare care nu se
     * face niciodata.
     *
     * Deci: componenta se poate naste fara legatura, iar devizistul o ataseaza
     * cand trece prin biblioteca. Ce NU se poate: sa arate in acelasi timp si
     * catre marfa, si catre om.
     */
    check(
      'normed_article_components_single_source',
      sql`num_nonnulls(${t.productId}, ${t.qualificationId}) <= 1`,
    ),
  ],
);

/**
 * Sablonul pe tip de obiectiv (SH, bazin, rezervor, filtru, statie).
 *
 * **Nu-si tine propriile linii.** Arata catre un deviz care serveste ca tipar
 * (`source_deviz_id`). Alternativa — a doua copie a structurii de linii — ar fi
 * insemnat doua locuri de intretinut si doua formate care divergeau la prima
 * schimbare de coloana.
 *
 * `objective_kind` e text, cu aceeasi conventie ca `checklists.objective_kind`:
 * lista tipurilor de obiectiv nu e inchisa si nu merita un enum.
 *
 * FK-ul catre `app.devize` se pune de mana in migrare: declarat aici ar inchide
 * un ciclu de import intre fisierele de schema.
 */
export const devizTemplates = app.table(
  'deviz_templates',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    objectiveKind: text('objective_kind'),
    sourceDevizId: uuid('source_deviz_id').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('deviz_templates_company_name_unique').on(t.companyId, t.name),
    index('deviz_templates_objective_kind_idx').on(t.companyId, t.objectiveKind),
    check('deviz_templates_name_not_blank', sql`length(btrim(${t.name})) > 0`),
  ],
);

export type NormedArticle = typeof normedArticles.$inferSelect;
export type NewNormedArticle = typeof normedArticles.$inferInsert;
export type NormedArticleComponent = typeof normedArticleComponents.$inferSelect;
export type DevizTemplate = typeof devizTemplates.$inferSelect;
