/**
 * Reguli de business pure. Fara I/O, fara baza de date, fara retea.
 *
 * Regula de dependente (verificata de eslint-plugin-boundaries, blocanta in CI):
 * `domain` poate importa DOAR `shared`. Nu are voie sa vada `db`.
 *
 * Motivul: calculul de plafon, decizia de rutare, mecanica de re-alocare si CMP
 * trebuie sa fie testabile in milisecunde, fara sa porneasca un Postgres.
 */

export const DOMAIN_PACKAGE_READY = true;

export {
  addYears,
  aggregateDeltaFill,
  applyIndexation,
  buildContractYears,
  CEILING_WARNING_PERCENT,
  ceilingUsage,
  consumptionRisk,
  compareDates,
  contractYearAt,
  daysInMonth,
  deltaFill,
  previousDay,
  RISK_CRITICAL_GAP,
} from './contracts';
export {
  allocatedTotal,
  canPromote,
  describeFundingMove,
  physicalProgress,
  planFundingMove,
  PROMOTION_ADDS,
  PROMOTION_PRESERVES,
  splitAcrossPeriods,
  stageScheduleIsCoherent,
  validateAllocationSum,
} from './funding';
export type {
  AllocationLike,
  AllocationProblem,
  AllocationProblemCode,
  AllocationSplit,
  AllocationSumCheck,
  FundingMovePlan,
  FundingTarget,
  MoveFundingInput,
  PeriodStatus,
  PhysicalProgress,
  PromotableWorkUnit,
  PromotionBlockerCode,
  PromotionCheck,
  ReallocationEntry,
  StageLike,
  StageProblem,
  StageProblemCode,
  StageScheduleCheck,
  WorkUnitStatus,
  WorkUnitType,
} from './funding';
export type {
  BusinessDate,
  CeilingState,
  CeilingUsage,
  CeilingUsageInput,
  ConsumptionRisk,
  ContractYear,
  ContractYearsInput,
  DeltaFill,
  DeltaFillInput,
  DeltaFillPart,
  DeltaState,
  RiskSeverity,
} from './contracts';
export {
  estimateFromCatalog,
  ROUTING_CHOICES,
  isCommercialOpportunity,
  routeRequest,
  selectBacklogToFill,
  splitDeltaAcrossPeriods,
} from './requests';
export {
  computeVariance,
  DEFAULT_VARIANCE_THRESHOLD,
  describeInspectionBlocker,
  describeVariance,
  INSPECTION_BLOCKER_MESSAGES,
  inspectionValidationCheck,
  MAX_HOURS_PER_DAY,
  rateCardAt,
  timesheetTotals,
} from './sheets';
export type {
  AnswerLike,
  ChecklistPointLike,
  InspectionBlocker,
  InspectionBlockerCode,
  InspectionValidationCheck,
  LaborConsumption,
  MaterialConsumption,
  RateCardLike,
  TimesheetLineLike,
  TimesheetTotals,
  VarianceInput,
  VarianceResult,
} from './sheets';
export type {
  BacklogProposalLike,
  BacklogSelection,
  DeltaPeriodFree,
  DeltaSplitPart,
  EstimateLineInput,
  EstimateResult,
  RouteRequestInput,
  RoutingCeilings,
  RoutingChoice,
  RoutingOption,
  RoutingProposal,
} from './requests';

export {
  REPORT_STATUSES,
  canIssueMaintenanceInvoice,
  reportProgress,
  reportTransition,
} from './reports';
export type { ReportAction, ReportProgress, ReportStatus, ReportTransition } from './reports';

export {
  deriveOneToOne,
  explodeNormedArticle,
  rollupDeviz,
  validateMapping,
} from './deviz';
export type {
  AdoptableClientLine,
  DevizAmounts,
  DevizCategoryLike,
  DevizCategoryRollup,
  DevizLineLike,
  DevizRollup,
  DevizRollupInput,
  ExplodedDevizLine,
  MappingCheck,
  MappingCoefficientProblem,
  MappingLike,
  NormedArticleLike,
  NormedComponentKind,
  NormedComponentLike,
  OneToOneDraft,
} from './deviz';
