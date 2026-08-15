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
): Actor {
  return {
    personId: TEST_PERSON_ID,
    persona,
    pgRole,
    claims: {},
    ...(reason === undefined ? {} : { reason }),
  };
}

export const officeActor = (reason?: string): Actor => actorFor('office', 'app_office', reason);
export const fieldActor = (): Actor => actorFor('field', 'app_field');

/** Prinde respingerea unei promisiuni fara sa o transforme in esec de test. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}
