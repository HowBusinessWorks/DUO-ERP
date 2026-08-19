import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { contracts } from './contracts';
import { app } from './enums';
import { periods } from './periods';
import { persons } from './organization';

/**
 * Raportul lunar catre client (pasul 10, §3.6).
 *
 * **Banii se primesc in baza lui.** De aceea nu e un export dintr-un ecran, ci
 * un document cu stare, versiuni si un moment de inghet — dupa care nu se mai
 * rescrie. O fisa corectata dupa inghet apare in luna urmatoare ca ajustare;
 * daca ar rescrie raportul, clientul ar avea in mana o hartie care nu mai
 * corespunde cu nimic din sistem, iar discutia despre factura n-ar mai avea
 * arbitru.
 *
 * Statusurile sunt cele din plan, ca text cu `check`, nu ca enum de Postgres:
 * lista e a noastra si se schimba mai des decat merita o migrare de tip —
 * aceeasi alegere ca la `contracts.status`.
 *
 *   `building`  generarea e in coada sau ruleaza (progresul e pe rand)
 *   `review`    versiunea e gata, se citeste intern
 *   `approved`  aprobata intern — de aici incolo se poate emite factura
 *   `frozen`    inghetata: versiunea trimisa nu se mai rescrie
 *   `sent`      trimisa clientului
 */
export const MONTHLY_REPORT_STATUSES = [
  'building',
  'review',
  'approved',
  'frozen',
  'sent',
] as const;

export type MonthlyReportStatus = (typeof MONTHLY_REPORT_STATUSES)[number];

export const monthlyReports = app.table(
  'monthly_reports',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id),
    status: text('status').notNull().default('building'),
    /** Sablonul de randare: `standard`, `client_branding`. Text, ca statusul. */
    templateId: text('template_id').notNull().default('standard'),

    /*
     * Progresul jobului, scris CHIAR DE JOB, nu ghicit de ecran.
     *
     * Sute de poze inseamna minute, iar un spinner care se invarte doua minute e
     * indistinct de o aplicatie blocata. Doua numere intregi, actualizate pe
     * masura ce jobul avanseaza, dau propozitia „312 din 480" — singura care
     * spune omului daca sa astepte sau sa cheme pe cineva.
     */
    progressDone: integer('progress_done').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),
    /** Ultima eroare a jobului, in romana. Se sterge la o generare reusita. */
    lastError: text('last_error'),

    approvedBy: uuid('approved_by').references(() => persons.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    frozenAt: timestamp('frozen_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Un singur raport per contract si luna. Al doilea n-ar fi o a doua parere,
    // ar fi a doua factura pe aceeasi munca.
    unique('monthly_reports_contract_period_unique').on(t.contractId, t.periodId),
    index('monthly_reports_period_idx').on(t.periodId, t.status),
    check(
      'monthly_reports_status_known',
      sql`${t.status} in ('building','review','approved','frozen','sent')`,
    ),
    // Aprobarea isi poarta autorul si momentul, ca inchiderea de luna: „cine a
    // aprobat raportul pe august?" trebuie sa aiba raspuns.
    check(
      'monthly_reports_approved_pair',
      sql`num_nonnulls(${t.approvedAt}, ${t.approvedBy}) <> 1`,
    ),
    // Nu se poate inghetat fara aprobare, nici trimis fara inghet: ordinea e
    // chiar sensul documentului.
    check(
      'monthly_reports_freeze_after_approve',
      sql`${t.frozenAt} is null or ${t.approvedAt} is not null`,
    ),
    check(
      'monthly_reports_send_after_freeze',
      sql`${t.sentAt} is null or ${t.frozenAt} is not null`,
    ),
    check(
      'monthly_reports_progress_non_negative',
      sql`${t.progressDone} >= 0 and ${t.progressTotal} >= 0`,
    ),
  ],
);

/**
 * O versiune generata a raportului. **Imutabila.**
 *
 * `update` si `delete` nu se acorda nimanui (vezi migrarea): o regenerare dupa
 * inghet produce versiunea 2, iar versiunea 1 ramane accesibila cu tokenul ei.
 * Asta e chiar verificarea #24 a pasului.
 *
 * `included_work_unit_ids` e fotografia continutului: ce fise au INTRAT in
 * versiunea asta. Fara ea, „raportul nu se schimba dupa inghet" ar fi o
 * afirmatie despre un PDF, nu despre date — iar ajustarea din luna urmatoare
 * n-ar avea cu ce sa se compare.
 */
export const monthlyReportVersions = app.table(
  'monthly_report_versions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    reportId: uuid('report_id')
      .notNull()
      .references(() => monthlyReports.id, { onDelete: 'cascade' }),
    version: smallint('version').notNull(),
    /**
     * Nodul din folderul contractului — copia pe care o deschide biroul din
     * arborele de fisiere, cu drepturile arborelui.
     */
    artifactNodeId: uuid('artifact_node_id'),
    /**
     * Cheia din bucket-ul `archive` — copia care nu trece prin arbore si nu se
     * poate sterge din explorer. Doua copii, dinadins: una pentru oameni, una
     * pentru dovada.
     */
    archiveKey: text('archive_key').notNull(),
    /** Tokenul raportului web (§3.6). Aleatoriu, unic, cu expirare proprie. */
    webToken: text('web_token').notNull().unique(),
    webTokenExpiresAt: timestamp('web_token_expires_at', { withTimezone: true }).notNull(),

    includedWorkUnitIds: uuid('included_work_unit_ids').array().notNull(),
    inspectionCount: integer('inspection_count').notNull().default(0),
    interventionCount: integer('intervention_count').notNull().default(0),
    journalCount: integer('journal_count').notNull().default(0),
    photoCount: integer('photo_count').notNull().default(0),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),

    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    generatedBy: uuid('generated_by').references(() => persons.id),
  },
  (t) => [
    unique('monthly_report_versions_report_version_unique').on(t.reportId, t.version),
    index('monthly_report_versions_report_idx').on(t.reportId, sql`version desc`),
    check('monthly_report_versions_version_positive', sql`${t.version} >= 1`),
    check(
      'monthly_report_versions_counts_non_negative',
      sql`${t.photoCount} >= 0 and ${t.sizeBytes} >= 0`,
    ),
  ],
);

export type MonthlyReport = typeof monthlyReports.$inferSelect;
export type MonthlyReportVersion = typeof monthlyReportVersions.$inferSelect;
