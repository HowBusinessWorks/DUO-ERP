/**
 * Use-case-uri: orchestreaza `domain` + `db` + `jobs` + `storage`.
 *
 * E singurul strat care are voie sa deschida tranzactii. Un use-case = o
 * tranzactie = o unitate atomica. Cand un job trebuie lansat impreuna cu o
 * mutatie, enqueue-ul intra in aceeasi tranzactie — daca ea da rollback,
 * jobul dispare cu ea.
 */
export { clearMustChangePassword } from './auth';

export { checkHealth } from './health';
export type { HealthReport, ComponentStatus } from './health';

export { ensureOpenPeriods, findPeriodId, listPeriodOptions } from './periods';
export type { EnsureOpenPeriodsResult, PeriodOption } from './periods';

export { getPeriodContext, listCompanies } from './context';
export type { CompanyOption, PeriodContext, PeriodState, PeriodStatus } from './context';

export {
  countRateCardsByQualification,
  createClient,
  createProduct,
  createQualification,
  createRateCard,
  createSubcontractor,
  createSupplier,
  getClient,
  getProduct,
  getQualification,
  getSubcontractor,
  getSupplier,
  listClients,
  listProducts,
  listQualifications,
  listRateCards,
  listSubcontractors,
  listSuppliers,
  updateClient,
  updateProduct,
  updateSubcontractor,
  updateSupplier,
} from './nomenclature';
export type {
  ClientRow,
  ListOptions,
  ProductRow,
  QualificationRow,
  RateCardRow,
  SubcontractorRow,
  SupplierRow,
} from './nomenclature';

export {
  countUnreadNotifications,
  countWorkQueue,
  listNotifications,
  listOpenAlerts,
  listWorkQueue,
  markAllNotificationsRead,
  markNotificationRead,
  raiseAlert,
  resolveAlert,
  resolveWorkQueueItem,
} from './notifications';
export type {
  AlertRow,
  NotificationRow,
  QueueCount,
  RaiseAlertInput,
  WorkQueueRow,
} from './notifications';

export {
  countCeilingsWithoutValue,
  createComponent,
  createContract,
  getContract,
  getContractOverview,
  listCeilings,
  listComponents,
  listContracts,
  listContractsForObjective,
  listContractYears,
  listExpiringContracts,
  listUnderfilledDelta,
  setCostCeiling,
  setRevenueCeiling,
  updateContract,
} from './contracts';
export type {
  CeilingRow,
  ComponentBand,
  ComponentRow,
  ContractOverview,
  ContractRow,
  ContractYearRow,
  DeltaUnderfilled,
  ExpiringContract,
  ListCeilingsOptions,
  ListContractsOptions,
} from './contracts';

export {
  clearDeltaAlert,
  clearExpiryAlert,
  CONTRACT_ALERT_KINDS,
  scanContractExpiry,
  scanDeltaFill,
  totalUnfilled,
} from './contract-alerts';

export {
  addProfileItem,
  createChecklist,
  createInspectionProfile,
  createObjective,
  getInspectionCoverage,
  getObjective,
  linkObjective,
  listChecklists,
  listContractObjectives,
  listInspectionProfiles,
  listObjectives,
  setInspectionProfile,
  unlinkObjective,
  updateObjective,
} from './objectives';
export type {
  ChecklistRow,
  ContractObjectiveRow,
  CoverageReport,
  CoverageRow,
  InspectionProfileRow,
  ListObjectivesOptions,
  ObjectiveRow,
} from './objectives';

export {
  createPerson,
  getPerson,
  linkAuthUser,
  listPersonOptions,
  listPersons,
  revokeSessions,
  setCompanyAccess,
  setOfficeRoles,
  updatePerson,
} from './admin';
export type { ListPersonsOptions, PersonOption, PersonRow } from './admin';

export { listAuditEntries, listRecentAuditEntries } from './audit';
export type { AuditEntry, AuditFeedEntry } from './audit';

export { countNomenclature, searchEverything } from './search';
export type { SearchGroup, SearchHit } from './search';

export { pgMessage, sqlstate, SQLSTATE, translateDbError } from './db-errors';

export {
  allocateFunding,
  closeWorkUnit,
  createStage,
  createWorkUnit,
  createWorkUnitFromForm,
  getClosingChecklist,
  getStage,
  getStageOverview,
  getWorkUnit,
  listAllocations,
  listAssignments,
  listReallocationDocuments,
  listStages,
  listStagesForCompanies,
  listWorkUnits,
  moveFunding,
  previewFundingMove,
  promoteToLucrare,
  promotionCheckFor,
  reorderStages,
} from './work-units';
export type {
  AllocationRow,
  AssignmentRow,
  ClosingChecklist,
  ClosingChecklistItem,
  ClosingItemState,
  FundingMovePreview,
  FundingMoveTarget,
  ListWorkUnitsOptions,
  MoveFundingResult,
  PromotionCheck,
  ReallocationDocumentRow,
  StageRow,
  StageWithWorkUnitRow,
  WorkUnitRow,
} from './work-units';

export {
  costBreakdown,
  costLineIdsForMove,
  listCostLines,
  listReconciliation,
  rechargeCostLines,
  recordCost,
  stornoCost,
  verifyRollups,
} from './cost';
export type {
  CostBreakdownRow,
  CostLineRow,
  RecordCostResult,
  ReconciliationRow,
  RollupDivergence,
} from './cost';

export {
  clearRollupAlert,
  COST_ALERT_KINDS,
  readIntegrityMetrics,
  verifyRollupsJob,
} from './cost-integrity';
export type { IntegrityMetrics } from './cost-integrity';

export {
  CLOSE_CHECKS,
  closePeriod,
  evaluatePeriodClose,
  reopenPeriod,
  startClosing,
} from './period-close';
export type {
  CloseCheckResult,
  CloseCheckRow,
  CloseCheckSpec,
  CloseCheckStatus,
  PeriodCloseState,
} from './period-close';
