import { type Actor, withActor } from '@damina/db';
import { sql } from 'drizzle-orm';

/**
 * Citirea jurnalului de audit.
 *
 * `audit.entries` nu e sub drizzle (schema `audit` e in afara lui
 * `schemaFilter`), deci interogarea e SQL scris de mana. Nu e un compromis:
 * jurnalul e append-only si are exact doua intrebari — „ce s-a intamplat cu
 * randul asta” si „ce a facut omul asta” — care nu au nevoie de un query
 * builder.
 */

export interface AuditEntry {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly operation: 'insert' | 'update' | 'delete';
  /** Doar diferenta: `{ coloana: { old, new } }`. */
  readonly changed: Readonly<Record<string, { old: unknown; new: unknown }>>;
  readonly reason: string | null;
}

/** Istoricul unui rand, cel mai recent primul. */
export async function listAuditEntries(
  actor: Actor,
  tableName: string,
  recordId: string,
  limit = 50,
): Promise<AuditEntry[]> {
  const rows = await withActor(actor, async (tx) =>
    tx.execute<{
      id: string;
      occurred_at: Date | string;
      actor_id: string | null;
      actor_name: string | null;
      operation: 'insert' | 'update' | 'delete';
      changed: Record<string, { old: unknown; new: unknown }>;
      reason: string | null;
    }>(sql`
      select e.id::text as id,
             e.occurred_at,
             e.actor_id::text as actor_id,
             p.full_name as actor_name,
             e.operation,
             e.changed,
             e.reason
        from audit.entries e
        left join app.persons p on p.id = e.actor_id
       where e.table_name = ${tableName}
         and e.record_id = ${recordId}
       order by e.occurred_at desc, e.id desc
       limit ${limit}
    `),
  );

  return rows.rows.map((row) => ({
    id: row.id,
    occurredAt: toDate(row.occurred_at),
    actorId: row.actor_id,
    actorName: row.actor_name,
    operation: row.operation,
    changed: row.changed,
    reason: row.reason,
  }));
}

/**
 * `occurred_at` vine ca SIR, nu ca `Date`.
 *
 * Interogarile de aici trec prin `tx.execute` — SQL brut, pentru ca schema
 * `audit` nu e sub drizzle. Pe drumul ala, valoarea nu mai trece prin parserul
 * de coloana al lui drizzle si ajunge asa cum o da driverul. Tipul declarat mai
 * sus spunea `Date` si nimeni nu-l contrazicea: TypeScript are incredere in ce
 * scrii intr-un `execute<...>()`.
 *
 * S-a vazut abia cand jurnalul a avut randuri de aratat — `Intl.format` pe un
 * sir da `RangeError: Invalid time value`, iar `.toISOString()` nu exista pe el.
 * Conversia se face AICI, o data, ca ecranele sa primeasca ce li s-a promis.
 */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Aceeasi intrare, cu tabela si randul atasate — pentru jurnalul global. */
export interface AuditFeedEntry extends AuditEntry {
  readonly tableName: string;
  readonly recordId: string;
}

/**
 * Jurnalul intreg, cel mai recent primul. Ecranul „Administrare › Audit trail”.
 *
 * Nu are filtru de rol: politica de pe `audit.entries` (migrarea `0011`) lasa
 * doar `admin` sa citeasca, iar un `financiar` primeste **zero randuri**, nu o
 * eroare. Ecranul verifica dreptul separat, ca sa spuna de ce lista e goala —
 * verificarea #19 din pas cere ambele jumatati.
 */
export async function listRecentAuditEntries(
  actor: Actor,
  limit = 100,
): Promise<AuditFeedEntry[]> {
  const rows = await withActor(actor, async (tx) =>
    tx.execute<{
      id: string;
      occurred_at: Date | string;
      actor_id: string | null;
      actor_name: string | null;
      operation: 'insert' | 'update' | 'delete';
      changed: Record<string, { old: unknown; new: unknown }>;
      reason: string | null;
      table_name: string;
      record_id: string;
    }>(sql`
      select e.id::text as id,
             e.occurred_at,
             e.actor_id::text as actor_id,
             p.full_name as actor_name,
             e.operation,
             e.changed,
             e.reason,
             e.table_name,
             e.record_id::text as record_id
        from audit.entries e
        left join app.persons p on p.id = e.actor_id
       order by e.occurred_at desc, e.id desc
       limit ${limit}
    `),
  );

  return rows.rows.map((row) => ({
    id: row.id,
    occurredAt: toDate(row.occurred_at),
    actorId: row.actor_id,
    actorName: row.actor_name,
    operation: row.operation,
    changed: row.changed,
    reason: row.reason,
    tableName: row.table_name,
    recordId: row.record_id,
  }));
}
