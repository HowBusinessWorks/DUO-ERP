CREATE TABLE "app"."consumption_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"note_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_lines_quantity_positive" CHECK ("app"."consumption_lines"."quantity" > 0),
	CONSTRAINT "consumption_lines_unit_cost_non_negative" CHECK ("app"."consumption_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."consumption_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"series" text NOT NULL,
	"number" text NOT NULL,
	"location_id" uuid NOT NULL,
	"work_unit_id" uuid,
	"stage_id" uuid,
	"contract_id" uuid,
	"component_id" uuid,
	"objective_id" uuid,
	"document_date" date NOT NULL,
	"effect_date" date NOT NULL,
	"period_id" uuid,
	"issued_by" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumption_notes_company_number_unique" UNIQUE("company_id","number"),
	CONSTRAINT "consumption_notes_number_not_blank" CHECK (length(btrim("app"."consumption_notes"."number")) > 0),
	CONSTRAINT "consumption_notes_status_known" CHECK ("app"."consumption_notes"."status" in ('draft', 'consumat', 'anulat')),
	CONSTRAINT "consumption_notes_component_has_contract" CHECK ("app"."consumption_notes"."component_id" is null or "app"."consumption_notes"."contract_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "app"."locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"type" "app"."location_type" NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"parent_location_id" uuid,
	"team_id" uuid,
	"work_unit_id" uuid,
	"subcontractor_id" uuid,
	"supplier_id" uuid,
	"address" jsonb,
	"geo_lat" numeric(9, 6),
	"geo_lng" numeric(9, 6),
	"is_custody" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_company_code_unique" UNIQUE("company_id","code"),
	CONSTRAINT "locations_name_not_blank" CHECK (length(btrim("app"."locations"."name")) > 0),
	CONSTRAINT "locations_code_not_blank" CHECK (length(btrim("app"."locations"."code")) > 0),
	CONSTRAINT "locations_not_own_parent" CHECK ("app"."locations"."parent_location_id" is distinct from "app"."locations"."id"),
	CONSTRAINT "locations_holder_matches_type" CHECK (("app"."locations"."type" = 'echipa') = ("app"."locations"."team_id" is not null)
          and ("app"."locations"."type" = 'santier') = ("app"."locations"."work_unit_id" is not null)
          and ("app"."locations"."type" = 'subcontractant') = ("app"."locations"."subcontractor_id" is not null)
          and ("app"."locations"."type" = 'consignatie') = ("app"."locations"."supplier_id" is not null)),
	CONSTRAINT "locations_geo_pair" CHECK (num_nonnulls("app"."locations"."geo_lat", "app"."locations"."geo_lng") <> 1)
);
--> statement-breakpoint
CREATE TABLE "app"."stock_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"location_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"qty_physical" numeric(14, 4) DEFAULT '0' NOT NULL,
	"qty_reserved" numeric(14, 4) DEFAULT '0' NOT NULL,
	"avg_cost" numeric(14, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_physical_non_negative" CHECK ("app"."stock_balances"."qty_physical" >= 0),
	CONSTRAINT "stock_balances_reserved_non_negative" CHECK ("app"."stock_balances"."qty_reserved" >= 0),
	CONSTRAINT "stock_balances_avg_cost_non_negative" CHECK ("app"."stock_balances"."avg_cost" is null or "app"."stock_balances"."avg_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"period_id" uuid,
	"document_type" text NOT NULL,
	"document_id" uuid NOT NULL,
	"document_line_id" uuid,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_cost" numeric(14, 4),
	"effect_date" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_positive" CHECK ("app"."stock_movements"."quantity" > 0),
	CONSTRAINT "stock_movements_unit_cost_non_negative" CHECK ("app"."stock_movements"."unit_cost" is null or "app"."stock_movements"."unit_cost" >= 0),
	CONSTRAINT "stock_movements_has_direction" CHECK (num_nonnulls("app"."stock_movements"."from_location_id", "app"."stock_movements"."to_location_id") >= 1),
	CONSTRAINT "stock_movements_not_circular" CHECK ("app"."stock_movements"."from_location_id" is distinct from "app"."stock_movements"."to_location_id")
);
--> statement-breakpoint
CREATE TABLE "app"."inspection_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"checklist_item_id" uuid NOT NULL,
	"answer" "app"."checklist_answer" NOT NULL,
	"note" text,
	"photo_node_id" uuid,
	CONSTRAINT "inspection_answers_item_unique" UNIQUE("work_unit_id","checklist_item_id")
);
--> statement-breakpoint
CREATE TABLE "app"."inspection_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"outcome" "app"."finding_outcome" NOT NULL,
	"resolution_note" text,
	"created_request_id" uuid,
	"backlog_proposal_id" uuid,
	"estimated_value" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_findings_answer_unique" UNIQUE("answer_id"),
	CONSTRAINT "inspection_findings_estimated_value_non_negative" CHECK ("app"."inspection_findings"."estimated_value" is null or "app"."inspection_findings"."estimated_value" >= 0),
	CONSTRAINT "inspection_findings_one_target" CHECK (num_nonnulls("app"."inspection_findings"."created_request_id", "app"."inspection_findings"."backlog_proposal_id") <= 1),
	CONSTRAINT "inspection_findings_resolved_has_note" CHECK ("app"."inspection_findings"."outcome" <> 'rezolvat_pe_loc' or length(btrim(coalesce("app"."inspection_findings"."resolution_note", ''))) > 0),
	CONSTRAINT "inspection_findings_proposal_has_value" CHECK ("app"."inspection_findings"."outcome" <> 'propunere' or "app"."inspection_findings"."estimated_value" is not null)
);
--> statement-breakpoint
CREATE TABLE "app"."inspections" (
	"work_unit_id" uuid PRIMARY KEY NOT NULL,
	"checklist_id" uuid NOT NULL,
	"checklist_version" smallint NOT NULL,
	"performed_on" date NOT NULL,
	"performed_by" uuid,
	"effect_date" date,
	"validated_at" timestamp with time zone,
	"validated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspections_checklist_version_positive" CHECK ("app"."inspections"."checklist_version" > 0),
	CONSTRAINT "inspections_validated_complete" CHECK (num_nonnulls("app"."inspections"."validated_at", "app"."inspections"."validated_by") <> 1),
	CONSTRAINT "inspections_effect_date_with_validation" CHECK (("app"."inspections"."effect_date" is not null) = ("app"."inspections"."validated_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."intervention_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"hours" numeric(14, 4) NOT NULL,
	"work_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intervention_hours_positive" CHECK ("app"."intervention_hours"."hours" > 0 and "app"."intervention_hours"."hours" <= 24)
);
--> statement-breakpoint
CREATE TABLE "app"."intervention_materials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"quantity" numeric(14, 4) NOT NULL,
	"location_id" uuid NOT NULL,
	"consumption_note_id" uuid,
	"unit_cost" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intervention_materials_quantity_positive" CHECK ("app"."intervention_materials"."quantity" > 0),
	CONSTRAINT "intervention_materials_unit_cost_non_negative" CHECK ("app"."intervention_materials"."unit_cost" is null or "app"."intervention_materials"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."interventions" (
	"work_unit_id" uuid PRIMARY KEY NOT NULL,
	"source_request_id" uuid,
	"performed_on" date NOT NULL,
	"effect_date" date,
	"description" text,
	"declared_hours" numeric(14, 4),
	"operation_id" uuid,
	"team_id" uuid,
	"expected_cost" numeric(14, 2),
	"real_cost" numeric(14, 2),
	"variance_pct" numeric(6, 4),
	"validated_at" timestamp with time zone,
	"validated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interventions_declared_hours_non_negative" CHECK ("app"."interventions"."declared_hours" is null or "app"."interventions"."declared_hours" >= 0),
	CONSTRAINT "interventions_validated_complete" CHECK (num_nonnulls("app"."interventions"."validated_at", "app"."interventions"."validated_by") <> 1),
	CONSTRAINT "interventions_effect_date_with_validation" CHECK (("app"."interventions"."effect_date" is not null) = ("app"."interventions"."validated_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."subcontractor_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"subcontractor_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"headcount" smallint NOT NULL,
	"declared_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subcontractor_attendance_unique" UNIQUE("work_unit_id","subcontractor_id","work_date"),
	CONSTRAINT "subcontractor_attendance_headcount_positive" CHECK ("app"."subcontractor_attendance"."headcount" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."timesheet_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"stage_id" uuid,
	"hours" numeric(14, 4) NOT NULL,
	"rate_card_id" uuid,
	"hourly_cost" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_lines_hours_positive" CHECK ("app"."timesheet_lines"."hours" > 0 and "app"."timesheet_lines"."hours" <= 24),
	CONSTRAINT "timesheet_lines_hourly_cost_non_negative" CHECK ("app"."timesheet_lines"."hourly_cost" is null or "app"."timesheet_lines"."hourly_cost" >= 0),
	CONSTRAINT "timesheet_lines_rate_pair" CHECK (num_nonnulls("app"."timesheet_lines"."rate_card_id", "app"."timesheet_lines"."hourly_cost") <> 1)
);
--> statement-breakpoint
CREATE TABLE "app"."timesheets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheets_person_date_unique" UNIQUE("person_id","work_date"),
	CONSTRAINT "timesheets_status_known" CHECK ("app"."timesheets"."status" in ('draft', 'submitted', 'validated')),
	CONSTRAINT "timesheets_validated_complete" CHECK (num_nonnulls("app"."timesheets"."validated_at", "app"."timesheets"."validated_by") <> 1),
	CONSTRAINT "timesheets_validated_status" CHECK (("app"."timesheets"."status" = 'validated') = ("app"."timesheets"."validated_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."products" ADD COLUMN "is_lot_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."consumption_lines" ADD CONSTRAINT "consumption_lines_note_id_consumption_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "app"."consumption_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_lines" ADD CONSTRAINT "consumption_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_notes" ADD CONSTRAINT "consumption_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_notes" ADD CONSTRAINT "consumption_notes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_notes" ADD CONSTRAINT "consumption_notes_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_notes" ADD CONSTRAINT "consumption_notes_stage_id_work_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "app"."work_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_notes" ADD CONSTRAINT "consumption_notes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_notes" ADD CONSTRAINT "consumption_notes_component_id_contract_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "app"."contract_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_notes" ADD CONSTRAINT "consumption_notes_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "app"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_notes" ADD CONSTRAINT "consumption_notes_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."consumption_notes" ADD CONSTRAINT "consumption_notes_issued_by_persons_id_fk" FOREIGN KEY ("issued_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locations" ADD CONSTRAINT "locations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locations" ADD CONSTRAINT "locations_parent_location_id_locations_id_fk" FOREIGN KEY ("parent_location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locations" ADD CONSTRAINT "locations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "app"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locations" ADD CONSTRAINT "locations_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locations" ADD CONSTRAINT "locations_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locations" ADD CONSTRAINT "locations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "app"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_balances" ADD CONSTRAINT "stock_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_balances" ADD CONSTRAINT "stock_balances_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stock_movements" ADD CONSTRAINT "stock_movements_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspection_answers" ADD CONSTRAINT "inspection_answers_work_unit_id_inspections_work_unit_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."inspections"("work_unit_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspection_answers" ADD CONSTRAINT "inspection_answers_checklist_item_id_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "app"."checklist_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspection_findings" ADD CONSTRAINT "inspection_findings_work_unit_id_inspections_work_unit_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."inspections"("work_unit_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspection_findings" ADD CONSTRAINT "inspection_findings_answer_id_inspection_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "app"."inspection_answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspection_findings" ADD CONSTRAINT "inspection_findings_created_request_id_requests_id_fk" FOREIGN KEY ("created_request_id") REFERENCES "app"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspection_findings" ADD CONSTRAINT "inspection_findings_backlog_proposal_id_backlog_proposals_id_fk" FOREIGN KEY ("backlog_proposal_id") REFERENCES "app"."backlog_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspections" ADD CONSTRAINT "inspections_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspections" ADD CONSTRAINT "inspections_checklist_id_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "app"."checklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspections" ADD CONSTRAINT "inspections_performed_by_persons_id_fk" FOREIGN KEY ("performed_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspections" ADD CONSTRAINT "inspections_validated_by_persons_id_fk" FOREIGN KEY ("validated_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."intervention_hours" ADD CONSTRAINT "intervention_hours_work_unit_id_interventions_work_unit_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."interventions"("work_unit_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."intervention_hours" ADD CONSTRAINT "intervention_hours_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."intervention_materials" ADD CONSTRAINT "intervention_materials_work_unit_id_interventions_work_unit_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."interventions"("work_unit_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."intervention_materials" ADD CONSTRAINT "intervention_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."intervention_materials" ADD CONSTRAINT "intervention_materials_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "app"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."intervention_materials" ADD CONSTRAINT "intervention_materials_consumption_note_id_consumption_notes_id_fk" FOREIGN KEY ("consumption_note_id") REFERENCES "app"."consumption_notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."interventions" ADD CONSTRAINT "interventions_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."interventions" ADD CONSTRAINT "interventions_source_request_id_requests_id_fk" FOREIGN KEY ("source_request_id") REFERENCES "app"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."interventions" ADD CONSTRAINT "interventions_operation_id_operation_catalog_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."operation_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."interventions" ADD CONSTRAINT "interventions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "app"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."interventions" ADD CONSTRAINT "interventions_validated_by_persons_id_fk" FOREIGN KEY ("validated_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_attendance" ADD CONSTRAINT "subcontractor_attendance_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_attendance" ADD CONSTRAINT "subcontractor_attendance_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."subcontractor_attendance" ADD CONSTRAINT "subcontractor_attendance_declared_by_persons_id_fk" FOREIGN KEY ("declared_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."timesheet_lines" ADD CONSTRAINT "timesheet_lines_timesheet_id_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "app"."timesheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."timesheet_lines" ADD CONSTRAINT "timesheet_lines_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."timesheet_lines" ADD CONSTRAINT "timesheet_lines_stage_id_work_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "app"."work_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."timesheet_lines" ADD CONSTRAINT "timesheet_lines_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "app"."rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."timesheets" ADD CONSTRAINT "timesheets_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."timesheets" ADD CONSTRAINT "timesheets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."timesheets" ADD CONSTRAINT "timesheets_validated_by_persons_id_fk" FOREIGN KEY ("validated_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consumption_lines_note_idx" ON "app"."consumption_lines" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "consumption_notes_work_unit_idx" ON "app"."consumption_notes" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "consumption_notes_location_idx" ON "app"."consumption_notes" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "consumption_notes_period_idx" ON "app"."consumption_notes" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "locations_company_type_idx" ON "app"."locations" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "locations_team_idx" ON "app"."locations" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "stock_balances_product_idx" ON "app"."stock_balances" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_document_idx" ON "app"."stock_movements" USING btree ("document_type","document_id");--> statement-breakpoint
CREATE INDEX "stock_movements_from_idx" ON "app"."stock_movements" USING btree ("from_location_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_to_idx" ON "app"."stock_movements" USING btree ("to_location_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_movements_period_idx" ON "app"."stock_movements" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "inspection_answers_work_unit_idx" ON "app"."inspection_answers" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "inspection_findings_work_unit_idx" ON "app"."inspection_findings" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "inspections_performed_on_idx" ON "app"."inspections" USING btree ("performed_on");--> statement-breakpoint
CREATE INDEX "inspections_effect_date_idx" ON "app"."inspections" USING btree ("effect_date");--> statement-breakpoint
CREATE INDEX "intervention_hours_work_unit_idx" ON "app"."intervention_hours" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "intervention_materials_work_unit_idx" ON "app"."intervention_materials" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "interventions_performed_on_idx" ON "app"."interventions" USING btree ("performed_on");--> statement-breakpoint
CREATE INDEX "interventions_effect_date_idx" ON "app"."interventions" USING btree ("effect_date");--> statement-breakpoint
CREATE INDEX "interventions_operation_idx" ON "app"."interventions" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "subcontractor_attendance_date_idx" ON "app"."subcontractor_attendance" USING btree ("work_date");--> statement-breakpoint
CREATE INDEX "timesheet_lines_timesheet_idx" ON "app"."timesheet_lines" USING btree ("timesheet_id");--> statement-breakpoint
CREATE INDEX "timesheet_lines_work_unit_idx" ON "app"."timesheet_lines" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "timesheets_company_date_idx" ON "app"."timesheets" USING btree ("company_id","work_date");--> statement-breakpoint
CREATE INDEX "timesheets_status_idx" ON "app"."timesheets" USING btree ("status");
-- ══ Completari scrise de mana ═══════════════════════════════════════════════

-- ── Legaturile inapoi, taiate ca sa evite cicluri de import ─────────────────
-- `teams.location_id` exista din pasul 02, fara gestiuni in baza. Acum are unde
-- sa arate. `inspection_answers.photo_node_id` la fel, cu arborele din 07a.
alter table app.teams
  add constraint teams_location_id_locations_id_fk
  foreign key (location_id) references app.locations(id);
--> statement-breakpoint

alter table app.inspection_answers
  add constraint inspection_answers_photo_node_id_nodes_id_fk
  foreign key (photo_node_id) references app.nodes(id);
--> statement-breakpoint

/*
 * Cheia naturala a soldului e (gestiune, produs, lot), dar `lot_id` e nullabil
 * si in Postgres doua NULL-uri nu sunt egale — deci un index simplu ar permite
 * cate un rand pe fiecare intrare fara lot. `coalesce` cu UUID-ul nul le face
 * comparabile, si e si expresia pe care o cere `on conflict` din trigger.
 */
create unique index stock_balances_key_unique
  on app.stock_balances (
    location_id, product_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
--> statement-breakpoint

-- ── `period_id` se deriva, nu se scrie ──────────────────────────────────────
-- Acelasi tipar ca `app.cost_line_derive_period` din 0017: aplicatia trimite
-- `effect_date`, luna o afla baza. O luna scrisa din aplicatie e o luna care
-- poate sa nu corespunda datei de efect.
create or replace function app.derive_period_from_effect_date() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $fn$
begin
  new.period_id := app.period_of(new.company_id, new.effect_date);
  return new;
end
$fn$;
--> statement-breakpoint

create trigger stock_movements_derive_period
  before insert on app.stock_movements
  for each row execute function app.derive_period_from_effect_date();
--> statement-breakpoint

create trigger consumption_notes_derive_period
  before insert or update of effect_date on app.consumption_notes
  for each row execute function app.derive_period_from_effect_date();
--> statement-breakpoint

alter table app.stock_movements alter column period_id set not null;
--> statement-breakpoint
alter table app.consumption_notes alter column period_id set not null;
--> statement-breakpoint

-- Luna inchisa blocheaza scrierea, ca peste tot unde exista bani sau cantitati
-- raportate. Ridicarea temporara se face numai prin `app.allow_closed_period`.
select app.attach_period_guard('app.stock_movements');
--> statement-breakpoint
select app.attach_period_guard('app.consumption_notes');
--> statement-breakpoint

-- ── `stock_movements` e append-only ─────────────────────────────────────────
/*
 * Regula 7 din pas. Corectia unei miscari gresite e o miscare inversa, nu un
 * `update` — altfel soldul ar putea fi „reparat" fara urma, si atunci
 * reconcilierea nocturna n-ar mai avea ce sa compare cu ce.
 *
 * Trigger SI revocare de grant: grantul apara de aplicatie, trigger-ul apara si
 * de `app_service`, care are voie sa scrie orice.
 */
create or replace function app.guard_stock_movement_append_only() returns trigger
  language plpgsql
as $fn$
begin
  raise exception
    'CONFLICT: miscarile de stoc sunt append-only - corectia se face prin miscare inversa'
    using errcode = 'P0001';
end
$fn$;
--> statement-breakpoint

create trigger stock_movements_append_only
  before update or delete on app.stock_movements
  for each row execute function app.guard_stock_movement_append_only();
--> statement-breakpoint

-- ── Soldul, intretinut prin trigger ─────────────────────────────────────────
/*
 * `stock_balances` e un rollup, exact ca `component_period_rollup` din pasul 06:
 * se poate recalcula oricand din `stock_movements`, si un job nocturn chiar o
 * face. Aici se intretine incremental, in aceeasi tranzactie cu miscarea.
 *
 * Doua lucruri care nu se vad din citirea rapida:
 *
 *   1. **Iesirea ia lock pe randul de sold** (`for update`) inainte sa verifice
 *      disponibilul. Fara el, doua consumuri concurente citesc amandoua acelasi
 *      disponibil, trec amandoua, si soldul ajunge negativ — pe care abia
 *      `check`-ul l-ar prinde, cu un mesaj care nu spune nimic omului.
 *   2. **CMP-ul se recalculeaza doar la INTRARE**, si numai daca miscarea aduce
 *      un cost. O iesire nu schimba costul mediu al ce ramane in gestiune.
 */
create or replace function app.apply_stock_movement() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $fn$
declare
  v_nil    constant uuid := '00000000-0000-0000-0000-000000000000';
  v_avail  numeric(14, 4);
  v_lot_tracked boolean;
  v_product text;
  v_location text;
begin
  -- Lotul e obligatoriu daca produsul se urmareste pe lot. FEFO complet e faza
  -- 3; steagul, insa, trebuie sa insemne ceva de la prima miscare.
  select p.is_lot_tracked, p.name into v_lot_tracked, v_product
    from app.products p where p.id = new.product_id;
  if v_lot_tracked and new.lot_id is null then
    raise exception 'VALIDATION_FAILED: produsul "%" se urmareste pe lot', v_product
      using errcode = 'P0001';
  end if;

  if new.from_location_id is not null then
    select b.qty_physical - b.qty_reserved into v_avail
      from app.stock_balances b
     where b.location_id = new.from_location_id
       and b.product_id = new.product_id
       and coalesce(b.lot_id, v_nil) = coalesce(new.lot_id, v_nil)
     for update;

    if v_avail is null or v_avail < new.quantity then
      select l.name into v_location from app.locations l where l.id = new.from_location_id;
      raise exception
        'STOCK_INSUFFICIENT: "%" in gestiunea "%" - disponibil %, cerut %',
        v_product, coalesce(v_location, '?'), coalesce(v_avail, 0), new.quantity
        using errcode = 'P0001';
    end if;

    update app.stock_balances b
       set qty_physical = b.qty_physical - new.quantity,
           updated_at = now()
     where b.location_id = new.from_location_id
       and b.product_id = new.product_id
       and coalesce(b.lot_id, v_nil) = coalesce(new.lot_id, v_nil);
  end if;

  if new.to_location_id is not null then
    insert into app.stock_balances (id, location_id, product_id, lot_id, qty_physical, avg_cost)
    values (
      app.uuid_generate_v7(), new.to_location_id, new.product_id, new.lot_id,
      new.quantity, new.unit_cost
    )
    on conflict (location_id, product_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set
      -- Toate expresiile din `set` vad randul VECHI, deci ordinea lor nu conteaza:
      -- CMP-ul se calculeaza cu cantitatea de dinainte de intrare.
      avg_cost = case
        when excluded.avg_cost is null then app.stock_balances.avg_cost
        when app.stock_balances.qty_physical + excluded.qty_physical = 0 then excluded.avg_cost
        else round(
          (app.stock_balances.qty_physical * coalesce(app.stock_balances.avg_cost, excluded.avg_cost)
           + excluded.qty_physical * excluded.avg_cost)
          / (app.stock_balances.qty_physical + excluded.qty_physical), 4)
      end,
      qty_physical = app.stock_balances.qty_physical + excluded.qty_physical,
      updated_at = now();
  end if;

  return new;
end
$fn$;
--> statement-breakpoint

create trigger stock_movements_apply_balance
  after insert on app.stock_movements
  for each row execute function app.apply_stock_movement();
--> statement-breakpoint

/*
 * Verificarea de integritate a stocului (verificarea #18): soldurile recalculate
 * din miscari, comparate cu cele stocate. Ruleaza nocturn dintr-un job; intoarce
 * un rand pe fiecare divergenta, cu produsul, gestiunea si diferenta.
 */
create or replace function app.verify_stock_balances()
  returns table (
    location_id uuid, product_id uuid, lot_id uuid,
    stored numeric(14, 4), computed numeric(14, 4), difference numeric(14, 4)
  )
  language sql
  stable
  security definer
  set search_path = app, pg_catalog
as $fn$
  with moved as (
    select to_location_id as loc, product_id, lot_id, sum(quantity) as qty
      from app.stock_movements where to_location_id is not null
     group by 1, 2, 3
    union all
    select from_location_id, product_id, lot_id, -sum(quantity)
      from app.stock_movements where from_location_id is not null
     group by 1, 2, 3
  ),
  computed as (
    select loc, product_id, lot_id, sum(qty) as qty from moved group by 1, 2, 3
  )
  select coalesce(b.location_id, c.loc),
         coalesce(b.product_id, c.product_id),
         coalesce(b.lot_id, c.lot_id),
         coalesce(b.qty_physical, 0)::numeric(14, 4),
         coalesce(c.qty, 0)::numeric(14, 4),
         (coalesce(b.qty_physical, 0) - coalesce(c.qty, 0))::numeric(14, 4)
    from app.stock_balances b
    full join computed c
      on c.loc = b.location_id and c.product_id = b.product_id
     and coalesce(c.lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(b.lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
   where coalesce(b.qty_physical, 0) <> coalesce(c.qty, 0)
$fn$;
--> statement-breakpoint

revoke execute on function app.verify_stock_balances() from public;
--> statement-breakpoint
grant execute on function app.verify_stock_balances() to app_service, app_office;
--> statement-breakpoint

-- ── Regula 1: fiecare NOK are iesire obligatorie ────────────────────────────
/*
 * Impusa in DB, nu prin validare de formular — regula 1 din pas. Un import, un
 * script sau un ecran viitor o capata fara sa stie ca exista.
 *
 * A doua verificare, in aceeasi functie: un punct cu `requires_photo` blocheaza
 * validarea fara poza. Poza se cauta pe RASPUNS (`photo_node_id`), nu „undeva pe
 * fisa": altfel o singura poza ar acoperi zece puncte care cer fiecare dovada.
 */
create or replace function app.guard_inspection_validation() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $fn$
declare
  v_item text;
begin
  if new.validated_at is null or (tg_op = 'UPDATE' and old.validated_at is not null) then
    return new;
  end if;

  select ci.text into v_item
    from app.inspection_answers a
    join app.checklist_items ci on ci.id = a.checklist_item_id
   where a.work_unit_id = new.work_unit_id
     and a.answer = 'nok'
     and not exists (select 1 from app.inspection_findings f where f.answer_id = a.id)
   order by ci.position
   limit 1;

  if v_item is not null then
    raise exception
      'FINDING_REQUIRED: punctul "%" e NOK si nu are iesire (rezolvat pe loc / interventie / propunere)',
      v_item using errcode = 'P0001';
  end if;

  select ci.text into v_item
    from app.inspection_answers a
    join app.checklist_items ci on ci.id = a.checklist_item_id
   where a.work_unit_id = new.work_unit_id
     and ci.requires_photo
     and a.answer <> 'na'
     and not exists (
       select 1 from app.nodes n
        where n.id = a.photo_node_id and n.deleted_at is null and n.kind = 'file'
     )
   order by ci.position
   limit 1;

  if v_item is not null then
    raise exception 'PHOTO_REQUIRED: punctul "%" cere poza', v_item using errcode = 'P0001';
  end if;

  return new;
end
$fn$;
--> statement-breakpoint

create trigger inspections_guard_validation
  before insert or update on app.inspections
  for each row execute function app.guard_inspection_validation();
--> statement-breakpoint

-- Fisa se completeaza doar pe o unitate de tipul potrivit. Fara asta, o
-- interventie ar putea primi raspunsuri de checklist si invers.
create or replace function app.guard_sheet_work_unit_type() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $fn$
declare
  v_type text;
  v_expected constant text := tg_argv[0];
begin
  select wu.type::text into v_type from app.work_units wu where wu.id = new.work_unit_id;
  if v_type is distinct from v_expected then
    raise exception 'VALIDATION_FAILED: fisa de % nu se poate pune pe o unitate de tip %',
      v_expected, coalesce(v_type, '?') using errcode = 'P0001';
  end if;
  return new;
end
$fn$;
--> statement-breakpoint

create trigger inspections_type_matches
  before insert on app.inspections
  for each row execute function app.guard_sheet_work_unit_type('inspectie');
--> statement-breakpoint

create trigger interventions_type_matches
  before insert on app.interventions
  for each row execute function app.guard_sheet_work_unit_type('interventie');
--> statement-breakpoint

-- ── `operation_actuals`, intretinut la validarea interventiei ───────────────
/*
 * Mecanismul anti-furt din §8.5, agatat in sfarsit de fisa care il alimenteaza.
 * Media se recalculeaza incremental din media precedenta si numarul de executii
 * — nu se reciteste tot istoricul la fiecare validare.
 */
create or replace function app.apply_intervention_actuals() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $fn$
declare
  v_period uuid;
  v_company uuid;
begin
  if new.validated_at is null
     or (tg_op = 'UPDATE' and old.validated_at is not null)
     or new.operation_id is null
     or new.team_id is null
     or new.real_cost is null then
    return new;
  end if;

  select wu.company_id into v_company from app.work_units wu where wu.id = new.work_unit_id;
  v_period := app.period_of(v_company, new.effect_date);

  insert into app.operation_actuals (
    operation_id, team_id, period_id, executions, avg_real_cost, avg_estimated_cost
  )
  values (new.operation_id, new.team_id, v_period, 1, new.real_cost, new.expected_cost)
  on conflict (operation_id, team_id, period_id) do update set
    avg_real_cost = round(
      (coalesce(app.operation_actuals.avg_real_cost, 0) * app.operation_actuals.executions
       + excluded.avg_real_cost) / (app.operation_actuals.executions + 1), 2),
    avg_estimated_cost = round(
      (coalesce(app.operation_actuals.avg_estimated_cost, 0) * app.operation_actuals.executions
       + coalesce(excluded.avg_estimated_cost, 0)) / (app.operation_actuals.executions + 1), 2),
    executions = app.operation_actuals.executions + 1;

  return new;
end
$fn$;
--> statement-breakpoint

create trigger interventions_apply_actuals
  after insert or update on app.interventions
  for each row execute function app.apply_intervention_actuals();
--> statement-breakpoint

-- ── Pontajul: ≤ 24 de ore pe zi, etapa obligatorie pe lucrari ───────────────
/*
 * Verificarea #12 a pasului. Se verifica pe TOTALUL pontajului, nu pe linie:
 * ziua se imparte pe mai multe unitati (regula 5), deci 4+2+2 e corect si
 * 12+13 nu — iar un `check` pe linie n-ar putea spune diferenta.
 *
 * Trigger de constrangere, amanat la commit: liniile se scriu una cate una, iar
 * o verificare imediata ar respinge o rescriere legitima (sterg 3 linii, adaug
 * 3 altele) doar din cauza ordinii in care s-au intamplat.
 */
create or replace function app.guard_timesheet_hours() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $fn$
declare
  v_sheet uuid := coalesce(new.timesheet_id, old.timesheet_id);
  v_total numeric(14, 4);
begin
  select coalesce(sum(l.hours), 0) into v_total
    from app.timesheet_lines l where l.timesheet_id = v_sheet;

  if v_total > 24 then
    raise exception 'VALIDATION_FAILED: ziua are % ore pontate, maximul e 24', v_total
      using errcode = 'P0001';
  end if;

  return coalesce(new, old);
end
$fn$;
--> statement-breakpoint

create constraint trigger timesheet_lines_hours_within_day
  after insert or update or delete on app.timesheet_lines
  deferrable initially deferred
  for each row execute function app.guard_timesheet_hours();
--> statement-breakpoint

/*
 * Etapa e obligatorie cand unitatea e lucrare — aceeasi regula ca pe
 * `cost_lines` in 0017, si din acelasi motiv: costul unei lucrari fara etapa nu
 * se poate compara cu bugetul etapei, adica nu se poate urmari deloc.
 */
create or replace function app.guard_timesheet_line_stage() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $fn$
declare
  v_type text;
begin
  select wu.type::text into v_type from app.work_units wu where wu.id = new.work_unit_id;

  if v_type = 'lucrare' and new.stage_id is null then
    raise exception 'VALIDATION_FAILED: pontajul pe o lucrare cere etapa'
      using errcode = 'P0001';
  end if;
  if v_type <> 'lucrare' and new.stage_id is not null then
    raise exception 'VALIDATION_FAILED: doar lucrarile au etape'
      using errcode = 'P0001';
  end if;

  return new;
end
$fn$;
--> statement-breakpoint

create trigger timesheet_lines_stage_required
  before insert or update on app.timesheet_lines
  for each row execute function app.guard_timesheet_line_stage();
--> statement-breakpoint

/*
 * Un pontaj validat e inghetat: orele lui au produs deja linii de cost (regula 4
 * din pas, verificarea #15). Se blocheaza adaugarea si stergerea de linii;
 * `update` ramane permis dinadins, fiindca chiar validarea scrie `rate_card_id`
 * si `hourly_cost` pe linii.
 */
create or replace function app.guard_validated_timesheet() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $fn$
declare
  v_status text;
begin
  select t.status into v_status
    from app.timesheets t
   where t.id = coalesce(new.timesheet_id, old.timesheet_id);

  if v_status = 'validated' then
    raise exception 'CONFLICT: pontajul e validat - liniile lui nu se mai schimba'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end
$fn$;
--> statement-breakpoint

create trigger timesheet_lines_frozen_when_validated
  before insert or delete on app.timesheet_lines
  for each row execute function app.guard_validated_timesheet();
--> statement-breakpoint

-- ── Scoping prin parinte, pentru politici ───────────────────────────────────
create or replace function app.location_in_scope(p_location uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $fn$
  select exists (
    select 1 from app.locations l
     where l.id = p_location and l.company_id = any(app.current_company_ids())
  )
$fn$;
--> statement-breakpoint

create or replace function app.consumption_note_in_scope(p_note uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $fn$
  select exists (
    select 1 from app.consumption_notes n
     where n.id = p_note and n.company_id = any(app.current_company_ids())
  )
$fn$;
--> statement-breakpoint

create or replace function app.timesheet_in_scope(p_timesheet uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $fn$
  select exists (
    select 1 from app.timesheets t
     where t.id = p_timesheet and t.company_id = any(app.current_company_ids())
  )
$fn$;
--> statement-breakpoint

-- Pontajul propriu: terenul isi vede si isi completeaza doar zilele lui.
create or replace function app.timesheet_is_mine(p_timesheet uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $fn$
  select exists (
    select 1 from app.timesheets t
     where t.id = p_timesheet
       and t.person_id = app.current_person_id()
       and t.company_id = any(app.current_company_ids())
  )
$fn$;
--> statement-breakpoint

grant execute on function
  app.location_in_scope(uuid), app.consumption_note_in_scope(uuid),
  app.timesheet_in_scope(uuid), app.timesheet_is_mine(uuid)
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Validarea unei fise si emiterea unui bon sunt exact lucrurile despre care se
-- intreaba peste sase luni „cine si cand". Miscarile de stoc, in schimb, nu:
-- sunt deja append-only, cu autor pe rand — auditul lor ar fi acelasi jurnal de
-- doua ori.
select app.attach_audit('app.inspections');
--> statement-breakpoint
select app.attach_audit('app.inspection_findings');
--> statement-breakpoint
select app.attach_audit('app.interventions');
--> statement-breakpoint
select app.attach_audit('app.timesheets');
--> statement-breakpoint
select app.attach_audit('app.consumption_notes');
--> statement-breakpoint
select app.attach_audit('app.locations');
--> statement-breakpoint

-- ── RLS ─────────────────────────────────────────────────────────────────────
select app.rls_enable('app.locations'::regclass);
--> statement-breakpoint
select app.rls_enable('app.stock_balances'::regclass);
--> statement-breakpoint
select app.rls_enable('app.stock_movements'::regclass);
--> statement-breakpoint
select app.rls_enable('app.consumption_notes'::regclass);
--> statement-breakpoint
select app.rls_enable('app.consumption_lines'::regclass);
--> statement-breakpoint
select app.rls_enable('app.inspections'::regclass);
--> statement-breakpoint
select app.rls_enable('app.inspection_answers'::regclass);
--> statement-breakpoint
select app.rls_enable('app.inspection_findings'::regclass);
--> statement-breakpoint
select app.rls_enable('app.interventions'::regclass);
--> statement-breakpoint
select app.rls_enable('app.intervention_materials'::regclass);
--> statement-breakpoint
select app.rls_enable('app.intervention_hours'::regclass);
--> statement-breakpoint
select app.rls_enable('app.timesheets'::regclass);
--> statement-breakpoint
select app.rls_enable('app.timesheet_lines'::regclass);
--> statement-breakpoint
select app.rls_enable('app.subcontractor_attendance'::regclass);
--> statement-breakpoint

-- Gestiunile si stocul: biroul, pe firmele lui. Terenul le CITESTE, pentru ca
-- fara sold nu poate declara un consum — dar coloanele de bani nu-i sunt
-- acordate (vezi grant-urile de mai jos).
create policy "office" on app.locations for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint
create policy "read" on app.locations for select to app_field
  using (company_id = any(app.current_company_ids()));
--> statement-breakpoint

create policy "office" on app.stock_balances for all to app_office
  using (app.location_in_scope(location_id))
  with check (app.location_in_scope(location_id));
--> statement-breakpoint
create policy "read" on app.stock_balances for select to app_field
  using (app.location_in_scope(location_id));
--> statement-breakpoint

create policy "office" on app.stock_movements for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint
create policy "read" on app.stock_movements for select to app_field
  using (company_id = any(app.current_company_ids()));
--> statement-breakpoint

create policy "office" on app.consumption_notes for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint
create policy "read" on app.consumption_notes for select to app_field
  using (company_id = any(app.current_company_ids()));
--> statement-breakpoint

create policy "office" on app.consumption_lines for all to app_office
  using (app.consumption_note_in_scope(note_id))
  with check (app.consumption_note_in_scope(note_id));
--> statement-breakpoint
create policy "read" on app.consumption_lines for select to app_field
  using (app.consumption_note_in_scope(note_id));
--> statement-breakpoint

-- Fisele: aceleasi doua politici ca pe `work_units` in 0016 — biroul vede tot
-- ce e la firmele lui, terenul doar ce e al lui. Fisa NU are politica proprie de
-- vizibilitate: ea o mosteneste, prin unitate, pe cea care exista deja.
create policy "office" on app.inspections for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint
create policy "assigned" on app.inspections for all to app_field
  using (app.work_unit_assigned_to_me(work_unit_id))
  with check (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

create policy "office" on app.inspection_answers for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint
create policy "assigned" on app.inspection_answers for all to app_field
  using (app.work_unit_assigned_to_me(work_unit_id))
  with check (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

create policy "office" on app.inspection_findings for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint
create policy "assigned" on app.inspection_findings for all to app_field
  using (app.work_unit_assigned_to_me(work_unit_id))
  with check (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

create policy "office" on app.interventions for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint
create policy "assigned" on app.interventions for all to app_field
  using (app.work_unit_assigned_to_me(work_unit_id))
  with check (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

create policy "office" on app.intervention_materials for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint
create policy "assigned" on app.intervention_materials for all to app_field
  using (app.work_unit_assigned_to_me(work_unit_id))
  with check (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

create policy "office" on app.intervention_hours for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint
create policy "assigned" on app.intervention_hours for all to app_field
  using (app.work_unit_assigned_to_me(work_unit_id))
  with check (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

-- Pontajul: biroul valideaza tot ce e la firmele lui; omul din teren isi vede si
-- isi scrie DOAR zilele lui. Nu „ale echipei" — pontajul altcuiva e datele
-- altcuiva, chiar si fara lei pe ecran.
create policy "office" on app.timesheets for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint
create policy "mine" on app.timesheets for all to app_field
  using (person_id = app.current_person_id() and company_id = any(app.current_company_ids()))
  with check (person_id = app.current_person_id() and company_id = any(app.current_company_ids()));
--> statement-breakpoint

create policy "office" on app.timesheet_lines for all to app_office
  using (app.timesheet_in_scope(timesheet_id))
  with check (app.timesheet_in_scope(timesheet_id));
--> statement-breakpoint
create policy "mine" on app.timesheet_lines for all to app_field
  using (app.timesheet_is_mine(timesheet_id))
  with check (app.timesheet_is_mine(timesheet_id));
--> statement-breakpoint

create policy "office" on app.subcontractor_attendance for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint
create policy "assigned" on app.subcontractor_attendance for all to app_field
  using (app.work_unit_assigned_to_me(work_unit_id))
  with check (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

-- ── Grant-uri ───────────────────────────────────────────────────────────────
grant select, insert, update, delete on
  app.locations, app.consumption_notes, app.consumption_lines,
  app.inspections, app.inspection_answers, app.inspection_findings,
  app.interventions, app.intervention_materials, app.intervention_hours,
  app.timesheets, app.timesheet_lines, app.subcontractor_attendance
  to app_office, app_service;
--> statement-breakpoint

-- Soldul e rollup: se scrie DOAR din trigger, care ruleaza `security definer`.
-- Nimeni nu are `insert`/`update` pe el, nici macar biroul — un sold corectat de
-- mana ar fi exact divergenta pe care o cauta jobul nocturn.
grant select on app.stock_balances to app_office, app_service;
--> statement-breakpoint

-- Miscarile: `insert` si atat. `update`/`delete` nu se acorda nimanui (regula 7),
-- iar trigger-ul de mai sus le respinge si daca cineva le-ar acorda din greseala.
grant select, insert on app.stock_movements to app_office, app_service;
--> statement-breakpoint

/*
 * Terenul (regula 9 din pas: zero preturi pe orice ecran atins de `field`).
 *
 * Enumerarea e explicita peste tot unde tabela are o coloana de bani — a patra
 * rulare a aceleiasi discipline, dupa 0012, 0016 si 0025. O coloana de bani
 * adaugata mai tarziu NU intra in lista de la sine, si asta e chiar rostul ei.
 */
grant select on app.locations to app_field;
--> statement-breakpoint

grant select (
  id, company_id, period_id, document_type, document_id, document_line_id,
  from_location_id, to_location_id, product_id, lot_id, quantity, effect_date,
  created_by, created_at
) on app.stock_movements to app_field;
--> statement-breakpoint

grant select (id, location_id, product_id, lot_id, qty_physical, qty_reserved, updated_at)
  on app.stock_balances to app_field;
--> statement-breakpoint

grant select (
  id, company_id, series, number, location_id, work_unit_id, stage_id,
  contract_id, component_id, objective_id, document_date, effect_date, period_id,
  issued_by, status, created_at
) on app.consumption_notes to app_field;
--> statement-breakpoint

grant select (id, note_id, product_id, lot_id, quantity, created_at)
  on app.consumption_lines to app_field;
--> statement-breakpoint

-- Inspectia n-are coloane de bani decat pe constatare (`estimated_value`):
-- fisa si raspunsurile se acorda intregi, constatarea pe coloane.
grant select, insert, update on app.inspections, app.inspection_answers to app_field;
--> statement-breakpoint

grant select (
  id, work_unit_id, answer_id, outcome, resolution_note,
  created_request_id, backlog_proposal_id, created_at
) on app.inspection_findings to app_field;
--> statement-breakpoint
grant insert (
  id, work_unit_id, answer_id, outcome, resolution_note,
  created_request_id, backlog_proposal_id, estimated_value
) on app.inspection_findings to app_field;
--> statement-breakpoint

/*
 * Interventia: cantitatile si orele DA, comparatia asteptat-vs-real NU.
 * `variance_pct` iese si el din lista — nu e in lei, dar spune acelasi lucru
 * despre bani, iar mecanismul anti-furt din §8.5 nu e o informatie de teren.
 */
grant select (
  work_unit_id, source_request_id, performed_on, effect_date, description,
  declared_hours, operation_id, team_id, validated_at, validated_by, created_at
) on app.interventions to app_field;
--> statement-breakpoint
grant insert, update (
  work_unit_id, source_request_id, performed_on, description, declared_hours,
  operation_id, team_id
) on app.interventions to app_field;
--> statement-breakpoint

-- Verificarea #24: `select *` din contextul `field` pe `intervention_materials`
-- ESUEAZA, fiindca `unit_cost` nu e acordat.
grant select (id, work_unit_id, product_id, lot_id, quantity, location_id,
              consumption_note_id, created_at)
  on app.intervention_materials to app_field;
--> statement-breakpoint
grant insert (id, work_unit_id, product_id, lot_id, quantity, location_id)
  on app.intervention_materials to app_field;
--> statement-breakpoint
grant delete on app.intervention_materials to app_field;
--> statement-breakpoint

grant select, insert, update, delete on app.intervention_hours to app_field;
--> statement-breakpoint
grant select, insert, update, delete on app.subcontractor_attendance to app_field;
--> statement-breakpoint

grant select, insert, update on app.timesheets to app_field;
--> statement-breakpoint
grant select (id, timesheet_id, work_unit_id, stage_id, hours, created_at)
  on app.timesheet_lines to app_field;
--> statement-breakpoint
grant insert (id, timesheet_id, work_unit_id, stage_id, hours)
  on app.timesheet_lines to app_field;
--> statement-breakpoint
grant delete on app.timesheet_lines to app_field;
--> statement-breakpoint

-- Poarta de bani, a patra rulare (0012, 0016, 0025, aici). `estimated_value` era
-- deja in lista; `variance_pct` se adauga acum, ca euristica pe nume de coloana
-- nu-l prinde si totusi el spune cat s-a furat.
select app.assert_no_money_leak(
  array['estimated_value', 'material_budget', 'labor_budget', 'variance_pct']
);
