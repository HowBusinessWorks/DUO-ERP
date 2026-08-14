import { afterEach, describe, expect, it, vi } from 'vitest';
import { blobKey, derivedKey, tmpKey } from './keys';

// `keys.ts` citeste mediul prin `optionalEnv`, care incarca .env.local o
// singura data. In teste inlocuim direct functia, ca sa nu depindem de fisier.
vi.mock('./env', () => ({
  optionalEnv: (name: string) => process.env[name] ?? '',
  requiredEnv: (name: string) => process.env[name] ?? '',
  loadStorageEnv: () => undefined,
}));

const originalPrefix = process.env['R2_KEY_PREFIX'];

afterEach(() => {
  if (originalPrefix === undefined) {
    delete process.env['R2_KEY_PREFIX'];
  } else {
    process.env['R2_KEY_PREFIX'] = originalPrefix;
  }
});

describe('chei R2', () => {
  it('sunt UUID opac, fara cale semantica', () => {
    delete process.env['R2_KEY_PREFIX'];
    const key = blobKey();
    expect(key).toMatch(/^blobs\/[0-9a-f-]{36}$/);
    // Nicio urma de contract, obiectiv sau nume de fisier in cheie.
    expect(key).not.toMatch(/contract|obiectiv|\.(jpg|pdf|png)/i);
  });

  it('respecta R2_KEY_PREFIX pe toate cele trei tipuri de cheie', () => {
    process.env['R2_KEY_PREFIX'] = 'erp-test';
    expect(blobKey()).toMatch(/^erp-test\/blobs\//);
    expect(derivedKey('01a0022a-ec15-7000-9c93-abcfd53cd338', 'thumb')).toBe(
      'erp-test/derived/01a0022a-ec15-7000-9c93-abcfd53cd338/thumb',
    );
    expect(tmpKey('smoke')).toMatch(/^erp-test\/tmp\/smoke\//);
  });

  it('normalizeaza slash-urile din prefix', () => {
    process.env['R2_KEY_PREFIX'] = '/erp-test/';
    expect(blobKey()).toMatch(/^erp-test\/blobs\//);
  });

  it('fara prefix, cheile raman curate', () => {
    process.env['R2_KEY_PREFIX'] = '';
    expect(blobKey()).toMatch(/^blobs\//);
    expect(tmpKey('smoke')).toMatch(/^tmp\/smoke\//);
  });

  it('respinge un prefix periculos', () => {
    process.env['R2_KEY_PREFIX'] = '../altceva';
    expect(() => blobKey()).toThrow(/R2_KEY_PREFIX invalid/);
  });

  it('respinge nume de varianta si prefixe temporare invalide', () => {
    delete process.env['R2_KEY_PREFIX'];
    expect(() => derivedKey('x', '../escape')).toThrow(/varianta invalid/);
    expect(() => tmpKey('a/b')).toThrow(/Prefix temporar invalid/);
  });
});
