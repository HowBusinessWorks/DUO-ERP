import { z } from 'zod';

/**
 * Primitivele comune tuturor schemelor de use-case.
 *
 * Regula care le tine pe toate: valorile numerice de business circula ca SIRURI,
 * niciodata ca `number`. Un `number` care intra intr-un JSON de server action a
 * trecut deja printr-un float — iar la a treia insumare lipseste un ban.
 */

/** UUID v7. Acceptam orice UUID valid: v7-ul e garantat de generator, nu de validare. */
export const uuidSchema = z.string().uuid();

/** Suma monetara, ca sir — niciodata `number`, ca sa nu treaca prin float. */
export const moneySchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,12}([.,]\d{1,2})?$/, 'Suma trebuie să aibă cel mult 2 zecimale.')
  .transform((value) => value.replace(',', '.'));

/** Cantitate, ca sir, cu maximum 4 zecimale. */
export const quantitySchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,10}([.,]\d{1,4})?$/, 'Cantitatea trebuie să aibă cel mult 4 zecimale.')
  .transform((value) => value.replace(',', '.'));

/** Perioada contabila, in forma "2026-08". */
export const periodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Data de business, fara ora. Formatul lui `input[type=date]` si al Postgres. */
export const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Alege o dată.');

export const personaSchema = z.enum(['office', 'field', 'subcontractor', 'client']);

export const officeRoleSchema = z.enum([
  'pm',
  'devizist',
  'achizitii',
  'magazie',
  'flota',
  'financiar',
  'admin',
]);

export type Uuid = z.infer<typeof uuidSchema>;
export type PeriodKeyInput = z.infer<typeof periodKeySchema>;
export type OfficeRole = z.infer<typeof officeRoleSchema>;
