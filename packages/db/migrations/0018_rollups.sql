CREATE TABLE "app"."component_period_rollup" (
	"component_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"committed" numeric(14, 2) DEFAULT '0' NOT NULL,
	"received" numeric(14, 2) DEFAULT '0' NOT NULL,
	"consumed" numeric(14, 2) DEFAULT '0' NOT NULL,
	"invoiced" numeric(14, 2) DEFAULT '0' NOT NULL,
	"allocated_revenue" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "component_period_rollup_pk" PRIMARY KEY("component_id","period_id")
);
--> statement-breakpoint
CREATE TABLE "app"."overhead_snapshots" (
	"contract_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"overhead_pct" numeric(6, 4) NOT NULL,
	"direct_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"overhead_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overhead_snapshots_pk" PRIMARY KEY("contract_id","period_id"),
	CONSTRAINT "overhead_snapshots_pct_range" CHECK ("app"."overhead_snapshots"."overhead_pct" >= 0 and "app"."overhead_snapshots"."overhead_pct" <= 1)
);
--> statement-breakpoint
ALTER TABLE "app"."component_period_rollup" ADD CONSTRAINT "component_period_rollup_component_id_contract_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "app"."contract_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."component_period_rollup" ADD CONSTRAINT "component_period_rollup_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."overhead_snapshots" ADD CONSTRAINT "overhead_snapshots_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."overhead_snapshots" ADD CONSTRAINT "overhead_snapshots_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "component_period_rollup_period_idx" ON "app"."component_period_rollup" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "overhead_snapshots_period_idx" ON "app"."overhead_snapshots" USING btree ("period_id");

-- ══ Completari scrise de mana ═══════════════════════════════════════════════

-- ── Intretinerea rollup-ului din registrul de cost ──────────────────────────
/*
 * Un `upsert` cu delta, chemat de trigger in ACEEASI tranzactie cu linia.
 *
 * `security definer`: rollup-ul trebuie sa se mute cu suma reala, nu cu cea
 * vizibila apelantului. Un rollup calculat pe randuri filtrate de RLS ar fi mai
 * mic pentru unele roluri si mai mare pentru altele — adica exact cifra despre
 * care nimeni nu mai poate spune care e cea buna.
 *
 * Delta zero nu se scrie: la un `update` care nu atinge suma, nu are rost sa
 * plimbam `updated_at` si sa blocam randul degeaba.
 */
create function app.rollup_apply_cost(
  p_component uuid,
  p_period    uuid,
  p_stage     app.cost_stage,
  p_delta     numeric
) returns void
  language plpgsql
  volatile
  security definer
  set search_path = app, pg_catalog
as $$
begin
  if p_component is null or p_period is null or p_delta is null or p_delta = 0 then
    return;
  end if;

  insert into app.component_period_rollup as r
    (component_id, period_id, committed, received, consumed, invoiced)
  values (
    p_component, p_period,
    case when p_stage = 'angajat'     then p_delta else 0 end,
    case when p_stage = 'receptionat' then p_delta else 0 end,
    case when p_stage = 'consumat'    then p_delta else 0 end,
    case when p_stage = 'facturat'    then p_delta else 0 end
  )
  on conflict (component_id, period_id) do update set
    committed  = r.committed + excluded.committed,
    received   = r.received  + excluded.received,
    consumed   = r.consumed  + excluded.consumed,
    invoiced   = r.invoiced  + excluded.invoiced,
    updated_at = now();
end
$$;
--> statement-breakpoint

/*
 * Trigger-ul propriu-zis. `after`, ca sa vada randul asa cum a ramas dupa toate
 * verificarile — un rollup mutat pentru o linie respinsa apoi de un `check` ar
 * fi cea mai greu de gasit forma de divergenta.
 *
 * La `update` scoate vechea contributie si o pune pe cea noua, chiar daca s-a
 * schimbat componenta: exact cazul mutarii de finantare pe luna deschisa
 * (verificarea #13), unde AMBELE componente trebuie sa se actualizeze in aceeasi
 * tranzactie.
 *
 * Liniile fara analitica „descarcat" (stadiul `angajat` inainte de decizia de
 * rutare) nu au unde sa se adune — `rollup_apply_cost` iese din prima. Ele intra
 * in rollup abia la rescrierea care le da o componenta.
 */
create function app.rollup_maintain_from_cost() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' then
    perform app.rollup_apply_cost(
      old.charged_component_id, old.period_id, old.stage, -old.amount
    );
  end if;

  perform app.rollup_apply_cost(
    new.charged_component_id, new.period_id, new.stage, new.amount
  );

  return null;
