import { z } from 'zod';

/**
 * Schemele Zod de intrare/iesire pentru fiecare use-case.
 *
 * In pasul 01 exista doar primitivele comune — use-case-urile propriu-zise vin
 * odata cu modulele lor (pasii 04-10).
 */

/** UUID v7. Acceptam orice UUID valid: v7-ul e garantat de generator, nu de validare. */
export const uuidSchema = z.string().uuid();

/** Suma monetara, ca sir — niciodata `number`, ca sa nu treaca prin float. */
export const moneySchema = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'Suma trebuie sa aiba cel mult 2 zecimale.');

/** Cantitate, ca sir, cu maximum 4 zecimale. */
export const quantitySchema = z
  .string()
  .regex(/^-?\d{1,10}(\.\d{1,4})?$/, 'Cantitatea trebuie sa aiba cel mult 4 zecimale.');

/** Perioada contabila, in forma "2026-08". */
export const periodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Data de business, fara ora. */
export const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const personaSchema = z.enum(['office', 'field', 'subcontractor', 'client']);

export type Uuid = z.infer<typeof uuidSchema>;
export type PeriodKeyInput = z.infer<typeof periodKeySchema>;
