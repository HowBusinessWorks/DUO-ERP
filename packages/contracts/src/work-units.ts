import { z } from 'zod';
import { businessDateSchema, moneySchema, uuidSchema } from './primitives';

/**
 * Unitatea de lucru, finantarea si etapele.
 *
 * Doua reguli ale pasului se citesc direct din forma schemelor:
 *   - **finantarea nu e un camp pe UL** — `workUnitInputSchema` n-are `contractId`,
 *     iar alocarile vin ca lista separata la creare;
 *   - **mutarea cere motiv scris** — `reason` e obligatoriu si nevid in
 *     `moveFundingInputSchema`, nu optional cu implicit.
 *
 * „Unitate de Lucru" nu apare niciodata pe ecran. Etichetele de aici sunt cele
 * care apar: Inspectie, Interventie, Lucrare.
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);

const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);

const optionalUuid = uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v));

const optionalDate = businessDateSchema.or(z.literal('')).transform((v) => (v === '' ? null : v));

const optionalMoney = moneySchema.or(z.literal('')).transform((v) => (v === '' ? null : v));

export const WORK_UNIT_TYPES = ['inspectie', 'interventie', 'lucrare'] as const;

export const WORK_UNIT_TYPE_LABELS: Readonly<Record<(typeof WORK_UNIT_TYPES)[number], string>> = {
  inspectie: 'Inspecție',
  interventie: 'Intervenție',
  lucrare: 'Lucrare',
};

export const WORK_UNIT_STATUSES = [
  'draft',
  'planificata',
  'in_executie',
  'suspendata',
  'finalizata',
  'inchisa',
  'anulata',
] as const;

export const WORK_UNIT_STATUS_LABELS: Readonly<
  Record<(typeof WORK_UNIT_STATUSES)[number], string>
> = {
  draft: 'Ciornă',
  planificata: 'Planificată',
  in_executie: 'În execuție',
  suspendata: 'Suspendată',
  finalizata: 'Finalizată',
  inchisa: 'Închisă',
  anulata: 'Anulată',
};

export const EXECUTOR_TYPES = ['echipa_proprie', 'subcontractant'] as const;

export const EXECUTOR_TYPE_LABELS: Readonly<Record<(typeof EXECUTOR_TYPES)[number], string>> = {
  echipa_proprie: 'Echipă proprie',
  subcontractant: 'Subcontractant',
};

export const WORK_UNIT_ROLES = ['sef_santier', 'inspector', 'echipa'] as const;

export const WORK_UNIT_ROLE_LABELS: Readonly<Record<(typeof WORK_UNIT_ROLES)[number], string>> = {
  sef_santier: 'Șef de șantier',
  inspector: 'Inspector',
  echipa: 'Echipă',
};

/**
 * O alocare de finantare, la creare sau la re-alocare.
 *
 * Ori suma, ori procent — `check`-ul din baza cere cel putin unul, iar formularul
 * n-are de ce sa ceara amandoua: o lucrare finantata 60% din Delta n-are o suma
 * fixa pana la finalul devizului.
 */
export const fundingAllocationInputSchema = z
  .object({
    contractId: uuidSchema,
    componentId: uuidSchema,
    periodId: uuidSchema,
    allocatedAmount: optionalMoney,
    allocatedPct: z
      .string()
      .trim()
      .regex(/^(100|\d{1,2})([.,]\d{1,2})?$/, 'Procentul e între 0 și 100.')
      .or(z.literal(''))
      .transform((v) => (v === '' ? null : (Number(v.replace(',', '.')) / 100).toFixed(4))),
    reason: requiredText(500, 'Scrie de ce se finanțează de aici.'),
  })
  .refine((v) => v.allocatedAmount !== null || v.allocatedPct !== null, {
    message: 'Completează suma sau procentul.',
    path: ['allocatedAmount'],
  })
  .refine((v) => v.allocatedPct === null || Number(v.allocatedPct) > 0, {
    message: 'Procentul trebuie să fie mai mare decât zero.',
    path: ['allocatedPct'],
  });

