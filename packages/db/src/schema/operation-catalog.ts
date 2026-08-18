import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  numeric,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { products } from './products';
import { qualifications, teams } from './organization';
import { periods } from './periods';
import { app } from './enums';

/**
 * Catalogul de operatiuni standard (pasul 08, §8.5).
 *
 * Rostul lui e sa transforme pragul de 2.000 lei dintr-o cifra „din ochi" intr-o
 * cifra calculata: norma de timp × tariful curent + materialele tipice. Fara
 * catalog, valoarea estimata a unei cereri ar fi opinia celui care o evalueaza,
 * si pragul de rutare ar depinde de cine a scris cifra, nu de operatiune.
 *
 * `operation_actuals` e mecanismul anti-furt: costul REAL mediu, per operatiune
 * si per echipa, intretinut prin acelasi tipar de trigger ca rollup-urile din
 * pasul 06 — un `SELECT` pe tabela materializata, nu un raport calculat la
 * cerere. Trigger-ul se ataseaza in pasul 09, la fisele de interventie; aici se
 * pregateste doar structura, testabila cu date inserate manual (verificarea #22).
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const operationCatalog = app.table(
  'operation_catalog',
  {
    id: id(),
    /** `OP-118`. Unic, e cheia pe care o cauta omul din evaluare. */
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    /** Gruparea din nomenclator. Text, ca la produse: creste cu firma. */
    category: text('category'),
    standardHours: numeric('standard_hours', { precision: 14, scale: 4 }).notNull(),
    qualificationId: uuid('qualification_id')
      .notNull()
      .references(() => qualifications.id),
    /**
     * Manopera si materialul estimat. Derivate din tariful curent la CRUD, dar
     * stocate — nu recalculate live — ca o cerere evaluata azi sa nu-si schimbe
     * cifra maine cand se schimba tariful orar.
     */
    estimatedLabor: numeric('estimated_labor', { precision: 14, scale: 2 }).notNull(),
    estimatedMaterial: numeric('estimated_material', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check('operation_catalog_code_not_blank', sql`length(btrim(${t.code})) > 0`),
    check('operation_catalog_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('operation_catalog_hours_positive', sql`${t.standardHours} > 0`),
    check('operation_catalog_labor_non_negative', sql`${t.estimatedLabor} >= 0`),
    check('operation_catalog_material_non_negative', sql`${t.estimatedMaterial} >= 0`),
  ],
);

/** Materialele tipice ale unei operatiuni. Cantitate per o singura executie. */
export const operationCatalogMaterials = app.table(
  'operation_catalog_materials',
  {
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operationCatalog.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.operationId, t.productId] }),
    check('operation_catalog_materials_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

/**
 * Costul real, materializat per operatiune × echipa × luna (mecanismul
 * anti-furt din §8.5). Randul se scrie/actualizeaza prin trigger la validarea
 * unei fise de interventie (pasul 09) — aici doar structura si constrangerile.
 */
export const operationActuals = app.table(
  'operation_actuals',
  {
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operationCatalog.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id),
    executions: integer('executions').notNull().default(0),
    avgRealCost: numeric('avg_real_cost', { precision: 14, scale: 2 }),
    avgEstimatedCost: numeric('avg_estimated_cost', { precision: 14, scale: 2 }),
  },
  (t) => [
    primaryKey({ columns: [t.operationId, t.teamId, t.periodId] }),
    check('operation_actuals_executions_non_negative', sql`${t.executions} >= 0`),
    check(
      'operation_actuals_avg_real_non_negative',
      sql`${t.avgRealCost} is null or ${t.avgRealCost} >= 0`,
    ),
    check(
      'operation_actuals_avg_estimated_non_negative',
      sql`${t.avgEstimatedCost} is null or ${t.avgEstimatedCost} >= 0`,
    ),
  ],
);

export type OperationCatalogEntry = typeof operationCatalog.$inferSelect;
export type NewOperationCatalogEntry = typeof operationCatalog.$inferInsert;
export type OperationCatalogMaterial = typeof operationCatalogMaterials.$inferSelect;
export type OperationActual = typeof operationActuals.$inferSelect;
