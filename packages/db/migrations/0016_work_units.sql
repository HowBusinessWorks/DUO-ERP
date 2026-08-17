ALTER TYPE "app"."numbered_document_type" ADD VALUE 'lucrare';--> statement-breakpoint
ALTER TYPE "app"."numbered_document_type" ADD VALUE 'interventie';--> statement-breakpoint
ALTER TYPE "app"."numbered_document_type" ADD VALUE 'inspectie';--> statement-breakpoint
CREATE TABLE "app"."funding_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"allocated_amount" numeric(14, 2),
	"allocated_pct" numeric(6, 4),
	"status" "app"."allocation_status" DEFAULT 'active' NOT NULL,
	"superseded_by" uuid,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funding_allocations_amount_or_pct" CHECK ("app"."funding_allocations"."allocated_amount" is not null or "app"."funding_allocations"."allocated_pct" is not null),
	CONSTRAINT "funding_allocations_amount_non_negative" CHECK ("app"."funding_allocations"."allocated_amount" is null or "app"."funding_allocations"."allocated_amount" >= 0),
	CONSTRAINT "funding_allocations_pct_range" CHECK ("app"."funding_allocations"."allocated_pct" is null or ("app"."funding_allocations"."allocated_pct" > 0 and "app"."funding_allocations"."allocated_pct" <= 1)),
	CONSTRAINT "funding_allocations_reason_not_blank" CHECK (length(btrim("app"."funding_allocations"."reason")) > 0),
	CONSTRAINT "funding_allocations_not_superseded_by_self" CHECK ("app"."funding_allocations"."superseded_by" is distinct from "app"."funding_allocations"."id"),
	CONSTRAINT "funding_allocations_superseded_has_status" CHECK ("app"."funding_allocations"."superseded_by" is null or "app"."funding_allocations"."status" = 'superseded')
);
--> statement-breakpoint
CREATE TABLE "app"."reallocation_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"number" text NOT NULL,
	"period_id" uuid NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"from_contract_id" uuid NOT NULL,
	"from_component_id" uuid NOT NULL,
	"from_period_id" uuid NOT NULL,
	"to_contract_id" uuid NOT NULL,
	"to_component_id" uuid NOT NULL,
	"to_period_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reallocation_documents_company_number_unique" UNIQUE("company_id","number"),
	CONSTRAINT "reallocation_documents_number_not_blank" CHECK (length(btrim("app"."reallocation_documents"."number")) > 0),
	CONSTRAINT "reallocation_documents_reason_not_blank" CHECK (length(btrim("app"."reallocation_documents"."reason")) > 0),
	CONSTRAINT "reallocation_documents_amount_positive" CHECK ("app"."reallocation_documents"."amount" > 0),
	CONSTRAINT "reallocation_documents_moves_somewhere" CHECK ("app"."reallocation_documents"."from_component_id" <> "app"."reallocation_documents"."to_component_id" or "app"."reallocation_documents"."from_period_id" <> "app"."reallocation_documents"."to_period_id")
);
--> statement-breakpoint
CREATE TABLE "app"."work_stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	"planned_start" date,
	"planned_end" date,
	"material_budget" numeric(14, 2),
	"labor_budget" numeric(14, 2),
	"pct_of_work" numeric(6, 4),
	"actual_start" date,
	"actual_end" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_stages_work_unit_position_unique" UNIQUE("work_unit_id","position"),
	CONSTRAINT "work_stages_position_positive" CHECK ("app"."work_stages"."position" > 0),
	CONSTRAINT "work_stages_name_not_blank" CHECK (length(btrim("app"."work_stages"."name")) > 0),
	CONSTRAINT "work_stages_planned_range" CHECK ("app"."work_stages"."planned_end" is null or "app"."work_stages"."planned_start" is null or "app"."work_stages"."planned_end" >= "app"."work_stages"."planned_start"),
	CONSTRAINT "work_stages_actual_range" CHECK ("app"."work_stages"."actual_end" is null or "app"."work_stages"."actual_start" is null or "app"."work_stages"."actual_end" >= "app"."work_stages"."actual_start"),
	CONSTRAINT "work_stages_material_budget_non_negative" CHECK ("app"."work_stages"."material_budget" is null or "app"."work_stages"."material_budget" >= 0),
	CONSTRAINT "work_stages_labor_budget_non_negative" CHECK ("app"."work_stages"."labor_budget" is null or "app"."work_stages"."labor_budget" >= 0),
	CONSTRAINT "work_stages_pct_range" CHECK ("app"."work_stages"."pct_of_work" is null or ("app"."work_stages"."pct_of_work" >= 0 and "app"."work_stages"."pct_of_work" <= 1))
);
--> statement-breakpoint
CREATE TABLE "app"."work_unit_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_unit_assignments_role_known" CHECK ("app"."work_unit_assignments"."role" in ('sef_santier', 'inspector', 'echipa')),
	CONSTRAINT "work_unit_assignments_period_valid" CHECK ("app"."work_unit_assignments"."valid_to" is null or "app"."work_unit_assignments"."valid_from" is null or "app"."work_unit_assignments"."valid_to" >= "app"."work_unit_assignments"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "app"."work_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" "app"."work_unit_type" NOT NULL,
	"name" text NOT NULL,
	"objective_id" uuid NOT NULL,
	"contract_objective_id" uuid,
	"status" "app"."work_unit_status" DEFAULT 'draft' NOT NULL,
	"responsible_person_id" uuid,
	"executor_type" "app"."executor_type" DEFAULT 'echipa_proprie' NOT NULL,
	"executor_subcontractor_id" uuid,
	"starts_on" date,
	"ends_on" date,
	"estimated_value" numeric(14, 2),
	"cost_budget" numeric(14, 2),
	"source_request_id" uuid,
	"promoted_from_id" uuid,
	"root_node_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_units_company_code_unique" UNIQUE("company_id","code"),
	CONSTRAINT "work_units_code_not_blank" CHECK (length(btrim("app"."work_units"."code")) > 0),
	CONSTRAINT "work_units_name_not_blank" CHECK (length(btrim("app"."work_units"."name")) > 0),
	CONSTRAINT "work_units_period_valid" CHECK ("app"."work_units"."ends_on" is null or "app"."work_units"."starts_on" is null or "app"."work_units"."ends_on" >= "app"."work_units"."starts_on"),
	CONSTRAINT "work_units_executor_consistent" CHECK (("app"."work_units"."executor_type" = 'subcontractant') = ("app"."work_units"."executor_subcontractor_id" is not null)),
	CONSTRAINT "work_units_estimated_value_non_negative" CHECK ("app"."work_units"."estimated_value" is null or "app"."work_units"."estimated_value" >= 0),
	CONSTRAINT "work_units_cost_budget_non_negative" CHECK ("app"."work_units"."cost_budget" is null or "app"."work_units"."cost_budget" >= 0),
	CONSTRAINT "work_units_closed_complete" CHECK (num_nonnulls("app"."work_units"."closed_at", "app"."work_units"."closed_by") <> 1),
	CONSTRAINT "work_units_not_promoted_from_self" CHECK ("app"."work_units"."promoted_from_id" is distinct from "app"."work_units"."id")
);
--> statement-breakpoint
ALTER TABLE "app"."funding_allocations" ADD CONSTRAINT "funding_allocations_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."funding_allocations" ADD CONSTRAINT "funding_allocations_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."funding_allocations" ADD CONSTRAINT "funding_allocations_component_id_contract_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "app"."contract_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."funding_allocations" ADD CONSTRAINT "funding_allocations_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."funding_allocations" ADD CONSTRAINT "funding_allocations_superseded_by_funding_allocations_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "app"."funding_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."funding_allocations" ADD CONSTRAINT "funding_allocations_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_from_contract_id_contracts_id_fk" FOREIGN KEY ("from_contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_from_component_id_contract_components_id_fk" FOREIGN KEY ("from_component_id") REFERENCES "app"."contract_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_from_period_id_periods_id_fk" FOREIGN KEY ("from_period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_to_contract_id_contracts_id_fk" FOREIGN KEY ("to_contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_to_component_id_contract_components_id_fk" FOREIGN KEY ("to_component_id") REFERENCES "app"."contract_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_to_period_id_periods_id_fk" FOREIGN KEY ("to_period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reallocation_documents" ADD CONSTRAINT "reallocation_documents_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_stages" ADD CONSTRAINT "work_stages_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_unit_assignments" ADD CONSTRAINT "work_unit_assignments_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_unit_assignments" ADD CONSTRAINT "work_unit_assignments_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_units" ADD CONSTRAINT "work_units_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_units" ADD CONSTRAINT "work_units_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "app"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_units" ADD CONSTRAINT "work_units_contract_objective_id_contract_objectives_id_fk" FOREIGN KEY ("contract_objective_id") REFERENCES "app"."contract_objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_units" ADD CONSTRAINT "work_units_responsible_person_id_persons_id_fk" FOREIGN KEY ("responsible_person_id") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_units" ADD CONSTRAINT "work_units_executor_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("executor_subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_units" ADD CONSTRAINT "work_units_promoted_from_id_work_units_id_fk" FOREIGN KEY ("promoted_from_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_units" ADD CONSTRAINT "work_units_closed_by_persons_id_fk" FOREIGN KEY ("closed_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funding_allocations_active_unique" ON "app"."funding_allocations" USING btree ("work_unit_id","contract_id","component_id","period_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "funding_allocations_work_unit_idx" ON "app"."funding_allocations" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "funding_allocations_component_period_idx" ON "app"."funding_allocations" USING btree ("component_id","period_id");--> statement-breakpoint
CREATE INDEX "funding_allocations_period_idx" ON "app"."funding_allocations" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "reallocation_documents_period_idx" ON "app"."reallocation_documents" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "reallocation_documents_work_unit_idx" ON "app"."reallocation_documents" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "work_unit_assignments_work_unit_idx" ON "app"."work_unit_assignments" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "work_unit_assignments_person_idx" ON "app"."work_unit_assignments" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "work_units_company_status_idx" ON "app"."work_units" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "work_units_company_type_idx" ON "app"."work_units" USING btree ("company_id","type");--> statement-breakpoint
CREATE INDEX "work_units_objective_idx" ON "app"."work_units" USING btree ("objective_id");--> statement-breakpoint
CREATE INDEX "work_units_contract_objective_idx" ON "app"."work_units" USING btree ("contract_objective_id");--> statement-breakpoint
CREATE INDEX "work_units_responsible_idx" ON "app"."work_units" USING btree ("responsible_person_id");

