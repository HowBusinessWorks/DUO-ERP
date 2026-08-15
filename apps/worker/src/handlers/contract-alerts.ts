import { contractExpiryScan, deltaFillScan, SCHEDULED_JOBS } from '@damina/jobs';
import { scanContractExpiry, scanDeltaFill } from '@damina/services';
import { logger } from '@damina/shared/logger';
import type PgBoss from 'pg-boss';

/**
 * Cele doua scanuri de alerte ale pasului 04 (§3.7).
 *
 * Sunt in worker, nu in aplicatia web, din acelasi motiv pentru care toate
 * joburile sunt acolo: o cerere HTTP nu are voie sa depinda de cat dureaza un
 * scan peste toate contractele, iar cronul nu are cine sa-l apese.
 */
export async function registerContractAlerts(boss: PgBoss): Promise<void> {
  await boss.work(contractExpiryScan.name, async (jobs) => {
    for (const job of jobs) {
      const raised = await scanContractExpiry(contractExpiryScan.name);
      logger.info(
        { use_case: contractExpiryScan.name, job_id: job.id, contracts: raised },
        'scan de expirare terminat',
      );
    }
  });

  await boss.work(deltaFillScan.name, async (jobs) => {
    for (const job of jobs) {
      const behind = await scanDeltaFill(new Date(), deltaFillScan.name);
      logger.info(
        { use_case: deltaFillScan.name, job_id: job.id, delta_in_urma: behind },
        'scan de umplere Delta terminat',
      );
    }
  });
}

/**
 * Programeaza cozile pe ceas.
 *
 * `schedule()` din pg-boss e idempotent pe numele cozii: rularea la fiecare
 * pornire de worker suprascrie definitia, nu adauga a doua. Deci doua replici de
 * worker nu produc doua declansari — planificatorul e in baza, nu in proces.
 *
 * Fusul e cel al aplicatiei, nu UTC: „pe 10 la 09:00” trebuie sa insemne ora
 * Bucurestiului si vara, si iarna.
 */
export async function scheduleContractAlerts(boss: PgBoss): Promise<void> {
  const tz = process.env['APP_TIMEZONE'] ?? 'Europe/Bucharest';

  for (const scheduled of SCHEDULED_JOBS) {
    await boss.schedule(scheduled.name, scheduled.cron, {}, { tz });
    logger.info({ queue: scheduled.name, cron: scheduled.cron, tz }, scheduled.why);
  }
}
