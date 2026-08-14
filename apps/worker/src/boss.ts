import { loadEnvFiles } from '@damina/db';
import { ALL_JOBS } from '@damina/jobs';
import { logger } from '@damina/shared/logger';
import PgBoss from 'pg-boss';

/**
 * pg-boss pe acelasi Postgres, in schema `jobs`, pe conexiunea de *session
 * pooling* — are nevoie de LISTEN/NOTIFY, care nu exista in transaction pooling.
 */
export function createBoss(): PgBoss {
  loadEnvFiles();

  const connectionString = process.env['DATABASE_URL_SESSION'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL_SESSION lipseste. Worker-ul nu poate porni fara ea.');
  }

  return new PgBoss({
    connectionString,
    schema: process.env['PGBOSS_SCHEMA'] ?? 'jobs',
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 5,
    // Curatenia si arhivarea sunt treaba worker-ului, nu a aplicatiei web.
    archiveCompletedAfterSeconds: 60 * 60 * 12,
    deleteAfterDays: 14,
  });
}

/**
 * Inregistreaza toate cozile cunoscute. Fara asta, un enqueue din aplicatia web
 * nu are unde sa aterizeze — insertul face JOIN pe `jobs.queue`.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const job of ALL_JOBS) {
    await boss.createQueue(job.name, {
      name: job.name,
      policy: 'standard',
      retryLimit: job.retryLimit,
      retryDelay: job.retryDelaySeconds,
      retryBackoff: job.retryBackoff,
      expireInSeconds: job.expireInSeconds,
    });
    logger.debug({ queue: job.name }, 'coada inregistrata');
  }
}