/** O asignare de persoana pe unitate, la creare. */
export const workUnitAssignmentInputSchema = z
  .object({
    personId: uuidSchema,
    role: z.enum(WORK_UNIT_ROLES),
    validFrom: optionalDate,
    validTo: optionalDate,
  })
  .refine((v) => v.validTo === null || v.validFrom === null || v.validTo >= v.validFrom, {
    message: 'Data de sfârșit trebuie să fie după cea de început.',
    path: ['validTo'],
  });

/**
 * Unitatea de lucru insasi. **Fara `contractId`**: contractul care plateste vine
 * din alocare, nu de aici. `contractObjectiveId` spune prin ce legatura se
 * executa, si e optional — o inspectie poate exista inaintea deciziei de rutare.
 */
export const workUnitInputSchema = z
  .object({
    companyId: uuidSchema,
    type: z.enum(WORK_UNIT_TYPES),
    name: requiredText(200, 'Scrie o denumire.'),
    objectiveId: uuidSchema,
    contractObjectiveId: optionalUuid,
    responsiblePersonId: optionalUuid,
    executorType: z.enum(EXECUTOR_TYPES),
    executorSubcontractorId: optionalUuid,
    startsOn: optionalDate,
    endsOn: optionalDate,
    estimatedValue: optionalMoney,
    costBudget: optionalMoney,
  })
  .refine((v) => v.endsOn === null || v.startsOn === null || v.endsOn >= v.startsOn, {
    message: 'Data de sfârșit trebuie să fie după cea de început.',
    path: ['endsOn'],
  })
  // Aceeasi egalitate ca `check`-ul din baza, spusa in romana inainte de a
  // ajunge acolo: cine executa si cu ce firma merg impreuna, in ambele sensuri.
  .refine((v) => (v.executorType === 'subcontractant') === (v.executorSubcontractorId !== null), {
    message: 'Alege subcontractantul care execută, sau treci pe echipă proprie.',
    path: ['executorSubcontractorId'],
  });

/** Crearea completa: unitatea + finantarea + asignarile, intr-o tranzactie. */
export const createWorkUnitInputSchema = z.object({
  workUnit: workUnitInputSchema,
  /** Cel putin una la lucrari si interventii; inspectiile pot porni nefinantate. */
  allocations: z.array(fundingAllocationInputSchema),
  assignments: z.array(workUnitAssignmentInputSchema),
  /** Seria din care se ia codul, la firma unitatii. */
  series: requiredText(20, 'Alege seria de numerotare.'),
});

/**
 * Formularul de creare din ecran — PLAT, cu o singura alocare.
 *
 * `createWorkUnitInputSchema` are liste imbricate (alocari, asignari), iar un
 * formular declarat ca date nu le poate exprima. Alegerea nu e o scurtatura: asa
 * se si lucreaza. O unitate se deschide cu finantarea de unde se plateste ACUM;
 * „Delta pe trei luni" se construieste pe urma, din tab-ul de finantare, unde se
 * vede si cat s-a alocat deja pe fiecare luna.
 *
 * Cele patru campuri de finantare merg impreuna: ori toate, ori niciunul. O
 * inspectie poate porni nefinantata; o interventie, nu — dar regula aia e a
 * serviciului, nu a formularului, pentru ca depinde de tip.
 */
export const workUnitFormSchema = z
  .object({
    companyId: uuidSchema,
    type: z.enum(WORK_UNIT_TYPES),
    name: requiredText(200, 'Scrie o denumire.'),
    objectiveId: uuidSchema,
    responsiblePersonId: optionalUuid,
    executorType: z.enum(EXECUTOR_TYPES),
    executorSubcontractorId: optionalUuid,
    startsOn: optionalDate,
    endsOn: optionalDate,
    estimatedValue: optionalMoney,
    costBudget: optionalMoney,
    series: requiredText(20, 'Alege seria de numerotare.'),
    fundingContractId: optionalUuid,
    fundingComponentId: optionalUuid,
    fundingPeriodId: optionalUuid,
    fundingAmount: optionalMoney,
  })
  .refine((v) => v.endsOn === null || v.startsOn === null || v.endsOn >= v.startsOn, {
    message: 'Data de sfârșit trebuie să fie după cea de început.',
    path: ['endsOn'],
  })
  .refine((v) => (v.executorType === 'subcontractant') === (v.executorSubcontractorId !== null), {
    message: 'Alege subcontractantul care execută, sau treci pe echipă proprie.',
    path: ['executorSubcontractorId'],
  })
  .refine(
    (v) => {
      const parts = [v.fundingContractId, v.fundingComponentId, v.fundingPeriodId, v.fundingAmount];
      const filled = parts.filter((part) => part !== null).length;
      return filled === 0 || filled === parts.length;
    },
    {
      message: 'Finanțarea cere contract, componentă, lună și sumă — toate patru, sau niciuna.',
      path: ['fundingAmount'],
    },
  );

