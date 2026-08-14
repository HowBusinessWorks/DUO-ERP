import { defineConfig } from 'drizzle-kit';
import { loadDbEnv } from './src/env';

/**
 * Migratiile ruleaza pe conexiunea de tip *session pooling* — au nevoie de
 * advisory locks si de DDL care nu suporta transaction pooling.
 *
 * `generate` nu se conecteaza nicaieri, deci nu cerem URL-ul aici; comenzile
 * care chiar ating baza (`push`, `studio`, scriptul de migrare) il valideaza.
 */
const env = loadDbEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['app'],
  casing: 'snake_case',
  dbCredentials: {
    url: env.DATABASE_URL_SESSION,
  },
  verbose: true,
  strict: true,
});
