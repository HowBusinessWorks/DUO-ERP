import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Porneste un Postgres efemer si aplica migratiile de la zero.
 *
 * Asta e testul care conteaza cel mai mult din suita: daca migratiile nu
 * reconstruiesc baza pe un cluster gol, nu se poate face deploy.
 *
 * Are nevoie de Docker, deci ruleaza numai in CI (GitHub Actions il are inclus).
 */
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  /*
   * Portita pentru masina de dezvoltare, care n-are Docker: cu
   * `TEST_DATABASE_URL` setat, suita ruleaza pe baza indicata in loc de un
   * container efemer.
   *
   * Exista pentru ca pretul de a afla o greseala abia in CI e sase minute de
   * fiecare data, iar fixturile fiecarui test sunt oricum izolate prin
   * `uuidv7()`. Ce NU verifica varianta asta e exact lucrul cel mai valoros al
   * containerului — ca migratiile reconstruiesc baza de la zero — deci in CI
   * variabila ramane nesetata, si acolo se da verdictul.
   *
   * De stiut inainte s-o folosesti pe baza de dezvoltare: testele lasa in urma
   * randurile lor, iar cateva presupun o baza goala si pica acolo fara sa fie
   * stricate — „100 de alocari in paralel" (epuizeaza pool-ul catre Supabase) si
   * „metricile de integritate sunt zero" (baza de dev are 10.000 de linii de
   * cost din seed). Verdictul pe ele il da tot CI-ul.
   */
  const provided = process.env['TEST_DATABASE_URL'];
  if (provided !== undefined && provided !== '') {
    project.provide('databaseUrl', provided);
    return;
  }

  // Aceeasi versiune majora ca Supabase (17.6). Un test care trece pe 15 si
  // pica pe 17 e cel mai prost fel de test posibil.
  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('damina_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const url = container.getConnectionUri();

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }

  project.provide('databaseUrl', url);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}
