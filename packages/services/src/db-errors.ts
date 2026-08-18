import { AppError, type AppErrorCode } from '@damina/shared';

/**
 * Traducerea erorilor din baza in `AppError`, intr-un singur loc.
 *
 * Regulile de business traiesc in triggere, iar triggerele vorbesc prin
 * `raise exception … using errcode = 'P0001'`, cu mesajul deja scris in romana.
 * Serviciile **nu rescriu** mesajul: doua formulari ale aceleiasi reguli inseamna
 * ca una din ele va ramane in urma.
 */

/**
 * SQLSTATE-ul real, de sub ambalajul Drizzle.
 *
 * `DrizzleQueryError` are ca mesaj doar „Failed query: …", deci potrivirea pe
 * text nu functioneaza. Codul din `cause` e si mai bun decat textul original: nu
 * depinde de `lc_messages`.
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

/** Mesajul original al erorii Postgres, de sub acelasi ambalaj. */
export function pgMessage(error: unknown): string {
  let current: unknown = error;
  let last = '';
  while (current instanceof Error) {
    last = current.message;
    current = current.cause;
  }
  return last;
}

export const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  INSUFFICIENT_PRIVILEGE: '42501',
  RAISED: 'P0001',
} as const;

/**
 * Prefixele pe care le ridica triggerele noastre, fiecare cu codul lui.
 *
 * Lista e inchisa dinadins: un prefix nou inventat intr-o migrare n-ar fi
 * recunoscut aici, si eroarea ar urca neimblanzita — ceea ce e mai bine decat
 * sa fie tradusa gresit.
 */
const RAISED_PREFIXES: readonly (readonly [string, AppErrorCode])[] = [
  ['PERIOD_CLOSED', 'PERIOD_CLOSED'],
  ['AUTHORIZATION_EXPIRED', 'AUTHORIZATION_EXPIRED'],
  ['QUANTITY_EXCEEDS_CONTRACT', 'QUANTITY_EXCEEDS_CONTRACT'],
  ['PRICE_FORBIDDEN', 'PRICE_FORBIDDEN'],
  ['VALIDATION_FAILED', 'VALIDATION_FAILED'],
  ['CONFLICT', 'CONFLICT'],
  ['NOT_FOUND', 'NOT_FOUND'],
  ['FORBIDDEN', 'FORBIDDEN'],
  /*
   * Pasul 09. Prefixul nu mai e identic cu codul, si e dinadins: mesajul din
   * baza numeste REGULA incalcata („stoc insuficient", „punctul n-are ieșire"),
   * ceea ce face un log de Postgres citibil fara sa deschizi codul. Traducerea
   * spre cele opt coduri se face aici, in singurul loc unde se face oricum.
   */
  ['STOCK_INSUFFICIENT', 'CONFLICT'],
  ['FINDING_REQUIRED', 'VALIDATION_FAILED'],
  ['PHOTO_REQUIRED', 'VALIDATION_FAILED'],
];

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Ridica `AppError` pentru erorile pe care le cunoastem, si lasa restul sa urce.
 *
 * Se cheama din `catch`, deci intoarce `never`: apelantul nu are ce sa faca cu o
 * valoare de retur.
 */
export function translateDbError(error: unknown): never {
  if (sqlstate(error) === SQLSTATE.RAISED) {
    const message = pgMessage(error);
    for (const [prefix, code] of RAISED_PREFIXES) {
      if (message.startsWith(`${prefix}:`)) {
        throw new AppError(code, capitalize(message.slice(prefix.length + 1).trim()));
      }
    }
  }
  throw error;
}