-- ══ Completari scrise de mana ═══════════════════════════════════════════════

/*
 * O persoana nu poate avea DE DOUA ORI acelasi rol pe aceeasi unitate de lucru
 * pe intervale care se suprapun. Fara constrangere, „cine era sef de santier pe
 * L-233 in septembrie" ar avea doua raspunsuri, iar pontajul lunii s-ar putea
 * atribui de doua ori.
 *
 * Rolul intra in cheie: acelasi om poate fi simultan inspector si echipa, si e
 * cazul real la o firma mica. `[)` — deschis la dreapta, ca la
 * `contract_objectives`: cineva scos pe 01.04 si readus pe 01.04 nu se suprapune
 * cu el insusi, altfel orice inlocuire ar cere o zi de pauza.
 */
alter table app.work_unit_assignments
  add constraint work_unit_assignments_no_overlap
  exclude using gist (
    work_unit_id with =,
    person_id with =,
    role with =,
    daterange(valid_from, valid_to, '[)') with &&
  );
--> statement-breakpoint

-- ── Etapele exista doar pe lucrari ──────────────────────────────────────────
--
-- Regula 6 din pas. `security definer`: verificarea trebuie sa vada unitatea
-- indiferent de ce vede apelantul — altfel o etapa pe o UL invizibila ar fi
-- respinsa cu motivul gresit, si depanarea ar cauta in alta parte.
create function app.guard_stages_only_on_lucrare() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_type app.work_unit_type;
begin
  select wu.type into v_type from app.work_units wu where wu.id = new.work_unit_id;

  if v_type is distinct from 'lucrare' then
    raise exception
      'VALIDATION_FAILED: etapele exista doar pe lucrari, iar unitatea % este %',
      new.work_unit_id, coalesce(v_type::text, 'inexistenta')
      using errcode = 'P0001';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger work_stages_only_on_lucrare
  before insert or update on app.work_stages
  for each row execute function app.guard_stages_only_on_lucrare();
