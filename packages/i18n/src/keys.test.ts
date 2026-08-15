import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { roRO } from './ro-RO';
import { translate, type TranslationKey } from './index';

/**
 * „Un test verifica sa nu existe chei lipsa” — cerinta de la §7 al pasului 03.
 *
 * Prima plasa e sistemul de tipuri: `t()` accepta doar caile de frunza din
 * dictionar, deci o cheie scrisa gresit nu compileaza. Testul asta e a doua
 * plasa, si prinde ce tipurile nu pot: chei compuse la runtime si chei ramase
 * in urma dupa ce cineva a redenumit ceva in dictionar.
 *
 * Scaneaza sursele reale, nu o lista intretinuta de mana — o lista de verificat
 * se demodeaza exact ca lucrurile pe care ar trebui sa le verifice.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const SCANNED = ['apps/web/src', 'packages/ui/src'];
const CALL = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('dictionarul ro-RO', () => {
  it('are o valoare pentru fiecare cheie folosita in cod', () => {
    const missing: string[] = [];

    for (const dir of SCANNED) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const content = readFileSync(file, 'utf8');
        for (const match of content.matchAll(CALL)) {
          const key = match[1];
          if (key === undefined) {
            continue;
          }
          if (translate(roRO, key as TranslationKey) === key) {
            missing.push(`${key}  (${file.slice(ROOT.length + 1)})`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('nu are frunze goale', () => {
    const empty: string[] = [];

    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        if (node.trim() === '') {
          empty.push(path);
        }
        return;
      }
      if (typeof node === 'object' && node !== null) {
        for (const [key, value] of Object.entries(node)) {
          walk(value, path === '' ? key : `${path}.${key}`);
        }
      }
    };

    walk(roRO, '');
    expect(empty).toEqual([]);
  });

  it('interpoleaza parametrii si lasa intacte acoladele fara valoare', () => {
    expect(translate(roRO, 'company.some', { count: 3 })).toBe('3 firme');
    expect(translate(roRO, 'period.lockedTitle', {})).toContain('{period}');
  });
});
