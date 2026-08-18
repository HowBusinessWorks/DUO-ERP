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
  listComponentsForContracts,
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
  listDocumentSeries,
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
  contractMargin,
  costBreakdown,
  costLineIdsForMove,
  listCostLines,
  listReconciliation,
  objectiveCostHistory,
  objectiveWorkHistory,
  rechargeCostLines,
  recomputeOverheadSnapshot,
  recordCost,
  stornoCost,
  verifyRollups,
} from './cost';
export type {
  ContractMargin,
  CostBreakdownRow,
  CostLineRow,
  ObjectiveCostYear,
  ObjectiveHistoryEntry,
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

export {
  applyExif,
  breadcrumb,
  cleanupFiles,
  companyRootFolder,
  completeUpload,
  countChildren,
  createFolder,
  deriveSource,
  downloadUrl,
  folderForEntity,
  listChildren,
  listShares,
  listTrash,
  listVersions,
  moveNode,
  nodeSummary,
  presignUpload,
  previewUrl,
  recordDerivedAsset,
  renameNode,
  restoreNode,
  shareNode,
  thumbnailUrl,
  trashNode,
  unshareNode,
} from './files';
export type {
  CleanupReport,
  CompletedUpload,
  Crumb,
  DeriveSource,
  DownloadTarget,
  ExifFacts,
  NodeRow,
  NodeSummaryRow,
  PresignedUpload,
  ShareRow,
  VersionRow,
} from './files';

export {
  createRequest,
  decideRouting,
  deltaFreeForContract,
  evaluateRequest,
  expireBacklogProposals,
  getRequest,
  getRequestEmail,
  listBacklogProposals,
  listDecisionsForRequest,
  listEstimateLines,
  listRequests,
  listRoutingDecisions,
  monthLabel,
  promoteBacklog,
  proposeRouting,
  routingContext,
  runBacklogExpiry,
  suggestBacklogFill,
  triageRequest,
} from './requests';
export type {
  BacklogRow,
  DecisionJournal,
  DeltaMonth,
  EstimateLineRow,
  ListBacklogOptions,
  ListRequestsOptions,
  RequestEmailRow,
  RequestRow,
  RoutingContext,
  RoutingDecisionRow,
} from './requests';
/*
 * Tipurile propunerii de rutare vin din `domain`, dar se re-exporta de aici.
 * `apps/web` n-are voie sa importe `domain` (regula de dependente din §3.2), iar
 * ecranul de Decizie are nevoie de forma optiunilor. Re-exportul e singurul mod
 * de a i-o da fara sa se sara peste `services`.
 */
export type { RoutingChoice, RoutingOption, RoutingProposal } from '@damina/domain';

export {
  createOperation,
  getOperation,
  listOperationMaterials,
  listOperations,
  operationActuals,
  setOperationMaterials,
  updateOperation,
} from './operations';
export type {
  ListOperationsOptions,
  OperationActualRow,
  OperationActualsReport,
  OperationMaterialRow,
  OperationRow,
} from './operations';

// ── Pasul 09: fise de lucru, pontaj, gestiuni ────────────────────────────────

export {
  checklistsForContractObjective,
  createInspection,
  getInspectionSheet,
  inspectionCoverage,
  listUnvalidatedInspections,
  saveInspection,
  validateInspection,
  validateInspections,
} from './inspections';
export type {
  InspectionCoverage,
  InspectionCoverageRow,
  InspectionPointRow,
  InspectionSheet,
  SaveInspectionResult,
} from './inspections';

export {
  createIntervention,
  getInterventionSheet,
  listInterventionHours,
  listInterventionMaterials,
  listUnvalidatedInterventions,
  saveIntervention,
  validateIntervention,
} from './interventions';
export type {
  InterventionHourRow,
  InterventionMaterialRow,
  InterventionSheet,
  ValidateInterventionResult,
} from './interventions';

export {
  declareSubcontractorAttendance,
  listSubcontractorAttendance,
  listTimesheetWeek,
  listUnvalidatedTimesheets,
  saveTimesheet,
  validateTimesheets,
} from './timesheets';
export type {
  TimesheetLineRow,
  TimesheetRow,
  TimesheetWeek,
  ValidateTimesheetsResult,
} from './timesheets';

export { INVENTORY_ALERT_KINDS, verifyStockJob } from './inventory-integrity';

export { pullFieldSnapshot } from './field-snapshot';
export type {
  FieldChecklist,
  FieldChecklistItem,
  FieldPerson,
  FieldSeries,
  FieldSnapshot,
  FieldStage,
  FieldStockLine,
  FieldWorkUnit,
} from './field-snapshot';

export { markPulled, pruneAppliedMutations, pushMutations, readCursor } from './field-sync';
export type { PushResult, SyncCursor } from './field-sync';

export {
  consumptionAnalyticsFor,
  createConsumptionNote,
  createLocation,
  issueConsumptionNoteTx,
  listConsumptionNotes,
  listLocations,
  listStock,
  listTeamOptions,
  unitCostKey,
  verifyStockBalances,
} from './inventory';
export type {
  ConsumptionAnalytics,
  ConsumptionNoteRow,
  IssuedConsumptionNote,
  ListStockOptions,
  LocationRow,
  StockDivergence,
  StockRow,
  TeamOption,
} from './inventory';

export {
  computeVariance,
  describeInspectionBlocker,
  describeVariance,
  inspectionValidationCheck,
  rateCardAt,
  timesheetTotals,
} from '@damina/domain';
export type { InspectionBlocker, InspectionValidationCheck, VarianceResult } from '@damina/domain';
