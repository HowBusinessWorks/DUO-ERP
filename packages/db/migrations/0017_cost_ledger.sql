CREATE TABLE "app"."cost_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"document_date" date NOT NULL,
	"effect_date" date NOT NULL,
	"period_id" uuid,
	"used_contract_id" uuid,
	"used_component_id" uuid,
	"objective_id" uuid,
	"work_unit_id" uuid,
	"stage_id" uuid,
	"charged_contract_id" uuid,
	"charged_component_id" uuid,
	"expense_type" "app"."expense_type" NOT NULL,
	"product_id" uuid,
	"qualification_id" uuid,
	"quantity" numeric(14, 4),
	"uom" text,
	"amount" numeric(14, 2) NOT NULL,
	"stage" "app"."cost_stage" NOT NULL,
	"document_type" "app"."cost_document_type" NOT NULL,
	"document_id" uuid NOT NULL,
	"document_line_id" uuid,
	"supplier_id" uuid,
	"subcontractor_id" uuid,
	"reallocation_of_id" uuid,
	"is_reallocation" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_lines_charged_required" CHECK ("app"."cost_lines"."stage" = 'angajat' or "app"."cost_lines"."charged_contract_id" is not null),
	CONSTRAINT "cost_lines_quantity_pair" CHECK (num_nonnulls("app"."cost_lines"."quantity", "app"."cost_lines"."uom") <> 1),
	CONSTRAINT "cost_lines_uom_not_blank" CHECK ("app"."cost_lines"."uom" is null or length(btrim("app"."cost_lines"."uom")) > 0),
	CONSTRAINT "cost_lines_used_component_has_contract" CHECK ("app"."cost_lines"."used_component_id" is null or "app"."cost_lines"."used_contract_id" is not null),
	CONSTRAINT "cost_lines_charged_component_has_contract" CHECK ("app"."cost_lines"."charged_component_id" is null or "app"."cost_lines"."charged_contract_id" is not null),
	CONSTRAINT "cost_lines_not_reallocation_of_self" CHECK ("app"."cost_lines"."reallocation_of_id" is distinct from "app"."cost_lines"."id")
);
--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_used_contract_id_contracts_id_fk" FOREIGN KEY ("used_contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_used_component_id_contract_components_id_fk" FOREIGN KEY ("used_component_id") REFERENCES "app"."contract_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "app"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_stage_id_work_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "app"."work_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_charged_contract_id_contracts_id_fk" FOREIGN KEY ("charged_contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_charged_component_id_contract_components_id_fk" FOREIGN KEY ("charged_component_id") REFERENCES "app"."contract_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_qualification_id_qualifications_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "app"."qualifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "app"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_reallocation_of_id_cost_lines_id_fk" FOREIGN KEY ("reallocation_of_id") REFERENCES "app"."cost_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cost_lines" ADD CONSTRAINT "cost_lines_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cost_lines_charged_idx" ON "app"."cost_lines" USING btree ("charged_contract_id","charged_component_id","effect_date");--> statement-breakpoint
CREATE INDEX "cost_lines_work_unit_idx" ON "app"."cost_lines" USING btree ("work_unit_id","expense_type");--> statement-breakpoint
CREATE INDEX "cost_lines_objective_idx" ON "app"."cost_lines" USING btree ("objective_id","effect_date");--> statement-breakpoint
CREATE INDEX "cost_lines_document_idx" ON "app"."cost_lines" USING btree ("document_type","document_id");--> statement-breakpoint
CREATE INDEX "cost_lines_committed_idx" ON "app"."cost_lines" USING btree ("company_id","stage") WHERE stage = 'angajat';--> statement-breakpoint
CREATE INDEX "cost_lines_reconciliation_idx" ON "app"."cost_lines" USING btree ("used_contract_id") WHERE used_contract_id is distinct from charged_contract_id;--> statement-breakpoint
CREATE INDEX "cost_lines_period_idx" ON "app"."cost_lines" USING btree ("period_id");

-- ══ Completari scrise de mana ═══════════════════════════════════════════════

/*
 * Indexul ecranului de plafon, refacut cu `include`.
 *
 * Drizzle nu exprima `INCLUDE`, iar aici chiar conteaza: interogarea benzii de
 * componenta cere suma si stadiul, si numai pe ele. Cu coloanele in index,
 * raspunsul iese din index fara sa mai atinga tabela — la zeci de mii de linii
 * pe luna, diferenta dintre un ecran care se deschide si unul care se asteapta.
 *
 * Se recreeaza, nu se altereaza: `include` nu se adauga la un index existent.
 */
drop index app."cost_lines_charged_idx";
--> statement-breakpoint

create index cost_lines_charged_idx
  on app.cost_lines (charged_contract_id, charged_component_id, effect_date)
  include (amount, stage);
--> statement-breakpoint

-- ── `period_id` se deriva, nu se scrie ──────────────────────────────────────
/*
 * Regula 3 din pas. Aplicatia trimite `effect_date`; luna o afla baza.
 *
 * Suprascriem neconditionat, chiar daca apelantul a trimis ceva: o luna scrisa
 * din aplicatie e o luna care poate sa nu corespunda datei de efect, iar atunci
 * raportul lunii si data de pe linie spun lucruri diferite despre acelasi ban.
 * `app.period_of` deschide luna daca lipseste — o linie cu data de efect intr-o
 * luna nedeschisa inca e cazul normal la inceput de luna.
 */
create function app.cost_line_derive_period() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
begin
  new.period_id := app.period_of(new.company_id, new.effect_date);
  return new;
end
$$;
--> statement-breakpoint

create trigger cost_lines_derive_period
  before insert on app.cost_lines
  for each row execute function app.cost_line_derive_period();
--> statement-breakpoint

/*
 * Acum coloana poate fi `not null`: triggerele `before` ruleaza inaintea
 * verificarii constrangerilor, deci pana aici valoarea exista intotdeauna.
 *
 * In schema Drizzle coloana ramane nullabila dinadins — tipul TypeScript spune
 * astfel adevarul despre ce trimite aplicatia la `insert`, adica nimic.
 */
alter table app.cost_lines alter column period_id set not null;
--> statement-breakpoint

-- ── Coerenta unei linii de cost ─────────────────────────────────────────────
/*
 * Sase intrebari la care cheile straine nu raspund, pentru ca ele leaga randuri,
 * nu firme si nu tipuri.
 *
 * `security definer`, ca surorile ei din 0016: verificarea trebuie sa vada
 * randul-parinte indiferent de ce vede apelantul, altfel o linie pe o unitate
 * invizibila ar fi respinsa cu motivul gresit si depanarea ar cauta aiurea.
 */
create function app.guard_cost_line_coherent() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_unit_company    uuid;
  v_unit_type       app.work_unit_type;
  v_unit_code       text;
  v_stage_unit      uuid;
  v_used_company    uuid;
  v_charged_company uuid;
  v_component_of    uuid;
begin
  if new.work_unit_id is not null then
    select wu.company_id, wu.type, wu.code
      into v_unit_company, v_unit_type, v_unit_code
      from app.work_units wu where wu.id = new.work_unit_id;

    if v_unit_company is distinct from new.company_id then
      raise exception
        'VALIDATION_FAILED: unitatea de lucru % e la alta firma decat linia de cost', v_unit_code
        using errcode = 'P0001';
    end if;

    /*
     * Etapa e obligatorie pe lucrari — prin trigger, nu prin `check`, fiindca
     * depinde de tipul UL-ului, care sta in alta tabela (§22.4). Fara ea, „cat a
     * costat etapa 2" n-ar avea raspuns pe jumatate din linii, iar raspunsul
     * partial e mai rau decat lipsa lui: nu se vede ca lipseste.
     */
    if v_unit_type = 'lucrare' and new.stage_id is null then
      raise exception
        'VALIDATION_FAILED: lucrarea % cere etapa pe fiecare linie de cost', v_unit_code
        using errcode = 'P0001';
    end if;

    if v_unit_type <> 'lucrare' and new.stage_id is not null then
      raise exception
        'VALIDATION_FAILED: etapele exista doar pe lucrari, iar unitatea % este %',
        v_unit_code, v_unit_type
        using errcode = 'P0001';
    end if;
  elsif new.stage_id is not null then
    raise exception 'VALIDATION_FAILED: etapa fara unitate de lucru'
      using errcode = 'P0001';
  end if;

  -- Etapa scrisa pe linie e a unitatii scrise pe linie. Altfel costul unei
  -- lucrari s-ar aduna pe graficul alteia.
  if new.stage_id is not null then
    select s.work_unit_id into v_stage_unit from app.work_stages s where s.id = new.stage_id;
    if v_stage_unit is distinct from new.work_unit_id then
      raise exception 'VALIDATION_FAILED: etapa nu apartine unitatii de lucru de pe linie'
        using errcode = 'P0001';
    end if;
  end if;

  -- Ambele analitici raman in firma liniei: un cost descarcat pe contractul
  -- altei firme ar strica marja amandurora, si ar face-o tacut.
  if new.used_contract_id is not null then
    select c.company_id into v_used_company from app.contracts c where c.id = new.used_contract_id;
    if v_used_company is distinct from new.company_id then
      raise exception 'VALIDATION_FAILED: contractul „folosit" e la alta firma decat linia'
        using errcode = 'P0001';
    end if;
  end if;

  if new.charged_contract_id is not null then
    select c.company_id into v_charged_company
      from app.contracts c where c.id = new.charged_contract_id;
    if v_charged_company is distinct from new.company_id then
      raise exception 'VALIDATION_FAILED: contractul „descarcat" e la alta firma decat linia'
        using errcode = 'P0001';
    end if;
  end if;

  -- Componenta apartine contractului de pe ACEEASI analitica, nu de pe cealalta.
  if new.used_component_id is not null then
    select cc.contract_id into v_component_of
      from app.contract_components cc where cc.id = new.used_component_id;
    if v_component_of is distinct from new.used_contract_id then
      raise exception 'VALIDATION_FAILED: componenta „folosit" nu apartine contractului „folosit"'
        using errcode = 'P0001';
    end if;
  end if;

  if new.charged_component_id is not null then
    select cc.contract_id into v_component_of
      from app.contract_components cc where cc.id = new.charged_component_id;
    if v_component_of is distinct from new.charged_contract_id then
      raise exception
        'VALIDATION_FAILED: componenta „descarcat" nu apartine contractului „descarcat"'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end
$$;
--> statement-breakpoint

-- `insert or update`: mutarea analiticei „descarcat" (mai jos) trebuie sa treaca
-- prin aceleasi verificari ca scrierea initiala. O componenta care nu apartine
-- contractului tinta ar fi la fel de gresita a doua oara ca prima.
create trigger cost_lines_coherent
  before insert or update on app.cost_lines
  for each row execute function app.guard_cost_line_coherent();
--> statement-breakpoint

-- ── Usa unica pentru rescrierea analiticei „descarcat" ──────────────────────
/*
 * Registrul e append-only, cu O SINGURA exceptie: mutarea finantarii pe o luna
 * DESCHISA rescrie `charged_*` pe liniile existente (§13.1). Nu e o portita, e
 * mecanica ceruta — costurile urmeaza unitatea de lucru.
 *
 * Usa cere motiv scris si il pune tot ea in `app.action_reason`, de unde il ia
 * trigger-ul de audit: o rescriere ajunge in jurnal cu motiv prin constructie,
 * nu pentru ca si-a amintit cineva sa-l treaca. Aceeasi forma ca
 * `app.allow_closed_period_writes` din 0005, si pentru acelasi motiv.
 *
 * Setarea e LOCALA tranzactiei, ca sa nu ramana lipita de o conexiune din pool
 * si sa deschida registrul pentru altcineva.
 */
create function app.allow_cost_recharge(p_reason text) returns void
  language plpgsql
  volatile
as $$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VALIDATION_FAILED: rescrierea analiticei „descarcat" cere un motiv scris'
      using errcode = 'P0001';
  end if;

  perform set_config('app.action_reason', p_reason, true);
  perform set_config('app.allow_cost_recharge', 'on', true);
end
$$;
--> statement-breakpoint

revoke execute on function app.allow_cost_recharge(text) from public;
--> statement-breakpoint
grant execute on function app.allow_cost_recharge(text) to app_office, app_service;
--> statement-breakpoint

-- ── Append-only ─────────────────────────────────────────────────────────────
/*
 * Regula 1 din pas, impusa in DOUA straturi care spun acelasi lucru:
 *
 *   - grant-ul: `update` si `delete` nu se acorda nimanui, deci un rol de
 *     aplicatie primeste 42501 inainte sa ajunga aici;
 *   - trigger-ul: acopera cealalta cale, functiile `security definer`, care
 *     ruleaza ca proprietarul tabelei si trec pe langa orice grant.
 *
 * Ce se poate schimba, si numai cu usa deschisa: `charged_contract_id` si
 * `charged_component_id`. Restul e istorie. Comparatia se face pe `to_jsonb(row)`
 * fara cele doua chei — ca la alocari, in 0016 — deci o coloana adaugata la
 * pasii 07-10 intra automat sub regula, fara sa-si aminteasca cineva.
 *
 * `document_date` si analitica „folosit" nu apar in lista dinadins: ele sunt
 * exact ce nu se schimba NICIODATA la mutarea finantarii (§13.1). Istoricul
 * obiectivului ramane intact oricat s-ar muta banii.
 */
create function app.guard_cost_line_append_only() returns trigger
  language plpgsql
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception
      'CONFLICT: liniile de cost nu se sterg — corectia se face prin linie de storno'
      using errcode = 'P0001';
  end if;

  if current_setting('app.allow_cost_recharge', true) is distinct from 'on' then
    raise exception
      'CONFLICT: registrul de cost e append-only — corectia se face prin linie de storno'
      using errcode = 'P0001';
  end if;

  v_old := to_jsonb(old) - 'charged_contract_id' - 'charged_component_id';
  v_new := to_jsonb(new) - 'charged_contract_id' - 'charged_component_id';

  if v_old is distinct from v_new then
    raise exception
      'CONFLICT: pe o linie de cost se rescrie doar analitica „descarcat" (s-a incercat: %)',
      (
        select coalesce(string_agg(key, ', ' order by key), 'necunoscut')
          from jsonb_each(v_new)
         where value is distinct from v_old -> key
      )
      using errcode = 'P0001';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger cost_lines_append_only
  before update or delete on app.cost_lines
  for each row execute function app.guard_cost_line_append_only();
--> statement-breakpoint

/*
 * Usa efectiva: singura cale prin care o linie de cost isi schimba analitica
 * „descarcat". `security definer`, pentru ca `update` nu e acordat NIMANUI —
 * nici biroului, nici worker-ului. Cine vrea sa mute costul cheama functia asta
 * sau nu-l muta deloc.
 *
 * Aici sta jumatatea de baza de date a verificarii #13: `charged_*` se rescrie,
 * `used_*` si `document_date` raman neatinse (trigger-ul de mai sus le apara),
 * iar rollup-urile AMBELOR componente se actualizeaza in aceeasi tranzactie,
 * prin trigger-ul din 0018.
 *
 * Luna inchisa nu se rescrie: `guard_closed_period` e atasat pe tabela si
 * ridica `PERIOD_CLOSED` la `update`, deci mutarea pe o luna raportata cade aici
 * si trebuie sa treaca prin documentul de re-alocare (§13.1, verificarea #14).
 * Usa asta nu deschide luna — sunt doua usi diferite, dinadins.
 *
 * `moveFunding` din 06b o cheama pentru fiecare linie din `costLineIds`. Nu
 * inventa un al doilea mecanism.
 */
create function app.recharge_cost_line(
  p_line      uuid,
  p_contract  uuid,
  p_component uuid,
  p_reason    text
) returns void
  language plpgsql
  volatile
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_company uuid;
begin
  perform app.allow_cost_recharge(p_reason);

  select company_id into v_company from app.cost_lines where id = p_line;
  if not found then
    raise exception 'NOT_FOUND: linia de cost % nu exista', p_line using errcode = 'P0001';
  end if;

  -- Vizibilitatea se verifica explicit: functia ruleaza ca proprietarul, deci
  -- RLS n-o mai apara. Fara randul asta, oricine ar putea muta costul oricui.
  if not app.contract_in_scope(p_contract) then
    raise exception 'FORBIDDEN: contractul tinta nu e vizibil' using errcode = 'P0001';
  end if;

  update app.cost_lines
     set charged_contract_id = p_contract,
         charged_component_id = p_component
   where id = p_line;
end
$$;
--> statement-breakpoint

revoke execute on function app.recharge_cost_line(uuid, uuid, uuid, text) from public;
--> statement-breakpoint
grant execute on function app.recharge_cost_line(uuid, uuid, uuid, text)
  to app_office, app_service;
--> statement-breakpoint

-- ── Blocarea lunii inchise ──────────────────────────────────────────────────
-- Verificarea #12. Trigger-ul citeste `period_id`, deci prinde si liniile care
-- vor sa intre intr-o luna raportata, si pe cele care ar vrea sa iasa din ea.
select app.attach_period_guard('app.cost_lines');
--> statement-breakpoint

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Cu motiv obligatoriu la `update`: singurul `update` posibil e rescrierea
-- analiticei „descarcat", adica exact felul de miscare despre care cineva va
-- intreba peste sase luni „cine si de ce".
select app.attach_audit('app.cost_lines', true);
--> statement-breakpoint

-- ── RLS ─────────────────────────────────────────────────────────────────────
select app.rls_enable('app.cost_lines'::regclass);
--> statement-breakpoint

-- Biroul, si numai biroul (regula 7 din pas). Terenul, subcontractantul si
-- clientul nu primesc NICIO politica — deci nu vad niciun rand, nici macar
-- filtrat. Nici grant-ul nu exista; cele doua straturi spun acelasi lucru.
create policy "office" on app.cost_lines for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint

-- ── Grant-uri ───────────────────────────────────────────────────────────────
-- Fara `update` si fara `delete`, pentru nimeni: registrul e append-only, iar
-- rescrierea analiticei trece prin usa `security definer` din 06b, care ruleaza
-- ca proprietarul si nu are nevoie de grant.
grant select, insert on app.cost_lines to app_office, app_service;
--> statement-breakpoint

/*
 * Poarta de bani, a treia rulare (0012, apoi 0016).
 *
 * Aici e ieftina: `amount` intra oricum sub regexul din 0012, si nicio coloana
 * de bani a registrului nu iese in afara biroului, pentru ca nici tabela nu iese.
 * O chemam totusi, pentru ca migrarea urmatoare adauga rollup-uri cu coloane pe
 * care regexul NU le prinde — iar o poarta care se cheama cu o linie chiar se cheama.
 */
select app.assert_no_money_leak(
  array['estimated_value', 'material_budget', 'labor_budget']
);
