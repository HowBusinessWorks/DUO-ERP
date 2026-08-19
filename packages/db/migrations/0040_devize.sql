CREATE TABLE "app"."deviz_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deviz_id" uuid NOT NULL,
	"parent_id" uuid,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deviz_categories_position_positive" CHECK ("app"."deviz_categories"."position" > 0),
	CONSTRAINT "deviz_categories_name_not_blank" CHECK (length(btrim("app"."deviz_categories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."deviz_line_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_line_id" uuid NOT NULL,
	"intern_line_id" uuid NOT NULL,
	"coefficient" numeric(10, 4) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deviz_line_mappings_pair_unique" UNIQUE("client_line_id","intern_line_id"),
	CONSTRAINT "deviz_line_mappings_coefficient_positive" CHECK ("app"."deviz_line_mappings"."coefficient" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."deviz_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deviz_id" uuid NOT NULL,
	"category_id" uuid,
	"position" smallint NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"uom" text NOT NULL,
	"quantity" numeric(14, 4) DEFAULT '0' NOT NULL,
	"stage_id" uuid,
	"normed_article_id" uuid,
	"unit_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"material_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"labor_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"equipment_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"transport_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deviz_lines_position_positive" CHECK ("app"."deviz_lines"."position" > 0),
	CONSTRAINT "deviz_lines_name_not_blank" CHECK (length(btrim("app"."deviz_lines"."name")) > 0),
	CONSTRAINT "deviz_lines_uom_not_blank" CHECK (length(btrim("app"."deviz_lines"."uom")) > 0),
	CONSTRAINT "deviz_lines_quantity_non_negative" CHECK ("app"."deviz_lines"."quantity" >= 0),
	CONSTRAINT "deviz_lines_costs_non_negative" CHECK ("app"."deviz_lines"."unit_price" >= 0 and "app"."deviz_lines"."material_cost" >= 0 and "app"."deviz_lines"."labor_cost" >= 0
          and "app"."deviz_lines"."equipment_cost" >= 0 and "app"."deviz_lines"."transport_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."deviz_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deviz_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"lines" jsonb NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"indirect_pct" numeric(6, 4),
	"profit_pct" numeric(6, 4),
	"reason" text NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_by" uuid,
	CONSTRAINT "deviz_versions_deviz_version_unique" UNIQUE("deviz_id","version"),
	CONSTRAINT "deviz_versions_version_positive" CHECK ("app"."deviz_versions"."version" >= 1),
	CONSTRAINT "deviz_versions_reason_not_blank" CHECK (length(btrim("app"."deviz_versions"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."devize" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"indirect_pct" numeric(6, 4),
	"profit_pct" numeric(6, 4),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devize_work_unit_kind_unique" UNIQUE("work_unit_id","kind"),
	CONSTRAINT "devize_kind_known" CHECK ("app"."devize"."kind" in ('client','intern')),
	CONSTRAINT "devize_status_known" CHECK ("app"."devize"."status" in ('draft','activ','anulat')),
	CONSTRAINT "devize_pct_range" CHECK (("app"."devize"."indirect_pct" is null or ("app"."devize"."indirect_pct" >= 0 and "app"."devize"."indirect_pct" <= 1))
          and ("app"."devize"."profit_pct" is null or ("app"."devize"."profit_pct" >= 0 and "app"."devize"."profit_pct" <= 1))),
	CONSTRAINT "devize_intern_has_no_markup" CHECK ("app"."devize"."kind" = 'client' or ("app"."devize"."indirect_pct" is null and "app"."devize"."profit_pct" is null))
);
--> statement-breakpoint
ALTER TABLE "app"."deviz_categories" ADD CONSTRAINT "deviz_categories_deviz_id_devize_id_fk" FOREIGN KEY ("deviz_id") REFERENCES "app"."devize"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deviz_categories" ADD CONSTRAINT "deviz_categories_parent_id_deviz_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."deviz_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deviz_line_mappings" ADD CONSTRAINT "deviz_line_mappings_client_line_id_deviz_lines_id_fk" FOREIGN KEY ("client_line_id") REFERENCES "app"."deviz_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deviz_line_mappings" ADD CONSTRAINT "deviz_line_mappings_intern_line_id_deviz_lines_id_fk" FOREIGN KEY ("intern_line_id") REFERENCES "app"."deviz_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deviz_lines" ADD CONSTRAINT "deviz_lines_deviz_id_devize_id_fk" FOREIGN KEY ("deviz_id") REFERENCES "app"."devize"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deviz_lines" ADD CONSTRAINT "deviz_lines_category_id_deviz_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."deviz_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deviz_lines" ADD CONSTRAINT "deviz_lines_stage_id_work_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "app"."work_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deviz_versions" ADD CONSTRAINT "deviz_versions_deviz_id_devize_id_fk" FOREIGN KEY ("deviz_id") REFERENCES "app"."devize"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deviz_versions" ADD CONSTRAINT "deviz_versions_frozen_by_persons_id_fk" FOREIGN KEY ("frozen_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."devize" ADD CONSTRAINT "devize_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."devize" ADD CONSTRAINT "devize_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."devize" ADD CONSTRAINT "devize_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deviz_categories_deviz_idx" ON "app"."deviz_categories" USING btree ("deviz_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "deviz_line_mappings_intern_idx" ON "app"."deviz_line_mappings" USING btree ("intern_line_id");--> statement-breakpoint
CREATE INDEX "deviz_lines_deviz_idx" ON "app"."deviz_lines" USING btree ("deviz_id","position");--> statement-breakpoint
CREATE INDEX "deviz_lines_category_idx" ON "app"."deviz_lines" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "deviz_lines_stage_idx" ON "app"."deviz_lines" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "deviz_lines_normed_article_idx" ON "app"."deviz_lines" USING btree ("normed_article_id");--> statement-breakpoint
CREATE INDEX "deviz_versions_deviz_idx" ON "app"."deviz_versions" USING btree ("deviz_id",version desc);--> statement-breakpoint
CREATE INDEX "devize_company_idx" ON "app"."devize" USING btree ("company_id","status");
--> statement-breakpoint

/*
 * Devizul (pasul 11, sec. 3.1) — RLS, grant-uri, triggere.
 *
 * Cinci tabele, o singura idee care le tine pe toate: **pretul nu iese din
 * birou.** Terenul si subcontractantul nu primesc NIMIC aici, nici macar
 * `select` pe coloanele fara valoare. Sec. 10.3 din business spune ca seful de
 * santier nu vede devizul deloc, iar exemplul din PLAN_TEHNIC sec. 4.4, care
 * acorda lui `app_field` cateva coloane din `deviz_lines`, e ales nefericit —
 * ordinea de autoritate e business > functional > tehnic. Terenul isi ia
 * cantitatile din `v_sl_lines_field` si `v_package_lines_field`, la pasii 12-13.
 *
 * Trei reguli se impun prin trigger, nu prin ecran, fiindca un `insert` scris
 * de mana, un import Excel (11c) sau un ecran viitor ocolesc orice filtru din
 * interfata:
 *
 * 1. **Arborele are doua niveluri**, categorie -> operatiune. Un al treilea ar
 *    intra tacut, iar totalurile pe categorie — scrise pentru doua — ar incepe
 *    sa piarda linii fara sa se planga nimeni.
 * 2. **`total` se calculeaza, nu se scrie.** Cantitate x pret unitar, iar pe
 *    devizul intern pretul unitar e chiar suma celor patru componente. Asa
 *    verificarea #1 (totalurile dau, la ban, cu suma liniilor) nu depinde de
 *    disciplina apelantului.
 * 3. **Maparea are doua capete, si fiecare cu felul lui.** Client cu intern, pe
 *    aceeasi lucrare. O mapare intre doua linii client ar trece nevazuta pana
 *    la pasul 14, cand se deriva situatia catre client si iese aiurea.
 *
 * Ce NU se impune: completitudinea maparii. Regula 6 a pasului — se raporteaza,
 * nu se blocheaza; o mapare incompleta e o stare de lucru normala in redactare.
 */

select app.rls_enable('app.devize'::regclass);
--> statement-breakpoint
select app.rls_enable('app.deviz_versions'::regclass);
--> statement-breakpoint
select app.rls_enable('app.deviz_categories'::regclass);
--> statement-breakpoint
select app.rls_enable('app.deviz_lines'::regclass);
--> statement-breakpoint
select app.rls_enable('app.deviz_line_mappings'::regclass);
--> statement-breakpoint

-- Capul devizului atarna de unitatea de lucru, ca tot ce e al ei din 0016.
create policy "office" on app.devize for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint

-- Copiii mostenesc vizibilitatea prin cap. Aceeasi conditie de patru ori, si
-- dinadins: o politica proprie pe fiecare ar fi patru locuri de tinut in acord.
create policy "office" on app.deviz_versions for all to app_office
  using (exists (select 1 from app.devize d where d.id = deviz_id and app.work_unit_in_scope(d.work_unit_id)))
  with check (exists (select 1 from app.devize d where d.id = deviz_id and app.work_unit_in_scope(d.work_unit_id)));
--> statement-breakpoint

create policy "office" on app.deviz_categories for all to app_office
  using (exists (select 1 from app.devize d where d.id = deviz_id and app.work_unit_in_scope(d.work_unit_id)))
  with check (exists (select 1 from app.devize d where d.id = deviz_id and app.work_unit_in_scope(d.work_unit_id)));
--> statement-breakpoint

create policy "office" on app.deviz_lines for all to app_office
  using (exists (select 1 from app.devize d where d.id = deviz_id and app.work_unit_in_scope(d.work_unit_id)))
  with check (exists (select 1 from app.devize d where d.id = deviz_id and app.work_unit_in_scope(d.work_unit_id)));
--> statement-breakpoint

-- Maparea atarna de ambele capete. Ajunge sa verificam unul: triggerul de mai
-- jos impune oricum ca amandoua sa fie pe aceeasi lucrare.
create policy "office" on app.deviz_line_mappings for all to app_office
  using (
    exists (
      select 1 from app.deviz_lines l join app.devize d on d.id = l.deviz_id
       where l.id = client_line_id and app.work_unit_in_scope(d.work_unit_id)
    )
  )
  with check (
    exists (
      select 1 from app.deviz_lines l join app.devize d on d.id = l.deviz_id
       where l.id = client_line_id and app.work_unit_in_scope(d.work_unit_id)
    )
  );
--> statement-breakpoint

/*
 * Grant-uri.
 *
 * `delete` pe linii, categorii si mapari: redactarea unui deviz inseamna si
 * stergere de randuri, iar lipsa lui la 0031 a costat sase defecte tacute,
 * toate invizibile pentru typecheck.
 *
 * `deviz_versions` primeste doar `select, insert`: o versiune inghetata care se
 * poate rescrie nu mai e un istoric, e o parere de acum despre ce s-a ofertat
 * atunci. Nici `app_service` n-o poate atinge.
 *
 * Coloanele de pret se acorda implicit aici, prin grant pe tabela, si e corect:
 * `app_office` are voie sa le vada. Enumerarea pe coloana e mecanismul pentru
 * rolurile care NU au voie — iar acelea nu primesc nimic (vezi `revoke`-ul).
 */
grant select, insert, update on app.devize to app_office;
--> statement-breakpoint
grant select, insert on app.deviz_versions to app_office;
--> statement-breakpoint
grant select, insert, update, delete on
  app.deviz_categories, app.deviz_lines, app.deviz_line_mappings to app_office;
--> statement-breakpoint

-- Joburile citesc devizul (rapoarte, generari), nu-l scriu. Scrierea are loc
-- intr-un use-case, cu actor, ca sa existe cine raspunde de cifra.
grant select on
  app.devize, app.deviz_versions, app.deviz_categories, app.deviz_lines,
  app.deviz_line_mappings to app_service;
--> statement-breakpoint

/*
 * Scris explicit, desi niciun `grant` nu le-a dat vreodata: un `revoke` scris e
 * o afirmatie verificabila, un grant lipsa e o omisiune care seamana cu ea.
 * Aceeasi alegere ca la 0012, pentru `rate_cards` si `contract_years`.
 */
revoke all on
  app.devize, app.deviz_versions, app.deviz_categories, app.deviz_lines,
  app.deviz_line_mappings from app_field, app_subcontractor, app_client;
--> statement-breakpoint

-- ── Regula 1: arborele are doua niveluri ────────────────────────────────────
create function app.deviz_categories_enforce_depth() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog
as $$
declare
  v_parent_deviz uuid;
  v_grandparent  uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select c.deviz_id, c.parent_id into v_parent_deviz, v_grandparent
    from app.deviz_categories c where c.id = new.parent_id;

  if v_parent_deviz is null then
    raise exception 'VALIDATION_FAILED: categoria părinte nu există.' using errcode = 'P0001';
  end if;

  if v_grandparent is not null then
    raise exception
      'VALIDATION_FAILED: devizul are două niveluri, categorie și operațiune. O operațiune nu poate avea sub ea altă operațiune.'
      using errcode = 'P0001';
  end if;

  if v_parent_deviz <> new.deviz_id then
    raise exception 'VALIDATION_FAILED: categoria părinte e dintr-un alt deviz.'
      using errcode = 'P0001';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger deviz_categories_depth
  before insert or update of parent_id, deviz_id on app.deviz_categories
  for each row execute function app.deviz_categories_enforce_depth();
--> statement-breakpoint

-- ── Regula 2: totalul se calculeaza, nu se scrie ────────────────────────────
create function app.deviz_lines_apply_total() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog
as $$
declare
  v_kind      text;
  v_work_unit uuid;
begin
  select d.kind, d.work_unit_id into v_kind, v_work_unit
    from app.devize d where d.id = new.deviz_id;

  if v_kind is null then
    raise exception 'VALIDATION_FAILED: devizul nu există.' using errcode = 'P0001';
  end if;

  /*
   * Pe devizul intern pretul unitar E suma celor patru componente. Scris de om
   * separat de ele, ar fi a doua sursa de adevar pentru acelasi numar — si
   * prima care ramane in urma la o corectie de manopera.
   */
  if v_kind = 'intern' then
    new.unit_price := round(
      coalesce(new.material_cost, 0) + coalesce(new.labor_cost, 0)
      + coalesce(new.equipment_cost, 0) + coalesce(new.transport_cost, 0), 2);
  end if;

  new.total := round(new.quantity * new.unit_price, 2);

  if new.category_id is not null
     and not exists (
       select 1 from app.deviz_categories c
        where c.id = new.category_id and c.deviz_id = new.deviz_id
     ) then
    raise exception 'VALIDATION_FAILED: categoria aleasă e dintr-un alt deviz.'
      using errcode = 'P0001';
  end if;

  if new.stage_id is not null
     and not exists (
       select 1 from app.work_stages s
        where s.id = new.stage_id and s.work_unit_id = v_work_unit
     ) then
    raise exception 'VALIDATION_FAILED: etapa aleasă e de pe altă lucrare.'
      using errcode = 'P0001';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger deviz_lines_total
  before insert or update on app.deviz_lines
  for each row execute function app.deviz_lines_apply_total();
--> statement-breakpoint

-- ── Regula 3: maparea are doua capete, fiecare cu felul lui ─────────────────
create function app.deviz_line_mappings_enforce_sides() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog
as $$
declare
  v_client_kind text;
  v_client_wu   uuid;
  v_intern_kind text;
  v_intern_wu   uuid;
begin
  select d.kind, d.work_unit_id into v_client_kind, v_client_wu
    from app.deviz_lines l join app.devize d on d.id = l.deviz_id
   where l.id = new.client_line_id;

  select d.kind, d.work_unit_id into v_intern_kind, v_intern_wu
    from app.deviz_lines l join app.devize d on d.id = l.deviz_id
   where l.id = new.intern_line_id;

  if v_client_kind is null or v_intern_kind is null then
    raise exception 'VALIDATION_FAILED: una dintre poziții nu există.' using errcode = 'P0001';
  end if;

  if v_client_kind <> 'client' or v_intern_kind <> 'intern' then
    raise exception
      'VALIDATION_FAILED: maparea leagă o poziție din devizul client cu una din devizul intern, în ordinea asta.'
      using errcode = 'P0001';
  end if;

  if v_client_wu <> v_intern_wu then
    raise exception 'VALIDATION_FAILED: cele două poziții sunt de pe lucrări diferite.'
      using errcode = 'P0001';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger deviz_line_mappings_sides
  before insert or update on app.deviz_line_mappings
  for each row execute function app.deviz_line_mappings_enforce_sides();
--> statement-breakpoint

/*
 * Audit pe capul devizului. Indirectele si profitul se negociaza, iar „cine a
 * pus 12% profit pe lucrarea asta si cand" trebuie sa aiba raspuns si dupa ce
 * omul a plecat din firma.
 *
 * Liniile NU primesc audit: intr-o sesiune de redactare se scriu si se rescriu
 * de sute de ori, iar un jurnal din care nu se poate citi nimic e mai rau decat
 * niciunul. Ce trebuie sa ramana din ele ramane in `deviz_versions`, la inghet.
 * Versiunile n-au nici ele nevoie: sunt append-only si isi poarta autorul si
 * momentul pe rand.
 */
select app.attach_audit('app.devize');
--> statement-breakpoint

/*
 * Plasa de bani, a zecea rulare — si prima pe tabele pline de preturi.
 *
 * `total` intra explicit in lista: regexul prinde price/pret/cost/amount/
 * margin/salary, dar nu si „total", iar `deviz_lines.total` si
 * `deviz_versions.total` sunt exact cifrele pe care sec. 10.3 le tine departe
 * de teren. Numele de coloana nu e un mecanism de securitate, e o euristica.
 */
select app.assert_no_money_leak(array['total']);
