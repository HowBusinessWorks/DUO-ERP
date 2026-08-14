import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * Incarcarea mediului sta intr-un modul separat pentru ca si `keys.ts`, si
 * `client.ts` au nevoie de ea.
 *
 * Motivul e o capcana pe care am si calcat-o: cheile se genereaza inainte ca
 * cineva sa atinga clientul S3, deci daca `.env.local` s-ar incarca doar la
 * prima conexiune, `R2_KEY_PREFIX` ar fi gol exact cand se construieste cheia,
 * si am scrie linistit in afara prefixului.
 */

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

let loaded = false;

/** Incarca `.env.local` apoi `.env`. Variabilele deja setate nu se suprascriu. */
export function loadStorageEnv(): void {
  if (loaded) return;
  const root = findRepoRoot();
  loadDotenv({ path: resolve(root, '.env.local'), quiet: true });
  loadDotenv({ path: resolve(root, '.env'), quiet: true });
  loaded = true;
}

export function requiredEnv(name: string): string {
  loadStorageEnv();
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} lipseste. Completeaza-l in .env.local (vezi .env.example).`);
  }
  return value;
}

export function optionalEnv(name: string): string {
  loadStorageEnv();
  return process.env[name] ?? '';
}