end
$$;
--> statement-breakpoint

create trigger cost_lines_maintain_rollup
  after insert or update of stage, amount, charged_component_id, period_id
  on app.cost_lines
  for each row execute function app.rollup_maintain_from_cost();
--> statement-breakpoint

-- ── Gradul de umplere: cat s-a promis din componenta ────────────────────────
/*
 * `allocated_revenue` nu vine din registrul de cost, ci din alocarile ACTIVE de
 * finantare — e cealalta jumatate a benzii Delta din pasul 04: plafonul spune
 * cat se poate, asta spune cat s-a promis deja.
 *
 * Aici recalculam celula intreaga, nu aplicam delta ca la costuri. Motivul e ca
 * numarul de alocari active pe o componenta × luna e mic (unitati, nu mii), iar
 * un recalcul exact nu poate sa se abata niciodata — pe cand o delta gresita o
 * data ramane gresita pana la urmatorul job de verificare. Unde recalculul e
 * ieftin, e si raspunsul corect.
 *
 * O alocare in procent nu are suma proprie: valoarea ei e procentul aplicat pe
 * valoarea estimata a unitatii de lucru. O unitate fara valoare estimata
 * contribuie cu zero — nu inventam o cifra pentru ca ecranul ar arata mai plin.
 */
create function app.rollup_recompute_allocated(p_component uuid, p_period uuid) returns void
  language plpgsql
  volatile
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_total numeric(14,2);
begin
  if p_component is null or p_period is null then
    return;
  end if;

  select coalesce(sum(
           coalesce(fa.allocated_amount, fa.allocated_pct * coalesce(wu.estimated_value, 0))
         ), 0)
    into v_total
    from app.funding_allocations fa
    join app.work_units wu on wu.id = fa.work_unit_id
   where fa.component_id = p_component
     and fa.period_id = p_period
     and fa.status = 'active';

  insert into app.component_period_rollup as r
    (component_id, period_id, allocated_revenue)
  values (p_component, p_period, v_total)
  on conflict (component_id, period_id) do update set
    allocated_revenue = excluded.allocated_revenue,
    updated_at = now();
end
$$;
--> statement-breakpoint

create function app.rollup_maintain_from_allocation() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
begin
  perform app.rollup_recompute_allocated(new.component_id, new.period_id);
  return null;
end
$$;
--> statement-breakpoint

-- Supersedarea e un `update` al statusului, deci trebuie sa miste si ea cifra:
-- o alocare inlocuita nu mai e promisa nimanui.
create trigger funding_allocations_maintain_rollup
  after insert or update of status on app.funding_allocations
  for each row execute function app.rollup_maintain_from_allocation();
--> statement-breakpoint

-- ── Verificarea de integritate ──────────────────────────────────────────────
/*
 * Rollup-ul e o suma derivata, deci poate diverge daca un trigger are un bug.
 * Functia asta recalculeaza din registru si intoarce DOAR diferentele.
 *
 * Jobul nocturn `rollup.verify` din 06b o cheama si alerteaza pe ce iese; pana
 * atunci, e unealta cu care testele verifica rollup-ul printr-o interogare
 * independenta de triggerul care l-a scris (verificarea #8). Un test care ar
 * verifica rollup-ul cu aceeasi formula care l-a produs n-ar verifica nimic.
 *
 * `p_period` null inseamna toate lunile — jobul nocturn le ia pe toate.
 */
create function app.rollup_verify(p_period uuid default null)
  returns table (
    component_id uuid,
    period_id    uuid,
    column_name  text,
    stored       numeric,
    expected     numeric
  )
  language sql
  stable
  security definer
  set search_path = app, pg_catalog
