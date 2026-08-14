import { beatHeartbeat, closeConnections, grantQueueAccess, withServiceActor } from '@damina/db';
import { logger } from '@damina/shared/logger';
import { createBoss, ensureQueues } from './boss';
import { registerSystemPing } from './handlers/system-ping';

/**
 * Worker-ul: proces persistent, container separat, consumer pg-boss.
 *
 * In pasul 01 are o singura coada (`system.ping`). Cozile reale — thumbnails si
 * EXIF, rapoarte lunare, ingest email, export Saga, notificari — se adauga
 * fiecare in pasul ei.
 */
const WORKER_ID = process.env['WORKER_ID'] ?? `worker-${process.pid}`;
const HEARTBEAT_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  const boss = createBoss();

  boss.on('error', (error) => {
    logger.error({ err: error }, 'eroare pg-boss');
  });

  await boss.start();
  logger.info({ worker_id: WORKER_ID }, 'pg-boss pornit');

  // pg-boss isi creeaza tabelele la primul start; abia acum putem da drepturile
  // celorlalte roluri, ca enqueue-ul din aplicatia web sa functioneze.
  await withServiceActor('worker.bootstrap', grantQueueAccess);

  await ensureQueues(boss);
  await registerSystemPing(boss);
  logger.info({ worker_id: WORKER_ID }, 'cozi inregistrate, worker activ');

  const beat = async (): Promise<void> => {
    try {
      await withServiceActor('worker.heartbeat', (tx) =>
        beatHeartbeat(tx, { workerId: WORKER_ID, version: process.env['APP_VERSION'] ?? 'dev' }),
      );
    } catch (error) {
      logger.warn({ err: error }, 'heartbeat esuat');
    }
  };

  await beat();
  const heartbeat = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'opresc worker-ul');
    clearInterval(heartbeat);
    void (async () => {
      await boss.stop({ graceful: true, timeout: 30_000 }).catch(() => undefined);
      await closeConnections().catch(() => undefined);
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'worker-ul nu a putut porni');
  process.exitCode = 1;
});
