import { Money } from '@damina/shared';
import { daysInMonth, type BusinessDate } from './indexation';

/**
 * Plafoane si Delta — cele doua citiri care nu au voie sa fie confundate.
 *
 * `ceilingUsage` masoara un plafon de COST: mult inseamna rau, bara se goleste,
 * depasirea e rosie.
 *
 * `deltaFill` masoara un plafon de VENIT: mult inseamna bine, bara se umple, iar
 * ce nu s-a umplut pana la finalul lunii e **venit pierdut definitiv** — nu se
 * reporteaza. De aceea nu exista o singura functie cu un `boolean` care sa
 * inverseze sensul: ar fi exact felul in care cele doua ajung amestecate intr-un
 * ecran, si de acolo intr-o decizie gresita.
 */

// ── Plafon de cost ───────────────────────────────────────────────────────────

/** Pragul de la care un plafon de cost devine „atentie”. */
export const CEILING_WARNING_PERCENT = 80;

export type CeilingState = 'ok' | 'warning' | 'exceeded';

export interface CeilingUsageInput {
  /** Plafonul. `null` inseamna „nesetat”, nu „nelimitat”. */
  readonly ceiling: Money | null;
  /** Angajat: comenzi lansate, pachete atribuite. Bani promisi, necheltuiti inca. */
  readonly committed: Money;
  /** Consumat: bonuri de consum, pontaje, situatii acceptate. Bani plecati. */
  readonly consumed: Money;
}

export interface CeilingUsage {
  readonly ceiling: Money | null;
  readonly committed: Money;
  readonly consumed: Money;
  /** Angajat + consumat. Cifra pe care se ia decizia „mai pot lansa o comanda?”. */
  readonly used: Money;
  /** Plafon − folosit. Negativ cand s-a depasit; nu se limiteaza la zero. */
  readonly remaining: Money;
  /** 0–∞. Peste 100 inseamna depasire, si cifra o spune. */
  readonly percent: number;
  readonly state: CeilingState;
  /** Nu se poate calcula procent fara plafon. Ecranul spune „plafon nesetat”. */
  readonly hasCeiling: boolean;
}

export function ceilingUsage(input: CeilingUsageInput): CeilingUsage {
  const used = input.committed.add(input.consumed);
  const ceiling = input.ceiling;

  if (ceiling === null) {
    return {
      ceiling: null,
      committed: input.committed,
      consumed: input.consumed,
      used,
      remaining: Money.ZERO,
      percent: 0,
      state: 'ok',
      hasCeiling: false,
    };
  }

  const remaining = ceiling.sub(used);

  // Plafon zero: orice consum e depasire, si 0/0 nu e 100%, e 0%.
  const percent = ceiling.isZero()
    ? used.isZero()
      ? 0
      : Number.POSITIVE_INFINITY
    : (used.toUnsafeNumber() / ceiling.toUnsafeNumber()) * 100;

  const state: CeilingState = remaining.isNegative()
    ? 'exceeded'
    : percent >= CEILING_WARNING_PERCENT
      ? 'warning'
      : 'ok';

  return {
    ceiling,
    committed: input.committed,
    consumed: input.consumed,
    used,
    remaining,
    percent,
    state,
    hasCeiling: true,
  };
}

// ── Delta: tinta de umplere ──────────────────────────────────────────────────

export type DeltaState = 'plin' | 'in_grafic' | 'in_urma' | 'nesetat';

export interface DeltaFillInput {
  /** Plafonul de VENIT al lunii, setat manual. `null` = nesetat. */
  readonly revenueCeiling: Money | null;
  /** Venitul deja alocat pe Delta in luna asta. Cat s-a umplut. */
  readonly allocatedRevenue: Money;
  /** Ziua fata de care se judeca ritmul, `yyyy-mm-dd`. */
  readonly asOf: BusinessDate;
}

export interface DeltaFill {
  readonly revenueCeiling: Money | null;
  readonly allocatedRevenue: Money;
  /** Lei NEUMPLUTI. Cifra care se pierde daca luna se termina asa. */
  readonly unfilled: Money;
  /** 0–100+. Cat de plina e Delta. */
  readonly fillPercent: number;
  /**
   * Cat ar fi trebuit sa fie plina la ziua asta, la umplere uniforma.
   *
   * Nu e o tinta contractuala, e o rigla: pe 10 ale lunii, 33%. Fara ea, „38%”
   * nu spune nimic — poate fi excelent pe 12 si dezastruos pe 28.
   */
  readonly expectedPercent: number;
  /** Zile ramase din luna, INCLUSIV ziua curenta: pe 31 mai e o zi de lucrat. */
  readonly daysLeft: number;
  readonly state: DeltaState;
}

export function deltaFill(input: DeltaFillInput): DeltaFill {
  const [yearText, monthText, dayText] = input.asOf.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError(`Data invalida: "${input.asOf}". Format asteptat: "2026-08-10".`);
  }

  const total = daysInMonth(year, month);
  const daysLeft = Math.max(0, total - day + 1);
  const expectedPercent = (day / total) * 100;

  const ceiling = input.revenueCeiling;
  if (ceiling === null || ceiling.isZero()) {
    return {
      revenueCeiling: ceiling,
      allocatedRevenue: input.allocatedRevenue,
      unfilled: Money.ZERO,
      fillPercent: 0,
      expectedPercent,
      daysLeft,
      state: 'nesetat',
    };
  }

  const fillPercent = (input.allocatedRevenue.toUnsafeNumber() / ceiling.toUnsafeNumber()) * 100;
  // Ce s-a alocat peste plafon nu e „umplere negativa”: plafonul e atins, atat.
  const unfilled = ceiling.sub(input.allocatedRevenue).max(Money.ZERO);

  const state: DeltaState =
    fillPercent >= 100 ? 'plin' : fillPercent >= expectedPercent ? 'in_grafic' : 'in_urma';

  return {
    revenueCeiling: ceiling,
    allocatedRevenue: input.allocatedRevenue,
    unfilled,
    fillPercent,
    expectedPercent,
    daysLeft,
    state,
  };
}
