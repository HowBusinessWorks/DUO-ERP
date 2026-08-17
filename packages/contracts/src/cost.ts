import { z } from 'zod';
import { businessDateSchema, moneySchema, quantitySchema, uuidSchema } from './primitives';

/**
 * Registrul de cost: inregistrare, storno, reconciliere.
 *
 * Doua reguli ale pasului se citesc direct din forma schemelor:
 *   - **ambele analitici pe fiecare linie** — `used*` si `charged*` sunt campuri
 *     separate, iar serviciul le face egale cand apelantul nu le desparte;
 *   - **fiecare linie are document sursa** — `documentType` si `documentId` sunt
 *     obligatorii, fara implicit si fara varianta „diverse".
 *
 * Corectia nu are schema proprie de scriere: se face prin `stornoCostInput`, care
 * cere linia gresita si motivul. Suma o afla serviciul din linia stornata — o
 * suma scrisa a doua ori de mana e o suma care se poate scrie gresit a doua oara.
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);

const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);

const optionalUuid = uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v));

export const EXPENSE_TYPES = [
  'material',
  'manopera_proprie',
  'servicii_subc',
  'utilaj',
  'motorina',
  'transport',
  'reparatii',
  'alte',
] as const;

export const EXPENSE_TYPE_LABELS: Readonly<Record<(typeof EXPENSE_TYPES)[number], string>> = {
  material: 'Material',
  manopera_proprie: 'Manoperă proprie',
  servicii_subc: 'Servicii subcontractant',
  utilaj: 'Utilaj',
  motorina: 'Motorină',
  transport: 'Transport',
  reparatii: 'Reparații',
  alte: 'Alte',
};

/**
 * Stadiile costului. Ordinea NU e decorativa: `angajat` e cel care face plafonul
 * sa se coloreze la lansarea comenzii, nu peste trei saptamani cand vine factura.
 */
export const COST_STAGES = ['angajat', 'receptionat', 'consumat', 'facturat'] as const;

export const COST_STAGE_LABELS: Readonly<Record<(typeof COST_STAGES)[number], string>> = {
  angajat: 'Angajat',
  receptionat: 'Recepționat',
  consumat: 'Consumat',
  facturat: 'Facturat',
};

export const COST_DOCUMENT_TYPES = [
  'bon_consum',
  'situatie_lucrari',
  'factura_furnizor',
  'fisa_motorina',
  'fisa_utilaj',
  'pontaj',
  'fisa_interventie',
  'comanda',
  'nir',
  'nota_realocare',
  'ajustare_pret',
  'fisa_reparatie',
] as const;

export const COST_DOCUMENT_TYPE_LABELS: Readonly<
  Record<(typeof COST_DOCUMENT_TYPES)[number], string>
> = {
  bon_consum: 'Bon de consum',
  situatie_lucrari: 'Situație de lucrări',
  factura_furnizor: 'Factură furnizor',
  fisa_motorina: 'Fișă motorină',
  fisa_utilaj: 'Fișă utilaj',
  pontaj: 'Pontaj',
  fisa_interventie: 'Fișă intervenție',
  comanda: 'Comandă',
  nir: 'NIR',
  nota_realocare: 'Notă de re-alocare',
  ajustare_pret: 'Ajustare de preț',
  fisa_reparatie: 'Fișă reparație',
};

/**
 * O linie de cost, asa cum o trimite un document care produce costuri.
 *
 * `periodId` nu apare: luna se deriva din `effectDate`, prin trigger (regula 3
 * din pas). Un camp de luna in formular ar fi un camp care poate contrazice data.
 */
export const recordCostInputSchema = z
  .object({
    companyId: uuidSchema,
    documentDate: businessDateSchema,
    /** Luna de raportare. Implicit egala cu data documentului. */
    effectDate: businessDateSchema,

    // Analitica „folosit": unde s-a intamplat fizic.
    usedContractId: optionalUuid,
    usedComponentId: optionalUuid,
    objectiveId: optionalUuid,
    workUnitId: optionalUuid,
    stageId: optionalUuid,

    /**
     * Analitica „descarcat": cine plateste. Lipsa, serviciul o face egala cu
     * „folosit" — implicit sunt egale, si numai cine are un motiv le desparte.
     */
    chargedContractId: optionalUuid,
    chargedComponentId: optionalUuid,

    expenseType: z.enum(EXPENSE_TYPES),
    productId: optionalUuid,
    qualificationId: optionalUuid,

    quantity: quantitySchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
    uom: trimmed(16).or(z.literal('')).transform((v) => (v === '' ? null : v)),
    amount: moneySchema,
    stage: z.enum(COST_STAGES),

    documentType: z.enum(COST_DOCUMENT_TYPES),
    documentId: uuidSchema,
    documentLineId: optionalUuid,
    supplierId: optionalUuid,
    subcontractorId: optionalUuid,
  })
  .refine((v) => v.stage === 'angajat' || v.chargedContractId !== null || v.usedContractId !== null, {
    message: 'De la recepție încolo, linia trebuie să spună cine plătește.',
    path: ['chargedContractId'],
  })
  // Cantitatea si unitatea de masura merg impreuna: „14" fara „m" nu spune nimic,
  // iar „m" fara cifra nu spune nici atat. Aceeasi regula ca `check`-ul din 0017.
  .refine((v) => (v.quantity === null) === (v.uom === null), {
    message: 'Cantitatea și unitatea de măsură se completează împreună.',
    path: ['uom'],
  });

export type RecordCostInput = z.infer<typeof recordCostInputSchema>;

/**
 * Corectia unei linii gresite. Suma NU se scrie aici: o ia serviciul din linia
 * stornata si o inverseaza. Asa storno-ul e prin constructie egal si opus.
 */
export const stornoCostInputSchema = z.object({
  costLineId: uuidSchema,
  reason: requiredText(500, 'Scrie de ce se stornează.'),
});

export type StornoCostInput = z.infer<typeof stornoCostInputSchema>;

/**
 * Filtrele tab-ului Costuri si ale rapoartelor de reconciliere.
 *
 * Toate optionale: un filtru absent inseamna „nu filtra pe asta". `''` se
 * transforma tot in absent, ca sa se poata lega direct de un `<select>` gol.
 */
export const costQuerySchema = z.object({
  companyId: optionalUuid.optional(),
  periodId: optionalUuid.optional(),
  workUnitId: optionalUuid.optional(),
  stageId: optionalUuid.optional(),
  objectiveId: optionalUuid.optional(),
  chargedComponentId: optionalUuid.optional(),
  expenseType: z.enum(EXPENSE_TYPES).optional(),
  stage: z.enum(COST_STAGES).optional(),
  /** Paginare cursor pe `(effect_date, id)` — niciodata `OFFSET` (§3.5). */
  cursorEffectDate: businessDateSchema.optional(),
  cursorId: uuidSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export type CostQuery = z.infer<typeof costQuerySchema>;

/**
 * Baza pe care e calculata o marja. Fiecare ecran cu cifre o declara — regula de
 * interfata 9, impusa prin tipul de retur al use-case-ului, nu prin memoria
 * celui care scrie ecranul.
 */
export const MARGIN_BASES = ['gross', 'net'] as const;

export const MARGIN_BASIS_LABELS: Readonly<Record<(typeof MARGIN_BASES)[number], string>> = {
  gross: 'Marjă brută (doar costuri directe)',
  net: 'Marjă netă (cu regie)',
};

export type MarginBasis = (typeof MARGIN_BASES)[number];
