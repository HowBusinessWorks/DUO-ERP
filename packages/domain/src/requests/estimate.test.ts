import { Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { estimateFromCatalog } from './estimate';

describe('estimateFromCatalog', () => {
  // Verificarea #5: valoarea = suma manoperei + materialului, per cantitate.
  it('inmulteste fiecare linie cu cantitatea si aduna', () => {
    const result = estimateFromCatalog([
      { quantity: 2, operation: { estimatedLabor: Money.of(180), estimatedMaterial: Money.of(232) } },
      { quantity: 1, operation: { estimatedLabor: Money.of(50), estimatedMaterial: Money.of(10) } },
    ]);
    expect(result.labor.equals(Money.of(410))).toBe(true);
    expect(result.material.equals(Money.of(474))).toBe(true);
    expect(result.total.equals(Money.of(884))).toBe(true);
  });

  it('lista goala da zero', () => {
    const result = estimateFromCatalog([]);
    expect(result.total.isZero()).toBe(true);
  });
});
