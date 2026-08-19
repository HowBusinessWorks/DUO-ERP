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
  /*
   * `domeniu.actiune`, cu actiunea eventual in camelCase — `contracts.expiryScan`.
   *
   * Verificarea a fost pana la 07b `[a-z0-9]` pe fiecare segment, deci respingea
   * exact doua din cozile definite mai jos, adaugate la pasul 04. Fiindca
   * `defineJob` ruleaza la INCARCAREA modulului, `import '@damina/jobs'` arunca
   * — adica worker-ul nu mai pornea deloc. N-a observat nimeni pentru ca nimic
   * din ce ruleaza in CI nu importa pachetul; s-a vazut abia cand `files.ts` l-a
   * adus in lantul de import al serviciilor.
   */
  if (!/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(definition.name)) {
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
  singletonKey: (payload) =>
    payload.periodId ?? payload.on ?? new Date().toISOString().slice(0, 10),
});

/*
 * Prelucrarea unui fisier proaspat urcat: EXIF, geotag, miniaturi (pasul 07).
 *
 * Coada cu cel mai mare debit din ERP — mii de poze de teren lunar. De aceea are
 * `singletonKey` pe versiune: un retry, sau doua apeluri de `complete` pentru
 * acelasi upload, nu produc doua seturi de miniaturi.
 */
/*
 * Controlul nocturn al soldurilor de stoc (pasul 09, verificarea #18).
 *
 * `stock_balances` e un rollup intretinut de trigger, iar un rollup ramas in
 * urma nu rupe nimic — doar minte. Coada asta il recalculeaza din miscari si
 * ridica alerta pe gestiunea divergenta.
 */
export const inventoryVerifyStock = defineJob({
  name: 'inventory.verifyStock',
  schema: z.object({}).passthrough(),
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 30 * 60,
  singletonKey: () => new Date().toISOString().slice(0, 10),
});

/*
 * Retentia jurnalului de mutatii de teren (pasul 10, §3.2).
 *
 * 90 de zile. Un dispozitiv care revine dupa atat isi pierde memoria de
 * idempotenta si face pull complet — comportament documentat, nu accidental.
 */
export const fieldPruneMutations = defineJob({
  name: 'field.pruneMutations',
  schema: z.object({ days: z.number().int().positive().max(3650).optional() }),
  retryLimit: 2,
  retryDelaySeconds: 600,
  expireInSeconds: 15 * 60,
  singletonKey: () => new Date().toISOString().slice(0, 10),
});

export const filesDerive = defineJob({
  name: 'files.derive',
  schema: z.object({ versionId: z.string().uuid() }),
  retryLimit: 3,
  retryDelaySeconds: 30,
  expireInSeconds: 10 * 60,
  singletonKey: (payload) => payload.versionId,
});

/**
 * Curatenia nocturna: uploaduri abandonate, parti multipart orfane, noduri din
 * cosul golit acum peste 30 de zile.
 *
 * Nu e o comoditate, e o factura: partile multipart neterminate se platesc lunar
 * pana cand le sterge cineva.
 */
export const filesCleanup = defineJob({
  name: 'files.cleanup',
  schema: z.object({ on: z.string().optional() }),
  retryLimit: 2,
  retryDelaySeconds: 600,
  expireInSeconds: 30 * 60,
  singletonKey: (payload) => payload.on ?? new Date().toISOString().slice(0, 10),
});

/**
 * `requests.expireBacklog` — propunerile din backlog cu `valid_until` depasit
 * trec in `expired` (pasul 08, §3.6).
 *
 * **Nu se sterg.** O propunere expirata ramane vizibila cu filtru: e istoria
 * lucrurilor pe care firma le-a vazut si nu le-a facut la timp, iar cifra aia
 * spune ceva. Stergerea ar face backlogul sa arate mai curat decat este.
 */
export const requestsExpireBacklog = defineJob({
  name: 'requests.expireBacklog',
  schema: z.object({ on: z.string().optional() }),
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 10 * 60,
  singletonKey: (payload) => payload.on ?? new Date().toISOString().slice(0, 10),
});

/**
 * `reports.monthly` — generarea raportului lunar catre client (pasul 10, §3.6).
 *
 * `singletonKey` pe RAPORT, nu pe zi: doua apasari pe „Generează" nu produc doua
 * PDF-uri si nu consuma de doua ori sute de poze (verificarea #26). Cheia e
 * versiunea ceruta, ca o regenerare dupa inghet sa nu fie inghitita ca duplicat
 * al celei dinainte.
 *
 * `expireInSeconds` e generos: 312 poze inseamna minute, nu secunde, iar un job
 * expirat la jumatate ar lasa raportul in `building` pe vecie.
 */
export const reportsMonthly = defineJob({
  name: 'reports.monthly',
  schema: z.object({
    reportId: z.string().uuid(),
    version: z.number().int().positive(),
    requestedBy: z.string().uuid().optional(),
  }),
  retryLimit: 3,
  retryDelaySeconds: 60,
  expireInSeconds: 60 * 60,
  singletonKey: (payload) => `${payload.reportId}:${String(payload.version)}`,
});

/** Toate cozile cunoscute. Worker-ul le creeaza pe toate la pornire. */
export const ALL_JOBS = [
  systemPing,
  contractExpiryScan,
  deltaFillScan,
  rollupVerify,
  inventoryVerifyStock,
  fieldPruneMutations,
  filesDerive,
  filesCleanup,
  requestsExpireBacklog,
  reportsMonthly,
] as const;

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
  {
    name: requestsExpireBacklog.name,
    cron: '0 5 * * *',
    why: 'Zilnic la 05:00, inaintea alertelor de contract — backlogul e deja curat cand se uita cineva la el.',
  },
  {
    name: inventoryVerifyStock.name,
    cron: '0 4 * * *',
    why: 'Nocturn la 04:00, dupa curatenia de fisiere. Un sold divergent se afla a doua zi dimineata, nu la inventarul de la anul.',
  },
  {
    name: fieldPruneMutations.name,
    cron: '0 1 * * 0',
    why: 'Duminica la 01:00. Retentia e de 90 de zile: nu are de ce sa fie zilnica, si tabela e cea mai scrisa din ERP.',
  },
  {
    name: filesCleanup.name,
    cron: '30 3 * * *',
    why: 'Nocturn la 03:30, dupa verificarea de rollup-uri. Partile multipart orfane se platesc lunar.',
  },
];

export type JobPayload<T> = T extends JobDefinition<infer P> ? P : never;
