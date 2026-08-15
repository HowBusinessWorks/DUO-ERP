import { Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import {
  addYears,
  applyIndexation,
  buildContractYears,
  contractYearAt,
  previousDay,
} from './indexation';

describe('applyIndexation', () => {
  // Verificarea #1 din pasul 04, cifra cu cifra.
  it('compune 5% peste un abonament de 50.000 lei, an de an', () => {
    const base = Money.of('50000.00');
    expect(applyIndexation(base, '0.0500', 1).toString()).toBe('50000.00');
    expect(applyIndexation(base, '0.0500', 2).toString()).toBe('52500.00');
    expect(applyIndexation(base, '0.0500', 3).toString()).toBe('55125.00');
    expect(applyIndexation(base, '0.0500', 4).toString()).toBe('57881.25');
  });

  // Verificarea #2: contractele cu indexare 0 se degradeaza cel mai repede.
  it('cu indexare 0 toti anii au aceeasi valoare', () => {
    const base = Money.of('50000.00');
    for (const year of [1, 2, 3, 4]) {
      expect(applyIndexation(base, '0', year).toString()).toBe('50000.00');
    }
  });

  it('rotunjeste la fiecare an, nu o singura data la final', () => {
    // 1000 × 1.035 = 1035 exact; 1035 × 1.035 = 1071,225 → 1071,23 (half-up).
    // Cu formula 1000 × 1.035² = 1071,225 → tot 1071,23, dar la anul 4 cele doua
    // cai diverg, si asta e ce blocheaza testul.
    const base = Money.of('1000.00');
    expect(applyIndexation(base, '0.035', 2).toString()).toBe('1035.00');
    expect(applyIndexation(base, '0.035', 3).toString()).toBe('1071.23');
    expect(applyIndexation(base, '0.035', 4).toString()).toBe('1108.72');
  });

  it('refuza un index de an sub 1', () => {
    expect(() => applyIndexation(Money.of('100'), '0.05', 0)).toThrow(RangeError);
  });
});

describe('addYears / previousDay', () => {
  it('limiteaza ziua la lungimea lunii tinta', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2026-03-01', 1)).toBe('2027-03-01');
  });

  it('trece corect peste granita de luna si de an', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
    expect(previousDay('2026-08-15')).toBe('2026-08-14');
  });
});

describe('buildContractYears', () => {
  // Verificarea #1: patru ani cu aniversare corecta si valori indexate.
  it('produce 4 ani cu aniversarea pe zi, nu pe an calendaristic', () => {
    const years = buildContractYears({
      startsOn: '2026-03-01',
      endsOn: '2030-02-28',
      monthlyValue: Money.of('50000.00'),
      indexationPct: '0.0500',
    });

    expect(years).toHaveLength(4);
    expect(years.map((y) => [y.startsOn, y.endsOn])).toEqual([
      ['2026-03-01', '2027-02-28'],
      ['2027-03-01', '2028-02-29'],
      ['2028-03-01', '2029-02-28'],
      ['2029-03-01', '2030-02-28'],
    ]);
    expect(years.map((y) => y.monthlyValue.toString())).toEqual([
      '50000.00',
      '52500.00',
      '55125.00',
      '57881.25',
    ]);
  });

  it('anul 1 nu poarta indexare, oricare ar fi procentul', () => {
    const [first, second] = buildContractYears({
      startsOn: '2026-01-01',
      endsOn: '2027-12-31',
      monthlyValue: Money.of('10000.00'),
      indexationPct: '0.0500',
    });

    expect(first?.indexationAppliedPct).toBe('0');
    expect(second?.indexationAppliedPct).toBe('0.0500');
  });

  // Verificarea #2: cei 4 ani au aceeasi valoare la indexare 0.
  it('cu indexare 0 produce tot 4 ani, toti la aceeasi valoare', () => {
    const years = buildContractYears({
      startsOn: '2026-03-01',
      endsOn: '2030-02-28',
      monthlyValue: Money.of('50000.00'),
      indexationPct: '0',
    });

    expect(years).toHaveLength(4);
    expect(new Set(years.map((y) => y.monthlyValue.toString())).size).toBe(1);
  });

  it('taie ultimul an la finalul contractului', () => {
    const years = buildContractYears({
      startsOn: '2026-03-01',
      endsOn: '2029-08-31',
      monthlyValue: Money.of('1000.00'),
      indexationPct: '0',
    });

    expect(years).toHaveLength(4);
    expect(years.at(-1)).toMatchObject({ startsOn: '2029-03-01', endsOn: '2029-08-31' });
  });

  it('un contract sub un an produce un singur an contractual', () => {
    const years = buildContractYears({
      startsOn: '2026-05-10',
      endsOn: '2026-09-30',
      monthlyValue: Money.of('3000.00'),
      indexationPct: '0.05',
    });

    expect(years).toEqual([
      {
        yearIndex: 1,
        startsOn: '2026-05-10',
        endsOn: '2026-09-30',
        monthlyValue: Money.of('3000.00'),
        indexationAppliedPct: '0',
      },
    ]);
  });

  it('refuza un contract care se termina inainte sa inceapa', () => {
    expect(() =>
      buildContractYears({
        startsOn: '2026-03-01',
        endsOn: '2026-03-01',
        monthlyValue: Money.of('1000.00'),
        indexationPct: '0',
      }),
    ).toThrow(RangeError);
  });

  it('refuza o data scrisa gresit in loc s-o interpreteze', () => {
    expect(() =>
      buildContractYears({
        startsOn: '01.03.2026',
        endsOn: '2030-02-28',
        monthlyValue: Money.of('1000.00'),
        indexationPct: '0',
      }),
    ).toThrow(RangeError);
  });
});

describe('contractYearAt', () => {
  const years = buildContractYears({
    startsOn: '2026-03-01',
    endsOn: '2030-02-28',
    monthlyValue: Money.of('50000.00'),
    indexationPct: '0.0500',
  });

  it('gaseste anul contractual al unei date, inclusiv la capete', () => {
    expect(contractYearAt(years, '2026-03-01')?.yearIndex).toBe(1);
    expect(contractYearAt(years, '2027-02-28')?.yearIndex).toBe(1);
    expect(contractYearAt(years, '2027-03-01')?.yearIndex).toBe(2);
    expect(contractYearAt(years, '2029-12-31')?.yearIndex).toBe(4);
  });

  it('intoarce null in afara contractului', () => {
    expect(contractYearAt(years, '2026-02-28')).toBeNull();
    expect(contractYearAt(years, '2030-03-01')).toBeNull();
  });
});
