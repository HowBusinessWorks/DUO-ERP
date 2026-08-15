import { uuidv7 } from '@damina/shared';
import type { Actor } from '../src/index';

/**
 * Codul SQLSTATE real al unei erori venite prin Drizzle.
 *
 * Drizzle imbraca erorile driverului intr-un `DrizzleQueryError` al carui mesaj
 * e doar "Failed query: ...", deci potrivirea pe text nu functioneaza. Codul din
 * `cause` e si mai bun decat textul original: nu depinde de `lc_messages`.
 */
export function sqlstate(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code } = current as Error & { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
    current = current.cause;
  }
  return undefined;
}

/** Mesajul original al erorii Postgres, de sub ambalajul Drizzle. */
export function pgMessage(error: unknown): string {
  let current: unknown = error;
  let last = '';
  while (current instanceof Error) {
    last = current.message;
    current = current.cause;
  }
  return last;
}

/** Prinde respingerea unei promisiuni fara sa o transforme in esec de test. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

export function actorFor(
  persona: Actor['persona'],
  pgRole: Actor['pgRole'],
  reason?: string,
): Actor {
  const personId = uuidv7();
  return {
    personId,
    persona,
    pgRole,
    claims: {},
    ...(reason === undefined ? {} : { reason }),
  };
}

export const officeActor = (reason?: string): Actor => actorFor('office', 'app_office', reason);
export const fieldActor = (): Actor => actorFor('field', 'app_field');

/** SQLSTATE-urile pe care le asteptam explicit in teste. */
export const SQLSTATE = {
  /** raise exception ... using errcode = 'P0001' */
  RAISED: 'P0001',
  /** violare de CHECK */
  CHECK_VIOLATION: '23514',
  /** violare de constrangere EXCLUDE */
  EXCLUSION_VIOLATION: '23P01',
  /** privilegiu insuficient */
  INSUFFICIENT_PRIVILEGE: '42501',
} as const;
