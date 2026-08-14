import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * Urca in arbore pana gaseste radacina monorepo-ului, ca sa citim acelasi
 * `.env.local` indiferent din ce pachet suntem porniti.
 */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

let loaded = false;

/** Incarca `.env.local` apoi `.env`. Variabilele deja setate nu se suprascriu. */
export function loadEnvFiles(): void {
  if (loaded) return;
  const root = findRepoRoot();
  loadDotenv({ path: resolve(root, '.env.local'), quiet: true });
  loadDotenv({ path: resolve(root, '.env'), quiet: true });
  loaded = true;
}

export interface DbEnv {
  /** Supavisor *transaction pooling* — rutele serverless din Vercel. */
  DATABASE_URL: string;
  /** Supavisor *session pooling* — worker si migratii (au nevoie de LISTEN/NOTIFY). */
  DATABASE_URL_SESSION: string;
}

/**
 * Citeste cele doua connection string-uri.
 *
 * `requireSession` / `requirePooled` arunca daca lipsesc — ce nu e cerut se
 * intoarce ca sir gol, ca `drizzle-kit generate` sa poata rula si fara baza
 * de date configurata (generarea nu se conecteaza nicaieri).
 */
export function loadDbEnv(
  options: { requireSession?: boolean; requirePooled?: boolean } = {},
): DbEnv {
  loadEnvFiles();

  const session = process.env['DATABASE_URL_SESSION'] ?? '';
  const pooled = process.env['DATABASE_URL'] ?? '';

  if (options.requireSession === true && session === '') {
    throw new Error(
      'DATABASE_URL_SESSION lipseste. Copiaza .env.example in .env.local si completeaza connection string-ul de session pooling (portul 5432).',
    );
  }
  if (options.requirePooled === true && pooled === '') {
    throw new Error(
      'DATABASE_URL lipseste. Copiaza .env.example in .env.local si completeaza connection string-ul de transaction pooling (portul 6543).',
    );
  }

  return { DATABASE_URL: pooled, DATABASE_URL_SESSION: session };
}
