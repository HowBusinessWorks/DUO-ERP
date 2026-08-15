CREATE TABLE "app"."checklist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"checklist_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"text" text NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	CONSTRAINT "checklist_items_position_unique" UNIQUE("checklist_id","position"),
	CONSTRAINT "checklist_items_text_not_blank" CHECK (length(btrim("app"."checklist_items"."text")) > 0),
	CONSTRAINT "checklist_items_position_positive" CHECK ("app"."checklist_items"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."checklists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"objective_kind" text,
	"version" smallint DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklists_code_version_unique" UNIQUE("code","version"),
	CONSTRAINT "checklists_code_not_blank" CHECK (length(btrim("app"."checklists"."code")) > 0),
	CONSTRAINT "checklists_version_positive" CHECK ("app"."checklists"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."contract_objectives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"objective_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"inspection_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_objectives_valid_range" CHECK ("app"."contract_objectives"."valid_to" is null or "app"."contract_objectives"."valid_to" > "app"."contract_objectives"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "app"."inspection_profile_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"frequency_months" smallint NOT NULL,
	CONSTRAINT "inspection_profile_items_unique" UNIQUE("profile_id","checklist_id"),
	CONSTRAINT "inspection_profile_items_frequency_range" CHECK ("app"."inspection_profile_items"."frequency_months" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "app"."inspection_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_profiles_name_unique" UNIQUE("name"),
	CONSTRAINT "inspection_profiles_name_not_blank" CHECK (length(btrim("app"."inspection_profiles"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."objectives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"address" jsonb,
	"geo_lat" numeric(10, 7),
	"geo_lng" numeric(10, 7),
	"area_sqm" numeric(14, 2),
	"root_node_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "objectives_code_not_blank" CHECK (length(btrim("app"."objectives"."code")) > 0),
	CONSTRAINT "objectives_kind_not_blank" CHECK (length(btrim("app"."objectives"."kind")) > 0),
	CONSTRAINT "objectives_lat_range" CHECK ("app"."objectives"."geo_lat" is null or "app"."objectives"."geo_lat" between -90 and 90),
	CONSTRAINT "objectives_lng_range" CHECK ("app"."objectives"."geo_lng" is null or "app"."objectives"."geo_lng" between -180 and 180),
	CONSTRAINT "objectives_geo_complete" CHECK (num_nonnulls("app"."objectives"."geo_lat", "app"."objectives"."geo_lng") <> 1),
	CONSTRAINT "objectives_area_non_negative" CHECK ("app"."objectives"."area_sqm" is null or "app"."objectives"."area_sqm" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "app"."checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contract_objectives" ADD CONSTRAINT "contract_objectives_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contract_objectives" ADD CONSTRAINT "contract_objectives_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "app"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contract_objectives" ADD CONSTRAINT "contract_objectives_inspection_profile_id_inspection_profiles_id_fk" FOREIGN KEY ("inspection_profile_id") REFERENCES "app"."inspection_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspection_profile_items" ADD CONSTRAINT "inspection_profile_items_profile_id_inspection_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "app"."inspection_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inspection_profile_items" ADD CONSTRAINT "inspection_profile_items_checklist_id_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "app"."checklists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_objectives_objective_idx" ON "app"."contract_objectives" USING btree ("objective_id");--> statement-breakpoint
CREATE INDEX "objectives_name_idx" ON "app"."objectives" USING btree ("name");--> statement-breakpoint
CREATE INDEX "objectives_kind_idx" ON "app"."objectives" USING btree ("kind");

-- â•â• Completari scrise de mana â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- Codul unui obiectiv e unic INDIFERENT de scris, ca la produse. â€žSP-14" scris
-- de dispecer si â€žsp-14" scris in teren trebuie sa cada pe acelasi obiectiv:
-- doua randuri ar insemna doua istorii paralele pentru aceeasi statie de pompare,
-- si tocmai istoria transversala e ecranul cerut explicit la obiectiv.
create unique index objectives_code_unique on app.objectives (lower(btrim(code)));
--> statement-breakpoint

/*
 * Un obiectiv nu poate fi legat de DOUA ori de acelasi contract pe perioade care
 * se suprapun. Fara constrangere, â€žce profil de inspectie are bazinul asta pe
 * contractul 4700 in martie" ar avea doua raspunsuri, iar acoperirea inspectiilor
 * ar numara acelasi obiectiv de doua ori.
 *
 * `contract_id` intra in cheia de excludere, deci DOUA CONTRACTE DIFERITE in
 * acelasi timp raman permise â€” e cazul real (verificarea #11), si e chiar motivul
 * pentru care profilul sta pe legatura si nu pe obiectiv.
 *
 * `[)` â€” deschis la dreapta: un obiectiv scos pe 01.04 si reintrodus pe 01.04 nu
 * se suprapune cu el insusi. Fara asta, orice mutare ar cere o zi de pauza.
 */
alter table app.contract_objectives
  add constraint contract_objectives_no_overlap
  exclude using gist (
    contract_id with =,
    objective_id with =,
    daterange(valid_from, valid_to, '[)') with &&
  );
--> statement-breakpoint

-- â”€â”€ Audit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Obiectivele si profilele sunt nomenclator: o redenumire sau o schimbare de
-- frecventa schimba sensul rapoartelor vechi, deci trebuie sa se stie cine.
select app.attach_audit('app.objectives');
--> statement-breakpoint
select app.attach_audit('app.checklists');
--> statement-breakpoint
select app.attach_audit('app.checklist_items');
--> statement-breakpoint
select app.attach_audit('app.inspection_profiles');
--> statement-breakpoint
select app.attach_audit('app.inspection_profile_items');
--> statement-breakpoint

-- Scoaterea unui obiectiv din contract muta bani intre contracte incepand cu
-- luna urmatoare. Cere motiv scris.
select app.attach_audit('app.contract_objectives', true);
--> statement-breakpoint

-- â”€â”€ Grant-uri â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/*
 * Nimic din 0010 nu poarta bani, deci nimic nu se decupeaza pe coloane.
 *
 * Terenul are nevoie de toate: obiectivul ca sa stie unde merge, fisa si
 * punctele ei ca sa aiba ce completa, profilul si legatura ca sa stie ce se
 * verifica pe contractul asta. Portalul clientului vede obiectivele lui â€”
 * filtrarea pe randuri e treaba RLS-ului din 02b, nu a grant-urilor.
 */
grant select on
  app.objectives, app.checklists, app.checklist_items,
  app.inspection_profiles, app.inspection_profile_items, app.contract_objectives
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

grant insert, update, delete on
  app.objectives, app.checklists, app.checklist_items,
  app.inspection_profiles, app.inspection_profile_items, app.contract_objectives
  to app_office, app_service;
