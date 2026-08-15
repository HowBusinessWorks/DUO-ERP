import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Schemele bazei de date:
 *   app    — business
 *   audit  — jurnale
 *   jobs   — pg-boss
 *   public — ramane gol, intentionat
 */
export const app = pgSchema('app');

/*
 * Toate tipurile enumerate din PLAN_TEHNIC Anexa C.0.
 *
 * Le cream pe toate de la prima migrare, chiar daca tabelele care le folosesc
 * vin in pasii 04-09: costa zero acum si evita o migrare de tip mai tarziu,
 * cand deja exista date.
 */

// ── identitate ──────────────────────────────────────────────────────────────
export const personaEnum = app.enum('persona', ['office', 'field', 'subcontractor', 'client']);

export const officeRoleEnum = app.enum('office_role', [
  'pm',
  'devizist',
  'achizitii',
  'magazie',
  'flota',
  'financiar',
  'admin',
]);

export const personCategoryEnum = app.enum('person_category', [
  'angajat',
  'sef_santier',
  'subcontractant',
  'client_user',
]);

// ── contracte ───────────────────────────────────────────────────────────────
export const contractTypeEnum = app.enum('contract_type', [
  'mentenanta_multianual',
  'individual_deviz',
  'individual_taxare_inversa',
]);

export const componentTypeEnum = app.enum('component_type', [
  'mentenanta',
  'lucrari',
  'delta',
  'individual',
]);

export const budgetCadenceEnum = app.enum('budget_cadence', ['lunar', 'anual']);

// ── unitatea de lucru ───────────────────────────────────────────────────────
export const workUnitTypeEnum = app.enum('work_unit_type', ['inspectie', 'interventie', 'lucrare']);

export const workUnitStatusEnum = app.enum('work_unit_status', [
  'draft',
  'planificata',
  'in_executie',
  'suspendata',
  'finalizata',
  'inchisa',
  'anulata',
]);

export const executorTypeEnum = app.enum('executor_type', ['echipa_proprie', 'subcontractant']);

// ── cereri si rutare ────────────────────────────────────────────────────────
export const requestTypeEnum = app.enum('request_type', [
  'tichet_client',
  'solicitare',
  'constatare_inspectie',
  'propunere_interna',
  'solicitare_utilaj',
  'observatie_utilaj',
]);

export const requestSourceEnum = app.enum('request_source', [
  'email',
  'manual',
  'fisa_inspectie',
  'utilaj',
]);

export const requestStatusEnum = app.enum('request_status', [
  'neprocesata',
  'in_evaluare',
  'decisa',
  'in_backlog',
  'respinsa',
  'anulata',
]);

export const routingChoiceEnum = app.enum('routing_choice', [
  'interventie_mentenanta',
  'lucrare_delta',
  'lucrare_delta_multi_luna',
  'lucrare_componenta_lucrari',
  'contract_individual_nou',
  'amanata_backlog',
]);

// ── registrul de cost ───────────────────────────────────────────────────────
export const expenseTypeEnum = app.enum('expense_type', [
  'material',
  'manopera_proprie',
  'servicii_subc',
  'utilaj',
  'motorina',
  'transport',
  'reparatii',
  'alte',
]);

export const costStageEnum = app.enum('cost_stage', [
  'angajat',
  'receptionat',
  'consumat',
  'facturat',
]);

export const costDocumentTypeEnum = app.enum('cost_document_type', [
  'bon_consum',
  'situatie_lucrari',
  'factura_furnizor',
  'fisa_motorina',
  'fisa_utilaj',
  'pontaj',
  'fisa_interventie',
  'comanda',
  'nir',
  'nota_realocare',
  'ajustare_pret',
  'fisa_reparatie',
]);

// ── perioade si alocari ─────────────────────────────────────────────────────
export const periodStatusEnum = app.enum('period_status', ['open', 'closing', 'closed']);

export const allocationStatusEnum = app.enum('allocation_status', ['active', 'superseded']);

// ── fisiere ─────────────────────────────────────────────────────────────────
export const nodeKindEnum = app.enum('node_kind', ['folder', 'file']);

export const nodeRoleEnum = app.enum('node_role', [
  'root_company',
  'contract',
  'objective',
  'work_unit',
  'stage',
  'system',
  'user',
]);

export const fileStateEnum = app.enum('file_state', [
  'uploading',
  'ready',
  'failed',
  'quarantined',
]);

export const sharePermissionEnum = app.enum('share_permission', ['read', 'write', 'manage']);

// ── gestiune si teren ───────────────────────────────────────────────────────
export const locationTypeEnum = app.enum('location_type', [
  'magazie_centrala',
  'consignatie',
  'santier',
  'echipa',
  'subcontractant',
  'unelte',
  'utilaje',
]);

export const checklistAnswerEnum = app.enum('checklist_answer', ['ok', 'nok', 'na']);

export const findingOutcomeEnum = app.enum('finding_outcome', [
  'rezolvat_pe_loc',
  'interventie',
  'propunere',
]);

export const geoSourceEnum = app.enum('geo_source', ['exif', 'device', 'manual']);

// ── documente numerotate si audit (pasul 02) ────────────────────────────────

/**
 * Documentele care primesc serie si numar per firma (PLAN_TEHNIC 4.10).
 *
 * Lista acopera toata faza 0, nu doar pasii facuti pana acum: adaugarea unei
 * valori la un enum dupa ce exista date e o migrare in plus, iar o valoare
 * nefolosita nu costa nimic.
 */
export const numberedDocumentTypeEnum = app.enum('numbered_document_type', [
  'factura',
  'situatie_lucrari',
  'comanda',
  'nir',
  'aviz_transfer',
  'aviz_retur',
  'bon_consum',
  'pv_receptie',
  'pv_custodie',
  'lista_inventar',
  'decizie_inventariere',
  'nota_diferente',
  'nota_realocare',
]);

export const auditOpEnum = app.enum('audit_op', ['insert', 'update', 'delete']);

// ── notificari (pasul 03) ───────────────────────────────────────────────────

/**
 * Severitatea unei alerte. Enum, spre deosebire de `kind`, pentru ca decide
 * culoarea si ordinea in interfata: o lista inchisa de trei valori, care nu are
 * de ce sa creasca. `kind` ramane text — fiecare pas isi aduce pragurile lui.
 */
export const alertSeverityEnum = app.enum('alert_severity', ['info', 'warning', 'critical']);
