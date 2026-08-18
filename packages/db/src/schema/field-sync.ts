import { sql } from 'drizzle-orm';
import { check, index, jsonb, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { app } from './enums';
import { persons } from './organization';

/** Acelasi ajutor local ca in celelalte fisiere de schema. */
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Sincronizarea aplicatiei de teren (pasul 10, §3.2).
 *
 * Doua tabele, si amandoua exista pentru acelasi lucru: **conexiunea cade la
 * jumatatea cererii, in subsol.** Nu e un caz limita, e cazul obisnuit.
 */

/**
 * Jurnalul mutatiilor aplicate — **cheia de idempotenta a intregului sistem**.
 *
 * `id` vine de la CLIENT, generat ca UUID v7 inainte de a exista retea. Un
 * `POST` cu un id deja aplicat nu reexecuta nimic: intoarce rezultatul memorat
 * in `result`. De asta retry-ul e sigur prin constructie, si de asta id-ul nu
 * se remapeaza niciodata la upload — o remapare ar face ca acelasi telefon sa
 * nu-si mai recunoasca propria mutatie dupa ce reteaua a cazut intre scriere si
 * raspuns.
 *
 * `error_code` nu e un esec de infrastructura: e o eroare de BUSINESS memorata
 * (luna inchisa, stoc insuficient). Se memoreaza dinadins — a doua incercare a
 * aceleiasi mutatii, cu aceleasi date, va esua la fel, iar coada trebuie sa se
 * opreasca in acelasi loc, nu sa reexecute o tranzactie grea ca sa afle asta.
 */
export const appliedMutations = app.table(
  'applied_mutations',
  {
    /** = `mutation.id` de pe client. NU se genereaza aici. */
    id: uuid('id').primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id),
    /** Identifica telefonul, nu sesiunea: ordinea cozii e per dispozitiv. */
    deviceId: text('device_id').notNull(),
    type: text('type').notNull(),
    /** Ce a intors use-case-ul. Se da inapoi la retry, fara reexecutie. */
    result: jsonb('result'),
    /** Cod de eroare de business, cand mutatia a fost respinsa definitiv. */
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('applied_mutations_person_idx').on(t.personId, t.appliedAt),
    index('applied_mutations_device_idx').on(t.deviceId, t.appliedAt),
    // Retentia e 90 de zile (job nocturn). Indexul pe data face stergerea ieftina.
    index('applied_mutations_applied_at_idx').on(t.appliedAt),
    check('applied_mutations_type_not_blank', sql`length(btrim(${t.type})) > 0`),
    check('applied_mutations_device_not_blank', sql`length(btrim(${t.deviceId})) > 0`),
    /*
     * Ori a mers, ori a picat cu un motiv — nu amandoua, si nu niciuna.
     * Un rand cu `result` si `error_code` deodata ar fi o mutatie despre care
     * nimeni nu mai poate spune daca a avut efect.
     */
    check(
      'applied_mutations_outcome_exclusive',
      sql`(${t.result} is not null) <> (${t.errorCode} is not null)`,
    ),
  ],
);

/**
 * Cursorul de pull, per (persoana, dispozitiv).
 *
 * Doua telefoane ale aceluiasi om au cursoare separate dinadins: unul lasat in
 * masina o saptamana nu are voie sa creada ca a primit ce a primit celalalt.
 */
export const syncCursors = app.table(
  'sync_cursors',
  {
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    lastPulledAt: timestamp('last_pulled_at', { withTimezone: true }),
    /**
     * Cursorul opac intors ultima data. Text, nu timestamp: forma lui e treaba
     * serverului si se poate schimba fara migrare de date.
     */
    lastCursor: text('last_cursor'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.deviceId] }),
    check('sync_cursors_device_not_blank', sql`length(btrim(${t.deviceId})) > 0`),
  ],
);
