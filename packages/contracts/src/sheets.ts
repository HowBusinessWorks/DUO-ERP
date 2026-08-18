import { z } from 'zod';
import { businessDateSchema, moneySchema, quantitySchema, uuidSchema } from './primitives';

/**
 * Fisele de lucru, pontajul si gestiunile (pasul 09).
 *
 * Doua lucruri se citesc direct din forma schemelor, si amandoua sunt reguli ale
 * pasului:
 *
 *   1. **`effectDate` nu se trimite la completare, ci la VALIDARE.** De aceea
 *      apare in `validateInspectionInputSchema` si `validateInterventionInput
 *      Schema`, si nu apare in schemele de completare. O fisa in lucru nu are
 *      inca luna de raportare.
 *   2. **Fiecare NOK are iesire obligatorie.** `inspectionAnswerInputSchema` o
 *      cere prin `refine`, inainte ca trigger-ul din baza sa fie nevoit s-o
 *      refuze. Adevarul ramane in baza; aici doar se spune mai devreme.
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);
const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);
const optionalUuid = uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v));
const optionalMoney = moneySchema.or(z.literal('')).transform((v) => (v === '' ? null : v));
const optionalText = (max: number): z.ZodType<string | null> =>
  trimmed(max)
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v));

export const CHECKLIST_ANSWERS = ['ok', 'nok', 'na'] as const;

export const CHECKLIST_ANSWER_LABELS: Readonly<
  Record<(typeof CHECKLIST_ANSWERS)[number], string>
> = {
  ok: 'OK',
  nok: 'NOK',
  na: 'Nu se aplică',
};

export const FINDING_OUTCOMES = ['rezolvat_pe_loc', 'interventie', 'propunere'] as const;

export const FINDING_OUTCOME_LABELS: Readonly<Record<(typeof FINDING_OUTCOMES)[number], string>> =
  {
    rezolvat_pe_loc: 'Rezolvat pe loc',
    interventie: 'Creează intervenție',
    propunere: 'Propunere pentru mai târziu',
  };

// ── Inspectia ────────────────────────────────────────────────────────────────

/**
 * Deschiderea fisei. `checklistId` NU se trimite: se citeste din profilul de
 * inspectie al legaturii contract↔obiectiv (verificarile #1 si #2). Un ecran
 * care l-ar putea trimite ar putea trimite si altul decat cel din profil, iar
 * atunci „acelasi obiectiv, alt contract, alt checklist" ar depinde de UI.
 */
export const createInspectionInputSchema = z.object({
  companyId: uuidSchema,
  objectiveId: uuidSchema,
  contractObjectiveId: uuidSchema,
  name: requiredText(300, 'Scrie o denumire.'),
  series: requiredText(20, 'Alege seria de numerotare.'),
  performedOn: businessDateSchema,
  performedBy: optionalUuid,
  responsiblePersonId: optionalUuid,
  /** Cand profilul are mai multe fise, ecranul alege una dintre ELE. */
  checklistId: optionalUuid,
});

/** Iesirea obligatorie a unui NOK. Regula 1 din pas. */
export const inspectionFindingInputSchema = z
  .object({
    outcome: z.enum(FINDING_OUTCOMES),
    resolutionNote: optionalText(2000),
    estimatedValue: optionalMoney,
    /** Doar pentru `propunere`: pana cand mai e valabila in backlog. */
    validUntil: businessDateSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
  })
  .refine((v) => v.outcome !== 'rezolvat_pe_loc' || (v.resolutionNote?.length ?? 0) > 0, {
    message: 'Scrie ce ai făcut pe loc.',
    path: ['resolutionNote'],
  })
  .refine((v) => v.outcome !== 'propunere' || v.estimatedValue !== null, {
    message: 'O propunere are nevoie de o valoare estimată.',
    path: ['estimatedValue'],
  });

/**
 * Un punct completat, cu iesirea lui daca e NOK.
 *
 * `finding` e obligatoriu exact atunci cand raspunsul e `nok`. Trigger-ul din
 * baza spune acelasi lucru; aici se spune inainte ca omul sa apese Validează.
 */
export const inspectionAnswerInputSchema = z
  .object({
    checklistItemId: uuidSchema,
    answer: z.enum(CHECKLIST_ANSWERS),
    note: optionalText(2000),
    photoNodeId: optionalUuid,
    finding: inspectionFindingInputSchema.optional(),
  })
  .refine((v) => (v.answer === 'nok') === (v.finding !== undefined), {
    message: 'Fiecare punct NOK are o ieșire obligatorie, și doar punctele NOK au.',
    path: ['finding'],
  });

