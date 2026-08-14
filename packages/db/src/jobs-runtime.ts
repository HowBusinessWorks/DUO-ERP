import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import type { ActorTx } from './with-actor';

/**
 * Interogarile peste tabelele operationale din schema `jobs`.
 *
 * Traiesc aici, si nu in `apps/worker`, pentru ca tot SQL-ul apartine
 * pachetului `db` — aplicatiile nu compun interogari.
 */

export interface PingRecord {
  jobId: string;
  note?: string | undefined;
  processedBy: string;
}

/** Tinta cozii de test `system.ping`. */
export async function recordPing(tx: ActorTx, record: PingRecord): Promise<void> {
  await tx.execute(sql`
    insert into jobs.ping_log (id, job_id, note, processed_by)
    values (${uuidv7()}, ${record.jobId}, ${record.note ?? null}, ${record.processedBy})
  `);
}

export async function countPings(tx: ActorTx): Promise<number> {
  const result = await tx.execute<{ count: string }>(
    sql`select count(*)::text as count from jobs.ping_log`,
  );
  return Number(result.rows[0]?.count ?? '0');
}

/** Bataia de inima a worker-ului, citita de /api/health. */
export async function beatHeartbeat(
  tx: ActorTx,
  worker: { workerId: string; version?: string },
): Promise<void> {
  await tx.execute(sql`
    insert into jobs.worker_heartbeat (worker_id, version, beat_at)
    values (${worker.workerId}, ${worker.version ?? null}, now())
    on conflict (worker_id) do update
      set beat_at = now(), version = excluded.version
  `);
}

export interface Heartbeat {
  workerId: string;
  beatAt: Date;
  ageSeconds: number;
}

/** Cea mai recenta bataie de inima, oricare worker. */
export async function readHeartbeat(tx: ActorTx): Promise<Heartbeat | null> {
  const result = await tx.execute<{ worker_id: string; beat_at: Date; age_seconds: string }>(sql`
    select worker_id, beat_at, extract(epoch from (now() - beat_at))::text as age_seconds
    from jobs.worker_heartbeat
    order by beat_at desc
    limit 1
  `);

  const row = result.rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    workerId: row.worker_id,
    beatAt: row.beat_at,
    ageSeconds: Math.round(Number(row.age_seconds)),
  };
}

/**
 * Reaplica grant-urile peste tabelele create de pg-boss la prima pornire.
 * Idempotent; worker-ul o cheama dupa `boss.start()`.
 */
export async function grantQueueAccess(tx: ActorTx): Promise<void> {
  await tx.execute(sql`select jobs.grant_queue_access()`);
}
