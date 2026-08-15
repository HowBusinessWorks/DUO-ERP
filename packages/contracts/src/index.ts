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

export {
  componentInputSchema,
  COMPONENT_TYPE_LABELS,
  COMPONENT_TYPES,
  contractInputSchema,
  CONTRACT_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  CONTRACT_TYPES,
  costCeilingInputSchema,
  revenueCeilingInputSchema,
} from './contracts';
export type {
  ComponentInput,
  ContractInput,
  CostCeilingInput,
  RevenueCeilingInput,
} from './contracts';

export {
  checklistInputSchema,
  contractObjectiveInputSchema,
  inspectionProfileInputSchema,
  inspectionProfileItemInputSchema,
  objectiveInputSchema,
  OBJECTIVE_KIND_LABELS,
  OBJECTIVE_KINDS,
} from './objectives';
export type {
  ChecklistInput,
  ContractObjectiveInput,
  InspectionProfileInput,
  InspectionProfileItemInput,
  ObjectiveInput,
} from './objectives';
