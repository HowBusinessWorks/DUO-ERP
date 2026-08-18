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
  applyIndexation,
  buildContractYears,
  CEILING_WARNING_PERCENT,
  ceilingUsage,
  compareDates,
  contractYearAt,
  daysInMonth,
  deltaFill,
  previousDay,
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
  ContractYear,
  ContractYearsInput,
  DeltaFill,
  DeltaFillInput,
  DeltaState,
} from './contracts';
export {
  estimateFromCatalog,
  ROUTING_CHOICES,
  routeRequest,
  selectBacklogToFill,
  splitDeltaAcrossPeriods,
} from './requests';
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
