import { z } from 'zod';

/**
 * Definitia tipata a unei cozi.
 *
 * Reguli de operare valabile din prima zi (PLAN_TEHNIC §10.4):
 *   - idempotenta prin `singletonKey` derivat din payload — un retry nu produce
 *     un al doilea PDF;
 *   - retry exponential, maximum 5 incercari, apoi dead-letter cu alerta.
 */
export interface JobDefinition<TPayload> {
  readonly name: string;
  readonly schema: z.ZodType<TPayload>;
  readonly retryLimit: number;
  readonly retryDelaySeconds: number;
  readonly retryBackoff: boolean;
  readonly expireInSeconds: number;
  /** Cheia de idempotenta, derivata din payload. Doua joburi cu aceeasi cheie = unul singur. */
  readonly singletonKey?: (payload: TPayload) => string;
}

export function defineJob<TPayload>(
  definition: Omit<
    JobDefinition<TPayload>,
    'retryLimit' | 'retryDelaySeconds' | 'retryBackoff' | 'expireInSeconds'
  > &
    Partial<
      Pick<
        JobDefinition<TPayload>,
        'retryLimit' | 'retryDelaySeconds' | 'retryBackoff' | 'expireInSeconds'
      >
    >,
): JobDefinition<TPayload> {
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(definition.name)) {
    throw new Error(
      `Nume de coada invalid: "${definition.name}". Format asteptat: "domeniu.actiune".`,
    );
  }

  return {
    retryLimit: 5,
    retryDelaySeconds: 15,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
    ...definition,
  };
}

/**
 * `system.ping` — singura coada din pasul 01. Exista ca sa validam lantul
 * complet: enqueue tranzactional -> worker -> scriere in baza.
 * Cozile reale (files.derive, reports.monthly, mail.ingest...) vin in pasii lor.
 */
export const systemPing = defineJob({
  name: 'system.ping',
  schema: z.object({
    note: z.string().max(200).optional(),
    requestedAt: z.string().datetime().optional(),
  }),
  retryLimit: 3,
  retryDelaySeconds: 5,
  expireInSeconds: 60,
});

/** Toate cozile cunoscute. Worker-ul le creeaza pe toate la pornire. */
export const ALL_JOBS = [systemPing] as const;

export type JobPayload<T> = T extends JobDefinition<infer P> ? P : never;
