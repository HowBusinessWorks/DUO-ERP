import Decimal from 'decimal.js';

/**
 * Constructor Decimal izolat, ca sa nu atingem configuratia globala a bibliotecii.
 * ROUND_HALF_UP e rotunjirea comerciala: 0.005 -> 0.01.
 */
export const D = Decimal.clone({
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});

export type DecimalInput = string | number | Decimal;

/**
 * Baza comuna pentru Money (2 zecimale) si Quantity (4 zecimale).
 *
 * Regula: valoarea interna e MEREU deja rotunjita la scara tipului. Nu exista
 * stari intermediare cu mai multe zecimale — asa nu se poate acumula eroare
 * invizibila peste o serie de operatii.
 */
export abstract class DecimalValue<T extends DecimalValue<T>> {
  protected constructor(protected readonly inner: Decimal) {}

  /** Scara tipului: cate zecimale are valoarea. */
  protected abstract get scale(): number;

  /** Fabrica tipului concret — permite operatiilor sa intoarca tipul corect. */
  protected abstract create(value: Decimal): T;

  // ── operatii ────────────────────────────────────────────────────────────

  add(other: T): T {
    return this.create(this.inner.plus(other.inner));
  }

  sub(other: T): T {
    return this.create(this.inner.minus(other.inner));
  }

  /** Inmultire cu un scalar (cantitate, procent, coeficient) — nu cu alt Money. */
  mul(factor: DecimalInput): T {
    return this.create(this.inner.times(new D(factor)));
  }

  /** Impartire la un scalar. Arunca la impartire cu zero. */
  div(divisor: DecimalInput): T {
    const d = new D(divisor);
    if (d.isZero()) {
      throw new RangeError('Impartire la zero.');
    }
    return this.create(this.inner.dividedBy(d));
  }

  negate(): T {
    return this.create(this.inner.negated());
  }

  abs(): T {
    return this.create(this.inner.abs());
  }

  min(other: T): T {
    return this.lt(other) ? this.self() : other;
  }

  max(other: T): T {
    return this.gt(other) ? this.self() : other;
  }

  // ── comparatii ──────────────────────────────────────────────────────────

  compare(other: T): -1 | 0 | 1 {
    return this.inner.comparedTo(other.inner) as -1 | 0 | 1;
  }

  equals(other: T): boolean {
    return this.inner.equals(other.inner);
  }

  lt(other: T): boolean {
    return this.inner.lessThan(other.inner);
  }

  lte(other: T): boolean {
    return this.inner.lessThanOrEqualTo(other.inner);
  }

  gt(other: T): boolean {
    return this.inner.greaterThan(other.inner);
  }

  gte(other: T): boolean {
    return this.inner.greaterThanOrEqualTo(other.inner);
  }

  isZero(): boolean {
    return this.inner.isZero();
  }

  isNegative(): boolean {
    return this.inner.isNegative() && !this.inner.isZero();
  }

  isPositive(): boolean {
    return this.inner.isPositive() && !this.inner.isZero();
  }

  /**
   * Imparte valoarea in bucati proportionale cu `ratios`, FARA pierdere.
   * Suma bucatilor e mereu exact valoarea initiala — restul de subunitati se
   * distribuie cate una, in ordine, catre primele bucati.
   *
   *   Money.of(100).allocate([1, 1, 1]) -> [33.34, 33.33, 33.33]
   */
  allocate(ratios: readonly DecimalInput[]): T[] {
    if (ratios.length === 0) {
      throw new RangeError('allocate() are nevoie de cel putin un raport.');
    }

    const weights = ratios.map((r) => new D(r));
    if (weights.some((w) => w.isNegative())) {
      throw new RangeError('allocate() nu accepta rapoarte negative.');
    }

    const totalWeight = weights.reduce((acc, w) => acc.plus(w), new D(0));
    if (totalWeight.isZero()) {
      throw new RangeError('allocate() are nevoie de cel putin un raport nenul.');
    }

    // Lucram in subunitati intregi (bani / a zecea-mia de unitate), ca sa nu
    // existe fractiuni nereprezentabile.
    const unit = new D(10).pow(this.scale);
    const totalMinor = this.inner.times(unit).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

    const shares = weights.map((w) =>
      totalMinor.times(w).dividedBy(totalWeight).toDecimalPlaces(0, Decimal.ROUND_DOWN),
    );

    let distributed = shares.reduce((acc, s) => acc.plus(s), new D(0));
    let remainder = totalMinor.minus(distributed);

    // Restul poate fi negativ daca valoarea e negativa: distribuim in directia lui.
    const step = remainder.isNegative() ? new D(-1) : new D(1);
    let i = 0;
    while (!remainder.isZero()) {
      const current = shares[i % shares.length];
      /* c8 ignore next */
      if (current === undefined) break;
      shares[i % shares.length] = current.plus(step);
      remainder = remainder.minus(step);
      i += 1;
    }

    distributed = shares.reduce((acc, s) => acc.plus(s), new D(0));
    /* c8 ignore next 3 */
    if (!distributed.equals(totalMinor)) {
      throw new Error('allocate() a pierdut valoare — bug in algoritm.');
    }

    return shares.map((s) => this.create(s.dividedBy(unit)));
  }

  // ── serializare ─────────────────────────────────────────────────────────

  /** Forma pentru coloanele numeric(14,s) din Postgres. Mereu cu toate zecimalele. */
  toDbString(): string {
    return this.inner.toFixed(this.scale);
  }

  toString(): string {
    return this.toDbString();
  }

  toJSON(): string {
    return this.toDbString();
  }

  /**
   * Iesire spre `number`. De folosit DOAR pentru grafice si sortari, niciodata
   * pentru a stoca sau a calcula mai departe.
   */
  toUnsafeNumber(): number {
    return this.inner.toNumber();
  }

  protected get decimal(): Decimal {
    return this.inner;
  }

  private self(): T {
    return this as unknown as T;
  }
}
