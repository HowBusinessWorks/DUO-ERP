import { z } from 'zod';
import { businessDateSchema, quantitySchema, uuidSchema } from './primitives';

/**
 * Gestiuni, stoc si bonuri de consum (pasul 09, §3.4).
 *
 * Regula 3 a pasului se vede direct in `LOCATION_TYPES`: **nu exista „gestiune
 * de contract"**, si nu pentru ca ecranul o interzice, ci pentru ca valoarea nu
 * exista in enum. Ecranul cere tip fizic + locatie, iar contractul apare abia pe
 * bonul de consum, ca dimensiune analitica (verificarea #16).
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);
const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);
const optionalUuid = uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v));

export const LOCATION_TYPES = [
  'magazie_centrala',
  'consignatie',
  'santier',
  'echipa',
  'subcontractant',
  'unelte',
  'utilaje',
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];

export const LOCATION_TYPE_LABELS: Readonly<Record<LocationType, string>> = {
  magazie_centrala: 'Magazie centrală',
  consignatie: 'Consignație furnizor',
  santier: 'Șantier',
  echipa: 'Echipă',
  subcontractant: 'Subcontractant',
  unelte: 'Unelte',
  utilaje: 'Utilaje',
};

/** Ce titular cere fiecare tip. `null` = niciunul (magazie, unelte, utilaje). */
export const LOCATION_TYPE_HOLDER: Readonly<
  Record<LocationType, 'team' | 'workUnit' | 'subcontractor' | 'supplier' | null>
> = {
  magazie_centrala: null,
  consignatie: 'supplier',
  santier: 'workUnit',
  echipa: 'team',
  subcontractant: 'subcontractor',
  unelte: null,
  utilaje: null,
};

export const createLocationInputSchema = z
  .object({
    companyId: uuidSchema,
    type: z.enum(LOCATION_TYPES),
    name: requiredText(200, 'Scrie o denumire.'),
    code: requiredText(30, 'Scrie un cod.'),
    parentLocationId: optionalUuid,
    teamId: optionalUuid,
    workUnitId: optionalUuid,
    subcontractorId: optionalUuid,
    supplierId: optionalUuid,
    addressText: trimmed(500).optional(),
    isCustody: z.boolean().default(false),
  })
  /*
   * Aceeasi regula ca `locations_holder_matches_type` din migrare, scrisa a doua
   * oara ca sa dea un mesaj de formular in loc de o eroare de constrangere.
   * Baza ramane adevarul: ea o impune si importurilor.
   */
  .superRefine((v, ctx) => {
    const expected = LOCATION_TYPE_HOLDER[v.type];
    const present = {
      team: v.teamId,
      workUnit: v.workUnitId,
      subcontractor: v.subcontractorId,
      supplier: v.supplierId,
    };
    for (const [key, value] of Object.entries(present)) {
      if (expected === key && value === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Gestiunea de tip „${LOCATION_TYPE_LABELS[v.type]}" cere titularul ei.`,
          path: [`${key}Id`],
        });
      }
      if (expected !== key && value !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Titularul nu se potrivește cu tipul gestiunii.',
          path: [`${key}Id`],
        });
      }
    }
  });

export const consumptionLineInputSchema = z.object({
  productId: uuidSchema,
  lotId: optionalUuid,
  quantity: quantitySchema,
});

/**
 * Bonul de consum emis manual, din gestiunea echipei.
 *
 * Analitica e obligatorie si nu are valori implicite: contractul, componenta si
 * obiectivul se scriu de fiecare data. Un bon fara ele ar produce linii de cost
 * pe care nu le-ar putea revendica niciun raport.
 */
export const createConsumptionNoteInputSchema = z.object({
  companyId: uuidSchema,
  series: requiredText(20, 'Alege seria bonului.'),
  locationId: uuidSchema,
  workUnitId: optionalUuid,
  stageId: optionalUuid,
  contractId: uuidSchema,
  componentId: uuidSchema,
  objectiveId: uuidSchema,
  documentDate: businessDateSchema,
  effectDate: businessDateSchema,
  lines: z.array(consumptionLineInputSchema).min(1, 'Bonul are nevoie de cel puțin o linie.'),
});

export type CreateLocationInput = z.input<typeof createLocationInputSchema>;
export type CreateConsumptionNoteInput = z.input<typeof createConsumptionNoteInputSchema>;
export type ConsumptionLineInput = z.input<typeof consumptionLineInputSchema>;
