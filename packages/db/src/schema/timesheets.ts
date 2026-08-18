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
import { companies } from './companies';
import { app } from './enums';
import { persons, rateCards, subcontractors } from './organization';
import { workStages, workUnits } from './work-units';

/**
 * Pontajul (pasul 09, §3.3).
 *
 * Doua reguli dau forma tabelelor, si amandoua sunt greseli de design frecvente
 * daca nu sunt scrise explicit:
 *
 *   1. **Ziua unui om se imparte pe mai multe unitati de lucru.** De aceea
 *      pontajul e antet + LINII, cu ore pe rand. Un pontaj cu o singura lucrare
 *      per zi ar fi un model care obliga terenul sa minta.
 *   2. **Rate card-ul se INGHEATA la validare.** `rate_card_id` si `hourly_cost`
 *      se scriu atunci, cu tariful valabil la `work_date` — nu cel curent. O
 *      modificare ulterioara de tarif nu mai atinge costurile inregistrate.
 *
 * Separat, `subcontractor_attendance` e **instrument de control, nu de plata** —
 * declarat de seful de santier, etichetat ca atare pe ecran. Nu produce nicio
 * linie de cost, dinadins: subcontractantul se plateste pe situatie de lucrari,
 * iar prezenta declarata e cifra cu care se confrunta situatia.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const TIMESHEET_STATUSES = ['draft', 'submitted', 'validated'] as const;

export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export const timesheets = app.table(
  'timesheets',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    workDate: date('work_date').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    status: text('status').notNull().default('draft'),
    validatedBy: uuid('validated_by').references(() => persons.id),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // O zi, un pontaj. Al doilea ar fi a doua versiune a aceleiasi zile, si
    // nimeni n-ar sti care e cea buna.
    unique('timesheets_person_date_unique').on(t.personId, t.workDate),
    // Ecranul de birou valideaza pe SAPTAMANA: citirea e pe firma × interval.
    index('timesheets_company_date_idx').on(t.companyId, t.workDate),
    index('timesheets_status_idx').on(t.status),
    check('timesheets_status_known', sql`${t.status} in ('draft', 'submitted', 'validated')`),
    check(
      'timesheets_validated_complete',
      sql`num_nonnulls(${t.validatedAt}, ${t.validatedBy}) <> 1`,
    ),
    check(
      'timesheets_validated_status',
      sql`(${t.status} = 'validated') = (${t.validatedAt} is not null)`,
    ),
  ],
);

export const timesheetLines = app.table(
  'timesheet_lines',
  {
    id: id(),
    timesheetId: uuid('timesheet_id')
      .notNull()
      .references(() => timesheets.id, { onDelete: 'cascade' }),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => workUnits.id),
    /** Obligatoriu daca UL-ul e lucrare — trigger, fiindca depinde de tipul lui. */
    stageId: uuid('stage_id').references(() => workStages.id),
    hours: numeric('hours', { precision: 14, scale: 4 }).notNull(),
    /** INGHETAT la validare. Null cat timp pontajul e draft. */
    rateCardId: uuid('rate_card_id').references(() => rateCards.id),
    hourlyCost: numeric('hourly_cost', { precision: 14, scale: 2 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('timesheet_lines_timesheet_idx').on(t.timesheetId),
    // „Cate ore s-au pontat pe lucrarea asta" — totalul pe UL din ecranul de birou.
    index('timesheet_lines_work_unit_idx').on(t.workUnitId),
    check('timesheet_lines_hours_positive', sql`${t.hours} > 0 and ${t.hours} <= 24`),
    check(
      'timesheet_lines_hourly_cost_non_negative',
      sql`${t.hourlyCost} is null or ${t.hourlyCost} >= 0`,
    ),
    // Tariful si costul lui merg impreuna: un cost fara tariful din care vine
    // n-ar mai putea fi explicat la un control.
    check(
      'timesheet_lines_rate_pair',
      sql`num_nonnulls(${t.rateCardId}, ${t.hourlyCost}) <> 1`,
    ),
  ],
);

/**
 * Prezenta subcontractantilor, declarata de seful de santier.
 *
 * **Instrument de control, nu de plata.** Nu are tarif, nu are cost si nu
 * produce linie de cost — si asta nu e o lipsa, e definitia ei.
 */
export const subcontractorAttendance = app.table(
  'subcontractor_attendance',
  {
    id: id(),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => workUnits.id, { onDelete: 'cascade' }),
    subcontractorId: uuid('subcontractor_id')
      .notNull()
      .references(() => subcontractors.id),
    workDate: date('work_date').notNull(),
    headcount: smallint('headcount').notNull(),
    declaredBy: uuid('declared_by')
      .notNull()
      .references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('subcontractor_attendance_unique').on(t.workUnitId, t.subcontractorId, t.workDate),
    index('subcontractor_attendance_date_idx').on(t.workDate),
    check('subcontractor_attendance_headcount_positive', sql`${t.headcount} > 0`),
  ],
);

export type Timesheet = typeof timesheets.$inferSelect;
export type NewTimesheet = typeof timesheets.$inferInsert;
export type TimesheetLine = typeof timesheetLines.$inferSelect;
export type SubcontractorAttendance = typeof subcontractorAttendance.$inferSelect;
