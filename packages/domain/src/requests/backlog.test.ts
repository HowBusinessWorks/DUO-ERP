import { Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { selectBacklogToFill } from './backlog';

describe('selectBacklogToFill', () => {
  // Verificarea #14: umplerea Deltei — cazul exact din mockup-ul §0.
  it('gaseste combinatia care umple exact plafonul, cand exista', () => {
    const proposals = [
      { id: 'a', estimatedValue: Money.of(1800) },
      { id: 'b', estimatedValue: Money.of(2300) },
      { id: 'c', estimatedValue: Money.of(4000) },
    ];
    const result = selectBacklogToFill(proposals, Money.of(4100));
    expect([...result.selectedIds].sort()).toEqual(['a', 'b']);
    expect(result.total.equals(Money.of(4100))).toBe(true);
    expect(result.fillPercent).toBe(100);
  });

  it('nu depaseste niciodata plafonul', () => {
    const proposals = [
      { id: 'a', estimatedValue: Money.of(3000) },
      { id: 'b', estimatedValue: Money.of(3000) },
    ];
    const result = selectBacklogToFill(proposals, Money.of(4000));
    expect(result.total.lte(Money.of(4000))).toBe(true);
  });

  it('plafon zero sau lista goala → nimic selectat', () => {
    expect(selectBacklogToFill([], Money.of(1000)).selectedIds).toEqual([]);
    expect(
      selectBacklogToFill([{ id: 'a', estimatedValue: Money.of(100) }], Money.ZERO).selectedIds,
    ).toEqual([]);
  });
});