as $$
  with expected as (
    select cl.charged_component_id as component_id,
           cl.period_id,
           sum(cl.amount) filter (where cl.stage = 'angajat')     as committed,
           sum(cl.amount) filter (where cl.stage = 'receptionat')  as received,
           sum(cl.amount) filter (where cl.stage = 'consumat')     as consumed,
           sum(cl.amount) filter (where cl.stage = 'facturat')     as invoiced
      from app.cost_lines cl
     where cl.charged_component_id is not null
       and (p_period is null or cl.period_id = p_period)
     group by 1, 2
  ),
  -- `full join`: intereseaza si randul de rollup ramas fara linii in spate, nu
  -- doar liniile fara rollup. Amandoua sunt divergente.
  paired as (
    select coalesce(r.component_id, e.component_id) as component_id,
           coalesce(r.period_id, e.period_id)       as period_id,
           coalesce(r.committed, 0) as r_committed, coalesce(e.committed, 0) as e_committed,
           coalesce(r.received, 0)  as r_received,  coalesce(e.received, 0)  as e_received,
           coalesce(r.consumed, 0)  as r_consumed,  coalesce(e.consumed, 0)  as e_consumed,
           coalesce(r.invoiced, 0)  as r_invoiced,  coalesce(e.invoiced, 0)  as e_invoiced
      from app.component_period_rollup r
      full join expected e
        on e.component_id = r.component_id and e.period_id = r.period_id
     where p_period is null or coalesce(r.period_id, e.period_id) = p_period
  )
  select component_id, period_id, c.name, c.stored, c.expected
    from paired
   cross join lateral (
     values
       ('committed', r_committed, e_committed),
       ('received',  r_received,  e_received),
       ('consumed',  r_consumed,  e_consumed),
       ('invoiced',  r_invoiced,  e_invoiced)
   ) as c(name, stored, expected)
   where c.stored is distinct from c.expected;
$$;
--> statement-breakpoint

grant execute on function app.rollup_verify(uuid) to app_office, app_service;
--> statement-breakpoint

/*
 * Cele doua functii de intretinere sunt `security definer`, deci cine le poate
 * chema poate schimba cifra de pe ecran fara sa lase urma in registru. Se iau
 * deci de la toata lumea si se dau inapoi doar worker-ului, care are nevoie de
 * ele pentru repararea unei divergente gasite de `rollup.verify` (06b).
 *
 * Triggerele nu sunt afectate: Postgres verifica dreptul de executie pe functia
 * de trigger la CREAREA trigger-ului, nu la fiecare rand.
 */
revoke execute on function app.rollup_apply_cost(uuid, uuid, app.cost_stage, numeric) from public;
--> statement-breakpoint
revoke execute on function app.rollup_recompute_allocated(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function app.rollup_apply_cost(uuid, uuid, app.cost_stage, numeric)
  to app_service;
--> statement-breakpoint
grant execute on function app.rollup_recompute_allocated(uuid, uuid) to app_service;
--> statement-breakpoint

-- ── RLS si grant-uri ────────────────────────────────────────────────────────
/*
 * Rollup-urile sunt bani agregati, deci merg exact unde merge registrul: la
 * birou, si nicaieri altundeva. Nicio politica pentru teren, subcontractant sau
 * client — si niciun grant. Cele doua straturi spun acelasi lucru dinadins.
 *
 * Fara `insert`/`update` pentru nimeni: tabelele se scriu DOAR din triggere, care
 * ruleaza `security definer` ca proprietarul. Un rol care ar putea scrie direct
 * in rollup ar putea face cifra de pe ecran sa nu mai dea, fara sa lase urma in
 * registru — adica exact ce §8.2 cere sa fie imposibil.
 */
select app.rls_enable('app.component_period_rollup'::regclass);
--> statement-breakpoint
select app.rls_enable('app.overhead_snapshots'::regclass);
--> statement-breakpoint

create policy "office" on app.component_period_rollup for select to app_office
  using (app.component_in_scope(component_id));
--> statement-breakpoint

create policy "office" on app.overhead_snapshots for select to app_office
  using (app.contract_in_scope(contract_id));
--> statement-breakpoint

grant select on app.component_period_rollup, app.overhead_snapshots
  to app_office, app_service;
--> statement-breakpoint

-- Regia se recalculeaza lunar de catre worker, nu de un trigger: depinde de un
-- coeficient per contract si de costul direct al lunii intregi, deci n-are cum
-- sa fie o delta pe linie.
grant insert, update on app.overhead_snapshots to app_service;
--> statement-breakpoint

/*
 * Poarta de bani, a patra rulare — si aici chiar prinde ceva.
 *
 * Regexul din 0012 cauta `price|pret|cost|amount|margin|salary`. Din coloanele
 * de mai sus prinde `direct_cost` si `overhead_amount`, dar NU `committed`,
 * `received`, `consumed`, `invoiced` sau `allocated_revenue` — care sunt tot
 * bani, doar cu alt nume. Exact gaura despre care 0016 avertizeaza: numele de
 * coloana nu e un mecanism de securitate, e o euristica.
 */
select app.assert_no_money_leak(
  array[
    'estimated_value', 'material_budget', 'labor_budget',
    'committed', 'received', 'consumed', 'invoiced', 'allocated_revenue'
  ]
);