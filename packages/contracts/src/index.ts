/**
 * Schemele Zod de intrare/iesire pentru fiecare use-case.
 *
 * Sunt granita dintre browser si server: `react-hook-form` valideaza cu ele in
 * formular, `createAction` valideaza cu ele in server action, iar use-case-ul
 * primeste deja tipul de iesire. Nu exista o a doua definitie care sa se abata.
 */
export {
  businessDateSchema,
  moneySchema,
  officeRoleSchema,
  periodKeySchema,
  personaSchema,
  quantitySchema,
  uuidSchema,
} from './primitives';
export type { OfficeRole, PeriodKeyInput, Uuid } from './primitives';

export {
  clientInputSchema,
  cuiSchema,
  productInputSchema,
  qualificationInputSchema,
  rateCardInputSchema,
  subcontractorInputSchema,
  supplierInputSchema,
  UNITS_OF_MEASURE,
  withId,
  WORK_QUEUE_KINDS,
} from './nomenclature';
export type {
  ClientInput,
  ProductInput,
  QualificationInput,
  RateCardInput,
  SubcontractorInput,
  SupplierInput,
  WorkQueueKind,
} from './nomenclature';
