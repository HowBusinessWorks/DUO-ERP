import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { index, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { alertSeverityEnum, app } from './enums';
import { persons } from './organization';

/**
 * Cele TREI mecanisme din §28. Confuzia dintre ele e cea mai comuna greseala din
 * ERP-uri, asa ca stau in tabele separate, cu semantici separate:
 *
 *   work_queue_items — obiecte care asteapta ACTIUNEA MEA. Badge in sidebar.
 *                      Se GOLESC prin actiune. Daca un rand nu se poate goli,
 *                      nu e coada de lucru, e statistica — si statisticile stau
 *                      in Panou.
 *   notifications    — eveniment punctual, spus O DATA. Clopotel.
 *   alerts           — prag depasit, PERSISTA pana dispare conditia. Banner.
 *   outbox_events    — efecte secundare care nu au voie sa blocheze tranzactia.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Coada de lucru personala. Un rand = un obiect care asteapta de la mine.
 *
 * `company_id` exista ca sa se filtreze pe selectia de firme din bara de sus:
 * badge-ul arata cate lucruri ma asteapta *in firmele pe care le privesc acum*.
 */
export const workQueueItems = app.table(
  'work_queue_items',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** `sl_de_aprobat`, `cerere_neprocesata`, `pv_deschis`… Text: fiecare pas isi
     * adauga tipurile lui fara migrare de enum. Valorile traiesc in `@damina/contracts`. */
    kind: text('kind').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    title: text('title').notNull(),
    /** Ruta catre locul unde se rezolva. Fara ea, badge-ul e o fundatura. */
    href: text('href').notNull(),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    // Intrebarea pusa la fiecare randare de sidebar: "cate lucruri deschise am eu,
    // pe tipuri". Indexul partial tine doar randurile nerezolvate — o coada golita
    // corect nu incetineste nimic, oricat ar creste istoricul.
    index('work_queue_items_open_idx')
      .on(t.personId, t.kind, t.companyId)
      .where(sql`resolved_at is null`),
  ],
);

/** Eveniment punctual. Se citeste o data si ramane in istoric. */
export const notifications = app.table(
  'notifications',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    href: text('href'),
    /** `aproba` | `vezi` | `amana` — actiunea directa din clopotel. */
    actionKind: text('action_kind'),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('notifications_person_created_idx').on(t.personId, t.createdAt.desc())],
);

/**
 * Prag depasit. Persista pana cand conditia dispare si cineva o inchide.
 *
 * Indexul unic partial din migrare (`unique … where resolved_at is null`) e
 * motivul pentru care nu ajungem cu 40 de alerte identice pe acelasi buget.
 */
export const alerts = app.table(
  'alerts',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** Pe ce sta alerta: `contract`, `work_unit`, `product`, `person`… */
    scopeType: text('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
    /** `buget_80`, `delta_sub_prag`, `stoc_sub_minim`, `autorizatie_expira`… */
    kind: text('kind').notNull(),
    severity: alertSeverityEnum('severity').notNull().default('warning'),
    title: text('title').notNull(),
    payload: jsonb('payload'),
    href: text('href'),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('alerts_scope_idx').on(t.scopeType, t.scopeId)],
);

/**
 * Outbox. Efectul secundar se scrie in aceeasi tranzactie cu fapta, dar se
 * executa dupa — daca tranzactia da rollback, efectul dispare cu ea.
 */
export const outboxEvents = app.table(
  'outbox_events',
  {
    id: id(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [
    index('outbox_events_unprocessed_idx')
      .on(t.createdAt)
      .where(sql`processed_at is null`),
  ],
);

export type WorkQueueItem = typeof workQueueItems.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
