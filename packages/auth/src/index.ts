/**
 * Sesiune, claims, guard-uri, personas.
 *
 * In pasul 01 pachetul re-exporta doar vocabularul de identitate. Supabase Auth,
 * JWT hook-ul cu custom claims si provizionarea de conturi vin in pasul 02.
 *
 * De ce traiesc `Actor` si `PgRole` in `@damina/db` si nu aici: `withActor` are
 * nevoie de ele, iar `db` nu are voie sa importe `auth` (ar inchide un ciclu in
 * graful de dependente). `auth` e sageata care merge spre `db`, nu invers.
 */
export { PG_ROLES, PG_ROLE_BY_PERSONA, isPgRole, serviceActor, SERVICE_ACTOR_ID } from '@damina/db';
export type { Actor, PgRole } from '@damina/db';

export { PERSONAS, isPersona } from '@damina/shared';
export type { Persona } from '@damina/shared';
