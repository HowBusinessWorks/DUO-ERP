import { type Actor, schema, withActor, withServiceActor } from '@damina/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

/**
 * Cele trei mecanisme din §28, cu API-uri deliberat DIFERITE, ca sa nu se
 * confunde la apel:
 *
 *   coada  → `countWorkQueue` / `listWorkQueue` / `resolveWorkQueueItem`
 *            Se GOLESTE prin actiune. Ce nu se poate goli nu se pune aici.
 *   clopotel → `listNotifications` / `markNotificationRead`
 *            Eveniment punctual, citit o data.
 *   alerte → `listOpenAlerts` / `raiseAlert` / `resolveAlert`
 *            Prag depasit; persista pana dispare conditia.
 *
 * Exemplul concret al fiecaruia, ca sa nu fie confundate in pasii urmatori:
 *
 *   coada:      „SL-0012 asteapta aprobarea ta” — dispare cand o aprobi.
 *   notificare: „A. Ionescu ti-a aprobat devizul D-45” — o citesti si gata.
 *   alerta:     „Bugetul componentei Lucrari e la 84%” — sta pe contract pana
 *               cand cineva mareste plafonul sau consumul scade.
 */

// ── Coada de lucru ───────────────────────────────────────────────────────────

export interface QueueCount {
  readonly kind: string;
  readonly count: number;
}

/**
 * Cate lucruri asteapta de la mine, pe tipuri, in firmele pe care le privesc.
 *
 * Filtrarea pe firme nu e cosmetica: badge-ul din sidebar trebuie sa insemne
 * „in ce vad acum”, altfel omul apasa pe el si nu gaseste randurile.
 */
export async function countWorkQueue(
  actor: Actor,
  personId: string,
  companyIds: readonly string[],
): Promise<QueueCount[]> {
  if (companyIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        kind: schema.workQueueItems.kind,
        count: sql<string>`count(*)::text`,
      })
      .from(schema.workQueueItems)
      .where(
        and(
          eq(schema.workQueueItems.personId, personId),
          inArray(schema.workQueueItems.companyId, [...companyIds]),
          isNull(schema.workQueueItems.resolvedAt),
        ),
      )
      .groupBy(schema.workQueueItems.kind);

    return rows.map((row) => ({ kind: row.kind, count: Number(row.count) }));
  });
}

export type WorkQueueRow = typeof schema.workQueueItems.$inferSelect;

export async function listWorkQueue(
  actor: Actor,
  personId: string,
  companyIds: readonly string[],
  options: { readonly kind?: string; readonly limit?: number } = {},
): Promise<WorkQueueRow[]> {
  if (companyIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.workQueueItems)
      .where(
        and(
          eq(schema.workQueueItems.personId, personId),
          inArray(schema.workQueueItems.companyId, [...companyIds]),
          isNull(schema.workQueueItems.resolvedAt),
          options.kind === undefined ? undefined : eq(schema.workQueueItems.kind, options.kind),
        ),
      )
      .orderBy(desc(schema.workQueueItems.createdAt))
      .limit(options.limit ?? 50),
  );
}

/**
 * Golirea unui rand de coada.
 *
 * In viata reala nu se cheama de la buton: se cheama din use-case-ul care chiar
 * rezolva treaba (aprobarea SL-ului goleste randul „SL de aprobat”). Un buton
 * „marchează ca rezolvat” care nu face nimic altceva transforma coada intr-o
 * lista de bifat, si atunci nu mai masoara nimic.
 */
export async function resolveWorkQueueItem(actor: Actor, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .update(schema.workQueueItems)
      .set({ resolvedAt: new Date() })
      .where(and(eq(schema.workQueueItems.id, id), isNull(schema.workQueueItems.resolvedAt)));
  });
}

// ── Clopoțel ─────────────────────────────────────────────────────────────────

export type NotificationRow = typeof schema.notifications.$inferSelect;

export async function listNotifications(
  actor: Actor,
  personId: string,
  limit = 20,
): Promise<NotificationRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.personId, personId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit),
  );
}

export async function countUnreadNotifications(actor: Actor, personId: string): Promise<number> {
  const rows = await withActor(actor, async (tx) =>
    tx
      .select({ count: sql<string>`count(*)::text` })
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.personId, personId), isNull(schema.notifications.readAt)),
      ),
  );
  return Number(rows[0]?.count ?? '0');
}

export async function markNotificationRead(actor: Actor, id: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(schema.notifications.id, id), isNull(schema.notifications.readAt)));
  });
}

export async function markAllNotificationsRead(actor: Actor, personId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(schema.notifications.personId, personId), isNull(schema.notifications.readAt)),
      );
  });
}

// ── Alerte ───────────────────────────────────────────────────────────────────

export type AlertRow = typeof schema.alerts.$inferSelect;

export async function listOpenAlerts(
  actor: Actor,
  companyIds: readonly string[],
  options: { readonly scopeType?: string; readonly scopeId?: string; readonly limit?: number } = {},
): Promise<AlertRow[]> {
  if (companyIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.alerts)
      .where(
        and(
          inArray(schema.alerts.companyId, [...companyIds]),
          isNull(schema.alerts.resolvedAt),
          options.scopeType === undefined ? undefined : eq(schema.alerts.scopeType, options.scopeType),
          options.scopeId === undefined ? undefined : eq(schema.alerts.scopeId, options.scopeId),
        ),
      )
      .orderBy(desc(schema.alerts.severity), desc(schema.alerts.raisedAt))
      .limit(options.limit ?? 20),
  );
}

export interface RaiseAlertInput {
  readonly companyId: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly kind: string;
  readonly severity?: 'info' | 'warning' | 'critical';
  readonly title: string;
  readonly href?: string;
  readonly payload?: Record<string, unknown>;
}

/**
 * Ridica o alerta, idempotent.
 *
 * `on conflict do nothing` pe indexul unic partial: a doua rulare a
 * resolver-ului pe acelasi buget depasit nu produce un al doilea rand. Fara
 * asta, un job care ruleaza din 15 in 15 minute umple bannerul in doua ore si
 * omul inceteaza sa-l mai citeasca — adica alertele isi pierd tot rostul.
 *
 * Ruleaza ca `app_service`: alertele le produce sistemul, nu utilizatorul.
 */
export async function raiseAlert(jobName: string, input: RaiseAlertInput): Promise<void> {
  await withServiceActor(jobName, async (tx) => {
    await tx.execute(sql`
      insert into app.alerts (id, company_id, scope_type, scope_id, kind, severity, title, href, payload)
      values (
        gen_random_uuid(), ${input.companyId}, ${input.scopeType}, ${input.scopeId},
        ${input.kind}, ${input.severity ?? 'warning'}::app.alert_severity, ${input.title},
        ${input.href ?? null}, ${input.payload === undefined ? null : JSON.stringify(input.payload)}::jsonb
      )
      on conflict do nothing
    `);
  });
}

/** Inchide alerta cand conditia a disparut. Randul ramane, cu `resolved_at`. */
export async function resolveAlert(
  jobName: string,
  scopeType: string,
  scopeId: string,
  kind: string,
): Promise<void> {
  await withServiceActor(jobName, async (tx) => {
    await tx
      .update(schema.alerts)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(schema.alerts.scopeType, scopeType),
          eq(schema.alerts.scopeId, scopeId),
          eq(schema.alerts.kind, kind),
          isNull(schema.alerts.resolvedAt),
        ),
      );
  });
}
