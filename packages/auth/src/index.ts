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
 *
 * Bariera asta aduce si `@damina/db`, deci **nu se poate importa din
 * middleware**, care ruleaza pe Edge. Pentru el exista `@damina/auth/edge`, cu
 * tot ce nu atinge baza de date. Fisierul de fata reexporta totul, ca sa nu
 * existe doua adrese pentru acelasi lucru in codul de server.
 */
export { PG_ROLES, PG_ROLE_BY_PERSONA, isPgRole, serviceActor, SERVICE_ACTOR_ID } from '@damina/db';
export type { Actor, PgRole } from '@damina/db';

export { actorFor } from './actor';

export * from './edge';