--> statement-breakpoint

/*
 * Reversul aceleiasi reguli, pe cealalta tabela: o lucrare cu etape nu se mai
 * poate intoarce la interventie sau inspectie.
 *
 * Fara el, regula ar fi impusa doar la scrierea etapei, iar etapele ar putea
 * ramane orfane retroactiv — adica exact starea pe care trigger-ul de mai sus o
 * face imposibila prin fata.
 */
create function app.guard_work_unit_type_change() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
begin
  if old.type = 'lucrare' and new.type <> 'lucrare'
     and exists (select 1 from app.work_stages s where s.work_unit_id = old.id) then
    raise exception
      'CONFLICT: unitatea % are etape, deci nu mai poate fi % — etapele exista doar pe lucrari',
      old.code, new.type
      using errcode = 'P0001';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger work_units_type_change_guard
  before update of type on app.work_units
  for each row execute function app.guard_work_unit_type_change();
--> statement-breakpoint

-- ── Coerenta unei alocari de finantare ──────────────────────────────────────
/*
 * Patru intrebari la care FK-urile nu raspund, pentru ca ele leaga randuri, nu
 * firme: unitatea, contractul si luna trebuie sa fie ale ACELEIASI firme, iar
 * componenta trebuie sa fie a contractului scris pe alocare.
 *
 * O alocare pe luna altei firme ar strica raportul ambelor luni, si ar face-o
 * silentios: cifrele ar exista, ar fi doar in locul nepotrivit.
 */
