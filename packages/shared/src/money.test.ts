import { describe, expect, it } from 'vitest';
import { Money } from './money';

describe('Money — aritmetica exacta', () => {
  // Verificarea #7 din Pasul 01.
  it('0.1 + 0.2 da exact 0.30', () => {
    const result = Money.of('0.10').add(Money.of('0.20'));
    expect(result.toDbString()).toBe('0.30');
    expect(result.equals(Money.of('0.30'))).toBe(true);
  });

  it('nu acumuleaza eroare peste o mie de adunari', () => {
    let total = Money.ZERO;
    for (let i = 0; i < 1000; i += 1) {
      total = total.add(Money.of('0.01'));
    }
    expect(total.toDbString()).toBe('10.00');
  });

  it('rotunjeste comercial la 2 zecimale', () => {
    expect(Money.of('0.005').toDbString()).toBe('0.01');
    expect(Money.of('0.004').toDbString()).toBe('0.00');
    expect(Money.of('1.2349').toDbString()).toBe('1.23');
  });

  it('inmulteste si imparte fara drift', () => {
    expect(Money.of('19.99').mul(3).toDbString()).toBe('59.97');
    expect(Money.of('100').div(3).toDbString()).toBe('33.33');
  });

  it('refuza impartirea la zero', () => {
    expect(() => Money.of('10').div(0)).toThrow(RangeError);
  });

  it('respinge valorile neinterpretabile', () => {
    expect(() => Money.of(Number.NaN)).toThrow(RangeError);
    expect(() => Money.of(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('Money.allocate — impartire fara pierdere', () => {
  // Verificarea #8 din Pasul 01.
  it('100 in 3 parti egale da [33.34, 33.33, 33.33] si suma exact 100', () => {
    const parts = Money.of('100.00').allocate([1, 1, 1]);
    expect(parts.map((p) => p.toDbString())).toEqual(['33.34', '33.33', '33.33']);
    expect(Money.sum(parts).toDbString()).toBe('100.00');
  });

  it('respecta rapoarte inegale', () => {
    const parts = Money.of('100.00').allocate([70, 30]);
    expect(parts.map((p) => p.toDbString())).toEqual(['70.00', '30.00']);
  });

  it('distribuie restul catre primele bucati', () => {
    const parts = Money.of('0.05').allocate([1, 1, 1, 1, 1, 1]);
    expect(parts.map((p) => p.toDbString())).toEqual([
      '0.01',
      '0.01',
      '0.01',
      '0.01',
      '0.01',
      '0.00',
    ]);
    expect(Money.sum(parts).toDbString()).toBe('0.05');
  });

  it('pastreaza suma si pentru valori negative', () => {
    const parts = Money.of('-100.00').allocate([1, 1, 1]);
    expect(Money.sum(parts).toDbString()).toBe('-100.00');
  });

  it('refuza rapoarte negative sau toate nule', () => {
    expect(() => Money.of('10').allocate([1, -1])).toThrow(RangeError);
    expect(() => Money.of('10').allocate([0, 0])).toThrow(RangeError);
    expect(() => Money.of('10').allocate([])).toThrow(RangeError);
  });
});

describe('Money — interfata cu baza de date si cu utilizatorul', () => {
  it('toDbString scrie mereu 2 zecimale', () => {
    expect(Money.of('5').toDbString()).toBe('5.00');
    expect(Money.of('-0.1').toDbString()).toBe('-0.10');
  });

  it('fromDb accepta null si sir gol', () => {
    expect(Money.fromDb(null).isZero()).toBe(true);
    expect(Money.fromDb('').isZero()).toBe(true);
    expect(Money.fromDb('1234.56').toDbString()).toBe('1234.56');
  });

  it('parseRo intelege formatul romanesc', () => {
    expect(Money.parseRo('1.234,56')?.toDbString()).toBe('1234.56');
    expect(Money.parseRo('1234,56')?.toDbString()).toBe('1234.56');
    expect(Money.parseRo('-99,90')?.toDbString()).toBe('-99.90');
    expect(Money.parseRo('abc')).toBeNull();
    expect(Money.parseRo('')).toBeNull();
  });

  it('format produce moneda romaneasca', () => {
    // Separatorii Intl pot fi spatii insecabile — comparam pe cifre.
    expect(Money.of('1234.56').format().replace(/\s/g, '')).toContain('1.234,56');
  });

  it('compara si ordoneaza corect', () => {
    expect(Money.of('10').gt(Money.of('9.99'))).toBe(true);
    expect(Money.of('-1').isNegative()).toBe(true);
    expect(Money.ZERO.isNegative()).toBe(false);
    expect(Money.of('5').max(Money.of('7')).toDbString()).toBe('7.00');
  });
});
