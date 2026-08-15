CREATE TABLE "app"."component_ceilings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"component_id" uuid NOT NULL,
	"period_id" uuid,
	"contract_year_id" uuid,
	"allocated_revenue" numeric(14, 2),
	"cost_ceiling" numeric(14, 2),
	"revenue_ceiling" numeric(14, 2),
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "component_ceilings_scope_unique" UNIQUE NULLS NOT DISTINCT("component_id","period_id","contract_year_id"),
	CONSTRAINT "component_ceilings_one_scope" CHECK (num_nonnulls("app"."component_ceilings"."period_id", "app"."component_ceilings"."contract_year_id") = 1),
	CONSTRAINT "component_ceilings_allocated_revenue_non_negative" CHECK ("app"."component_ceilings"."allocated_revenue" is null or "app"."component_ceilings"."allocated_revenue" >= 0),
	CONSTRAINT "component_ceilings_cost_ceiling_non_negative" CHECK ("app"."component_ceilings"."cost_ceiling" is null or "app"."component_ceilings"."cost_ceiling" >= 0),
	CONSTRAINT "component_ceilings_revenue_ceiling_non_negative" CHECK ("app"."component_ceilings"."revenue_ceiling" is null or "app"."component_ceilings"."revenue_ceiling" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."contract_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"type" "app"."component_type" NOT NULL,
	"name" text NOT NULL,
	"budget_cadence" "app"."budget_cadence" NOT NULL,
	"is_fill_target" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_components_contract_type_unique" UNIQUE("contract_id","type"),
	CONSTRAINT "contract_components_name_not_blank" CHECK (length(btrim("app"."contract_components"."name")) > 0),
	CONSTRAINT "contract_components_fill_target_only_delta" CHECK ("app"."contract_components"."is_fill_target" = ("app"."contract_components"."type" = 'delta'))
);
--> statement-breakpoint
CREATE TABLE "app"."contract_years" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"year_index" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"monthly_value" numeric(14, 2) NOT NULL,
	"indexation_applied_pct" numeric(6, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_years_contract_index_unique" UNIQUE("contract_id","year_index"),
	CONSTRAINT "contract_years_index_range" CHECK ("app"."contract_years"."year_index" between 1 and 20),
	CONSTRAINT "contract_years_period_valid" CHECK ("app"."contract_years"."ends_on" > "app"."contract_years"."starts_on"),
	CONSTRAINT "contract_years_monthly_value_non_negative" CHECK ("app"."contract_years"."monthly_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"code" text NOT NULL,
	"reference" text,
	"type" "app"."contract_type" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"total_value" numeric(14, 2),
	"monthly_value" numeric(14, 2),
	"payment_term_days" smallint DEFAULT 70 NOT NULL,
	"indexation_pct" numeric(6, 4) DEFAULT '0.0500' NOT NULL,
	"delta_threshold" numeric(14, 2) DEFAULT '2000.00' NOT NULL,
	"expiry_alert_months" smallint DEFAULT 6 NOT NULL,
	"owner_person_id" uuid,
	"overhead_pct" numeric(6, 4),
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_company_code_unique" UNIQUE("company_id","code"),
	CONSTRAINT "contracts_code_not_blank" CHECK (length(btrim("app"."contracts"."code")) > 0),
	CONSTRAINT "contracts_period_valid" CHECK ("app"."contracts"."ends_on" > "app"."contracts"."starts_on"),
	CONSTRAINT "contracts_status_known" CHECK ("app"."contracts"."status" in ('draft', 'activ', 'suspendat', 'incheiat', 'anulat')),
	CONSTRAINT "contracts_indexation_non_negative" CHECK ("app"."contracts"."indexation_pct" >= 0),
	CONSTRAINT "contracts_delta_threshold_non_negative" CHECK ("app"."contracts"."delta_threshold" >= 0),
	CONSTRAINT "contracts_total_value_non_negative" CHECK ("app"."contracts"."total_value" is null or "app"."contracts"."total_value" >= 0),
	CONSTRAINT "contracts_monthly_value_non_negative" CHECK ("app"."contracts"."monthly_value" is null or "app"."contracts"."monthly_value" >= 0),
	CONSTRAINT "contracts_expiry_alert_positive" CHECK ("app"."contracts"."expiry_alert_months" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."component_ceilings" ADD CONSTRAINT "component_ceilings_component_id_contract_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "app"."contract_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."component_ceilings" ADD CONSTRAINT "component_ceilings_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."component_ceilings" ADD CONSTRAINT "component_ceilings_contract_year_id_contract_years_id_fk" FOREIGN KEY ("contract_year_id") REFERENCES "app"."contract_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."component_ceilings" ADD CONSTRAINT "component_ceilings_set_by_persons_id_fk" FOREIGN KEY ("set_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contract_components" ADD CONSTRAINT "contract_components_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contract_years" ADD CONSTRAINT "contract_years_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contracts" ADD CONSTRAINT "contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "app"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contracts" ADD CONSTRAINT "contracts_owner_person_id_persons_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "component_ceilings_period_idx" ON "app"."component_ceilings" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "contracts_expiry_idx" ON "app"."contracts" USING btree ("ends_on") WHERE status = 'activ';--> statement-breakpoint
CREATE INDEX "contracts_company_status_idx" ON "app"."contracts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "contracts_client_idx" ON "app"."contracts" USING btree ("client_id");

-- â•â• Completari scrise de mana â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

-- â”€â”€ Reparatie: auditul tabelelor cu cheie compusa â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/*
 * BUG gasit in pasul 04, introdus in 0007.
 *
 * `audit.record_change()` deriva `record_id` din coloana `id` a randului. Trei
 * tabele auditate n-au coloana asta â€” `person_company_access`,
 * `person_office_roles`, `team_members` â€” deci ORICE insert in ele esua cu
 * 23502 (`record_id` not null). Verificat pe Supabase: â€žnull value in column
 * record_id of relation entries". Nu s-a vazut pana acum pentru ca niciun test
 * si niciun ecran nu scrisese inca in ele; seed-ul pasului 04 le atinge pe toate.
 *
 * Reparatia: cand randul n-are `id`, `record_id` se deriva din md5-ul randului
 * intreg. Pe tabelele astea toate coloanele SUNT cheia (sunt tabele de legatura
 * pura), deci hash-ul randului e hash-ul cheii â€” stabil intre INSERT si DELETE,
 * adica exact ce trebuie ca â€žce s-a intamplat cu legatura asta" sa aiba raspuns.
 * `md5()` da 32 de caractere hex, care se toarna direct in uuid.
 *
 * Restul functiei e neschimbat fata de 0007.
 */
create or replace function audit.record_change() returns trigger
  language plpgsql
  security definer
  set search_path = audit, app, pg_catalog
as $$
declare
  v_old      jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new      jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_changed  jsonb := '{}'::jsonb;
  v_key      text;
  v_record   uuid;
  v_claims   jsonb;
  v_persona  app.persona;
  v_actor    uuid;
  v_reason   text;
  v_required boolean := coalesce(tg_argv[0], 'false')::boolean and tg_op <> 'INSERT';
begin
  for v_key in select jsonb_object_keys(v_old || v_new) loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changed := v_changed || jsonb_build_object(
        v_key,
        jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key)
      );
    end if;
  end loop;

  if tg_op = 'UPDATE' and v_changed = '{}'::jsonb then
    return new;
  end if;

  v_record := coalesce(
    nullif(v_new ->> 'id', ''),
    nullif(v_old ->> 'id', ''),
    md5((case when tg_op = 'DELETE' then v_old else v_new end)::text)
  )::uuid;

  v_claims  := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_persona := nullif(v_claims ->> 'persona', '')::app.persona;
  v_actor   := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_reason  := nullif(btrim(coalesce(current_setting('app.action_reason', true), '')), '');

  if v_required and v_reason is null then
    raise exception
      'VALIDATION_FAILED: operatia pe % cere un motiv scris (app.action_reason)', tg_table_name
      using errcode = 'P0001';
  end if;

  insert into audit.entries (
    actor_id, persona, table_name, record_id, operation, changed,
    reason, request_id, requires_reason
  ) values (
    v_actor,
    v_persona,
    format('%s.%s', tg_table_schema, tg_table_name),
    v_record,
    lower(tg_op)::app.audit_op,
    v_changed,
    v_reason,
    nullif(current_setting('app.request_id', true), ''),
    v_required
  );

  return case when tg_op = 'DELETE' then old else new end;
end
$$;
--> statement-breakpoint

-- â”€â”€ Cele trei numere nu se amesteca â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/*
 * Regula 1 a pasului, impusa in baza: `revenue_ceiling` se completeaza DOAR pe
 * Delta, `cost_ceiling` doar pe mentenanta / lucrari / individual.
 *
 * Nu poate fi un `check` simplu: randul de plafon nu poarta tipul componentei,
 * ci doar `component_id`. Alternativa era sa denormalizam tipul pe fiecare rand
 * de plafon si sa-l tinem sincron cu o cheie straina compusa â€” mai multa
 * masinarie, si o coloana in plus pe care aplicatia ar putea s-o completeze
 * gresit.
 *
 * `security definer`: verificarea trebuie sa vada componenta indiferent de ce
 * are voie sa citeasca apelantul. Cu RLS pe `contract_components` (02b), un rol
 * cu vizibilitate partiala ar primi â€žcomponenta nu exista" in loc de regula.
 */
create function app.check_ceiling_kind() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_type app.component_type;
begin
  select type into v_type from app.contract_components where id = new.component_id;

  if not found then
    -- Cheia straina prinde cazul asta oricum; nu dublam mesajul.
    return new;
  end if;

  if v_type = 'delta' then
    if new.cost_ceiling is not null then
      raise exception
        'VALIDATION_FAILED: Delta nu are plafon de cost. E buget de VENIT pe care il umpli, nu limita de cheltuiala.'
        using errcode = 'P0001';
    end if;
  else
    if new.revenue_ceiling is not null then
      raise exception
        'VALIDATION_FAILED: doar Delta are plafon de venit. Componenta % primeste plafon de COST.', v_type
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger component_ceilings_check_kind
  before insert or update on app.component_ceilings
  for each row execute function app.check_ceiling_kind();
--> statement-breakpoint

-- â”€â”€ Luna inchisa â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Plafoanele lunare poarta `period_id`, deci trigger-ul generic din 0005 le
-- prinde direct. Randurile anuale (cu `contract_year_id`) nu apartin unei luni
-- si raman modificabile â€” corect: planul anual nu e o cifra a lui august.
select app.attach_period_guard('app.component_ceilings');
--> statement-breakpoint

-- â”€â”€ Audit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
select app.attach_audit('app.contracts');
--> statement-breakpoint
select app.attach_audit('app.contract_years');
--> statement-breakpoint
select app.attach_audit('app.contract_components');
--> statement-breakpoint

/*
 * Plafoanele cer MOTIV SCRIS (regula 7 a pasului).
 *
 * Ca peste tot in aplicatie, motivul se cere la UPDATE si DELETE, nu la INSERT
 * (decizia din 02a: a crea ceva nu e ireversibil). In practica plafoanele se
 * creeaza o data, la deschiderea anului, si se MODIFICA de zeci de ori â€” deci
 * exact operatia care conteaza e acoperita. Stratul de servicii cere motiv si la
 * creare, ca verificarea #5 sa treaca pe intelesul ei literal.
 */
select app.attach_audit('app.component_ceilings', true);
--> statement-breakpoint

-- â”€â”€ Grant-uri, cu izolarea pretului la nivel de COLOANA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/*
 * Decizia 3 din PLAN_TEHNIC, aplicata aici pentru prima data pe o tabela pe care
 * terenul chiar are nevoie s-o citeasca.
 *
 * `app.rate_cards` a fost usor: poarta doar bani, deci terenul n-are ce cauta in
 * ea deloc. Contractul e altfel â€” omul din teren trebuie sa stie pe ce contract
 * lucreaza, cum se numeste si cat mai tine, dar nu are de ce sa afle cat
 * valoreaza sau cu ce indexare. Deci nu se revoca tabela, se revoca coloanele.
 *
 * Cele cinci coloane care NU apar mai jos â€” `total_value`, `monthly_value`,
 * `indexation_pct`, `delta_threshold`, `overhead_pct` â€” sunt exact clauzele
 * comerciale. Un `select *` din teren esueaza cu 42501, adica refuz, nu tacere:
 * mai bine o eroare vizibila decat o cifra lipsa pe care o completeaza cineva
 * din memorie.
 */
grant select on app.contracts to app_office, app_service;
--> statement-breakpoint

grant select (
  id, company_id, client_id, code, reference, type,
  starts_on, ends_on, payment_term_days, expiry_alert_months,
  owner_person_id, status, created_at
) on app.contracts to app_field, app_subcontractor, app_client;
--> statement-breakpoint

-- Componentele nu poarta nicio suma: numele si cadenta sunt structura, nu bani.
-- Terenul are nevoie de ele ca sa stie din ce se finanteaza lucrarea lui.
grant select on app.contract_components
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

-- Anii contractuali poarta abonamentul indexat, plafoanele poarta toti cei trei
-- bani. Amandoua sunt integral financiare: nu se decupeaza pe coloane, se refuza.
grant select on app.contract_years, app.component_ceilings to app_office, app_service;
--> statement-breakpoint

grant insert, update, delete on
  app.contracts, app.contract_years, app.contract_components, app.component_ceilings
  to app_office, app_service;
