import { z } from 'zod';
import { moneySchema, quantitySchema, uuidSchema } from './primitives';

/**
 * Catalogul de operatiuni (pasul 08, §3.2).
 *
 * Rostul lui e sa transforme pragul de 2.000 lei dintr-o cifra „din ochi" intr-o
 * cifra calculata. De aceea formularul NU cere manopera: ea se deriveaza in
 * serviciu din norma de timp × costul orar al calificarii, luat din tariful in
 * vigoare azi. Un om care ar putea scrie manopera direct ar putea scrie orice,
 * si atunci catalogul n-ar mai fi o masura, ci tot o parere.
 *
 * Materialul ramane scris de mana: e suma materialelor tipice, si pana exista
 * lista de materiale a operatiunii (formularul ei separat) cifra trebuie sa
 * poata fi pusa. Cand lista exista, ea o rescrie.
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);
const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);

export const operationInputSchema = z.object({
  code: requiredText(24, 'Scrie codul operațiunii.').regex(
    /^[A-Za-z0-9-]+$/,
    'Doar litere, cifre și minus.',
  ),
  name: requiredText(200, 'Scrie denumirea.'),
  /** Gruparea din nomenclator. Text, ca la produse: creste cu firma. */
  category: trimmed(80).transform((v) => (v === '' ? null : v)),
  standardHours: quantitySchema,
  qualificationId: uuidSchema,
  estimatedMaterial: moneySchema,
  isActive: z.boolean(),
});

/** O linie din lista de materiale tipice ale unei operatiuni. */
export const operationMaterialInputSchema = z.object({
  productId: uuidSchema,
  quantity: quantitySchema,
});

/**
 * Lista completa de materiale a unei operatiuni, inlocuita dintr-o bucata.
 *
 * Nu „adauga o linie"/„sterge o linie": lista si `estimated_material` de pe
 * operatiune trebuie sa fie mereu de acord, iar asta se poate garanta doar cand
 * se scriu impreuna, intr-o tranzactie.
 */
export const operationMaterialsInputSchema = z.object({
  operationId: uuidSchema,
  lines: z.array(operationMaterialInputSchema),
});

export type OperationInput = z.input<typeof operationInputSchema>;
export type OperationMaterialInput = z.input<typeof operationMaterialInputSchema>;
export type OperationMaterialsInput = z.input<typeof operationMaterialsInputSchema>;
