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
  accountActionInputSchema,
  ACCOUNT_ACTIONS,
  companyAccessInputSchema,
  officeRolesInputSchema,
  OFFICE_ROLE_LABELS,
  PERSONA_LABELS,
  personCategorySchema,
  personInputSchema,
  PERSON_CATEGORIES,
  PERSON_CATEGORY_LABELS,
  provisionAccountInputSchema,
} from './admin';
export type {
  AccountAction,
  AccountActionInput,
  CompanyAccessInput,
  OfficeRolesInput,
  PersonCategory,
  PersonInput,
  ProvisionAccountInput,
} from './admin';

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

export {
  closeWorkUnitInputSchema,
  createWorkUnitInputSchema,
  EXECUTOR_TYPE_LABELS,
  EXECUTOR_TYPES,
  fundingAllocationInputSchema,
  moveFundingInputSchema,
  promoteWorkUnitInputSchema,
  reorderStagesInputSchema,
  workStageInputSchema,
  workUnitAssignmentInputSchema,
  workUnitFormSchema,
  workUnitInputSchema,
  WORK_UNIT_ROLE_LABELS,
  WORK_UNIT_ROLES,
  WORK_UNIT_STATUS_LABELS,
  WORK_UNIT_STATUSES,
  WORK_UNIT_TYPE_LABELS,
  WORK_UNIT_TYPES,
} from './work-units';
export type {
  CloseWorkUnitInput,
  CreateWorkUnitInput,
  ExecutorType,
  FundingAllocationInput,
  MoveFundingInputDto,
  PromoteWorkUnitInput,
  ReorderStagesInput,
  WorkStageInput,
  WorkUnitAssignmentInput,
  WorkUnitFormInput,
  WorkUnitInput,
  WorkUnitRole,
  WorkUnitStatusValue,
  WorkUnitType,
} from './work-units';
