import { recordPing, withServiceActor } from '@damina/db';
import { systemPing } from '@damina/jobs';
import { logger } from '@damina/shared/logger';
import type PgBoss from 'pg-boss';

/**
 * Coada de test din pasul 01. Scrie un rand in `jobs.ping_log`.
 *
 * Ruleaza prin `withServiceActor`, deci: rol `app_service`, `app.actor_id`
 * setat pe ID-ul tehnic si motivul marcat cu numele jobului. Orice scriere din
 * worker trebuie sa se vada in audit ca venind dintr-un job, nu de la un om.
 */
export function registerSystemPing(boss: PgBoss): Promise<string> {
  return boss.work(systemPing.name, async (jobs) => {
    for (const job of jobs) {
      const payload = systemPing.schema.parse(job.data ?? {});

      await withServiceActor(systemPing.name, async (tx) => {
        await recordPing(tx, {
          jobId: job.id,
          note: payload.note,
          processedBy: process.env['WORKER_ID'] ?? 'worker-local',
        });
      });

      logger.info({ use_case: systemPing.name, job_id: job.id }, 'ping procesat');
    }
  });
}
