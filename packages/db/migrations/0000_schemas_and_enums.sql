CREATE SCHEMA "app";
--> statement-breakpoint
-- audit si jobs nu au tabele in Drizzle (audit e scris de triggere, jobs apartine
-- lui pg-boss), deci schemele lor se creeaza explicit aici. `public` ramane gol.
CREATE SCHEMA IF NOT EXISTS "audit";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "jobs";
--> statement-breakpoint
CREATE TYPE "app"."allocation_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TYPE "app"."budget_cadence" AS ENUM('lunar', 'anual');--> statement-breakpoint
CREATE TYPE "app"."checklist_answer" AS ENUM('ok', 'nok', 'na');--> statement-breakpoint
CREATE TYPE "app"."component_type" AS ENUM('mentenanta', 'lucrari', 'delta', 'individual');--> statement-breakpoint
CREATE TYPE "app"."contract_type" AS ENUM('mentenanta_multianual', 'individual_deviz', 'individual_taxare_inversa');--> statement-breakpoint
CREATE TYPE "app"."cost_document_type" AS ENUM('bon_consum', 'situatie_lucrari', 'factura_furnizor', 'fisa_motorina', 'fisa_utilaj', 'pontaj', 'fisa_interventie', 'comanda', 'nir', 'nota_realocare', 'ajustare_pret', 'fisa_reparatie');--> statement-breakpoint
CREATE TYPE "app"."cost_stage" AS ENUM('angajat', 'receptionat', 'consumat', 'facturat');--> statement-breakpoint
CREATE TYPE "app"."executor_type" AS ENUM('echipa_proprie', 'subcontractant');--> statement-breakpoint
CREATE TYPE "app"."expense_type" AS ENUM('material', 'manopera_proprie', 'servicii_subc', 'utilaj', 'motorina', 'transport', 'reparatii', 'alte');--> statement-breakpoint
CREATE TYPE "app"."file_state" AS ENUM('uploading', 'ready', 'failed', 'quarantined');--> statement-breakpoint
CREATE TYPE "app"."finding_outcome" AS ENUM('rezolvat_pe_loc', 'interventie', 'propunere');--> statement-breakpoint
CREATE TYPE "app"."geo_source" AS ENUM('exif', 'device', 'manual');--> statement-breakpoint
CREATE TYPE "app"."location_type" AS ENUM('magazie_centrala', 'consignatie', 'santier', 'echipa', 'subcontractant', 'unelte', 'utilaje');--> statement-breakpoint
CREATE TYPE "app"."node_kind" AS ENUM('folder', 'file');--> statement-breakpoint
CREATE TYPE "app"."node_role" AS ENUM('root_company', 'contract', 'objective', 'work_unit', 'stage', 'system', 'user');--> statement-breakpoint
CREATE TYPE "app"."office_role" AS ENUM('pm', 'devizist', 'achizitii', 'magazie', 'flota', 'financiar', 'admin');--> statement-breakpoint
CREATE TYPE "app"."period_status" AS ENUM('open', 'closing', 'closed');--> statement-breakpoint
CREATE TYPE "app"."person_category" AS ENUM('angajat', 'sef_santier', 'subcontractant', 'client_user');--> statement-breakpoint
CREATE TYPE "app"."persona" AS ENUM('office', 'field', 'subcontractor', 'client');--> statement-breakpoint
CREATE TYPE "app"."request_source" AS ENUM('email', 'manual', 'fisa_inspectie', 'utilaj');--> statement-breakpoint
CREATE TYPE "app"."request_status" AS ENUM('neprocesata', 'in_evaluare', 'decisa', 'in_backlog', 'respinsa', 'anulata');--> statement-breakpoint
CREATE TYPE "app"."request_type" AS ENUM('tichet_client', 'solicitare', 'constatare_inspectie', 'propunere_interna', 'solicitare_utilaj', 'observatie_utilaj');--> statement-breakpoint
CREATE TYPE "app"."routing_choice" AS ENUM('interventie_mentenanta', 'lucrare_delta', 'lucrare_delta_multi_luna', 'lucrare_componenta_lucrari', 'contract_individual_nou', 'amanata_backlog');--> statement-breakpoint
CREATE TYPE "app"."share_permission" AS ENUM('read', 'write', 'manage');--> statement-breakpoint
CREATE TYPE "app"."work_unit_status" AS ENUM('draft', 'planificata', 'in_executie', 'suspendata', 'finalizata', 'inchisa', 'anulata');--> statement-breakpoint
CREATE TYPE "app"."work_unit_type" AS ENUM('inspectie', 'interventie', 'lucrare');