create function app.guard_funding_allocation_coherent() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_company            uuid;
  v_contract_company   uuid;
  v_period_company     uuid;
  v_component_contract uuid;
begin
  select wu.company_id  into v_company           from app.work_units wu where wu.id = new.work_unit_id;
  select c.company_id   into v_contract_company  from app.contracts c  where c.id = new.contract_id;
  select p.company_id   into v_period_company    from app.periods p    where p.id = new.period_id;
  select cc.contract_id into v_component_contract
    from app.contract_components cc where cc.id = new.component_id;

  if v_contract_company is distinct from v_company then
    raise exception
      'VALIDATION_FAILED: contractul alocarii e la alta firma decat unitatea de lucru'
      using errcode = 'P0001';
  end if;

  if v_period_company is distinct from v_company then
    raise exception
      'VALIDATION_FAILED: luna alocarii e la alta firma decat unitatea de lucru'
      using errcode = 'P0001';
  end if;

  if v_component_contract is distinct from new.contract_id then
    raise exception
      'VALIDATION_FAILED: componenta nu apartine contractului scris pe alocare'
      using errcode = 'P0001';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger funding_allocations_coherent
  before insert on app.funding_allocations
  for each row execute function app.guard_funding_allocation_coherent();
--> statement-breakpoint

-- ── Suma procentelor active ≤ 1 ─────────────────────────────────────────────
/*
 * Trigger, nu `check`: regula e pe un AGREGAT peste mai multe randuri.
 *
 * `after`, ca sa vada si randul care se insereaza. `security definer`, ca suma
 * sa fie cea reala si nu cea vizibila apelantului — o suma calculata pe randuri
 * filtrate de RLS ar fi mai mica, deci ar permite depasirea exact rolurilor cu
 * vizibilitate partiala.
 *
 * O lucrare finantata 60% din Mentenanta si 50% din Delta in aceeasi luna
 * inseamna 110% din ea insasi, adica o eroare de introducere — verificarea #2.
 */
