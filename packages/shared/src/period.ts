/** Cheia canonica a unei perioade: "2026-08". */
export type PeriodKey = `${number}-${string}`;

const KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Luna calendaristica de business. Toata contabilitatea interna (registrul de
 * cost, inchiderea, rollup-urile) se agrega pe perioade, dupa `data_efect`.
 *
 * Imutabil: orice operatie intoarce o instanta noua.
 */
export class Period {
  readonly year: number;
  readonly month: number;

  private constructor(year: number, month: number) {
    this.year = year;
    this.month = month;
    Object.freeze(this);
  }

  static of(year: number, month: number): Period {
    if (!Number.isInteger(year) || year < 1900 || year > 2999) {
      throw new RangeError(`An invalid: ${year}`);
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new RangeError(`Luna invalida: ${month}`);
    }
    return new Period(year, month);
  }

  /** Perioada in care cade o data. Foloseste componentele locale ale datei. */
  static fromDate(date: Date): Period {
    return Period.of(date.getFullYear(), date.getMonth() + 1);
  }

  /** Perioada dintr-o cheie "2026-08". Arunca daca sirul nu are formatul corect. */
  static fromKey(key: string): Period {
    const match = KEY_PATTERN.exec(key);
    if (match === null) {
      throw new RangeError(`Cheie de perioada invalida: "${key}". Format asteptat: "2026-08".`);
    }
    return Period.of(Number(match[1]), Number(match[2]));
  }

  next(): Period {
    return this.month === 12 ? Period.of(this.year + 1, 1) : Period.of(this.year, this.month + 1);
  }

  prev(): Period {
    return this.month === 1 ? Period.of(this.year - 1, 12) : Period.of(this.year, this.month - 1);
  }

  /** Deplasare cu n luni, in orice directie. */
  shift(months: number): Period {
    const total = this.year * 12 + (this.month - 1) + months;
    return Period.of(Math.floor(total / 12), (total % 12) + 1);
  }

  /** Numarul de luni de la `other` pana la `this`. Negativ daca `this` e mai vechi. */
  diff(other: Period): number {
    return this.year * 12 + this.month - (other.year * 12 + other.month);
  }

  compare(other: Period): -1 | 0 | 1 {
    const d = this.diff(other);
    return d === 0 ? 0 : d < 0 ? -1 : 1;
  }

  equals(other: Period): boolean {
    return this.year === other.year && this.month === other.month;
  }

  /** Prima zi a lunii, ca `date` de business (fara ora). */
  firstDay(): string {
    return `${this.toKey()}-01`;
  }

  /** Ultima zi a lunii, ca `date` de business (fara ora). */
  lastDay(): string {
    const day = new Date(Date.UTC(this.year, this.month, 0)).getUTCDate();
    return `${this.toKey()}-${String(day).padStart(2, '0')}`;
  }

  toKey(): PeriodKey {
    return `${this.year}-${String(this.month).padStart(2, '0')}` as PeriodKey;
  }

  toString(): string {
    return this.toKey();
  }

  toJSON(): string {
    return this.toKey();
  }
}
