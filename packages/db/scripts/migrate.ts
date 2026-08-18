import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadDbEnv } from '../src/env';

/**
 * Aplica migratiile pe conexiunea de *session pooling*.
 *
 * Un advisory lock la nivel de cluster impiedica doua rulari simultane — cazul
 * real e deploy-ul: CI-ul porneste migrarea in acelasi timp cu un retry.
 */
const LOCK_ID = 0x0dab1a01;

const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

async function main(): Promise<void> {
  const env = loadDbEnv({ requireSession: true });
  const ssl = env.DATABASE_URL_SESSION.includes('localhost')
    ? false
    : { rejectUnauthorized: false };

  const lockClient = new pg.Client({ connectionString: env.DATABASE_URL_SESSION, ssl });
  await lockClient.connect();

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL_SESSION, ssl, max: 1 });

  try {
    process.stdout.write('Astept lock-ul de migrare... ');
    await lockClient.query('select pg_advisory_lock($1)', [LOCK_ID]);
    process.stdout.write('obtinut.\n');

    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    process.stdout.write('Migratii aplicate.\n');
  } finally {
    await lockClient.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    await lockClient.end().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  /*
   * Drizzle ambaleaza eroarea si pastreaza doar „Failed query: …", adica exact
   * partea pe care o stiam deja. Mesajul Postgres — cel care spune ce anume
   * n-a mers — sta in `cause`, si fara el depanarea unei migrari lungi inseamna
   * injumatatirea fisierului cu mana.
   */
  const cause = error instanceof Error ? error.cause : undefined;
  process.stderr.write(`${String(error)}\n`);
  if (cause !== undefined) {
    process.stderr.write(`\nCauza: ${String(cause)}\n`);
  }
  process.exitCode = 1;
});
