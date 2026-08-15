/**
 * Use-case-uri: orchestreaza `domain` + `db` + `jobs` + `storage`.
 *
 * E singurul strat care are voie sa deschida tranzactii. Un use-case = o
 * tranzactie = o unitate atomica. Cand un job trebuie lansat impreuna cu o
 * mutatie, enqueue-ul intra in aceeasi tranzactie — daca ea da rollback,
 * jobul dispare cu ea.
 */
export { checkHealth } from './health';
export type { HealthReport, ComponentStatus } from './health';

export { ensureOpenPeriods } from './periods';
export type { EnsureOpenPeriodsResult } from './periods';

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

export { listAuditEntries } from './audit';
export type { AuditEntry } from './audit';

export { countNomenclature, searchEverything } from './search';
export type { SearchGroup, SearchHit } from './search';
