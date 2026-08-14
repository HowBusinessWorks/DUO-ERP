/**
 * Suprafata publica a pachetului.
 *
 * `pool`, `getDb` si driverul Drizzle NU apar aici, intentionat: singurul mod
 * de a atinge Postgres din afara acestui pachet e `withActor`/`withServiceActor`.
 */
export { withActor, withServiceActor } from './with-actor';
export type { ActorTx } from './with-actor';

export { PG_ROLES, PG_ROLE_BY_PERSONA, isPgRole, serviceActor, SERVICE_ACTOR_ID } from './actor';
export type { Actor, PgRole } from './actor';

export { closeConnections } from './client';
export { loadEnvFiles } from './env';

export {
  recordPing,
  countPings,
  beatHeartbeat,
  readHeartbeat,
  grantQueueAccess,
} from './jobs-runtime';
export type { PingRecord, Heartbeat } from './jobs-runtime';

export * as schema from './schema/index';
