import { describe, expect, it } from 'vitest';
import { Quantity } from './quantity';

describe('Quantity', () => {
  it('pastreaza 4 zecimale', () => {
    expect(Quantity.of('2.5').toDbString()).toBe('2.5000');
    expect(Quantity.of('0.12345').toDbString()).toBe('0.1235');
  });

  it('aduna fara drift', () => {
    let total = Quantity.ZERO;
    for (let i = 0; i < 10; i += 1) {
      total = total.add(Quantity.of('0.1'));
    }
    expect(total.toDbString()).toBe('1.0000');
  });

  it('allocate pastreaza suma', () => {
    const parts = Quantity.of('1').allocate([1, 1, 1]);
    expect(Quantity.sum(parts).toDbString()).toBe('1.0000');
  });

  it('format elimina zerourile inutile', () => {
    expect(Quantity.of('2.5000').format()).toBe('2,5');
    expect(Quantity.of('3').format()).toBe('3');
  });
});
