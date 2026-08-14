import { describe, expect, it } from 'vitest';
import { Period } from './period';

describe('Period', () => {
  it('toKey da formatul canonic', () => {
    expect(Period.of(2026, 8).toKey()).toBe('2026-08');
    expect(Period.of(2026, 12).toKey()).toBe('2026-12');
  });

  it('next si prev trec corect peste granita de an', () => {
    expect(Period.of(2026, 12).next().toKey()).toBe('2027-01');
    expect(Period.of(2026, 1).prev().toKey()).toBe('2025-12');
  });

  it('fromDate ia luna calendaristica locala', () => {
    expect(Period.fromDate(new Date(2026, 7, 14)).toKey()).toBe('2026-08');
  });

  it('fromKey accepta doar formatul corect', () => {
    expect(Period.fromKey('2026-08').equals(Period.of(2026, 8))).toBe(true);
    expect(() => Period.fromKey('2026-13')).toThrow(RangeError);
    expect(() => Period.fromKey('2026-8')).toThrow(RangeError);
    expect(() => Period.fromKey('august')).toThrow(RangeError);
  });

  it('shift si diff sunt inverse', () => {
    const p = Period.of(2026, 8);
    expect(p.shift(5).toKey()).toBe('2027-01');
    expect(p.shift(-8).toKey()).toBe('2025-12');
    expect(p.shift(17).diff(p)).toBe(17);
  });

  it('firstDay si lastDay dau date de business valide', () => {
    expect(Period.of(2026, 2).firstDay()).toBe('2026-02-01');
    expect(Period.of(2026, 2).lastDay()).toBe('2026-02-28');
    expect(Period.of(2028, 2).lastDay()).toBe('2028-02-29');
    expect(Period.of(2026, 8).lastDay()).toBe('2026-08-31');
  });

  it('respinge valori imposibile', () => {
    expect(() => Period.of(2026, 0)).toThrow(RangeError);
    expect(() => Period.of(2026, 13)).toThrow(RangeError);
    expect(() => Period.of(1800, 1)).toThrow(RangeError);
  });

  it('compare ordoneaza cronologic', () => {
    expect(Period.of(2026, 1).compare(Period.of(2026, 2))).toBe(-1);
    expect(Period.of(2026, 2).compare(Period.of(2026, 2))).toBe(0);
    expect(Period.of(2027, 1).compare(Period.of(2026, 12))).toBe(1);
  });
});
