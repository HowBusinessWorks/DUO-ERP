import type Decimal from 'decimal.js';
import { D, DecimalValue, type DecimalInput } from './decimal-base';

const SCALE = 2;

/**
 * Valoare monetara. Corespunde lui `numeric(14,2)` din Postgres.
 *
 * `float`/`number` sunt interzise pe valori monetare (PLAN_TEHNIC, decizia 11):
 * un ERP cu marje pe 4 ani nu are voie sa aiba erori de rotunjire.
 */
export class Money extends DecimalValue<Money> {
  static readonly ZERO = new Money(new D(0));

  protected override get scale(): number {
    return SCALE;
  }

  protected override create(value: Decimal): Money {
    return new Money(value);
  }

  private constructor(value: Decimal) {
    super(value.toDecimalPlaces(SCALE, D.ROUND_HALF_UP));
  }

  /** Construieste dintr-un literal. Numerele sunt acceptate doar ca literali de cod. */
  static of(value: DecimalInput): Money {
    const d = new D(value);
    if (!d.isFinite()) {
      throw new RangeError(`Valoare monetara invalida: ${String(value)}`);
    }
    return new Money(d);
  }

  /** Citire dintr-o coloana numeric(14,2). `null` devine zero. */
  static fromDb(value: string | null | undefined): Money {
    if (value === null || value === undefined || value === '') {
      return Money.ZERO;
    }
    return Money.of(value);
  }

  /** Suma unei liste. Lista goala da zero. */
  static sum(values: readonly Money[]): Money {
    return values.reduce<Money>((acc, v) => acc.add(v), Money.ZERO);
  }

  /**
   * Parseaza un numar scris de utilizator in format romanesc: "1.234,56" sau "1234,56".
   * Intoarce `null` daca sirul nu e un numar — apelantul decide ce inseamna asta.
   */
  static parseRo(input: string): Money | null {
    const cleaned = input.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) {
      return null;
    }
    return Money.of(cleaned);
  }

  /** Afisare pentru interfata: "1.234,56 lei". */
  format(locale = 'ro-RO', currency = 'RON'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: SCALE,
      maximumFractionDigits: SCALE,
    }).format(this.toUnsafeNumber());
  }
}
