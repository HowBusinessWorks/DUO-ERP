import type { Actor } from '@damina/db';
import { TEST_PERSON_ID } from './global-setup';

/**
 * Actorul testelor, legat de o persoana care CHIAR exista in
 * `app.persons` (provizionata de `global-setup`).
 *
 * Un `personId` inventat trece prin `withActor` si prin jurnalul de audit —
 * `audit.entries.actor_id` nu are cheie straina, dinadins, ca jurnalul sa
 * supravietuiasca stergerii persoanei. Dar `component_ceilings.set_by` are, si
 * trebuie s-o aiba. Testele care scriu plafoane au nevoie de un autor real.
 */
export function actorFor(
  persona: Actor['persona'],
  pgRole: Actor['pgRole'],
  reason?: string,
  claims: Record<string, unknown> = {},
): Actor {
  return {
    personId: TEST_PERSON_ID,
    persona,
    pgRole,
    claims,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * De la 02b (RLS) incoace, actorul de birou al testelor e ADMINISTRATOR.
 *
 * Fara rolul asta n-ar putea crea firme — politica de pe `app.companies` cere
 * explicit `admin` la scriere — iar fara `company_ids` in claim si fara randuri
 * in `person_company_access`, `app.current_company_ids()` cade pe regula
 * administratorului si intoarce tot grupul. Exact ce trebuie unui harness.
 */
export const officeActor = (reason?: string): Actor =>
  actorFor('office', 'app_office', reason, { office_roles: ['admin'] });

export const fieldActor = (companyIds: readonly string[] = []): Actor =>
  actorFor('field', 'app_field', undefined, { company_ids: companyIds });

/** Prinde respingerea unei promisiuni fara sa o transforme in esec de test. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}
