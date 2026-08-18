import { Money, Quantity } from '@damina/shared';

/**
 * Consum asteptat vs consum real (§3.2) — **cel mai bun mecanism anti-furt din
 * sistem**, si traieste pe fisa, nu intr-un raport pe care nu-l citeste nimeni.
 *
 * Ce se compara: costul estimat al operatiunii din catalog (manopera din norma
 * de timp × tariful zilei, plus materialele tipice) cu costul real rezultat din
 * materialele consumate efectiv si orele declarate.
 *
 * Ce NU face functia asta: nu decide daca cineva a furat. Marcheaza abaterea, o
 * arata pe fisa si alerteaza PM-ul. Cauza poate fi la fel de bine o teava
 * spartsa in plus sau o norma de timp gresita in catalog — si de aceea sunt
 * marcate si abaterile in MINUS, nu doar cele in plus: o operatiune facuta
 * sistematic sub estimare spune ca estimarea e gresita, si atunci pragul de
 * rutare de 2.000 de lei se calculeaza pe o cifra falsa.
 */

/** Peste cat se marcheaza abaterea. Fractie: 0.15 = 15%. */
export const DEFAULT_VARIANCE_THRESHOLD = 0.15;

export interface MaterialConsumption {
  readonly quantity: Quantity;
  readonly unitCost: Money;
}

export interface LaborConsumption {
  readonly hours: Quantity;
  readonly hourlyCost: Money;
}

export interface VarianceInput {
  /** Din catalog, inmultit cu numarul de executii. Null = fara operatiune. */
  readonly expected: Money | null;
  readonly materials: readonly MaterialConsumption[];
  readonly labor: readonly LaborConsumption[];
  readonly threshold?: number;
}

export interface VarianceResult {
  readonly materialCost: Money;
  readonly laborCost: Money;
  readonly realCost: Money;
  readonly expectedCost: Money | null;
  /**
   * Fractie cu semn: 0.18 = +18% peste estimat. `null` cand nu exista estimare
   * sau cand estimarea e zero — impartirea la zero n-are inteles, si „infinit la
   * suta" nu e o informatie pe care sa se uite cineva.
   */
  readonly variancePct: string | null;
  readonly flagged: boolean;
}

/** Costul real al unei fise, si abaterea fata de catalog. */
export function computeVariance(input: VarianceInput): VarianceResult {
  const threshold = input.threshold ?? DEFAULT_VARIANCE_THRESHOLD;

  const materialCost = Money.sum(
    input.materials.map((m) => m.unitCost.mul(m.quantity.toDbString())),
  );
  const laborCost = Money.sum(input.labor.map((l) => l.hourlyCost.mul(l.hours.toDbString())));
  const realCost = materialCost.add(laborCost);

  const expectedCost = input.expected;
  if (expectedCost === null || expectedCost.isZero()) {
    return {
      materialCost,
      laborCost,
      realCost,
      expectedCost,
      variancePct: null,
      flagged: false,
    };
  }

  /*
   * Procentul se calculeaza in `Quantity`, nu in `Money` si cu atat mai putin in
   * float: coloana e `numeric(6,4)`, iar `Money` ar rotunji fractia la doua
   * zecimale — adica +18,34% si +18,49% ar deveni aceeasi cifra, exact acolo
   * unde diferenta e intre „sub prag" si „peste prag".
   */
  const variance = Quantity.of(realCost.sub(expectedCost).toDbString()).div(
    expectedCost.toDbString(),
  );
  const magnitude = variance.abs();

  return {
    materialCost,
    laborCost,
    realCost,
    expectedCost,
    variancePct: variance.toDbString(),
    flagged: magnitude.gt(Quantity.of(threshold)),
  };
}

/** Eticheta de pe fisa: „+18% față de estimat". */
export function describeVariance(result: VarianceResult): string | null {
  if (result.variancePct === null) {
    return null;
  }
  const pct = Number(result.variancePct) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% față de estimat`;
}
