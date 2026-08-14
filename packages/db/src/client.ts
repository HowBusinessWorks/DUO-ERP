import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadDbEnv } from './env';
import * as schema from './schema/index';

/**
 * `pooled`  — Supavisor transaction pooling. Rutele serverless (Vercel).
 * `session` — Supavisor session pooling. Worker si migratii: au nevoie de
 *             LISTEN/NOTIFY si de prepared statements.
 */
export type ConnectionMode = 'pooled' | 'session';

export type Db = NodePgDatabase<typeof schema>;

const pools = new Map<ConnectionMode, pg.Pool>();
const databases = new Map<ConnectionMode, Db>();

function createPool(mode: ConnectionMode): pg.Pool {
  const env = loadDbEnv(mode === 'session' ? { requireSession: true } : { requirePooled: true });
  const connectionString = mode === 'session' ? env.DATABASE_URL_SESSION : env.DATABASE_URL;

  return new pg.Pool({
    connectionString,
    // Supabase cere TLS, dar prezinta un lant pe care Node nu il are in store.
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    // Transaction pooling: conexiuni putine si scurte, pentru ca Vercel scaleaza
    // pe orizontala si fiecare instanta tine propriul pool.
    max: mode === 'pooled' ? 5 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: `damina-${mode}`,
  });
}

/**
 * Accesul intern la Drizzle. NU se exporta din pachet — singura poarta publica
 * spre Postgres e `withActor()` / `withServiceActor()`.
 */
export function getDb(mode: ConnectionMode = 'pooled'): Db {
  const existing = databases.get(mode);
  if (existing !== undefined) {
    return existing;
  }

  const pool = createPool(mode);
  pools.set(mode, pool);

  const db = drizzle(pool, { schema, casing: 'snake_case' });
  databases.set(mode, db);
  return db;
}

/** Inchide conexiunile. De folosit doar la oprirea worker-ului si in teste. */
export async function closeConnections(): Promise<void> {
  await Promise.all([...pools.values()].map((pool) => pool.end()));
  pools.clear();
  databases.clear();
}
