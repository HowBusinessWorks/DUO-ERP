import { serviceActor } from '@damina/db';
import { requestsExpireBacklog } from '@damina/jobs';
import { runBacklogExpiry } from '@damina/services';
import { logger } from '@damina/shared/logger';
import type PgBoss from 'pg-boss';

/**
 * Cronurile modulului de cereri (pasul 08, §3.6).
 *
 * Deocamdata unul singur: expirarea propunerilor din backlog. Ingestia de email
 * (`mail.ingest`) vine cu 08c si se inregistreaza tot aici.
 */
export async function registerRequestJobs(boss: PgBoss): Promise<void> {
  await boss.work(requestsExpireBacklog.name, async (jobs) => {
    for (const job of jobs) {
      // Payload-ul trece prin schema cozii, ca peste tot: cronul il trimite gol,
      // dar o rulare manuala poate tinti o zi anume.
      const { on } = requestsExpireBacklog.schema.parse(job.data ?? {});
      const expired = await runBacklogExpiry(serviceActor(requestsExpireBacklog.name), on);
      logger.info(
        { use_case: requestsExpireBacklog.name, job_id: job.id, propuneri_expirate: expired },
        'expirarea propunerilor din backlog terminata',
      );
    }
  });
}
