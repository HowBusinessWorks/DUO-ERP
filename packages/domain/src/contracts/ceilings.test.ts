import { Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { ceilingUsage, deltaFill } from './ceilings';

const lei = (value: string): Money => Money.of(value);

describe('ceilingUsage', () => {
  it('aduna angajatul cu consumatul si le tine si separate', () => {
    const usage = ceilingUsage({
      ceiling: lei('40000.00'),
      committed: lei('12000.00'),
      consumed: lei('8000.00'),
    });

    expect(usage.used.toString()).toBe('20000.00');
    expect(usage.committed.toString()).toBe('12000.00');
    expect(usage.consumed.toString()).toBe('8000.00');
    expect(usage.remaining.toString()).toBe('20000.00');
    expect(usage.percent).toBe(50);
    expect(usage.state).toBe('ok');
  });

  it('trece pe „atentie” exact la 80%, nu peste', () => {
    const at79 = ceilingUsage({
      ceiling: lei('10000.00'),
      committed: Money.ZERO,
      consumed: lei('7999.00'),
    });
    const at80 = ceilingUsage({
      ceiling: lei('10000.00'),
      committed: Money.ZERO,
      consumed: lei('8000.00'),
    });

    expect(at79.state).toBe('ok');
    expect(at80.state).toBe('warning');
  });

  it('depasirea da rest negativ si procent peste 100 — cifra spune adevarul', () => {
    const usage = ceilingUsage({
      ceiling: lei('10000.00'),
      committed: lei('6000.00'),
      consumed: lei('7000.00'),
    });

    expect(usage.state).toBe('exceeded');
    expect(usage.remaining.toString()).toBe('-3000.00');
    expect(usage.percent).toBe(130);
  });

  it('plafon nesetat nu inseamna nelimitat: nu se calculeaza procent', () => {
    const usage = ceilingUsage({
      ceiling: null,
      committed: lei('5000.00'),
      consumed: lei('1000.00'),
    });

    expect(usage.hasCeiling).toBe(false);
    expect(usage.percent).toBe(0);
    expect(usage.used.toString()).toBe('6000.00');
    expect(usage.state).toBe('ok');
  });

  it('plafon zero: fara consum e 0%, cu consum e depasire', () => {
    expect(
      ceilingUsage({ ceiling: Money.ZERO, committed: Money.ZERO, consumed: Money.ZERO }),
    ).toMatchObject({ percent: 0, state: 'ok' });

    const spent = ceilingUsage({
      ceiling: Money.ZERO,
      committed: Money.ZERO,
      consumed: lei('1.00'),
    });
    expect(spent.state).toBe('exceeded');
    expect(spent.percent).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('deltaFill', () => {
  // Regula 2 a pasului: Delta se UMPLE. Ce ramane neumplut se pierde definitiv.
  it('spune cati lei au ramas neumpluti, nu cati mai poti cheltui', () => {
    const fill = deltaFill({
      revenueCeiling: lei('20000.00'),
      allocatedRevenue: lei('7600.00'),
      asOf: '2026-08-20',
    });

    expect(fill.fillPercent).toBe(38);
    expect(fill.unfilled.toString()).toBe('12400.00');
  });

  // Ultima zi se numara inclusiv doar cand ea chiar e azi. Pe o luna deja
  // incheiata, „mai ai o zi” e o minciuna: nu mai e nimic de umplut.
  it('o luna incheiata n-are zile ramase, iar ritmul cerut e 100%', () => {
    const fill = deltaFill({
      revenueCeiling: lei('20000.00'),
      allocatedRevenue: lei('7600.00'),
      asOf: '2026-03-31',
      monthEnded: true,
    });

    expect(fill.daysLeft).toBe(0);
    expect(fill.expectedPercent).toBe(100);
    expect(fill.state).toBe('in_urma');
    expect(fill.unfilled.toString()).toBe('12400.00');
  });

  it('pe 10 ale unei luni de 31 de zile, ritmul asteptat e ~32%', () => {
    const fill = deltaFill({
      revenueCeiling: lei('10000.00'),
      allocatedRevenue: lei('3300.00'),
      asOf: '2026-08-10',
    });

    expect(fill.expectedPercent).toBeCloseTo(32.26, 2);
    expect(fill.daysLeft).toBe(22);
    expect(fill.state).toBe('in_grafic');
  });

  it('38% pe 20 august inseamna „in urma” — exact alerta din §3.7', () => {
    const fill = deltaFill({
      revenueCeiling: lei('20000.00'),
      allocatedRevenue: lei('7600.00'),
      asOf: '2026-08-20',
    });

    expect(fill.expectedPercent).toBeCloseTo(64.52, 2);
    expect(fill.state).toBe('in_urma');
  });

  it('in ultima zi a lunii mai e o zi de lucrat, nu zero', () => {
    const fill = deltaFill({
      revenueCeiling: lei('1000.00'),
      allocatedRevenue: Money.ZERO,
      asOf: '2026-02-28',
    });

    expect(fill.daysLeft).toBe(1);
    expect(fill.expectedPercent).toBe(100);
  });

  it('anul bisect are 29 de zile in februarie', () => {
    expect(
      deltaFill({
        revenueCeiling: lei('1000.00'),
        allocatedRevenue: Money.ZERO,
        asOf: '2028-02-28',
      }).daysLeft,
    ).toBe(2);
  });

  it('umplerea peste plafon e „plin”, iar neumplutul nu devine negativ', () => {
    const fill = deltaFill({
      revenueCeiling: lei('10000.00'),
      allocatedRevenue: lei('12000.00'),
      asOf: '2026-08-05',
    });

    expect(fill.state).toBe('plin');
    expect(fill.fillPercent).toBe(120);
    expect(fill.unfilled.toString()).toBe('0.00');
  });

  it('fara plafon setat nu exista grad de umplere', () => {
    const fill = deltaFill({
      revenueCeiling: null,
      allocatedRevenue: lei('5000.00'),
      asOf: '2026-08-05',
    });

    expect(fill.state).toBe('nesetat');
    expect(fill.fillPercent).toBe(0);
  });

  it('refuza o data scrisa gresit', () => {
    expect(() =>
      deltaFill({ revenueCeiling: lei('1000'), allocatedRevenue: Money.ZERO, asOf: 'august' }),
    ).toThrow(RangeError);
  });
});
