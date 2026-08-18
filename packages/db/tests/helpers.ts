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

/**
 * Ce se pune in `request.jwt.claims`. De la 02b incoace conteaza: politicile
 * RLS citesc de acolo, deci un actor de test fara claim-uri vede exact ce vede
 * un utilizator fara drepturi — adica nimic.
 */
export interface ActorOptions {
  readonly reason?: string;
  readonly personId?: string;
  /** Firmele vizibile. Lipsa lor + rol `admin` = tot grupul (vezi `0011`). */
  readonly companyIds?: readonly string[];
  readonly officeRoles?: readonly string[];
}

export function actorFor(
  persona: Actor['persona'],
  pgRole: Actor['pgRole'],
  options: ActorOptions = {},
): Actor {
  const personId = options.personId ?? uuidv7();
  return {
    personId,
    persona,
    pgRole,
    claims: {
      ...(options.officeRoles === undefined ? {} : { office_roles: options.officeRoles }),
      ...(options.companyIds === undefined ? {} : { company_ids: options.companyIds }),
    },
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
}

/**
 * Biroul din teste e ADMINISTRATOR, si asta nu e comoditate: fara rolul de
 * admin n-ar putea crea firme (politica `office` de pe `app.companies` cere
 * explicit rolul), iar fara firme n-ar avea ce testa. Testele care verifica ce
 * NU poate face un birou obisnuit isi construiesc actorul lor.
 */
export const officeActor = (
  reason?: string,
  options: Omit<ActorOptions, 'reason'> = {},
): Actor =>
  actorFor('office', 'app_office', {
    officeRoles: ['admin'],
    ...options,
    ...(reason === undefined ? {} : { reason }),
  });

export const fieldActor = (options: Omit<ActorOptions, 'reason' | 'officeRoles'> = {}): Actor =>
  actorFor('field', 'app_field', options);

/** SQLSTATE-urile pe care le asteptam explicit in teste. */
export const SQLSTATE = {
  /** raise exception ... using errcode = 'P0001' */
  RAISED: 'P0001',
  /** violare de CHECK */
  CHECK_VIOLATION: '23514',
  /** violare de UNIQUE (constrangere sau index unic partial) */
  UNIQUE_VIOLATION: '23505',
  /** violare de constrangere EXCLUDE */
  EXCLUSION_VIOLATION: '23P01',
  /** privilegiu insuficient */
  INSUFFICIENT_PRIVILEGE: '42501',
  /** `raise ... using errcode = 'restrict_violation'` — guard-uri de trigger */
  RESTRICT_VIOLATION: '23001',
} as const;