export const saveInspectionInputSchema = z.object({
  workUnitId: uuidSchema,
  answers: z.array(inspectionAnswerInputSchema),
});

/** Validarea de birou. `effectDate` se seteaza AICI — regula 2 din pas. */
export const validateInspectionInputSchema = z.object({
  workUnitId: uuidSchema,
  effectDate: businessDateSchema,
});

// ── Interventia ──────────────────────────────────────────────────────────────

export const interventionMaterialInputSchema = z.object({
  productId: uuidSchema,
  lotId: optionalUuid,
  quantity: quantitySchema,
  locationId: uuidSchema,
});

export const interventionHourInputSchema = z.object({
  personId: uuidSchema,
  hours: quantitySchema,
  workDate: businessDateSchema,
});

export const createInterventionInputSchema = z.object({
  companyId: uuidSchema,
  objectiveId: uuidSchema,
  contractObjectiveId: optionalUuid,
  name: requiredText(300, 'Scrie o denumire.'),
  series: requiredText(20, 'Alege seria de numerotare.'),
  performedOn: businessDateSchema,
  description: optionalText(5000),
  operationId: optionalUuid,
  teamId: optionalUuid,
  sourceRequestId: optionalUuid,
  responsiblePersonId: optionalUuid,
  /** Finantarea, obligatorie de la primul rand pentru o interventie (pasul 05). */
  fundingContractId: uuidSchema,
  fundingComponentId: uuidSchema,
  fundingPeriodId: uuidSchema,
  fundingAmount: moneySchema,
  fundingReason: requiredText(500, 'Scrie de ce se plătește de acolo.'),
});

/** Completarea fisei pe teren: materiale, ore, descriere. Inlocuieste liniile. */
export const saveInterventionInputSchema = z.object({
  workUnitId: uuidSchema,
  description: optionalText(5000),
  operationId: optionalUuid,
  teamId: optionalUuid,
  declaredHours: quantitySchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
  materials: z.array(interventionMaterialInputSchema),
  hours: z.array(interventionHourInputSchema),
});

/**
 * Validarea: **o singura tranzactie** care produce bonul de consum, miscarile de
 * stoc, liniile de cost si `operation_actuals` — sau niciunul (regula 8).
 */
export const validateInterventionInputSchema = z.object({
  workUnitId: uuidSchema,
  effectDate: businessDateSchema,
  /** Seria bonului de consum emis pentru materiale. */
  consumptionSeries: requiredText(20, 'Alege seria bonului de consum.'),
});

// ── Pontajul ─────────────────────────────────────────────────────────────────

export const timesheetLineInputSchema = z.object({
  workUnitId: uuidSchema,
  stageId: optionalUuid,
  hours: quantitySchema,
});

export const saveTimesheetInputSchema = z.object({
  companyId: uuidSchema,
  personId: uuidSchema,
  workDate: businessDateSchema,
  lines: z.array(timesheetLineInputSchema).min(1, 'Pontajul are nevoie de cel puțin o linie.'),
});

/** Validarea in masa, pe saptamana. Rate card-ul se ingheata aici. */
export const validateTimesheetsInputSchema = z.object({
  timesheetIds: z.array(uuidSchema).min(1, 'Alege cel puțin un pontaj.'),
  /** Luna de raportare a liniilor de cost. Implicit luna zilei pontate. */
  effectDate: businessDateSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
});

export const subcontractorAttendanceInputSchema = z.object({
  workUnitId: uuidSchema,
  subcontractorId: uuidSchema,
  workDate: businessDateSchema,
  headcount: z.coerce.number().int().min(1).max(999),
});

export type CreateInspectionInput = z.input<typeof createInspectionInputSchema>;
export type InspectionAnswerInput = z.input<typeof inspectionAnswerInputSchema>;
export type SaveInspectionInput = z.input<typeof saveInspectionInputSchema>;
export type ValidateInspectionInput = z.input<typeof validateInspectionInputSchema>;
export type CreateInterventionInput = z.input<typeof createInterventionInputSchema>;
export type SaveInterventionInput = z.input<typeof saveInterventionInputSchema>;
export type ValidateInterventionInput = z.input<typeof validateInterventionInputSchema>;
export type SaveTimesheetInput = z.input<typeof saveTimesheetInputSchema>;
export type ValidateTimesheetsInput = z.input<typeof validateTimesheetsInputSchema>;
export type SubcontractorAttendanceInput = z.input<typeof subcontractorAttendanceInputSchema>;
