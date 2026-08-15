import { uuidv7 } from '@damina/shared';
import { boolean, jsonb, numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { app } from './enums';

/**
 * Cele 5 firme ale grupului.
 *
 * Nomenclatoarele sunt comune intre firme (produse, furnizori, clienti,
 * obiective, calificari) — doar seriile de documente si gestiunile sunt
 * proprii. De aceea `company_id` apare pe documente, nu pe nomenclatoare.
 */
export const companies = app.table('companies', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  cui: text('cui').unique(),
  regCom: text('reg_com'),
  address: jsonb('address'),
  // Sigla de pe rapoartele catre client. `app.nodes` vine in pasul 07.
  logoNodeId: uuid('logo_node_id'),
  isGroupMember: boolean('is_group_member').notNull().default(true),
  // Doar referinte catre Supabase Vault. Credentialele nu stau aici.
  efacturaConfig: jsonb('efactura_config'),
  /** Indexarea anuala implicita a contractelor: 0.0500 = 5%. Poate fi 0. */
  defaultIndexationPct: numeric('default_indexation_pct', { precision: 6, scale: 4 })
    .notNull()
    .default('0.0500'),
  /** Pragul peste care o interventie de mentenanta trece pe Delta. */
  defaultDeltaThreshold: numeric('default_delta_threshold', { precision: 14, scale: 2 })
    .notNull()
    .default('2000.00'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
