CREATE TABLE "app"."operation_actuals" (
	"operation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"executions" integer DEFAULT 0 NOT NULL,
	"avg_real_cost" numeric(14, 2),
	"avg_estimated_cost" numeric(14, 2),
	CONSTRAINT "operation_actuals_operation_id_team_id_period_id_pk" PRIMARY KEY("operation_id","team_id","period_id"),
	CONSTRAINT "operation_actuals_executions_non_negative" CHECK ("app"."operation_actuals"."executions" >= 0),
	CONSTRAINT "operation_actuals_avg_real_non_negative" CHECK ("app"."operation_actuals"."avg_real_cost" is null or "app"."operation_actuals"."avg_real_cost" >= 0),
	CONSTRAINT "operation_actuals_avg_estimated_non_negative" CHECK ("app"."operation_actuals"."avg_estimated_cost" is null or "app"."operation_actuals"."avg_estimated_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."operation_catalog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"standard_hours" numeric(14, 4) NOT NULL,
	"qualification_id" uuid NOT NULL,
	"estimated_labor" numeric(14, 2) NOT NULL,
	"estimated_material" numeric(14, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_catalog_code_unique" UNIQUE("code"),
	CONSTRAINT "operation_catalog_code_not_blank" CHECK (length(btrim("app"."operation_catalog"."code")) > 0),
	CONSTRAINT "operation_catalog_name_not_blank" CHECK (length(btrim("app"."operation_catalog"."name")) > 0),
	CONSTRAINT "operation_catalog_hours_positive" CHECK ("app"."operation_catalog"."standard_hours" > 0),
	CONSTRAINT "operation_catalog_labor_non_negative" CHECK ("app"."operation_catalog"."estimated_labor" >= 0),
	CONSTRAINT "operation_catalog_material_non_negative" CHECK ("app"."operation_catalog"."estimated_material" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."operation_catalog_materials" (
	"operation_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	CONSTRAINT "operation_catalog_materials_operation_id_product_id_pk" PRIMARY KEY("operation_id","product_id"),
	CONSTRAINT "operation_catalog_materials_quantity_positive" CHECK ("app"."operation_catalog_materials"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."backlog_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"title" text NOT NULL,
	"estimated_value" numeric(14, 2) NOT NULL,
	"source_kind" text NOT NULL,
	"source_inspection_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"promoted_work_unit_id" uuid,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backlog_proposals_title_not_blank" CHECK (length(btrim("app"."backlog_proposals"."title")) > 0),
	CONSTRAINT "backlog_proposals_estimated_value_non_negative" CHECK ("app"."backlog_proposals"."estimated_value" >= 0),
	CONSTRAINT "backlog_proposals_source_kind_known" CHECK ("app"."backlog_proposals"."source_kind" in ('inspectie', 'tichet', 'amanata')),
	CONSTRAINT "backlog_proposals_status_known" CHECK ("app"."backlog_proposals"."status" in ('open', 'promoted', 'dropped', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "app"."request_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"choice" "app"."routing_choice" NOT NULL,
	"system_proposal" "app"."routing_choice" NOT NULL,
	"target_contract_id" uuid,
	"target_component_id" uuid,
	"target_periods" date[],
	"created_work_unit_id" uuid,
	"reason" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_decisions_reason_not_blank" CHECK (length(btrim("app"."request_decisions"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."request_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"from_address" "citext" NOT NULL,
	"to_address" "citext",
	"subject" text,
	"received_at" timestamp with time zone NOT NULL,
	"body_text" text,
	"body_html" text,
	"raw_node_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_emails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "app"."request_estimate_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"estimated_labor" numeric(14, 2) NOT NULL,
	"estimated_material" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "request_estimate_lines_quantity_positive" CHECK ("app"."request_estimate_lines"."quantity" > 0),
	CONSTRAINT "request_estimate_lines_labor_non_negative" CHECK ("app"."request_estimate_lines"."estimated_labor" >= 0),
	CONSTRAINT "request_estimate_lines_material_non_negative" CHECK ("app"."request_estimate_lines"."estimated_material" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"type" "app"."request_type" NOT NULL,
	"source" "app"."request_source" NOT NULL,
	"status" "app"."request_status" DEFAULT 'neprocesata' NOT NULL,
	"objective_id" uuid,
	"contract_id" uuid,
	"contract_objective_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"source_inspection_finding_id" uuid,
	"source_equipment_id" uuid,
	"estimated_value" numeric(14, 2),
	"sla_due_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_title_not_blank" CHECK (length(btrim("app"."requests"."title")) > 0),
	CONSTRAINT "requests_estimated_value_non_negative" CHECK ("app"."requests"."estimated_value" is null or "app"."requests"."estimated_value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."operation_actuals" ADD CONSTRAINT "operation_actuals_operation_id_operation_catalog_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."operation_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_actuals" ADD CONSTRAINT "operation_actuals_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "app"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_actuals" ADD CONSTRAINT "operation_actuals_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_catalog" ADD CONSTRAINT "operation_catalog_qualification_id_qualifications_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "app"."qualifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_catalog_materials" ADD CONSTRAINT "operation_catalog_materials_operation_id_operation_catalog_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."operation_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."operation_catalog_materials" ADD CONSTRAINT "operation_catalog_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."backlog_proposals" ADD CONSTRAINT "backlog_proposals_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."backlog_proposals" ADD CONSTRAINT "backlog_proposals_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "app"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."backlog_proposals" ADD CONSTRAINT "backlog_proposals_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."backlog_proposals" ADD CONSTRAINT "backlog_proposals_promoted_work_unit_id_work_units_id_fk" FOREIGN KEY ("promoted_work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_decisions" ADD CONSTRAINT "request_decisions_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_decisions" ADD CONSTRAINT "request_decisions_target_contract_id_contracts_id_fk" FOREIGN KEY ("target_contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_decisions" ADD CONSTRAINT "request_decisions_target_component_id_contract_components_id_fk" FOREIGN KEY ("target_component_id") REFERENCES "app"."contract_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_decisions" ADD CONSTRAINT "request_decisions_created_work_unit_id_work_units_id_fk" FOREIGN KEY ("created_work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_decisions" ADD CONSTRAINT "request_decisions_decided_by_persons_id_fk" FOREIGN KEY ("decided_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_emails" ADD CONSTRAINT "request_emails_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_estimate_lines" ADD CONSTRAINT "request_estimate_lines_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "app"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."request_estimate_lines" ADD CONSTRAINT "request_estimate_lines_operation_id_operation_catalog_id_fk" FOREIGN KEY ("operation_id") REFERENCES "app"."operation_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD CONSTRAINT "requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD CONSTRAINT "requests_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "app"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD CONSTRAINT "requests_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD CONSTRAINT "requests_contract_objective_id_contract_objectives_id_fk" FOREIGN KEY ("contract_objective_id") REFERENCES "app"."contract_objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."requests" ADD CONSTRAINT "requests_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backlog_proposals_contract_status_value_idx" ON "app"."backlog_proposals" USING btree ("contract_id","status","estimated_value");--> statement-breakpoint
CREATE INDEX "backlog_proposals_request_idx" ON "app"."backlog_proposals" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_decisions_request_idx" ON "app"."request_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_emails_request_idx" ON "app"."request_emails" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_estimate_lines_request_idx" ON "app"."request_estimate_lines" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "requests_company_status_idx" ON "app"."requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "requests_company_type_idx" ON "app"."requests" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "requests_objective_idx" ON "app"."requests" USING btree ("objective_id");--> statement-breakpoint
CREATE INDEX "requests_contract_idx" ON "app"."requests" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "requests_sla_idx" ON "app"."requests" USING btree ("sla_due_at");
-- ══ Completari scrise de mana ═══════════════════════════════════════════════

-- ── Legaturile inapoi, taiate la 05/07 ca sa evite un ciclu de import ───────
-- `work_units.source_request_id` exista din pasul 05; cererea nu exista pana
-- acum. `request_emails.raw_node_id` la fel, cu arborele de fisiere din 07a.
alter table app.work_units
  add constraint work_units_source_request_id_requests_id_fk
  foreign key (source_request_id) references app.requests(id);
--> statement-breakpoint

alter table app.request_emails
  add constraint request_emails_raw_node_id_nodes_id_fk
  foreign key (raw_node_id) references app.nodes(id);
--> statement-breakpoint

-- ── Scoping prin parinte, pentru politici ───────────────────────────────────
-- `security definer`, ca surorile lor din 0011/0016: verificarea vede randul-
-- parinte indiferent de ce vede apelantul.
create or replace function app.request_in_scope(p_request uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select exists (
    select 1 from app.requests r
     where r.id = p_request and r.company_id = any(app.current_company_ids())
  )
$$;
--> statement-breakpoint

/*
 * Terenul vede o cerere DOAR daca a nascut o UL pe care e asignat sau de care
 * raspunde — verificarea #20 a pasului. O cerere inca in evaluare, fara UL, nu
 * e vizibila terenului: n-are inca ce sa faca cu ea.
 */
create or replace function app.request_assigned_to_me(p_request uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select exists (
    select 1 from app.work_units wu
     where wu.source_request_id = p_request
       and app.work_unit_assigned_to_me(wu.id)
  )
$$;
--> statement-breakpoint

grant execute on function
  app.request_in_scope(uuid), app.request_assigned_to_me(uuid)
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Deciziile de rutare si starea unei cereri sunt exact genul de lucru despre
-- care cineva va intreba peste sase luni „cine si de ce a decis asa".
select app.attach_audit('app.requests');
--> statement-breakpoint
select app.attach_audit('app.request_decisions');
--> statement-breakpoint
select app.attach_audit('app.backlog_proposals');
--> statement-breakpoint
select app.attach_audit('app.operation_catalog');
--> statement-breakpoint

-- ── RLS ─────────────────────────────────────────────────────────────────────
select app.rls_enable('app.requests'::regclass);
--> statement-breakpoint
select app.rls_enable('app.request_emails'::regclass);
--> statement-breakpoint
select app.rls_enable('app.request_estimate_lines'::regclass);
--> statement-breakpoint
select app.rls_enable('app.request_decisions'::regclass);
--> statement-breakpoint
select app.rls_enable('app.backlog_proposals'::regclass);
--> statement-breakpoint
select app.rls_enable('app.operation_catalog'::regclass);
--> statement-breakpoint
select app.rls_enable('app.operation_catalog_materials'::regclass);
--> statement-breakpoint
select app.rls_enable('app.operation_actuals'::regclass);
--> statement-breakpoint

create policy "office" on app.requests for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint
-- Doar cererile care i-au nascut o UL pe care e asignat (#20).
create policy "assigned" on app.requests for select to app_field
  using (app.request_assigned_to_me(id));
--> statement-breakpoint

create policy "office" on app.request_emails for all to app_office
  using (app.request_in_scope(request_id))
  with check (app.request_in_scope(request_id));
--> statement-breakpoint

create policy "office" on app.request_estimate_lines for all to app_office
  using (app.request_in_scope(request_id))
  with check (app.request_in_scope(request_id));
--> statement-breakpoint

create policy "office" on app.request_decisions for all to app_office
  using (app.request_in_scope(request_id))
  with check (app.request_in_scope(request_id));
--> statement-breakpoint

create policy "office" on app.backlog_proposals for all to app_office
  using (
    exists (select 1 from app.contracts c
             where c.id = contract_id and c.company_id = any(app.current_company_ids()))
  )
  with check (
    exists (select 1 from app.contracts c
             where c.id = contract_id and c.company_id = any(app.current_company_ids()))
  );
--> statement-breakpoint

-- Catalogul e nomenclator comun celor 5 firme, ca produsele si calificarile —
-- fara scoping pe firma, la fel ca `app.products`.
create policy "office" on app.operation_catalog for all to app_office
  using (true) with check (true);
--> statement-breakpoint
create policy "office" on app.operation_catalog_materials for all to app_office
  using (true) with check (true);
--> statement-breakpoint
create policy "office" on app.operation_actuals for all to app_office
  using (true) with check (true);
--> statement-breakpoint

-- ── Grant-uri ───────────────────────────────────────────────────────────────
grant select, insert, update, delete on
  app.request_emails, app.request_estimate_lines, app.request_decisions,
  app.backlog_proposals, app.operation_catalog, app.operation_catalog_materials,
  app.operation_actuals
  to app_office, app_service;
--> statement-breakpoint

grant select, insert, update on app.requests to app_office, app_service;
--> statement-breakpoint

/*
 * Terenul: toate coloanele in afara de `estimated_value` (#20). Enumerarea
 * explicita, ca la `work_units` in 0016 — o coloana de bani adaugata mai
 * tarziu nu intra in lista de la sine.
 */
grant select (
  id, company_id, type, source, status, objective_id, contract_id,
  contract_objective_id, title, description, source_inspection_finding_id,
  source_equipment_id, sla_due_at, created_by, created_at
) on app.requests to app_field;
--> statement-breakpoint

-- Poarta de bani, a treia rulare (0012, 0016, aici). `avg_real_cost` si
-- `avg_estimated_cost` din catalog raman office-only: e mecanismul anti-furt
-- din §8.5, nu date de teren.
select app.assert_no_money_leak(
  array['estimated_value', 'material_budget', 'labor_budget']
);
