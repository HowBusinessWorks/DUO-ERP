import { z } from 'zod';
import { businessDateSchema, uuidSchema } from './primitives';

/**
 * Obiective, fise de verificare si profile de inspectie.
 *
 * Doua reguli ale pasului sunt impuse chiar de forma schemelor:
 *   - obiectivul **nu are `companyId`** — e nomenclator comun celor 5 firme;
 *   - profilul de inspectie apare in `contractObjectiveInputSchema`, **nu** in
 *     `objectiveInputSchema` — sta pe legatura, nu pe obiectiv.
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);

const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);

const optionalText = (max: number) =>
  trimmed(max).transform((value) => (value === '' ? null : value));

export const OBJECTIVE_KINDS = [
  'cladire',
  'statie_pompare',
  'bazin',
  'rezervor',
  'gura_canal',
  'retea',
  'altul',
] as const;

export const OBJECTIVE_KIND_LABELS: Readonly<Record<(typeof OBJECTIVE_KINDS)[number], string>> = {
  cladire: 'Clădire',
  statie_pompare: 'Stație de pompare',
  bazin: 'Bazin',
  rezervor: 'Rezervor',
  gura_canal: 'Gură de canal',
  retea: 'Rețea',
  altul: 'Altul',
};

/** Coordonata geografica, ca sir cu maximum 7 zecimale (≈1 cm). */
const coordinateSchema = (max: number, label: string) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,3}([.,]\d{1,7})?$/, `${label} se scrie în grade zecimale.`)
    .refine(
      (v) => Math.abs(Number(v.replace(',', '.'))) <= max,
      `${label} e în afara intervalului.`,
    )
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v.replace(',', '.')));

export const objectiveInputSchema = z
  .object({
    code: requiredText(40).regex(
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
      'Codul poate conține litere, cifre, punct, minus, slash.',
    ),
    name: requiredText(200),
    kind: z.enum(OBJECTIVE_KINDS),
    geoLat: coordinateSchema(90, 'Latitudinea'),
    geoLng: coordinateSchema(180, 'Longitudinea'),
    areaSqm: z
      .string()
      .trim()
      .regex(/^\d{1,12}([.,]\d{1,2})?$/, 'Scrie o suprafață în metri pătrați.')
      .or(z.literal(''))
      .transform((v) => (v === '' ? null : v.replace(',', '.'))),
    isActive: z.boolean(),
  })
  // Un pin are nevoie de amandoua. O latitudine singura nu se poate desena, si
  // nici nu se poate corecta mai tarziu — nimeni nu stie ca lipseste.
  .refine((v) => (v.geoLat === null) === (v.geoLng === null), {
    message: 'Completează ambele coordonate, sau niciuna.',
    path: ['geoLng'],
  });

/**
 * Legatura contract ↔ obiectiv, cu valabilitate si profil.
 *
 * Aici sta profilul de inspectie. Acelasi obiectiv poate avea frecvente
 * diferite pe contracte diferite, iar suprapunerea pe ACELASI contract e
 * refuzata de constrangerea `exclude` din baza (23P01), tradusa in romana in
 * serviciu.
 */
export const contractObjectiveInputSchema = z
  .object({
    contractId: uuidSchema,
    objectiveId: uuidSchema,
    validFrom: businessDateSchema,
    validTo: businessDateSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
    inspectionProfileId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
  })
  .refine((v) => v.validTo === null || v.validTo > v.validFrom, {
    message: 'Data de sfârșit trebuie să fie după cea de început.',
    path: ['validTo'],
  });

export const inspectionProfileInputSchema = z.object({
  name: requiredText(120),
  description: optionalText(500),
  isActive: z.boolean(),
});

export const inspectionProfileItemInputSchema = z.object({
  profileId: uuidSchema,
  checklistId: uuidSchema,
  frequencyMonths: z
    .string()
    .trim()
    .regex(/^([1-9]|[1-5]\d|60)$/, 'Frecvența e între 1 și 60 de luni.')
    .transform(Number),
});

export const checklistInputSchema = z.object({
  code: requiredText(40),
  name: requiredText(200),
  objectiveKind: z
    .enum(OBJECTIVE_KINDS)
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v)),
  isActive: z.boolean(),
});

export type ObjectiveInput = z.input<typeof objectiveInputSchema>;
export type ContractObjectiveInput = z.input<typeof contractObjectiveInputSchema>;
export type InspectionProfileInput = z.input<typeof inspectionProfileInputSchema>;
export type InspectionProfileItemInput = z.input<typeof inspectionProfileItemInputSchema>;
export type ChecklistInput = z.input<typeof checklistInputSchema>;
