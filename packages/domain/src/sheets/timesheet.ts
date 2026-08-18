import { Quantity, type Money } from '@damina/shared';

/**
 * Pontajul: alegerea tarifului si totalurile zilei (§3.3).
 *
 * Regula care trebuie sa fie pura si testabila fara baza: **se aplica tariful
 * valabil la data pontajului, nu cel curent**. Un pontaj din martie, validat in
 * august, se evalueaza cu tariful din martie — si dupa validare `rate_card_id`
 * ramane inghetat pe linie, deci o schimbare ulterioara de tarif nu mai atinge
 * costul (verificarile #14 si #15).
 */

export interface RateCardLike {
  readonly id: string;
  readonly qualificationId: string;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly hourlyCost: Money;
}

/**
 * Tariful in vigoare la o data. Intervalele sunt `[validFrom, validTo)` — la fel
 * ca `rate_cards_valid_range` din 0004, care cere `valid_to > valid_from`.
 *
 * Intoarce `null` cand nu exista tarif: apelantul decide ce inseamna, si in
 * `validateTimesheet` inseamna „nu se poate valida", nu „cost zero". Un cost
 * zero ar trece tacut prin toate rapoartele.
 */
export function rateCardAt(
  cards: readonly RateCardLike[],
  qualificationId: string,
  onDate: string,
): RateCardLike | null {
  const matching = cards.filter(
    (c) =>
      c.qualificationId === qualificationId &&
      c.validFrom <= onDate &&
      (c.validTo === null || c.validTo > onDate),
  );
  // Sortarea e o plasa, nu o alegere: constrangerea `exclude` din 0004 interzice
  // intervale suprapuse pe aceeasi calificare, deci lista are cel mult un rand.
  // Daca ajunge sa aiba doua, cel mai recent inceput e cel corect.
  matching.sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return matching[0] ?? null;
}

export interface TimesheetLineLike {
  readonly workUnitId: string;
  readonly hours: Quantity;
}

export interface TimesheetTotals {
  readonly total: Quantity;
  /** Ore pe fiecare unitate de lucru — regula 5: ziua se imparte. */
  readonly byWorkUnit: ReadonlyMap<string, Quantity>;
  readonly withinDay: boolean;
}

export const MAX_HOURS_PER_DAY = 24;

export function timesheetTotals(lines: readonly TimesheetLineLike[]): TimesheetTotals {
  const byWorkUnit = new Map<string, Quantity>();
  for (const line of lines) {
    const current = byWorkUnit.get(line.workUnitId) ?? Quantity.ZERO;
    byWorkUnit.set(line.workUnitId, current.add(line.hours));
  }
  const total = Quantity.sum(lines.map((l) => l.hours));
  return {
    total,
    byWorkUnit,
    withinDay: total.isPositive() && total.lte(Quantity.of(MAX_HOURS_PER_DAY)),
  };
}
