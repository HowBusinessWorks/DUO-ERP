import { Money, Quantity } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { computeVariance, describeVariance } from './variance';

const material = (qty: string, cost: string) => ({
  quantity: Quantity.of(qty),
  unitCost: Money.of(cost),
});
const labor = (hours: string, cost: string) => ({
  hours: Quantity.of(hours),
  hourlyCost: Money.of(cost),
});

describe('computeVariance', () => {
  it('aduna materialele si manopera in costul real', () => {
    const result = computeVariance({
      expected: null,
      materials: [material('2', '150.50'), material('0.5', '80')],
      labor: [labor('6', '45.25')],
    });

    expect(result.materialCost.toDbString()).toBe('341.00');
    expect(result.laborCost.toDbString()).toBe('271.50');
    expect(result.realCost.toDbString()).toBe('612.50');
  });

  it('marcheaza abaterea peste prag — verificarea #10, +18%', () => {
    const result = computeVariance({
      expected: Money.of('1000'),
      materials: [material('1', '680')],
      labor: [labor('10', '50')],
    });

    expect(result.realCost.toDbString()).toBe('1180.00');
    expect(result.variancePct).toBe('0.1800');
    expect(result.flagged).toBe(true);
    expect(describeVariance(result)).toBe('+18.0% față de estimat');
  });

  it('nu marcheaza o abatere sub prag', () => {
    const result = computeVariance({
      expected: Money.of('1000'),
      materials: [material('1', '1100')],
      labor: [],
    });

    expect(result.variancePct).toBe('0.1000');
    expect(result.flagged).toBe(false);
  });

  it('marcheaza si abaterea in MINUS — o normă gresita e tot o problema', () => {
    const result = computeVariance({
      expected: Money.of('1000'),
      materials: [material('1', '700')],
      labor: [],
    });

    expect(result.variancePct).toBe('-0.3000');
    expect(result.flagged).toBe(true);
    expect(describeVariance(result)).toBe('-30.0% față de estimat');
  });

  it('pastreaza patru zecimale, ca sa nu se piarda diferenta de la prag', () => {
    const result = computeVariance({
      expected: Money.of('1000'),
      materials: [material('1', '1153.40')],
      labor: [],
      threshold: 0.1534,
    });

    expect(result.variancePct).toBe('0.1534');
    // Egal cu pragul, nu peste: `flagged` cere depasire stricta.
    expect(result.flagged).toBe(false);
  });

  it('nu imparte la zero cand nu exista estimare', () => {
    const zero = computeVariance({
      expected: Money.ZERO,
      materials: [material('1', '500')],
      labor: [],
    });
    const missing = computeVariance({ expected: null, materials: [], labor: [] });

    expect(zero.variancePct).toBeNull();
    expect(zero.flagged).toBe(false);
    expect(missing.variancePct).toBeNull();
    expect(describeVariance(missing)).toBeNull();
  });
});
