import { z } from 'zod';
import { businessDateSchema, moneySchema, quantitySchema, uuidSchema } from './primitives';
import { createWorkUnitInputSchema } from './work-units';

/**
 * Cererile, evaluarea si decizia de rutare (pasul 08).
 *
 * `decideRoutingInputSchema` e forma in care se citeste regula 2 din plan:
 * decizia creeaza atomic UL + alocare + legatura, sau — pentru `amanata_backlog`
 * — creeaza propunerea de backlog. Niciodata ambele, niciodata nici una.
 * `creation` reutilizeaza `createWorkUnitInputSchema` intreg, ca sa nu existe
 * doua validari pentru „cum arata o unitate de lucru nou-creata".
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);
const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);
/**
 * Optionalele formularului de cerere trebuie sa fie IDEMPOTENTE: aceeasi schema
 * ruleaza de doua ori pe acelasi obiect — o data in browser (react-hook-form,
 * care trimite mai departe valorile DEJA transformate) si o data in server
 * action. Daca ar accepta doar `''`, a doua trecere ar primi `null`-ul produs de
 * prima si ar cadea cu „Invalid input" pe un formular corect completat.
 */
const emptyish = z.union([z.literal(''), z.null(), z.undefined()]);
const optionalUuid = uuidSchema.or(emptyish).transform((v) => (v === '' || v == null ? null : v));
const optionalMoney = moneySchema.or(emptyish).transform((v) => (v === '' || v == null ? null : v));
const optionalDate = businessDateSchema
  .or(emptyish)
  .transform((v) => (v === '' || v == null ? null : v));
const optionalDateTime = z
  .string()
  .datetime()
  .or(emptyish)
  .transform((v) => (v === '' || v == null ? null : v));

export const REQUEST_TYPES = [
  'tichet_client',
  'solicitare',
  'constatare_inspectie',
  'propunere_interna',
  'solicitare_utilaj',
  'observatie_utilaj',
] as const;

export const REQUEST_TYPE_LABELS: Readonly<Record<(typeof REQUEST_TYPES)[number], string>> = {
  tichet_client: 'Tichet client',
  solicitare: 'Solicitare internă',
  constatare_inspectie: 'Constatare din inspecție',
  propunere_interna: 'Propunere internă',
  solicitare_utilaj: 'Solicitare utilaj',
  observatie_utilaj: 'Observație utilaj',
};

export const REQUEST_SOURCES = ['email', 'manual', 'fisa_inspectie', 'utilaj'] as const;

export const REQUEST_STATUSES = [
  'neprocesata',
  'in_evaluare',
  'decisa',
  'in_backlog',
  'respinsa',
  'anulata',
] as const;

export const REQUEST_STATUS_LABELS: Readonly<Record<(typeof REQUEST_STATUSES)[number], string>> =
  {
    neprocesata: 'Neprocesată',
    in_evaluare: 'În evaluare',
    decisa: 'Decisă',
    in_backlog: 'În backlog',
    respinsa: 'Respinsă',
    anulata: 'Anulată',
  };

export const ROUTING_CHOICES = [
  'interventie_mentenanta',
  'lucrare_delta',
  'lucrare_delta_multi_luna',
  'lucrare_componenta_lucrari',
  'contract_individual_nou',
  'amanata_backlog',
] as const;

export const ROUTING_CHOICE_LABELS: Readonly<Record<(typeof ROUTING_CHOICES)[number], string>> = {
  interventie_mentenanta: 'Intervenție pe Mentenanță',
  lucrare_delta: 'Lucrare pe Deltă (1 lună)',
  lucrare_delta_multi_luna: 'Lucrare pe Deltă (2–3 luni)',
  lucrare_componenta_lucrari: 'Lucrare pe componenta Lucrări',
  contract_individual_nou: 'Contract individual nou',
  amanata_backlog: 'Amânare → backlog',
};

/** Cererea insasi, la creare (din inbox de email sau manual). */
export const createRequestInputSchema = z.object({
  companyId: uuidSchema,
  type: z.enum(REQUEST_TYPES),
  source: z.enum(REQUEST_SOURCES),
  objectiveId: optionalUuid,
  contractId: optionalUuid,
  contractObjectiveId: optionalUuid,
  title: requiredText(300, 'Scrie un titlu.'),
  description: trimmed(5000).nullish(),
  estimatedValue: optionalMoney,
  slaDueAt: optionalDateTime,
});

/** O linie de evaluare: operatiune din catalog × cantitate. */
export const requestEstimateLineInputSchema = z.object({
  operationId: uuidSchema,
  quantity: quantitySchema,
});

