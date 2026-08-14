import { uuidv7 } from '@damina/shared';
import { boolean, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { app } from './enums';

/**
 * Cele 5 firme ale grupului. E singura tabela de business din pasul 01 —
 * exista ca sa avem pe ce testa `withActor`, rolurile si RLS-ul.
 * Restul organizatiei (persoane, echipe, clienti, furnizori) vine in pasul 02.
 */
export const companies = app.table('companies', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  cui: text('cui').unique(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
