/**
 * Sesiune, claims, guard-uri, personas.
 *
 * De ce traiesc `Actor` si `PgRole` in `@damina/db` si nu aici: `withActor` are
 * nevoie de ele, iar `db` nu are voie sa importe `auth` (ar inchide un ciclu in
 * graful de dependente). `auth` e sageata care merge spre `db`, nu invers.
 *
 * Supabase Auth si JWT hook-ul cu custom claims vin in pasul 02c si inlocuiesc
 * exclusiv `parseDevSession` — restul suprafetei ramane neschimbat.
 */
export { PG_ROLES, PG_ROLE_BY_PERSONA, isPgRole, serviceActor, SERVICE_ACTOR_ID } from '@damina/db';
export type { Actor, PgRole } from '@damina/db';

export { PERSONAS, isPersona } from '@damina/shared';
export type { Persona } from '@damina/shared';

export {
  actorFor,
  canEditNomenclature,
  canSeeFinancials,
  DEV_SESSION_COOKIE,
  hasRole,
  isOfficeRole,
  OFFICE_ROLES,
  parseDevSession,
  serializeDevSession,
} from './session';
export type { DevSessionSeed, OfficeRole, Session } from './session';
