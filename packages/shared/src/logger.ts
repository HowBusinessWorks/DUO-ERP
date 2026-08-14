import { pino, type Logger } from 'pino';

/**
 * Log-uri JSON structurate (PLAN_TEHNIC §14).
 *
 * Campurile obligatorii pe orice linie care descrie o operatie:
 * `request_id`, `actor_id`, `use_case`, `duration_ms`. Fara ele, un log din
 * productie nu se poate corela cu nimic.
 *
 * Se importa din `@damina/shared/logger`, nu din indexul pachetului: pino nu
 * are ce cauta intr-un bundle de browser.
 */
export interface LogContext {
  request_id?: string;
  actor_id?: string;
  use_case?: string;
  [key: string]: unknown;
}

const level = process.env['LOG_LEVEL'] ?? 'info';

export const logger: Logger = pino({
  level,
  base: { service: process.env['SERVICE_NAME'] ?? 'damina' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password',
      '*.password',
      'authorization',
      '*.authorization',
      'token',
      '*.token',
      'claims.email',
    ],
    censor: '[redactat]',
  },
});

export function childLogger(context: LogContext): Logger {
  return logger.child(context);
}

/**
 * Masoara o operatie si o scrie cu durata. Erorile se logheaza si se re-arunca —
 * decizia ce se face cu ele apartine apelantului.
 */
export async function logged<T>(
  context: LogContext & { use_case: string },
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    logger.info({ ...context, duration_ms: Date.now() - started }, 'ok');
    return result;
  } catch (error) {
    logger.error({ ...context, duration_ms: Date.now() - started, err: error }, 'esec');
    throw error;
  }
}

export type { Logger } from 'pino';
