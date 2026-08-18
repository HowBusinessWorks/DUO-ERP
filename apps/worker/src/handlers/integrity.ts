import { inventoryVerifyStock, rollupVerify } from '@damina/jobs';
import { verifyRollupsJob, verifyStockJob } from '@damina/services';
import { logger } from '@damina/shared/logger';
import type PgBoss from 'pg-boss';

/**
 * Controalele nocturne de integritate.
 *
 * Amandoua verifica acelasi fel de lucru: un **rollup** intretinut de trigger,
 * care poate ramane in urma fara sa rupa nimic. `component_period_rollup` din
 * pasul 06 si `stock_balances` din pasul 09. Nimic nu cade, doar cifrele nu se
 * mai potrivesc — de asta jobul alerteaza, cu diferenta in titlu.
 *
 * `rollup.verify` era **programat din pasul 06 dar neconsumat**: coada exista,
 * cronul o alimenta, si nimeni nu lua joburile din ea. Se inregistreaza aici,
 * langa fratele ei, pentru ca cele doua se citesc impreuna.
 */
export async function registerIntegrityJobs(boss: PgBoss): Promise<void> {
  await boss.work(rollupVerify.name, async (jobs) => {
    for (const job of jobs) {
      const payload = rollupVerify.schema.parse(job.data ?? {});
      const alerted = await verifyRollupsJob(payload.periodId);
      logger.info(
        { use_case: rollupVerify.name, job_id: job.id, componente_divergente: alerted },
        'verificarea rollup-urilor terminata',
      );
    }
  });

  await boss.work(inventoryVerifyStock.name, async (jobs) => {
    for (const job of jobs) {
      inventoryVerifyStock.schema.parse(job.data ?? {});
      const alerted = await verifyStockJob(inventoryVerifyStock.name);
      logger.info(
        { use_case: inventoryVerifyStock.name, job_id: job.id, solduri_divergente: alerted },
        'verificarea soldurilor de stoc terminata',
      );
    }
  });
}
