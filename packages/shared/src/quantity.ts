import type Decimal from 'decimal.js';
import { D, DecimalValue, type DecimalInput } from './decimal-base';

const SCALE = 4;

/**
 * Cantitate. Corespunde lui `numeric(14,4)` din Postgres.
 * Patru zecimale pentru ca exista unitati de masura cu 3-4 zecimale (mp, kg, ore).
 */
export class Quantity extends DecimalValue<Quantity> {
  static readonly ZERO = new Quantity(new D(0));

  protected override get scale(): number {
    return SCALE;
  }

  protected override create(value: Decimal): Quantity {
    return new Quantity(value);
  }

  private constructor(value: Decimal) {
    super(value.toDecimalPlaces(SCALE, D.ROUND_HALF_UP));
  }

  static of(value: DecimalInput): Quantity {
    const d = new D(value);
    if (!d.isFinite()) {
      throw new RangeError(`Cantitate invalida: ${String(value)}`);
    }
    return new Quantity(d);
  }

  static fromDb(value: string | null | undefined): Quantity {
    if (value === null || value === undefined || value === '') {
      return Quantity.ZERO;
    }
    return Quantity.of(value);
  }

  static sum(values: readonly Quantity[]): Quantity {
    return values.reduce<Quantity>((acc, v) => acc.add(v), Quantity.ZERO);
  }

  /** Afisare fara zerouri inutile la coada: 2.5000 -> "2,5". */
  format(locale = 'ro-RO'): string {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: SCALE,
    }).format(this.toUnsafeNumber());
  }
}
