import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { boolean, check, integer, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { app, numberedDocumentTypeEnum } from './enums';

/**
 * Seriile de documente, per firma.
 *
 * Nomenclatoarele sunt comune celor 5 firme; seriile nu — fiecare firma isi
 * numeroteaza propriile facturi.
 *
 * Nu folosim `sequence`: sequence-urile Postgres lasa goluri la rollback,
 * pentru ca sunt intentionat necontrolate de tranzactie. Un document fiscal nu
 * are voie sa aiba goluri in numerotare. `next_number` intr-un rand obisnuit,
 * incrementat sub lock, se intoarce la loc daca tranzactia esueaza.
 *
 * `next_number` se schimba DOAR prin `app.allocate_document_number()`: niciun
 * rol nu are `update` pe tabela.
 */
export const documentSeries = app.table(
  'document_series',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    documentType: numberedDocumentTypeEnum('document_type').notNull(),
    series: text('series').notNull(),
    nextNumber: integer('next_number').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('document_series_company_type_series_unique').on(t.companyId, t.documentType, t.series),
    check('document_series_next_number_positive', sql`${t.nextNumber} >= 1`),
    check('document_series_series_not_blank', sql`btrim(${t.series}) <> ''`),
  ],
);

export type DocumentSeries = typeof documentSeries.$inferSelect;
