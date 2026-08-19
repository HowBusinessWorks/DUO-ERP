import { z } from 'zod';
import { moneySchema, quantitySchema, uuidSchema } from './primitives';

/**
 * Devizul si biblioteca de articole normate (pasul 11).
 *
 * Doua reguli traverseaza toate schemele de aici:
 *
 *  1. **Banii si cantitatile circula ca siruri**, ca peste tot (vezi
 *     `primitives.ts`). Un `number` care a trecut printr-un JSON a trecut deja
 *     printr-un float, iar un deviz cu 500 de pozitii pierde bani reali acolo.
 *  2. **Procentele sunt fractii**: 0,08 pentru 8%. Aceeasi conventie ca
 *     `work_stages.pct_of_work`, ca sa nu existe doua feluri de procent in
 *     acelasi ecran.
 */

/** Procent, ca fractie intre 0 si 1. Sirul gol inseamna „nu se aplica". */
export const pctSchema = z
  .string()
  .trim()
  .regex(/^\d(([.,])\d{1,4})?$/, 'Procentul se scrie ca fracție: 0,08 pentru 8%.')
  .transform((value) => value.replace(',', '.'))
  .refine((value) => Number(value) >= 0 && Number(value) <= 1, 'Procentul e între 0 și 1.');

const optionalPct = pctSchema.or(z.literal('')).transform((v) => (v === '' ? null : v));
const optionalUuid = uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v));

export const devizKindSchema = z.enum(['client', 'intern']);

export const createDevizInputSchema = z.object({
  workUnitId: uuidSchema,
  kind: devizKindSchema,
  /**
   * Indirectele si profitul se pot pune de la creare, dar DOAR pe devizul
   * client. Refuzul e si in baza, ca `check`; aici e ca sa iasa in romana, cu
   * numele campului, in loc de un 23514 nedescifrabil.
   */
  indirectPct: optionalPct.optional(),
  profitPct: optionalPct.optional(),
});

export const updateDevizMarkupInputSchema = z.object({
  devizId: uuidSchema,
  indirectPct: optionalPct,
  profitPct: optionalPct,
});

export const devizCategoryInputSchema = z.object({
  devizId: uuidSchema,
  /** Lipsa = categorie de nivel 1. Prezent = operatiune sub ea. */
  parentId: optionalUuid.optional(),
  name: z.string().trim().min(1, 'Scrie denumirea categoriei.').max(200),
  position: z.number().int().min(1).max(30000),
});

export const devizLineInputSchema = z.object({
  devizId: uuidSchema,
  categoryId: optionalUuid.optional(),
  position: z.number().int().min(1).max(30000),
  code: z.string().trim().max(60).optional(),
  name: z.string().trim().min(1, 'Scrie denumirea poziției.').max(300),
  uom: z.string().trim().min(1, 'Alege unitatea de măsură.').max(20),
  quantity: quantitySchema,
  stageId: optionalUuid.optional(),
  normedArticleId: optionalUuid.optional(),
  /**
   * Pe devizul client se scrie `unitPrice`. Pe cel intern se scriu cele patru
   * componente, iar pretul unitar il calculeaza triggerul din baza ca suma lor
   * — de aceea `unitPrice` ramane optional si acolo se ignora.
   */
  unitPrice: moneySchema.optional(),
  materialCost: moneySchema.optional(),
  laborCost: moneySchema.optional(),
  equipmentCost: moneySchema.optional(),
  transportCost: moneySchema.optional(),
});

export const updateDevizLineInputSchema = devizLineInputSchema
  .partial()
  .extend({ lineId: uuidSchema });

export const moveDevizLineInputSchema = z.object({
  lineId: uuidSchema,
  categoryId: optionalUuid,
  position: z.number().int().min(1).max(30000),
});

/**
 * Inghetarea devizului client — singura operatie ireversibila a pasului.
 *
 * `reason` e obligatoriu, ca la plafoanele de la 04: peste sase luni,
 * intrebarea nu e „ce versiune s-a trimis", ci „de ce s-a trimis alta".
 */
export const freezeDevizInputSchema = z.object({
  devizId: uuidSchema,
  reason: z.string().trim().min(3, 'Scrie de ce se îngheață versiunea.').max(500),
});

export const adoptAsInternalInputSchema = z.object({
  workUnitId: uuidSchema,
});

export const mapDevizLinesInputSchema = z.object({
  pairs: z
    .array(
      z.object({
        clientLineId: uuidSchema,
        internLineId: uuidSchema,
        coefficient: quantitySchema.default('1'),
      }),
    )
    .min(1, 'Alege cel puțin o poziție internă.'),
});

export const unmapDevizLinesInputSchema = z.object({
  mappingIds: z.array(uuidSchema).min(1),
});

// ── Biblioteca de articole normate ──────────────────────────────────────────

export const normedComponentKindSchema = z.enum(['material', 'manopera', 'utilaj', 'transport']);

export const normedArticleComponentInputSchema = z.object({
  kind: normedComponentKindSchema,
  productId: optionalUuid.optional(),
  qualificationId: optionalUuid.optional(),
  position: z.number().int().min(1).max(200),
  quantityPerUom: quantitySchema,
  normHours: quantitySchema.or(z.literal('')).transform((v) => (v === '' ? null : v)).optional(),
});

export const normedArticleInputSchema = z.object({
  companyId: uuidSchema,
  code: z.string().trim().min(1, 'Scrie codul articolului.').max(60),
  name: z.string().trim().min(1, 'Scrie denumirea articolului.').max(300),
  uom: z.string().trim().min(1, 'Alege unitatea de măsură.').max(20),
  components: z.array(normedArticleComponentInputSchema).min(1, 'Un articol are cel puțin o componentă.'),
});

/** „Salvează poziția ca articol normat" — din editorul de deviz (§3.6, modul 3). */
export const saveAsNormedArticleInputSchema = z.object({
  lineId: uuidSchema,
  code: z.string().trim().min(1, 'Scrie codul articolului.').max(60),
});

export const listNormedArticlesInputSchema = z.object({
  companyId: uuidSchema,
  search: z.string().trim().max(200).optional(),
  includeInactive: z.boolean().optional(),
});

export type CreateDevizInput = z.input<typeof createDevizInputSchema>;
export type UpdateDevizMarkupInput = z.input<typeof updateDevizMarkupInputSchema>;
export type DevizCategoryInput = z.input<typeof devizCategoryInputSchema>;
export type DevizLineInput = z.input<typeof devizLineInputSchema>;
export type UpdateDevizLineInput = z.input<typeof updateDevizLineInputSchema>;
export type MoveDevizLineInput = z.input<typeof moveDevizLineInputSchema>;
export type FreezeDevizInput = z.input<typeof freezeDevizInputSchema>;
export type AdoptAsInternalInput = z.input<typeof adoptAsInternalInputSchema>;
export type MapDevizLinesInput = z.input<typeof mapDevizLinesInputSchema>;
export type UnmapDevizLinesInput = z.input<typeof unmapDevizLinesInputSchema>;
export type NormedArticleInput = z.input<typeof normedArticleInputSchema>;
export type NormedArticleComponentInput = z.input<typeof normedArticleComponentInputSchema>;
export type SaveAsNormedArticleInput = z.input<typeof saveAsNormedArticleInputSchema>;
export type ListNormedArticlesInput = z.input<typeof listNormedArticlesInputSchema>;
