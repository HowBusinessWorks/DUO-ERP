import type { Persona } from '@damina/shared';

/**
 * Rolurile Postgres. Toate sunt NOLOGIN — se intra in ele prin `SET LOCAL ROLE`,
 * din interiorul unei tranzactii deschise de `withActor`.
 *
 * Izolarea pretului (PLAN_TEHNIC decizia 3) traieste aici, nu in UI: `app_field`
 * nu are `SELECT` pe coloanele de pret, deci un query gresit nu poate scapa date.
 */
export const PG_ROLES = [
  'app_office',
  'app_field',
  'app_subcontractor',
  'app_client',
  'app_service',
] as const;

export type PgRole = (typeof PG_ROLES)[number];

export const PG_ROLE_BY_PERSONA: Readonly<Record<Persona, PgRole>> = Object.freeze({
  office: 'app_office',
  field: 'app_field',
  subcontractor: 'app_subcontractor',
  client: 'app_client',
});

export function isPgRole(value: string): value is PgRole {
  return (PG_ROLES as readonly string[]).includes(value);
}

/**
 * Cine face operatia. Se construieste o singura data, la marginea sistemului
 * (sesiune Next.js sau job in worker), si se plimba mai departe intact.
 */
export interface Actor {
  /** ID-ul persoanei din `app.persons`. Ajunge in audit ca autor. */
  readonly personId: string;
  readonly persona: Persona;
  readonly pgRole: PgRole;
  /** Claim-urile din JWT, citite de politicile RLS prin `request.jwt.claims`. */
  readonly claims: Readonly<Record<string, unknown>>;
  /** Motivul actiunii, cand operatia il cere (stornari, re-alocari, deblocari). */
  readonly reason?: string;
}

/**
 * Actorul tehnic al worker-ului. E un ID fix si identificabil, ca sa se vada
 * in audit ca scrierea a venit dintr-un job, nu de la un om.
 */
export const SERVICE_ACTOR_ID = '00000000-0000-7000-8000-000000000001';

export function serviceActor(jobName: string): Actor {
  return {
    personId: SERVICE_ACTOR_ID,
    persona: 'office',
    pgRole: 'app_service',
    claims: { role: 'app_service', job: jobName },
    reason: `job:${jobName}`,
  };
}
