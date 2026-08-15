import type { Actor } from '@damina/db';
import { uuidv7 } from '@damina/shared';

export function actorFor(
  persona: Actor['persona'],
  pgRole: Actor['pgRole'],
  reason?: string,
): Actor {
  return {
    personId: uuidv7(),
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
