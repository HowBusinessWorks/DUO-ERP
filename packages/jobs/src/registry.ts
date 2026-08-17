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

/**
 * `contracts.expiryScan` — scanul zilnic de contracte care expira (pasul 04,
 * §3.7). Rulare unica pe zi, deci `singletonKey` pe data: doua declansari in
 * aceeasi zi (cron + o rulare manuala) produc un singur job.
 */
export const contractExpiryScan = defineJob({
  name: 'contracts.expiryScan',
  schema: z.object({ on: z.string().optional() }),
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 10 * 60,
  singletonKey: (payload) => payload.on ?? new Date().toISOString().slice(0, 10),
});

/**
 * `contracts.deltaFillScan` — gradul de umplere a Deltei, pe 10 si pe 20.
 *
 * NU la inchidere: la inchidere venitul neumplut e deja pierdut. Vezi
 * `scanDeltaFill` din `@damina/services`.
 */
export const deltaFillScan = defineJob({
  name: 'contracts.deltaFillScan',
  schema: z.object({ on: z.string().optional() }),
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 10 * 60,
  singletonKey: (payload) => payload.on ?? new Date().toISOString().slice(0, 10),
});

/**
 * `rollup.verify` — controlul nocturn al rollup-urilor (pasul 06, §3.2).
 *
 * Rollup-ul e o suma derivata, intretinuta prin trigger. Daca trigger-ul are un
 * bug, cifra de pe ecran se abate de la registru **tacut**: nimic nu cade, doar
 * raportul incepe sa mintă. Jobul recalculeaza din registru si compara.
 *
 * Nocturn, nu la cerere: un ERP nu cade cu 500, cade cu cifre care nu se mai
 * potrivesc. Vrei sa afli in ziua in care apare, nu in luna in care o vezi in
 * factura.
 */
export const rollupVerify = defineJob({
  name: 'rollup.verify',
  schema: z.object({ on: z.string().optional(), periodId: z.string().uuid().optional() }),
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 30 * 60,
  singletonKey: (payload) => payload.periodId ?? payload.on ?? new Date().toISOString().slice(0, 10),
});

/** Toate cozile cunoscute. Worker-ul le creeaza pe toate la pornire. */
export const ALL_JOBS = [systemPing, contractExpiryScan, deltaFillScan, rollupVerify] as const;

/**
 * Cozile care ruleaza pe ceas, cu expresia lor cron. Fusul e cel al aplicatiei
 * (`APP_TIMEZONE`), nu UTC: „pe 10 la 09:00” inseamna ora Bucurestiului, si se
 * schimba cu ora de vara ca sa ramana la fel pentru oameni.
 */
export const SCHEDULED_JOBS: readonly {
  readonly name: string;
  readonly cron: string;
  readonly why: string;
}[] = [
  {
    name: contractExpiryScan.name,
    cron: '0 6 * * *',
    why: 'Zilnic la 06:00 — alerta de expirare apare inaintea programului de lucru.',
  },
  {
    name: deltaFillScan.name,
    cron: '0 9 10,20 * *',
    why: 'Pe 10 si pe 20, la 09:00. La inchidere ar fi prea tarziu: Delta neumpluta se pierde.',
  },
  {
    name: rollupVerify.name,
    cron: '0 2 * * *',
    why: 'Nocturn la 02:00, cand registrul sta linistit. O divergenta se afla a doua zi, nu peste o luna.',
  },
];

export type JobPayload<T> = T extends JobDefinition<infer P> ? P : never;