export const workStageInputSchema = z
  .object({
    workUnitId: uuidSchema,
    name: requiredText(200, 'Scrie denumirea etapei.'),
    plannedStart: optionalDate,
    plannedEnd: optionalDate,
    materialBudget: optionalMoney,
    laborBudget: optionalMoney,
    pctOfWork: z
      .string()
      .trim()
      .regex(/^(100|\d{1,2})([.,]\d{1,2})?$/, 'Procentul e între 0 și 100.')
      .or(z.literal(''))
      .transform((v) => (v === '' ? null : (Number(v.replace(',', '.')) / 100).toFixed(4))),
  })
  .refine(
    (v) => v.plannedEnd === null || v.plannedStart === null || v.plannedEnd >= v.plannedStart,
    {
      message: 'Sfârșitul etapei nu poate fi înaintea începutului.',
      path: ['plannedEnd'],
    },
  );

/**
 * Mutarea finantarii. `reason` e obligatoriu si **nu are implicit** — verificarea
 * #7 a pasului cere ca fara motiv sa nu se salveze.
 */
export const moveFundingInputSchema = z.object({
  workUnitId: uuidSchema,
  /** Alocarea activa care se muta. */
  allocationId: uuidSchema,
  toContractId: uuidSchema,
  toComponentId: uuidSchema,
  toPeriodId: uuidSchema,
  reason: requiredText(500, 'Mutarea finanțării cere un motiv scris.'),
});

export const promoteWorkUnitInputSchema = z.object({
  workUnitId: uuidSchema,
  reason: requiredText(500, 'Promovarea cere un motiv scris.'),
});

export const closeWorkUnitInputSchema = z.object({
  workUnitId: uuidSchema,
  reason: requiredText(500, 'Închiderea cere un motiv scris.'),
});

export const reorderStagesInputSchema = z.object({
  workUnitId: uuidSchema,
  /** Id-urile etapelor, in ordinea dorita. Pozitiile se rescriu 1..n. */
  stageIds: z.array(uuidSchema).min(1, 'Trimite cel puțin o etapă.'),
});

export type WorkUnitType = (typeof WORK_UNIT_TYPES)[number];
export type WorkUnitStatusValue = (typeof WORK_UNIT_STATUSES)[number];
export type ExecutorType = (typeof EXECUTOR_TYPES)[number];
export type WorkUnitRole = (typeof WORK_UNIT_ROLES)[number];
export type WorkUnitInput = z.input<typeof workUnitInputSchema>;
export type FundingAllocationInput = z.input<typeof fundingAllocationInputSchema>;
export type WorkUnitAssignmentInput = z.input<typeof workUnitAssignmentInputSchema>;
export type CreateWorkUnitInput = z.input<typeof createWorkUnitInputSchema>;
export type WorkStageInput = z.input<typeof workStageInputSchema>;
export type WorkUnitFormInput = z.input<typeof workUnitFormSchema>;
export type MoveFundingInputDto = z.input<typeof moveFundingInputSchema>;
export type PromoteWorkUnitInput = z.input<typeof promoteWorkUnitInputSchema>;
export type CloseWorkUnitInput = z.input<typeof closeWorkUnitInputSchema>;
export type ReorderStagesInput = z.input<typeof reorderStagesInputSchema>;