create function app.guard_funding_allocation_pct_sum() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_sum numeric(10, 4);
begin
  select coalesce(sum(fa.allocated_pct), 0)
    into v_sum
    from app.funding_allocations fa
   where fa.work_unit_id = new.work_unit_id
     and fa.period_id    = new.period_id
     and fa.status       = 'active';

  if v_sum > 1 then
    -- Semnul de procent se lipeste la ARGUMENT, nu la sablon: in plpgsql `%%%`
    -- se citeste „% literal, apoi placeholder", deci ar fi iesit „%110.00".
    raise exception
      'VALIDATION_FAILED: procentele alocate activ pe unitatea % in aceeasi luna insumeaza %, maximul e 100%%',
      new.work_unit_id, round(v_sum * 100, 2)::text || '%'
      using errcode = 'P0001';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger funding_allocations_pct_sum
  after insert or update of allocated_pct, status on app.funding_allocations
  for each row execute function app.guard_funding_allocation_pct_sum();
--> statement-breakpoint

-- ── Alocarile nu se rescriu ─────────────────────────────────────────────────
/*
 * Regula 3 din pas, impusa in baza si nu prin instruire: singurele coloane care
 * se mai pot schimba dupa ce randul exista sunt `status` si `superseded_by`.
 * Suma, componenta, luna si motivul sunt istorie.
 *
 * Comparatia se face pe `to_jsonb(row)` fara cele doua chei mutabile, nu coloana
 * cu coloana: asa o coloana adaugata in pasii urmatori intra automat sub regula,
 * in loc sa scape pentru ca nimeni nu s-a gandit s-o adauge in lista.
 *
 * `delete` e refuzat integral. O alocare stearsa ar lua cu ea explicatia unei
 * cifre deja raportate.
 */
create function app.guard_funding_allocation_immutable() returns trigger
  language plpgsql
as $$
declare
  v_changed text;
begin
  if tg_op = 'DELETE' then
    raise exception
      'CONFLICT: alocarile de finantare nu se sterg, se supersedeaza (alocarea %)', old.id
      using errcode = 'P0001';
  end if;

  select string_agg(n.key, ', ' order by n.key)
    into v_changed
    from jsonb_each(to_jsonb(new) - 'status' - 'superseded_by') as n(key, value)
   where n.value is distinct from (to_jsonb(old) - 'status' - 'superseded_by') -> n.key;

  if v_changed is not null then
    raise exception
      'CONFLICT: o alocare de finantare nu se rescrie, se supersedeaza (s-a incercat: %)', v_changed
      using errcode = 'P0001';
  end if;

  -- Drumul e intr-un singur sens. O alocare reactivata ar fi a doua versiune a
  -- aceluiasi rand, iar `superseded_by` ar arata spre viitorul care n-a fost.
  if old.status = 'superseded' and new.status <> 'superseded' then
    raise exception 'CONFLICT: o alocare supersedata nu se reactiveaza (alocarea %)', old.id
      using errcode = 'P0001';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger funding_allocations_immutable
  before update or delete on app.funding_allocations
  for each row execute function app.guard_funding_allocation_immutable();
--> statement-breakpoint

-- ── Documentul de re-alocare ────────────────────────────────────────────────
/*
 * Documentul se emite in luna CURENTA si muta finantarea intr-o luna DESCHISA.
 * A muta intr-una inchisa ar rescrie exact luna raportata pe care intreg
 * mecanismul e construit sa n-o atinga — deci nu e o omisiune de interfata, e o
 * regula de baza.
 *
 * Luna in care se emite (`period_id`) e verificata separat, de
 * `guard_closed_period`, atasat mai jos.
 */
create function app.guard_reallocation_document() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_company uuid;
begin
  select wu.company_id into v_company from app.work_units wu where wu.id = new.work_unit_id;

  if v_company is distinct from new.company_id then
    raise exception 'VALIDATION_FAILED: documentul e la alta firma decat unitatea de lucru'
      using errcode = 'P0001';
  end if;

  perform app.assert_period_open(new.to_period_id);

  return new;
end
$$;
--> statement-breakpoint

create trigger reallocation_documents_coherent
  before insert on app.reallocation_documents
  for each row execute function app.guard_reallocation_document();
--> statement-breakpoint

/*
 * Un document emis nu se modifica si nu se sterge. Corectia unei re-alocari
 * gresite e o re-alocare in sens invers, care se vede si ea pe lista lunii —
 * „ambele miscari raman vizibile" (§13.1) nu e o preferinta de afisare, e
 * proprietatea pe care se sprijina increderea in lista.
 */