/** Ce se creeaza atunci cand alegerea NU e `amanata_backlog`. */
const routingCreationSchema = createWorkUnitInputSchema;

/** Ce se creeaza cand alegerea E `amanata_backlog`. */
const routingBacklogSchema = z.object({
  objectiveId: uuidSchema,
  contractId: uuidSchema,
  title: requiredText(300),
  estimatedValue: moneySchema,
  validUntil: optionalDate,
});

/**
 * Decizia de rutare. Regula 3 din pas: `reason` obligatoriu si nevid — se
 * salveaza pe `request_decisions`, iar pentru `amanata_backlog` NU exista
 * fundingAllocationInputSchema (care cere motiv propriu), deci `reason` de aici
 * e singurul.
 *
 * `contract_individual_nou` cere si el `creation`, si asta NU e o scapare:
 * contractul individual se creeaza INAINTE de decizie, prin fluxul de contracte
 * din pasul 04, iar decizia doar leaga unitatea de lucru de componenta lui.
 * Alegerea din ecran e „lucrarea se plateste dintr-un contract individual", nu
 * „creeaza-mi acum un contract" — altfel decizia de rutare ar ajunge sa scrie
 * contracte, si atunci ar exista doua drumuri de creare de contract.
 */
export const decideRoutingInputSchema = z
  .object({
    requestId: uuidSchema,
    choice: z.enum(ROUTING_CHOICES),
    systemProposal: z.enum(ROUTING_CHOICES),
    reason: requiredText(500, 'Scrie de ce ai decis asa.'),
    creation: routingCreationSchema.optional(),
    backlog: routingBacklogSchema.optional(),
  })
  .refine((v) => (v.choice === 'amanata_backlog' ? v.backlog !== undefined : v.creation !== undefined), {
    message:
      'Amânarea cere datele propunerii de backlog; orice altă alegere cere datele unității de lucru.',
    path: ['choice'],
  });

/** Promovarea din backlog (§0): mai multe propuneri → UL-uri, o singura tranzactie. */
export const promoteBacklogInputSchema = z.object({
  proposalIds: z.array(uuidSchema).min(1, 'Alege cel puțin o propunere.'),
  /** Seria din care se ia codul UL-urilor create. */
  series: requiredText(20, 'Alege seria de numerotare.'),
  /** Contractul si componenta si luna din care se plătesc — toate promovările din același apel. */
  contractId: uuidSchema,
  componentId: uuidSchema,
  periodId: uuidSchema,
  reason: requiredText(500, 'Scrie de ce promovezi acum.'),
  /**
   * Confirmarea constienta a depasirii de plafon (verificarea #16).
   *
   * Implicit `false`: promovarea care nu incape in plafonul lunii cade cu
   * `CONFLICT` si spune CU CAT se depaseste. Cu `true` trece — pentru ca uneori
   * depasirea e decizia corecta, dar atunci trebuie sa fie o decizie luata, nu
   * un plafon depasit tacut.
   */
  acceptOverCeiling: z.boolean().default(false),
});

export type CreateRequestInput = z.input<typeof createRequestInputSchema>;
export type RequestEstimateLineInput = z.input<typeof requestEstimateLineInputSchema>;
export type DecideRoutingInput = z.input<typeof decideRoutingInputSchema>;
export type PromoteBacklogInput = z.input<typeof promoteBacklogInputSchema>;

/**
 * Trierea unei cereri din inbox (§3.5, „ținta e 30 de secunde per email").
 *
 * Nu creeaza nimic: cererea exista deja — a intrat prin email sau a fost scrisa
 * de mana — si trierea ii completeaza obiectivul, contractul, tipul si valoarea
 * estimata, apoi o trece in `in_evaluare`. De aceea `requestId` e obligatoriu si
 * `companyId`/`source` lipsesc: firma si sursa unei cereri nu se schimba la
 * triere, iar un formular care le-ar oferi ar invita exact asta.
 */
export const triageRequestInputSchema = z.object({
  requestId: uuidSchema,
  type: z.enum(REQUEST_TYPES),
  objectiveId: optionalUuid,
  contractId: optionalUuid,
  contractObjectiveId: optionalUuid,
  title: requiredText(300, 'Scrie un titlu.'),
  description: trimmed(5000).nullish(),
  estimatedValue: optionalMoney,
});

/** Evaluarea: liniile din catalog care produc valoarea estimata (verificarea #5). */
export const evaluateRequestInputSchema = z.object({
  requestId: uuidSchema,
  lines: z.array(requestEstimateLineInputSchema),
});

export type TriageRequestInput = z.input<typeof triageRequestInputSchema>;
export type EvaluateRequestInput = z.input<typeof evaluateRequestInputSchema>;
