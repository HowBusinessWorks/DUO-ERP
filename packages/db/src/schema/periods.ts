import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { app, periodStatusEnum } from './enums';
import { persons } from './organization';

/**
 * Luna contabila, per firma.
 *
 * Odata inchisa, blocheaza scrierile pe tot ce poarta `period_id` — prin
 * trigger, nu prin `if` in serviciu. Altfel cifrele lunilor trecute nu mai sunt
 * reproductibile, si tot raportul financiar devine inutil.
 */
export const periods = app.table(
  'periods',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    status: periodStatusEnum('status').notNull().default('open'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => persons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('periods_company_year_month_unique').on(t.companyId, t.year, t.month),
    check('periods_month_range', sql`${t.month} between 1 and 12`),
    check('periods_year_range', sql`${t.year} between 2000 and 2100`),
    // O luna inchisa stie cine si cand a inchis-o. Fara asta, "cine a inchis
    // august?" nu are raspuns, iar inchiderea e tocmai o actiune ireversibila.
    check(
      'periods_closed_has_author',
      sql`(${t.status} = 'closed') = (${t.closedAt} is not null and ${t.closedBy} is not null)`,
    ),
  ],
);

/**
 * Checklist-ul de inchidere, ca date si nu ca cod.
 *
 * Fiecare `check_key` are un query de validare inregistrat in aplicatie.
 * Ecranul de inchidere (pasul 06) randeaza tabela; butonul "Inchide luna" e
 * activ doar cand niciun rand nu e `blocked`.
 */
export const periodCloseChecks = app.table(
  'period_close_checks',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id, { onDelete: 'cascade' }),
    checkKey: text('check_key').notNull(),
    status: text('status').notNull().default('pending'),
    blockingCount: integer('blocking_count').notNull().default(0),
    detail: jsonb('detail'),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }),
  },
  (t) => [
    unique('period_close_checks_period_key_unique').on(t.periodId, t.checkKey),
    /*
     * Cinci stari, nu trei (pasul 06, §3.3). Cele doua adaugate spun lucruri
     * diferite, si de-aia sunt doua:
     *   `not_applicable` — verificarea nu se aplica firmei asteia (n-are flota,
     *      n-are subcontractanti). Ramane asa pana se schimba firma.
     *   `pending_module` — modulul care raspunde inca nu exista (SL, SPV, Saga).
     *      Se aprinde SINGURA cand apare modulul, fara migrare — de aceea nu e
     *      acelasi lucru cu `not_applicable`, desi pe ecran arata la fel.
     */
    check(
      'period_close_checks_status',
      sql`${t.status} in ('pending', 'ok', 'blocked', 'not_applicable', 'pending_module')`,
    ),
    check('period_close_checks_blocking_count', sql`${t.blockingCount} >= 0`),
  ],
);

export type Period = typeof periods.$inferSelect;
export type NewPeriod = typeof periods.$inferInsert;
export type PeriodCloseCheck = typeof periodCloseChecks.$inferSelect;
