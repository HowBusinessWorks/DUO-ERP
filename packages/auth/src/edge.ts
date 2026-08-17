/**
 * Jumatatea din `@damina/auth` care poate rula oriunde.
 *
 * ── De ce exista punctul asta de intrare ────────────────────────────────────
 *
 * Middleware-ul Next ruleaza pe Edge, un runtime fara `node:fs`. Bariera
 * obisnuita (`@damina/auth`) reexporta si `Actor`, `PG_ROLES`, `serviceActor` —
 * adica `@damina/db`, adica driverul de Postgres, adica `node:fs`. La 02c′,
 * cand middleware-ul a avut nevoie de `mfaSatisfied` ca sa opreasca un `admin`
 * pe `aal1`, build-ul a cazut exact acolo.
 *
 * Ce e aici: claim-uri, sesiune, matricea de drepturi, limitatorul de
 * incercari. Toate sunt functii pure peste date deja citite — nu ating nici
 * baza, nici reteaua, nici framework-ul.
 *
 * Ce NU e aici: `actorFor`. El traduce sesiunea in rol Postgres si claim-uri
 * pentru RLS, deci apartine serverului prin definitie.
 *
 * Regula, pe scurt: **middleware-ul importa din `@damina/auth/edge`, restul din
 * `@damina/auth`.** A doua bariera n-o inlocuieste pe prima; o taie in doua pe
 * granita care exista oricum.
 */

export { PERSONAS, isPersona } from '@damina/shared';
export type { Persona } from '@damina/shared';

export {
  DEV_SESSION_COOKIE,
  hasRole,
  isAuthenticatorLevel,
  isOfficeRole,
  OFFICE_ROLES,
  parseDevSession,
  serializeDevSession,
} from './session';
export type { AuthenticatorLevel, DevSessionSeed, OfficeRole, Session } from './session';

export { sessionFromClaims } from './claims';
export type { ClaimsRejection, ClaimsResult } from './claims';

export {
  can,
  canEditNomenclature,
  canSeeFinancials,
  capabilitiesOf,
  CAPABILITIES,
  grantsCapability,
  MFA_REQUIRED_ROLES,
  mfaBypassed,
  mfaSatisfied,
  PERMISSION_MATRIX,
  requireCapability,
  requireMfa,
  requireOfficeRole,
  requirePersona,
  requiresMfa,
  rolesRequireMfa,
} from './permissions';
export type { Capability, CapabilitySpec } from './permissions';

export { createRateLimiter } from './rate-limit';
export type { RateLimiter, RateLimitOptions, RateLimitVerdict } from './rate-limit';
