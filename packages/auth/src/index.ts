/**
 * Sesiune, claims, guard-uri, personas.
 *
 * De ce traiesc `Actor` si `PgRole` in `@damina/db` si nu aici: `withActor` are
 * nevoie de ele, iar `db` nu are voie sa importe `auth` (ar inchide un ciclu in
 * graful de dependente). `auth` e sageata care merge spre `db`, nu invers.
 *
 * Din 02c, sesiunea vine din claim-urile JWT emise de `app.custom_access_token_hook`
 * (migrarea 0013) — `sessionFromClaims`. Sesiunea de dezvoltare a ramas, dar e
 * o scara laterala explicita, nu drumul principal; vezi `apps/web/src/lib/session.ts`.
 */
export { PG_ROLES, PG_ROLE_BY_PERSONA, isPgRole, serviceActor, SERVICE_ACTOR_ID } from '@damina/db';
export type { Actor, PgRole } from '@damina/db';

export { PERSONAS, isPersona } from '@damina/shared';
export type { Persona } from '@damina/shared';

export {
  actorFor,
  DEV_SESSION_COOKIE,
  hasRole,
  isOfficeRole,
  OFFICE_ROLES,
  parseDevSession,
  serializeDevSession,
} from './session';
export type { DevSessionSeed, OfficeRole, Session } from './session';

export { sessionFromClaims } from './claims';
export type { ClaimsRejection, ClaimsResult } from './claims';

export {
  can,
  canEditNomenclature,
  canSeeFinancials,
  capabilitiesOf,
  CAPABILITIES,
  PERMISSION_MATRIX,
  requireCapability,
  requireOfficeRole,
  requirePersona,
} from './permissions';
export type { Capability, CapabilitySpec } from './permissions';
