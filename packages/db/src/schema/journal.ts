import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { check, date, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { app } from './enums';
import { persons } from './organization';
import { workStages, workUnits } from './work-units';

/**
 * Jurnalul de santier (pasul 10, §3.5).
 *
 * **Append-only, si asta e chiar definitia lui.** Un jurnal care se poate
 * rescrie nu mai e o consemnare, e o parere de acum despre ce a fost atunci —
 * exact lucrul care nu tine intr-o discutie cu clientul peste sase luni. De
 * aceea nu exista `update`/`delete` in grant-uri, iar ecranul nu are „editeaza":
 * o corectie se scrie ca o intrare noua, cu data ei.
 *
 * **Poza nu are coloana aici.** Ea pleaca prin coada `media`, in folderul `Poze`
 * al unitatii, ca peste tot in aplicatia de teren; jurnalul si pozele zilei se
 * citesc impreuna prin unitatea de lucru. O a doua legatura ar fi insemnat doua
 * adevaruri despre acelasi fisier.
 *
 * `entry_date` e data CONSEMNARII pe hartie, separata de `created_at`: omul
 * scrie seara ce s-a intamplat dimineata, iar in subsol scrie a doua zi.
 */
export const journalEntries = app.table(
  'journal_entries',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workUnitId: uuid('work_unit_id')
      .notNull()
      .references(() => workUnits.id, { onDelete: 'cascade' }),
    /** Etapa, cand lucrarea are etape. Optionala: o interventie n-are. */
    stageId: uuid('stage_id').references(() => workStages.id),
    /** Cine a consemnat. Se ia din sesiune, nu de pe ecran. */
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    entryDate: date('entry_date').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('journal_entries_work_unit_idx').on(t.workUnitId, t.entryDate),
    check('journal_entries_text_not_blank', sql`length(btrim(${t.text})) > 0`),
  ],
);

export type JournalEntry = typeof journalEntries.$inferSelect;
export type NewJournalEntry = typeof journalEntries.$inferInsert;
