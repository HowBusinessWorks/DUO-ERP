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

/** Persoana in numele careia ruleaza toate testele. Vezi `helpers.ts`. */
export const TEST_PERSON_ID = '01950000-0000-7000-8000-000000000001';

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  /*
   * Aceeasi portita ca in `@damina/db`: cu `TEST_DATABASE_URL` setat, suita
   * ruleaza pe baza indicata in loc de un container efemer. Exista pentru
   * masina de dezvoltare, care n-are Docker; in CI variabila ramane nesetata,
   * si acolo se da verdictul — inclusiv pe intrebarea pe care numai containerul
   * o pune, aceea daca migratiile reconstruiesc baza de la zero.
   */
  const provided = process.env['TEST_DATABASE_URL'];
  if (provided !== undefined && provided !== '') {
    const client = new pg.Pool({
      connectionString: provided,
      max: 1,
      // Baza indicata e de obicei un Supabase la distanta, deci cu TLS — dar cu
      // lant pe care masina de dezvoltare nu-l are. Local ramane fara.
      ssl: provided.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    try {
      await client.query(
        `insert into app.persons (id, persona, category, full_name, email)
         values ($1, 'office', 'angajat', 'Actor de test', 'actor@test.local')
         on conflict do nothing`,
        [TEST_PERSON_ID],
      );
    } finally {
      await client.end();
    }
    project.provide('databaseUrl', provided);
    return;
  }

  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('damina_services_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const url = container.getConnectionUri();

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

    // Actorul testelor e o PERSOANA REALA, nu un uuid inventat.
    //
    // `component_ceilings.set_by` are cheie straina catre `app.persons` — si
    // trebuie s-o aiba: „cine a pus plafonul asta” nu poate fi un id care nu
    // corespunde nimanui. Un actor sintetic trece prin `withActor` (jurnalul de
    // audit nu are cheie straina, dinadins), dar cade la prima scriere care
    // pastreaza autorul. Harness-ul provizioneaza persoana o data, la migrare.
    await pool.query(
      `insert into app.persons (id, persona, category, full_name, email)
       values ($1, 'office', 'angajat', 'Actor de test', 'actor@test.local')
       on conflict do nothing`,
      [TEST_PERSON_ID],
    );
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
