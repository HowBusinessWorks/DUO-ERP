import { AppError, Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import {
  allocatedTotal,
  splitAcrossPeriods,
  validateAllocationSum,
  type AllocationLike,
} from './allocations';

function allocation(overrides: Partial<AllocationLike> = {}): AllocationLike {
  return {
    periodId: 'per-2026-08',
    componentId: 'comp-delta',
    allocatedAmount: Money.of(1000),
    allocatedPct: null,
    status: 'active',
    ...overrides,
  };
}

describe('splitAcrossPeriods', () => {
  // Cazul din §13: „Lucrare mare impartita pe 3 Delta".
  it('taie o suma pe trei luni fara sa piarda un ban', () => {
    const split = splitAcrossPeriods(Money.of(34800), ['aug', 'sep', 'oct']);

    expect(split.map((s) => s.amount.toDbString())).toEqual(['11600.00', '11600.00', '11600.00']);
    expect(Money.sum(split.map((s) => s.amount)).toDbString()).toBe('34800.00');
  });

  it('suma care nu se imparte exact: restul se distribuie, totalul ramane intact', () => {
    const split = splitAcrossPeriods(Money.of(100), ['aug', 'sep', 'oct']);

    expect(split.map((s) => s.amount.toDbString())).toEqual(['33.34', '33.33', '33.33']);
    expect(Money.sum(split.map((s) => s.amount)).toDbString()).toBe('100.00');
  });

  it('ponderi: aug 12.500 · sep 12.500 · oct 9.800, exact ca in §13', () => {
    const split = splitAcrossPeriods(Money.of(34800), ['aug', 'sep', 'oct'], [125, 125, 98]);

    expect(split.map((s) => s.amount.toDbString())).toEqual(['12500.00', '12500.00', '9800.00']);
  });

  it('o singura luna: un singur rand, cu toata suma', () => {
    const split = splitAcrossPeriods(Money.of(8400), ['aug']);

    expect(split).toHaveLength(1);
    expect(split[0]?.amount.toDbString()).toBe('8400.00');
  });

  it('zero luni, ponderi nepotrivite si luni duplicate: refuzate', () => {
    expect(() => splitAcrossPeriods(Money.of(100), [])).toThrow(AppError);
    expect(() => splitAcrossPeriods(Money.of(100), ['aug', 'sep'], [1])).toThrow(AppError);
    expect(() => splitAcrossPeriods(Money.of(100), ['aug', 'aug'])).toThrow(AppError);
  });
});

describe('allocatedTotal', () => {
  it('aduna doar alocarile active, si doar pe cele in bani', () => {
    const total = allocatedTotal([
      allocation({ allocatedAmount: Money.of(12500) }),
      allocation({ allocatedAmount: Money.of(9800) }),
      allocation({ allocatedAmount: Money.of(5000), status: 'superseded' }),
      allocation({ allocatedAmount: null, allocatedPct: 0.5 }),
    ]);

    expect(total.toDbString()).toBe('22300.00');
  });

  it('nicio alocare: zero, nu eroare', () => {
    expect(allocatedTotal([]).toDbString()).toBe('0.00');
  });
});

describe('validateAllocationSum', () => {
  // Verificarea #2 a pasului: 60% + 50% pe aceeasi UL si aceeasi luna.
  it('procentele active peste 100% pe aceeasi luna: problema', () => {
    const check = validateAllocationSum([
      allocation({ allocatedAmount: null, allocatedPct: 0.6, componentId: 'comp-mentenanta' }),
      allocation({ allocatedAmount: null, allocatedPct: 0.5, componentId: 'comp-delta' }),
    ]);

    expect(check.valid).toBe(false);
    expect(check.problems[0]?.code).toBe('pct_sum_exceeded');
    expect(check.problems[0]?.found).toBe('110.00%');
    expect(check.pctByPeriod.get('per-2026-08')).toBeCloseTo(1.1);
  });

  it('exact 100% pe o luna: valid — limita e inclusa', () => {
    const check = validateAllocationSum([
      allocation({ allocatedAmount: null, allocatedPct: 0.6, componentId: 'comp-mentenanta' }),
      allocation({ allocatedAmount: null, allocatedPct: 0.4, componentId: 'comp-delta' }),
    ]);

    expect(check.valid).toBe(true);
  });

  it('60% + 50% pe LUNI DIFERITE: valid, fiecare luna se judeca singura', () => {
    const check = validateAllocationSum([
      allocation({ allocatedAmount: null, allocatedPct: 0.6, periodId: 'aug' }),
      allocation({ allocatedAmount: null, allocatedPct: 0.5, periodId: 'sep' }),
    ]);

    expect(check.valid).toBe(true);
  });

  it('alocarile supersedate nu intra in suma procentelor', () => {
    const check = validateAllocationSum([
      allocation({ allocatedAmount: null, allocatedPct: 1, status: 'superseded' }),
      allocation({
        allocatedAmount: null,
        allocatedPct: 1,
        componentId: 'comp-delta',
        status: 'active',
      }),
    ]);

    expect(check.valid).toBe(true);
  });

  it('0.3333 × 3 nu pica pe aritmetica binara', () => {
    const check = validateAllocationSum([
      allocation({ allocatedAmount: null, allocatedPct: 0.3333, componentId: 'a' }),
      allocation({ allocatedAmount: null, allocatedPct: 0.3333, componentId: 'b' }),
      allocation({ allocatedAmount: null, allocatedPct: 0.3334, componentId: 'c' }),
    ]);

    expect(check.valid).toBe(true);
  });

  it('doua alocari active pe aceeasi componenta si luna: problema', () => {
    const check = validateAllocationSum([allocation(), allocation()]);

    expect(check.valid).toBe(false);
    expect(check.problems.map((p) => p.code)).toContain('duplicate_active');
  });

  // Verificarea #1 a pasului: suma alocarilor = valoarea lucrarii.
  it('suma alocarilor fata de valoarea lucrarii', () => {
    const allocations = splitAcrossPeriods(Money.of(34800), ['aug', 'sep', 'oct']).map((s) =>
      allocation({ periodId: s.periodId, allocatedAmount: s.amount }),
    );

    expect(validateAllocationSum(allocations, Money.of(34800)).valid).toBe(true);

    const mismatch = validateAllocationSum(allocations, Money.of(34801));
    expect(mismatch.valid).toBe(false);
    expect(mismatch.problems[0]?.code).toBe('total_mismatch');
    expect(mismatch.problems[0]?.found).toBe('34800.00');
    expect(mismatch.problems[0]?.expected).toBe('34801.00');
  });

  it('fara valoare de referinta, suma nu se compara cu nimic', () => {
    const check = validateAllocationSum([allocation({ allocatedAmount: Money.of(7) })]);

    expect(check.valid).toBe(true);
    expect(check.total.toDbString()).toBe('7.00');
  });
});
