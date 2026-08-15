import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { boolean, check, index, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { app } from './enums';
import { suppliers } from './organization';

/**
 * Nomenclatorul de produse. Comun celor 5 firme, ca toate nomenclatoarele —
 * doar seriile de documente si gestiunile sunt per firma.
 *
 * Ce NU e aici, intentionat: stocul, pretul si CMP-ul. Un produs e o definitie,
 * nu o cantitate. Soldurile vin cu `app.stock_balances` in pasul 06, iar pretul
 * de achizitie traieste pe linia de NIR, nu pe nomenclator — altfel istoricul de
 * cost se pierde la prima actualizare de pret.
 */
export const products = app.table(
  'products',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    /** Codul intern, cel scris pe bonul de consum. Unic, case-insensitive prin index. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Unitatea de masura: buc, kg, m, mp, mc, l, ora, set. Text, nu enum: lista
     * creste cu fiecare furnizor nou si o migrare de tip pentru "ml" e absurda. */
    uom: text('uom').notNull(),
    /** Gruparea din nomenclator (materiale de constructii, instalatii, consumabile…). */
    category: text('category'),
    defaultSupplierId: uuid('default_supplier_id').references(() => suppliers.id),
    /** Fals pentru servicii si manopera facturata: nu intra niciodata in gestiune. */
    isStockItem: boolean('is_stock_item').notNull().default(true),
    /** Pragul care declanseaza alerta `stoc_sub_minim`. Null = fara prag. */
    minStock: numeric('min_stock', { precision: 14, scale: 4 }),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Cautarea din nomenclator si din editorul de deviz merge pe nume, nu pe cod.
    index('products_name_idx').on(t.name),
    check('products_code_not_blank', sql`length(btrim(${t.code})) > 0`),
    check('products_uom_not_blank', sql`length(btrim(${t.uom})) > 0`),
    check('products_min_stock_non_negative', sql`${t.minStock} is null or ${t.minStock} >= 0`),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
