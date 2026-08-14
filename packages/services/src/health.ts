import { readHeartbeat, serviceActor, withActor } from '@damina/db';
import { checkStorageHealth } from '@damina/storage';

/**
 * Verificarea de sanatate din PLAN_TEHNIC §3.7: baza de date raspunde, R2
 * raspunde, worker-ul a batut recent din inima.
 *
 * Nu e un endpoint decorativ: daca worker-ul e mort, joburile se aduna tacut in
 * coada si nimeni nu observa pana cand cineva asteapta un raport lunar.
 */
const WORKER_STALE_AFTER_SECONDS = 90;

export type ComponentStatus = 'ok' | 'stale' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  db: ComponentStatus;
  r2: ComponentStatus;
  worker: ComponentStatus;
  details: {
    workerId?: string;
    workerLastBeatSeconds?: number;
    error?: string;
  };
}

export async function checkHealth(): Promise<HealthReport> {
  const details: HealthReport['details'] = {};

  let db: ComponentStatus = 'down';
  let worker: ComponentStatus = 'down';

  try {
    const heartbeat = await withActor(serviceActor('health'), readHeartbeat);
    db = 'ok';

    if (heartbeat !== null) {
      details.workerId = heartbeat.workerId;
      details.workerLastBeatSeconds = heartbeat.ageSeconds;
      worker = heartbeat.ageSeconds <= WORKER_STALE_AFTER_SECONDS ? 'ok' : 'stale';
    }
  } catch (error) {
    details.error = error instanceof Error ? error.message : String(error);
  }

  const r2: ComponentStatus = (await checkStorageHealth()) ? 'ok' : 'down';

  const status = db === 'ok' && r2 === 'ok' && worker === 'ok' ? 'ok' : 'degraded';

  return { status, db, r2, worker, details };
}
