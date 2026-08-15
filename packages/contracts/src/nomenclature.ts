import { z } from 'zod';
import { businessDateSchema, moneySchema, uuidSchema } from './primitives';

/**
 * Schemele de intrare ale nomenclatoarelor.
 *
 * Acelasi obiect e folosit de `react-hook-form` in browser si de `createAction`
 * pe server. Nu sunt „doua validari care trebuie tinute la fel” — e una singura,
 * importata de doua ori.
 *
 * Mesajele sunt in romana, cu diacritice: ajung direct sub camp, in formular.
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);

const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);

/** CUI: cifre, optional prefixate cu RO. Gol inseamna „nu-l stim inca”. */
export const cuiSchema = z
  .string()
  .trim()
  .regex(/^(RO)?\d{2,10}$/i, 'CUI-ul are 2–10 cifre, opțional cu prefixul RO.')
  .or(z.literal(''))
  .transform((value) => (value === '' ? null : value.toUpperCase()));

/**
 * Unitatile de masura folosite azi. Lista traieste in cod, nu ca enum in baza:
 * creste cu fiecare furnizor si nu merita o migrare de tip.
 */
export const UNITS_OF_MEASURE = [
  'buc',
  'kg',
  'to',
  'm',
  'mp',
  'mc',
  'l',
  'ml',
  'set',
  'oră',
  'zi',
  'km',
] as const;

export const productInputSchema = z.object({
  code: requiredText(40).regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
    'Codul poate conține litere, cifre, punct, minus, slash.',
  ),
  name: requiredText(200),
  uom: requiredText(16),
  category: trimmed(80).transform((v) => (v === '' ? null : v)),
  defaultSupplierId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
  isStockItem: z.boolean(),
  minStock: z
    .string()
    .trim()
    .regex(/^\d{1,10}([.,]\d{1,4})?$/, 'Scrie un număr pozitiv.')
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v.replace(',', '.'))),
  notes: trimmed(1000).transform((v) => (v === '' ? null : v)),
  isActive: z.boolean(),
});

export const supplierInputSchema = z.object({
  name: requiredText(200),
  cui: cuiSchema,
  defaultLeadTimeDays: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Scrie un număr de zile.')
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : Number(v))),
  isActive: z.boolean(),
});

export const clientInputSchema = z
  .object({
    name: requiredText(200),
    cui: cuiSchema,
    paymentTermDays: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/, 'Scrie un număr de zile.')
      .transform(Number),
    isIntercompany: z.boolean(),
    intercompanyCompanyId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
  })
  // Aceeasi regula ca `check`-ul din baza: daca e client intern, stim CARE firma
  // din grup e. Verificata aici ca sa iasa mesaj in romana sub camp, nu un
  // 23514 din Postgres — dar ramane si in baza, pentru ce nu trece prin UI.
  .refine((v) => v.isIntercompany === (v.intercompanyCompanyId !== null), {
    message: 'Alege firma din grup căreia îi corespunde clientul.',
    path: ['intercompanyCompanyId'],
  });

export const subcontractorInputSchema = z.object({
  name: requiredText(200),
  cui: cuiSchema,
  specialties: trimmed(400).transform((v) =>
    v === '' ? [] : v.split(',').map((s) => s.trim()).filter((s) => s !== ''),
  ),
  warrantyRetentionPct: z
    .string()
    .trim()
    .regex(/^\d{1,2}([.,]\d{1,2})?$/, 'Scrie un procent între 0 și 99.')
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : (Number(v.replace(',', '.')) / 100).toFixed(4))),
  isActive: z.boolean(),
});

export const qualificationInputSchema = z.object({
  code: requiredText(24).regex(/^[A-Za-z0-9-]+$/, 'Doar litere, cifre și minus.'),
  name: requiredText(120),
  isActive: z.boolean(),
});

/**
 * Tarif orar. Nu se modifica niciodata un rand existent — se adauga un interval
 * nou. Suprapunerea e refuzata de constrangerea `exclude` din baza; aici o
 * prindem doar cat sa dam un mesaj mai bun cand se poate.
 */
export const rateCardInputSchema = z
  .object({
    qualificationId: uuidSchema,
    validFrom: businessDateSchema,
    validTo: businessDateSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
    hourlySalary: moneySchema,
    /** Procent scris de om (45), stocat ca fractie (0.4500). */
    taxCoefficient: z
      .string()
      .trim()
      .regex(/^\d{1,3}([.,]\d{1,2})?$/, 'Scrie un procent.')
      .transform((v) => (Number(v.replace(',', '.')) / 100).toFixed(4)),
    unproductivityCoefficient: z
      .string()
      .trim()
      .regex(/^\d{1,3}([.,]\d{1,2})?$/, 'Scrie un procent.')
      .transform((v) => (Number(v.replace(',', '.')) / 100).toFixed(4)),
  })
  .refine((v) => v.validTo === null || v.validTo > v.validFrom, {
    message: 'Data de sfârșit trebuie să fie după cea de început.',
    path: ['validTo'],
  });

export type ProductInput = z.input<typeof productInputSchema>;
export type SupplierInput = z.input<typeof supplierInputSchema>;
export type ClientInput = z.input<typeof clientInputSchema>;
export type SubcontractorInput = z.input<typeof subcontractorInputSchema>;
export type QualificationInput = z.input<typeof qualificationInputSchema>;
export type RateCardInput = z.input<typeof rateCardInputSchema>;

/** Editarea trimite si id-ul. Restul campurilor sunt identice cu crearea. */
export const withId = <Schema extends z.ZodTypeAny>(
  schema: Schema,
): z.ZodIntersection<Schema, z.ZodObject<{ id: typeof uuidSchema }>> =>
  z.intersection(schema, z.object({ id: uuidSchema }));

/**
 * Tipurile de coada de lucru cunoscute azi.
 *
 * Traiesc aici, nu ca enum in baza: fiecare pas isi adauga tipurile lui fara
 * migrare, dar traducerea si ruta lor trebuie sa fie undeva declarate, altfel
 * apar badge-uri cu chei brute pe ecran.
 */
export const WORK_QUEUE_KINDS = [
  'sl_de_aprobat',
  'cerere_neprocesata',
  'pv_deschis',
  'receptie_de_facut',
  'factura_nematchata',
  'necesar_de_procesat',
] as const;

export type WorkQueueKind = (typeof WORK_QUEUE_KINDS)[number];