create function app.guard_reallocation_document_immutable() returns trigger
  language plpgsql
as $$
begin
  raise exception
    'CONFLICT: documentul de re-alocare % e definitiv, corectia se face cu un document in sens invers',
    coalesce(old.number, '?')
    using errcode = 'P0001';
end
$$;
--> statement-breakpoint

create trigger reallocation_documents_immutable
  before update or delete on app.reallocation_documents
  for each row execute function app.guard_reallocation_document_immutable();
--> statement-breakpoint

-- ── Autorizatia SSM la asignare ─────────────────────────────────────────────
/*
 * Mesajul primea pana acum lista tipurilor lipsa. Acum spune si CE s-a
 * intamplat cu fiecare: lipseste, a expirat la o data, sau e emisa abia mai
 * tarziu. Verificarea #12 a pasului cere exact asta — „ce autorizatie si cand a
 * expirat" — iar un mesaj care spune doar „ssm" trimite omul sa caute singur.
 *
 * Semnatura nu se schimba, deci apelantii din 0004 raman valabili.
 */
create or replace function app.assert_authorizations_valid(
  p_person_id uuid,
  p_kinds     text[],
  p_on_date   date
) returns void
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_problem text;
begin
  if p_kinds is null or cardinality(p_kinds) = 0 then
    return;
  end if;

  select string_agg(
           case
             when last.kind is null then format('%s (lipseste)', k)
             when last.expires_at is not null and last.expires_at < p_on_date
               then format('%s (expirata la %s)', k, to_char(last.expires_at, 'DD.MM.YYYY'))
             else format('%s (emisa abia la %s)', k, to_char(last.issued_at, 'DD.MM.YYYY'))
           end,
           ', ' order by k
         )
    into v_problem
    from unnest(p_kinds) as k
    left join lateral (
      select a.kind, a.issued_at, a.expires_at
        from app.person_authorizations a
       where a.person_id = p_person_id
         and a.kind      = k
       -- Cea care duce cel mai departe in timp: despre ea merita sa se
       -- vorbeasca in mesaj. `infinity` pentru cele fara data de expirare.
       order by coalesce(a.expires_at, 'infinity'::date) desc
       limit 1
    ) as last on true
   where not exists (
     select 1
       from app.person_authorizations a
      where a.person_id  = p_person_id
        and a.kind       = k
        and a.issued_at <= p_on_date
        and (a.expires_at is null or a.expires_at >= p_on_date)
   );

  if v_problem is not null then
    raise exception
      'AUTHORIZATION_EXPIRED: persoana % nu are la % autorizatiile: %',
      p_person_id, to_char(p_on_date, 'DD.MM.YYYY'), v_problem
      using errcode = 'P0001';
  end if;
end
$$;
--> statement-breakpoint

/*
 * De ce nu `app.guard_person_authorizations` din 0004, care exista tocmai pentru
 * asta: ambalajul generic citeste data din randul care se scrie, iar aici data
 * care conteaza sta pe PARINTE. Verificarea e „avea omul SSM valabil cand
 * incepe lucrarea", nu „acum".
 *
 * Ordinea din `coalesce` e ordinea de precizie: intervalul asignarii, apoi
 * inceputul unitatii, apoi ziua de azi pentru o UL fara date planificate.
 *
 * Se cere `ssm` si numai `ssm`. Autorizatiile de specialitate (lucru la
 * inaltime, ISCIR, electrician autorizat) depind de ce se executa, nu de faptul
 * ca cineva e asignat — se cer pe operatie, in pasul 09, unde exista fisa care
 * spune ce se face.
 */
create function app.guard_work_unit_assignment_authorizations() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_on_date date;
begin
  select coalesce(new.valid_from, wu.starts_on, current_date)
    into v_on_date
    from app.work_units wu
   where wu.id = new.work_unit_id;

  perform app.assert_authorizations_valid(new.person_id, array['ssm'], v_on_date);

  return new;
end
$$;
--> statement-breakpoint

create trigger work_unit_assignments_require_authorizations
  before insert or update on app.work_unit_assignments
  for each row execute function app.guard_work_unit_assignment_authorizations();
