import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Postgres efemer pentru testele de use-case.
 *
 * De ce un container separat de cel din `packages/db`: testele de acolo verifica
 * ce impune BAZA (constrangeri, triggere, grant-uri) si nu au voie sa vada
 * stratul de servicii — `db` nu poate importa `services` fara sa inchida un
 * ciclu de dependente. Testele de aici verifica exact partea pe care baza nu o
 * poate garanta singura: ca `createContract` chiar genereaza anii, ca plafonul
 * cere motiv si la creare, ca alertele nu se dubleaza.
 *
 * Migrarile sunt aceleasi, luate din `packages/db`: nu exista o a doua schema.
 */
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('damina_services_test')
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
