import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadDbEnv, loadEnvFiles } from '../src/env';

/**
 * Sterge complet schema si o reconstruieste din migratii.
 *
 * Operatie distructiva pe o baza de date reala, deci e blocata implicit:
 * ruleaza doar daca `.env.local` contine ALLOW_DB_RESET=true. Mediile de
 * staging si productie nu au variabila, deci comanda nu are ce sa strice acolo.
 */
const ROLES = [
  'app_office',
  'app_field',
  'app_subcontractor',
  'app_client',
  'app_service',
  'app_runtime',
] as const;

async function main(): Promise<void> {
  loadEnvFiles();

  if (process.env['ALLOW_DB_RESET'] !== 'true') {
    throw new Error(
      'db:reset e blocat. Adauga ALLOW_DB_RESET=true in .env.local daca esti sigur ca baza din DATABASE_URL_SESSION e una de dezvoltare.',
    );
  }

  const env = loadDbEnv({ requireSession: true });
  const ssl = env.DATABASE_URL_SESSION.includes('localhost')
    ? false
    : { rejectUnauthorized: false };

  const client = new pg.Client({ connectionString: env.DATABASE_URL_SESSION, ssl });
  await client.connect();

  try {
    process.stdout.write('Sterg schemele app, audit, jobs si jurnalul de migratii...\n');
    await client.query('drop schema if exists app cascade');
    await client.query('drop schema if exists audit cascade');
    await client.query('drop schema if exists jobs cascade');
    await client.query('drop schema if exists drizzle cascade');

    process.stdout.write('Sterg rolurile de aplicatie...\n');
    for (const role of ROLES) {
      const { rows } = await client.query<{ exists: boolean }>(
        'select exists(select 1 from pg_roles where rolname = $1) as exists',
        [role],
      );
      if (rows[0]?.exists === true) {
        // Grant-urile ramase tin rolul in viata; drop owned le curata.
        await client.query(`drop owned by ${role} cascade`);
        await client.query(`drop role ${role}`);
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const run = (script: string, failure: string): void => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve(here, script)], {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(failure);
    }
  };

  process.stdout.write('Reaplic migratiile de la zero...\n');
  run('migrate.ts', 'Migrarea a esuat dupa reset.');

  // Reset-ul sterge rolurile, iar migrarea il recreeaza pe `app_runtime` FARA
  // parola — parola nu are ce cauta intr-o migrare versionata. Fara pasul asta,
  // baza ar arata perfect dar aplicatia n-ar mai putea sa se conecteze.
  if ((process.env['APP_RUNTIME_PASSWORD'] ?? '') === '') {
    process.stdout.write(
      '\nATENTIE: APP_RUNTIME_PASSWORD lipseste, deci rolul app_runtime a ramas fara parola.\n' +
        'Aplicatia nu se va putea conecta pana nu rulezi: pnpm --filter @damina/db db:set-runtime-password\n',
    );
  } else {
    process.stdout.write('Repun parola rolului app_runtime...\n');
    run('set-runtime-password.ts', 'Setarea parolei pentru app_runtime a esuat dupa reset.');
  }

  process.stdout.write('Baza a fost reconstruita de la zero.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
