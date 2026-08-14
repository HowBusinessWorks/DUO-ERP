import { describe, expect, it } from 'vitest';
import { isUuid, timestampFromUuidv7, uuidv7 } from './uuid';

describe('uuidv7', () => {
  it('produce un UUID valid, versiunea 7, varianta RFC', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('e ordonat temporal — sortarea alfabetica da ordinea crearii', () => {
    const ids = Array.from({ length: 2000 }, () => uuidv7());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('nu produce duplicate', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });

  it('poarta in el momentul crearii', () => {
    const before = Date.now();
    const id = uuidv7();
    const extracted = timestampFromUuidv7(id);
    expect(extracted).not.toBeNull();
    // Toleranta de o secunda acopera imprumutul de milisecunde din contor.
    expect(Math.abs((extracted as Date).getTime() - before)).toBeLessThan(1000);
  });

  it('timestampFromUuidv7 refuza ce nu e v7', () => {
    expect(timestampFromUuidv7('nu-e-uuid')).toBeNull();
    expect(timestampFromUuidv7('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
