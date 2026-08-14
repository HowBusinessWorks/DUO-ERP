import pg from 'pg';
import { loadDbEnv, loadEnvFiles } from '../src/env';

/**
 * Seteaza parola rolului `app_runtime` — rolul cu care se conecteaza aplicatia.
 *
 * Parola nu are ce cauta intr-o migrare versionata, deci se pune separat, o
 * singura data per mediu, din `APP_RUNTIME_PASSWORD`.
 */
async function main(): Promise<void> {
  loadEnvFiles();

  const password = process.env['APP_RUNTIME_PASSWORD'];
  if (password === undefined || password.length < 16) {
    throw new Error(
      'APP_RUNTIME_PASSWORD lipseste sau e prea scurta (minim 16 caractere). Genereaza una si pune-o in .env.local.',
    );
  }

  const env = loadDbEnv({ requireSession: true });
  const ssl = env.DATABASE_URL_SESSION.includes('localhost')
    ? false
    : { rejectUnauthorized: false };

  const client = new pg.Client({ connectionString: env.DATABASE_URL_SESSION, ssl });
  await client.connect();
  try {
    // ALTER ROLE nu accepta parametri legati, deci escapam literalul cu
    // functia driverului — nu prin concatenare manuala.
    await client.query(`alter role app_runtime login password ${client.escapeLiteral(password)}`);
    process.stdout.write('Parola pentru app_runtime a fost setata.\n');
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