--> statement-breakpoint

-- ── Blocarea lunii inchise ──────────────────────────────────────────────────
/*
 * Doar pe cele doua tabele care poarta bani si luna. `work_units` NU primeste
 * blocarea: o unitate de lucru n-are luna proprie, iar starea ei se schimba si
 * dupa ce luna in care a inceput s-a inchis (o lucrare din august se finalizeaza
 * in septembrie — e cazul normal, nu exceptia).
 *
 * Verificarea #16 („creezi UL intr-o luna inchisa → PERIOD_CLOSED") trece prin
 * alocare, nu prin unitate: `createWorkUnit` e o singura tranzactie care scrie
 * si finantarea, iar finantarea e cea care are luna.
 */
select app.attach_period_guard('app.funding_allocations');
--> statement-breakpoint
select app.attach_period_guard('app.reallocation_documents');
--> statement-breakpoint

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Promovarea, mutarea finantarii si inchiderea sunt exact felul de decizii
-- despre care cineva va intreba peste sase luni „cine si de ce".
select app.attach_audit('app.work_units');
--> statement-breakpoint
select app.attach_audit('app.work_unit_assignments');
--> statement-breakpoint
select app.attach_audit('app.work_stages');
--> statement-breakpoint

-- Supersedarea unei alocari cere motiv scris (regula 4 din pas). La `insert`
-- motivul e oricum obligatoriu — sta in coloana `reason`, `not null`.
select app.attach_audit('app.funding_allocations', true);
--> statement-breakpoint
select app.attach_audit('app.reallocation_documents');
--> statement-breakpoint

