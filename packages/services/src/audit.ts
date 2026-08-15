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
      occurred_at: Date;
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
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    actorName: row.actor_name,
    operation: row.operation,
    changed: row.changed,
    reason: row.reason,
  }));
}
