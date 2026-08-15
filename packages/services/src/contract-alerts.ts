import { serviceActor } from '@damina/db';
import { Money, Period } from '@damina/shared';
import { listExpiringContracts, listUnderfilledDelta } from './contracts';
import { raiseAlert, resolveAlert } from './notifications';

/**
 * Cele doua alerte ale pasului 04 (§3.7).
 *
 * Amandoua se sprijina pe indexul unic partial din 0008 — o singura alerta
 * DESCHISA per (scope, kind). De aceea `raiseAlert` se poate chema la fiecare
 * rulare fara sa produca zgomot: a doua oara nu se intampla nimic. Verificarea
 * #17 („o singura data, nu de 40 de ori”) e garantata de baza, nu de o
 * verificare in cod care s-ar putea uita.
 */

const EXPIRY_KIND = 'contract_expira';
const DELTA_KIND = 'delta_sub_ritm';

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

/**
 * Scanul zilnic de expirare. Cron: 06:00.
 *
 * Ridica alerta pe contractele active care intra in fereastra lor proprie de
 * avertizare, si o INCHIDE pe cele care au iesit din ea — un contract prelungit
 * nu trebuie sa ramana rosu pana isi aminteste cineva sa apese pe X.
 */
export async function scanContractExpiry(jobName = 'contracts.expiryScan'): Promise<number> {
  const expiring = await listExpiringContracts(serviceActor(jobName));

  for (const contract of expiring) {
    await raiseAlert(jobName, {
      companyId: contract.companyId,
      scopeType: 'contract',
      scopeId: contract.id,
      kind: EXPIRY_KIND,
      severity: 'warning',
      title: `Contractul ${contract.code} (${contract.clientName}) expiră pe ${dateFormat.format(new Date(contract.endsOn))}`,
      href: `/contracte/${contract.id}`,
      payload: { endsOn: contract.endsOn, alertMonths: contract.expiryAlertMonths },
    });
  }

  return expiring.length;
}

/** Inchide alerta de expirare a unui contract prelungit sau incheiat. */
export async function clearExpiryAlert(
  contractId: string,
  jobName = 'contracts.expiryScan',
): Promise<void> {
  await resolveAlert(jobName, 'contract', contractId, EXPIRY_KIND);
}

/**
 * Scanul de umplere a Deltei. Cron: **pe 10 si pe 20, la 09:00** — nu la
 * inchidere.
 *
 * Momentul e tot ce conteaza aici. La inchidere raspunsul nu mai foloseste la
 * nimic: venitul neumplut din august e pierdut definitiv pe 1 septembrie, si nu
 * se reporteaza. Pe 10 mai sunt trei saptamani in care backlogul poate fi
 * transformat in lucrari care umplu Delta.
 */
export async function scanDeltaFill(
  asOf: Date = new Date(),
  jobName = 'contracts.deltaFillScan',
): Promise<number> {
  const period = Period.fromDate(asOf);
  const asOfDate = `${period.toKey()}-${String(asOf.getDate()).padStart(2, '0')}`;

  const behind = await listUnderfilledDelta(
    serviceActor(jobName),
    period.year,
    period.month,
    asOfDate,
  );

  for (const row of behind) {
    const unfilled = row.fill.unfilled;
    await raiseAlert(jobName, {
      companyId: row.companyId,
      scopeType: 'contract',
      scopeId: row.contractId,
      kind: DELTA_KIND,
      severity: row.fill.fillPercent < 25 ? 'critical' : 'warning',
      // Cifra din titlu e cea care se pierde, nu procentul: „12.400 lei” misca
      // pe cineva, „38%” nu.
      title: `Delta contractului ${row.contractCode}: ${unfilled.format()} neumpluți, ${String(row.fill.daysLeft)} zile rămase`,
      href: `/contracte/${row.contractId}`,
      payload: {
        fillPercent: Math.round(row.fill.fillPercent),
        expectedPercent: Math.round(row.fill.expectedPercent),
        unfilled: unfilled.toDbString(),
        daysLeft: row.fill.daysLeft,
      },
    });
  }

  return behind.length;
}

/** Delta umpluta la loc (sau luna schimbata): alerta se inchide singura. */
export async function clearDeltaAlert(
  contractId: string,
  jobName = 'contracts.deltaFillScan',
): Promise<void> {
  await resolveAlert(jobName, 'contract', contractId, DELTA_KIND);
}

export const CONTRACT_ALERT_KINDS = {
  expiry: EXPIRY_KIND,
  deltaFill: DELTA_KIND,
} as const;

/** Suma neumpluta pe toate Deltele in urma — pentru Panou. */
export function totalUnfilled(rows: readonly { fill: { unfilled: Money } }[]): Money {
  return Money.sum(rows.map((row) => row.fill.unfilled));
}