-- ── Scoping prin parinte, pentru politici ───────────────────────────────────
-- `security definer`, ca surorile lor din 0011: verificarea vede randul-parinte
-- indiferent de ce vede apelantul.
create or replace function app.work_unit_in_scope(p_work_unit uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select exists (
    select 1 from app.work_units wu
     where wu.id = p_work_unit and wu.company_id = any(app.current_company_ids())
  )
$$;
--> statement-breakpoint

/*
 * Terenul nu vede tot ce e la firma lui, ci doar ce e al lui: unitatile pe care
 * e asignat, plus cele pe care e responsabil. Verificarea #17 a pasului.
 *
 * Responsabilul intra dinadins, chiar daca n-are rand de asignare: un sef de
 * santier care nu-si vede propria lucrare in lista ar raporta-o ca bug in prima
 * zi, si ar avea dreptate.
 */
create or replace function app.work_unit_assigned_to_me(p_work_unit uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select exists (
    select 1
      from app.work_units wu
     where wu.id = p_work_unit
       and wu.company_id = any(app.current_company_ids())
       and (
         wu.responsible_person_id = app.current_person_id()
         or exists (
           select 1 from app.work_unit_assignments a
            where a.work_unit_id = wu.id and a.person_id = app.current_person_id()
         )
       )
  )
$$;
--> statement-breakpoint

grant execute on function
  app.work_unit_in_scope(uuid), app.work_unit_assigned_to_me(uuid)
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

-- ── RLS ─────────────────────────────────────────────────────────────────────
select app.rls_enable('app.work_units'::regclass);
--> statement-breakpoint
select app.rls_enable('app.work_unit_assignments'::regclass);
--> statement-breakpoint
select app.rls_enable('app.work_stages'::regclass);
--> statement-breakpoint
select app.rls_enable('app.funding_allocations'::regclass);
--> statement-breakpoint
select app.rls_enable('app.reallocation_documents'::regclass);
--> statement-breakpoint

create policy "office" on app.work_units for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint
create policy "assigned" on app.work_units for select to app_field
  using (app.work_unit_assigned_to_me(id));
--> statement-breakpoint
-- Subcontractantul vede unitatile pe care le executa el, si numai pe ele.
create policy "own" on app.work_units for select to app_subcontractor
  using (executor_subcontractor_id = app.current_subcontractor_id());
--> statement-breakpoint

create policy "office" on app.work_unit_assignments for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint
create policy "assigned" on app.work_unit_assignments for select to app_field
  using (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

create policy "office" on app.work_stages for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint
create policy "assigned" on app.work_stages for select to app_field
  using (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

-- Finantarea e integral comerciala: nicio politica in afara biroului, pentru ca
-- nici grant-ul nu exista. Cele doua straturi spun acelasi lucru dinadins.
create policy "office" on app.funding_allocations for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint

create policy "office" on app.reallocation_documents for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint

-- ── Grant-uri ───────────────────────────────────────────────────────────────
grant select, insert, update, delete on
  app.work_units, app.work_unit_assignments, app.work_stages
  to app_office, app_service;
--> statement-breakpoint

/*
 * Finantarea: biroul si worker-ul, nimeni altcineva. Fara `delete` si fara
 * `update` pe documentul de re-alocare — tabelele sunt istorie, iar triggerele
 * de imutabilitate ar refuza oricum. Grant-ul lipsa e primul strat, trigger-ul
 * al doilea: refuzul vine cu 42501 inainte sa ajunga la mesajul de business.
 */
grant select, insert, update on app.funding_allocations to app_office, app_service;
--> statement-breakpoint
grant select, insert on app.reallocation_documents to app_office, app_service;
--> statement-breakpoint

/*
 * Terenul si subcontractantul: TOATE coloanele in afara de cele doua de bani.
 * Enumerarea e explicita si plictisitoare dinadins — o coloana de bani adaugata
 * in pasii urmatori nu intra in lista de la sine, deci nu poate scapa afara din
 * neatentie. Poarta de la finalul migrarii verifica exact asta.
 *
 * Ce NU primesc: `estimated_value`, `cost_budget`. Ecranul de teren arata ce e
 * de facut si unde, nu cat valoreaza (verificarea #17).
 */
grant select (
  id, company_id, code, type, name, objective_id, contract_objective_id, status,
  responsible_person_id, executor_type, executor_subcontractor_id,
  starts_on, ends_on, source_request_id, promoted_from_id, root_node_id,
  closed_at, closed_by, created_at
) on app.work_units to app_field, app_subcontractor;
--> statement-breakpoint

grant select on app.work_unit_assignments to app_field, app_subcontractor;
--> statement-breakpoint

-- Ce NU primesc: `material_budget`, `labor_budget`. Graficul etapelor se vede,
-- bugetul lor nu.
grant select (
  id, work_unit_id, position, name, planned_start, planned_end,
  pct_of_work, actual_start, actual_end, created_at
) on app.work_stages to app_field, app_subcontractor;
--> statement-breakpoint

/*
 * Poarta de bani, a doua rulare (prima e in 0012).
 *
 * Regexul de acolo prinde price/pret/cost/amount/margin/salary — deci
 * `cost_budget` si `allocated_amount`, dar NU `estimated_value`,
 * `material_budget` sau `labor_budget`. Numele de coloana nu e un mecanism de
 * securitate, e o euristica; de aceea lista celor patru se scrie explicit.
 *
 * Functia ramane in baza dupa migrare: pasii 06-10 adauga tabele cu bani, iar o
 * poarta care se cheama cu o linie chiar se cheama.
 */
create or replace function app.assert_no_money_leak(p_extra_columns text[] default '{}')
  returns void
  language plpgsql
  stable
as $$
declare
  leaked text;
begin
  select string_agg(format('%s.%s → %s', c.relname, a.attname, r.rolname), ', ')
    into leaked
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join (
      select rolname from pg_roles
       where rolname in ('app_field', 'app_subcontractor', 'app_client')
    ) r
   where c.relnamespace = 'app'::regnamespace
     and c.relkind = 'r'
     and (
       a.attname ~ '(price|pret|cost|amount|margin|salary)'
       or a.attname = any(p_extra_columns)
     )
     and has_column_privilege(r.rolname, c.oid, a.attnum, 'select');

  if leaked is not null then
    raise exception 'PRICE_LEAK: coloane de bani vizibile in afara biroului: %', leaked
      using errcode = 'P0001';
  end if;
end
$$;
--> statement-breakpoint

revoke execute on function app.assert_no_money_leak(text[]) from public;
--> statement-breakpoint

select app.assert_no_money_leak(
  array['estimated_value', 'material_budget', 'labor_budget']
);
