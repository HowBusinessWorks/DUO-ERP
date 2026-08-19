import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { loadDbEnv } from '../src/env';

/**
 * Ruleaza un fisier `.sql` pe conexiunea de dezvoltare, ca superuser.
 *
 * Exista pentru probele care nu incap intr-un test: „ce vede rolul restrans pe
 * date reale", corecturi punctuale pe baza de dev, si smoke-ul dinaintea
 * ecranelor. NU e o cale de migrare — nu tine evidenta a ce s-a rulat.
 *
 *   pnpm --filter @damina/db exec tsx scripts/dev-sql.ts fisier.sql
 */
async function main(): Promise<void> {
  const file = process.argv[2];
  if (file === undefined) {
    throw new Error('Foloseste: tsx scripts/dev-sql.ts <fisier.sql>');
  }

  const env = loadDbEnv({ requireSession: true });
  const ssl = env.DATABASE_URL_SESSION.includes('localhost')
    ? false
    : { rejectUnauthorized: false };

  const client = new pg.Client({ connectionString: env.DATABASE_URL_SESSION, ssl });
  await client.connect();

  try {
    const results = await client.query(await readFile(file, 'utf8'));
    for (const result of Array.isArray(results) ? results : [results]) {
      if (result.rows.length > 0) {
        process.stdout.write(`${JSON.stringify(result.rows, null, 2)}\n`);
      } else {
        process.stdout.write(`${result.command ?? 'ok'}\n`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  let current: unknown = error;
  let message = String(error);
  while (current instanceof Error) {
    message = current.message;
    current = current.cause;
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
