import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { err, isErr, isOk, mapResult, ok, unwrap } from './result';

describe('AppError', () => {
  it('supravietuieste lui instanceof dupa transpilare', () => {
    const e = AppError.periodClosed('2026-08');
    expect(e).toBeInstanceOf(AppError);
    expect(e).toBeInstanceOf(Error);
    expect(AppError.is(e)).toBe(true);
  });

  it('poarta cod si payload', () => {
    const e = AppError.periodClosed('2026-08');
    expect(e.code).toBe('PERIOD_CLOSED');
    expect(e.payload).toEqual({ periodKey: '2026-08' });
    expect(e.toJSON().code).toBe('PERIOD_CLOSED');
  });

  it('payload-ul e inghetat', () => {
    const e = AppError.validation({ field: 'cui' });
    expect(Object.isFrozen(e.payload)).toBe(true);
  });
});

describe('Result', () => {
  it('ok si err se disting prin narrowing', () => {
    const good = ok(42);
    const bad = err(AppError.notFound('Contract'));
    expect(isOk(good)).toBe(true);
    expect(isErr(bad)).toBe(true);
    if (good.ok) {
      expect(good.value).toBe(42);
    }
  });

  it('unwrap arunca eroarea din err', () => {
    expect(unwrap(ok('x'))).toBe('x');
    expect(() => unwrap(err(AppError.forbidden()))).toThrow(AppError);
  });

  it('mapResult transforma doar cazul ok', () => {
    expect(mapResult(ok(2), (n) => n * 2)).toEqual({ ok: true, value: 4 });
    const failure = err(AppError.notFound('Obiectiv'));
    expect(mapResult(failure, (n: number) => n * 2)).toBe(failure);
  });
});
