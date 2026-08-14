import type { ActorTx } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import type { JobDefinition } from './registry';

/**
 * Motivul pentru care pg-boss sta pe acelasi Postgres: **enqueue tranzactional**.
 *
 * Jobul se insereaza in ACEEASI tranzactie cu datele. Daca tranzactia da
 * rollback, jobul dispare cu ea. Cu o coada externa (SQS, Upstash) exista mereu
 * fereastra "job trimis, tranzactie esuata" — si ajungi sa construiesti un
 * outbox oricum.
 *
 * Ca sa scriem in aceeasi tranzactie, nu putem folosi `boss.send()`: acela isi
 * deschide propria conexiune. Deci reproducem interogarea de insert a lui
 * pg-boss (`plans.insertJobs`, versiunea 10.x) peste tranzactia noastra.
 * Cuplajul e intentionat si acoperit de un test in `test:db` — daca pg-boss
 * schimba schema la un major, testul pica inainte de deploy.
 */

function jobsSchema(): string {
  const schema = process.env['PGBOSS_SCHEMA'] ?? 'jobs';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`PGBOSS_SCHEMA invalid: "${schema}".`);
  }
  return schema;
}

export interface EnqueueOptions {
  /** Suprascrie cheia de idempotenta calculata din definitia jobului. */
  singletonKey?: string;
  /** Intarzie pornirea cu atatea secunde. */
  startAfterSeconds?: number;
  /** 0 e implicit; numere mai mari trec in fata. */
  priority?: number;
}

/**
 * Pune un job in coada, in tranzacția curentă.
 *
 * Intoarce `false` daca jobul a fost respins ca duplicat (exista deja unul cu
 * aceeasi `singletonKey`) — asta e comportamentul corect, nu o eroare.
 */
export async function enqueue<TPayload>(
  tx: ActorTx,
  job: JobDefinition<TPayload>,
  payload: TPayload,
  options: EnqueueOptions = {},
): Promise<boolean> {
  const parsed = job.schema.parse(payload);
  const singletonKey = options.singletonKey ?? job.singletonKey?.(parsed) ?? null;
  const schema = sql.raw(jobsSchema());

  const row = {
    id: uuidv7(),
    name: job.name,
    priority: options.priority ?? 0,
    data: parsed,
    startAfter:
      options.startAfterSeconds === undefined ? null : `${options.startAfterSeconds} seconds`,
    retryLimit: job.retryLimit,
    retryDelay: job.retryDelaySeconds,
    retryBackoff: job.retryBackoff,
    singletonKey,
    singletonSeconds: null,
    expireInSeconds: job.expireInSeconds,
    keepUntil: null,
    deadLetter: null,
  };

  const result = await tx.execute(sql`
    insert into ${schema}.job (
      id, name, data, priority, start_after, singleton_key, singleton_on,
      dead_letter, expire_in, keep_until, retry_limit, retry_delay, retry_backoff, policy
    )
    select
      coalesce(j.id, gen_random_uuid()),
      j.name,
      j.data,
      coalesce(j.priority, 0),
      j.start_after,
      j."singletonKey",
      null,
      coalesce(j."deadLetter", q.dead_letter),
      case
        when j."expireInSeconds" is not null then j."expireInSeconds"::numeric * interval '1s'
        when q.expire_seconds is not null then q.expire_seconds * interval '1s'
        else interval '15 minutes'
      end,
      case
        when j."keepUntil" is not null then j."keepUntil"
        else coalesce(j.start_after, now())
             + cast(coalesce((q.retention_minutes * 60)::text, '14 days') as interval)
      end,
      coalesce(j."retryLimit", q.retry_limit, 2),
      case
        when coalesce(j."retryBackoff", q.retry_backoff, false)
          then greatest(coalesce(j."retryDelay", q.retry_delay), 1)
        else coalesce(j."retryDelay", q.retry_delay, 0)
      end,
      coalesce(j."retryBackoff", q.retry_backoff, false),
      q.policy
    from (
      select *,
        now() + cast(coalesce("startAfter", '0') as interval) as start_after
      from json_to_recordset(${JSON.stringify([row])}::json) as x (
        id uuid,
        name text,
        priority integer,
        data jsonb,
        "startAfter" text,
        "retryLimit" integer,
        "retryDelay" integer,
        "retryBackoff" boolean,
        "singletonKey" text,
        "singletonSeconds" integer,
        "expireInSeconds" integer,
        "keepUntil" timestamp with time zone,
        "deadLetter" text
      )
    ) j
    join ${schema}.queue q on j.name = q.name
    on conflict do nothing
  `);

  if ((result.rowCount ?? 0) > 0) {
    return true;
  }

  // Zero randuri inseamna ori duplicat (corect), ori coada neinregistrata (bug).
  // Distingem, ca sa nu pierdem joburi in tacere.
  const queueCheck = await tx.execute<{ exists: boolean }>(sql`
    select exists(select 1 from ${schema}.queue where name = ${job.name}) as exists
  `);

  if (queueCheck.rows[0]?.exists !== true) {
    throw new Error(
      `Coada "${job.name}" nu exista in ${jobsSchema()}.queue. Porneste worker-ul o data ca sa o creeze, sau adauga jobul in ALL_JOBS.`,
    );
  }

  return false;
}
