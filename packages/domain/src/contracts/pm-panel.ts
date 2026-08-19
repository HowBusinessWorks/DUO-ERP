import { Money } from '@damina/shared';
import { deltaFill, type DeltaFill } from './ceilings';
import type { BusinessDate } from './indexation';

/**
 * Cele doua citiri ale panoului PM care NU tin de baza de date.
 *
 * `aggregateDeltaFill` — o singura Delta din mai multe. PM-ul are, in mod
 * normal, mai multe contracte, si intrebarea lui de dimineata nu e „cum sta
 * contractul 7", ci „cati lei imi scapa luna asta daca nu fac nimic". Suma se
 * face pe LEI, nu pe procente: media a doua procente ar cantari la fel un
 * contract de 200.000 si unul de 3.000, si ar minti exact in cazul care conteaza.
 *
 * `consumptionRisk` — divergenta dintre bani si fizic. Cele doua procente vin
 * din surse diferite prin constructie (registrul de cost si etapele), tocmai ca
 * sa poata diverge; aici se citeste divergenta, nu se recalculeaza niciunul.
 */

/** Componenta Delta a unui contract, redusa la ce trebuie insumat. */
export interface DeltaFillPart {
  readonly revenueCeiling: Money | null;
  readonly allocatedRevenue: Money;
}

export function aggregateDeltaFill(
  parts: readonly DeltaFillPart[],
  asOf: BusinessDate,
  monthEnded = false,
): DeltaFill {
  // Componentele fara plafon setat NU se numara ca zero: ar dilua procentul cu o
  // cifra pe care nimeni n-a scris-o. Ele se raporteaza separat, ca „nesetate".
  const withCeiling = parts.filter((part) => part.revenueCeiling !== null);

  const ceiling = withCeiling.reduce(
    (acc, part) => acc.add(part.revenueCeiling ?? Money.ZERO),
    Money.ZERO,
  );
  const allocated = withCeiling.reduce((acc, part) => acc.add(part.allocatedRevenue), Money.ZERO);

  return deltaFill({
    revenueCeiling: withCeiling.length === 0 ? null : ceiling,
    allocatedRevenue: allocated,
    asOf,
    monthEnded,
  });
}

export type RiskSeverity = 'ok' | 'atentie' | 'critic';

export interface ConsumptionRisk {
  /** Consumat − executat, in puncte procentuale. Negativ inseamna avans. */
  readonly gap: number;
  readonly severity: RiskSeverity;
  /** Peste plafonul asta lucrarea intra in lista din panou. */
  readonly atRisk: boolean;
}

/** De la cate puncte procentuale de decalaj lucrarea devine „critic". */
export const RISK_CRITICAL_GAP = 15;

/**
 * Banii au plecat mai repede decat munca. Atat spune, si nimic mai mult:
 * lucrarea intra in lista ca sa se uite cineva la ea, nu ca sa fie condamnata.
 */
export function consumptionRisk(consumedPercent: number, progressPercent: number): ConsumptionRisk {
  const gap = consumedPercent - progressPercent;

  if (gap <= 0) {
    return { gap, severity: 'ok', atRisk: false };
  }
  return {
    gap,
    severity: gap >= RISK_CRITICAL_GAP ? 'critic' : 'atentie',
    atRisk: true,
  };
}
