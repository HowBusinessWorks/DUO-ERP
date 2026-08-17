-- Pasul 02b — Row Level Security pe TOATA schema `app` (PLAN_TEHNIC §4.5, pasul 02 §3.8).
--
-- Regula pasului: `enable` SI `force row level security` pe fiecare tabela din
-- `app`, fara exceptii. O tabela fara politica nu returneaza nimic — asta e
-- comportamentul sigur, si e motivul pentru care testul generic (#2, #3) e
-- blocant in CI: o tabela adaugata maine fara politica pica build-ul, nu
-- productia.
--
-- Straturile sunt trei si NU se inlocuiesc unul pe altul:
--   1. grant-uri pe tabela si pe coloana  — ce COLOANE pot fi citite (0012)
--   2. politici RLS                       — ce RANDURI pot fi citite (aici)
--   3. DTO-uri Zod in `packages/contracts` — ce iese pe sarma
--
-- Sursa claim-urilor e `request.jwt.claims`, pusa de `withActor()`. In 02c
-- vine din JWT-ul emis de GoTrue; pana atunci din sesiunea de dezvoltare.
-- Contractul nu se schimba, doar cine umple GUC-ul.

-- ── Cine sunt eu ────────────────────────────────────────────────────────────

create or replace function app.current_claims() returns jsonb
  language sql
  stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
--> statement-breakpoint

create or replace function app.current_person_id() returns uuid
  language sql
  stable
as $$
  select nullif(app.current_claims() ->> 'person_id', '')::uuid
$$;
--> statement-breakpoint

create or replace function app.current_persona() returns app.persona
  language sql
  stable
as $$
  select nullif(app.current_claims() ->> 'persona', '')::app.persona
$$;
--> statement-breakpoint

/*
 * Rolurile de birou se citesc DOAR din claim, niciodata din tabela.
 *
 * Nu e o scurtatura de performanta: `app.person_office_roles` e ea insasi sub
 * RLS, iar politica ei ar chema inapoi functia asta. Postgres numeste asta
 * "infinite recursion detected in policy" si o refuza la runtime, adica exact
 * in productie. Claim-ul rupe ciclul prin constructie.
 */
create or replace function app.has_office_role(p_role app.office_role) returns boolean
  language sql
  stable
as $$
  select app.current_persona() = 'office'
     and (app.current_claims() -> 'office_roles') @> to_jsonb(p_role::text)
$$;
--> statement-breakpoint

/*
 * Firmele pe care le vede actorul curent. Trei surse, in ordinea asta:
 *
 *   1. claim-ul `company_ids` — cazul normal, fara round-trip la baza;
 *   2. `app.person_company_access` — cand claim-ul lipseste (job, script,
 *      test). Claim-ul e un CACHE al tabelei, deci caderea pe tabela da acelasi
 *      raspuns, nu unul mai larg;
 *   3. daca persoana n-are nicio firma atribuita SI e administrator: tot grupul.
 *
 * Regula 3 nu deschide nimic: un administrator poate oricum sa scrie in
 * `person_company_access`, deci si sa-si dea singur acces la orice firma. Fara
 * ea, o instalare noua ar fi imposibil de configurat — primul administrator
 * n-ar vedea nicio firma pe care sa-si atribuie acces.
 */
create or replace function app.current_company_ids() returns uuid[]
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(app.current_claims() -> 'company_ids') = 'array'
         and jsonb_array_length(app.current_claims() -> 'company_ids') > 0
      then (
        select coalesce(array_agg(value::uuid), '{}'::uuid[])
          from jsonb_array_elements_text(app.current_claims() -> 'company_ids')
      )
    else coalesce(
      (
        select array_agg(a.company_id)
          from app.person_company_access a
         where a.person_id = app.current_person_id()
      ),
      case
        when app.has_office_role('admin')
          then (select coalesce(array_agg(c.id), '{}'::uuid[]) from app.companies c)
        else '{}'::uuid[]
      end
    )
  end
$$;
--> statement-breakpoint

/*
 * Firma subcontractantului / clientului. Claim intai, altfel din `app.persons`
 * — `check`-urile din 0004 garanteaza ca persona si firma sunt consistente,
 * deci nu exista drum prin care un utilizator de birou sa capete un
 * `subcontractor_id`.
 */
create or replace function app.current_subcontractor_id() returns uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select coalesce(
    nullif(app.current_claims() ->> 'subcontractor_id', '')::uuid,
    (select p.subcontractor_id from app.persons p where p.id = app.current_person_id())
  )
$$;
--> statement-breakpoint

create or replace function app.current_client_id() returns uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select coalesce(
    nullif(app.current_claims() ->> 'client_id', '')::uuid,
    (select p.client_id from app.persons p where p.id = app.current_person_id())
  )
$$;
--> statement-breakpoint

/*
 * Rolul care detine tabelele — cel care ruleaza migrarile.
 *
 * `force row level security` se aplica SI proprietarului, iar jumatate din
 * mecanica pasilor 02a–04 traieste in functii `security definer` care ruleaza
 * ca el: alocatorul de numere face `update` pe serie, `app.period_of` creeaza
 * luna lipsa, trigger-ul de audit scrie in jurnal. Fara o politica pentru el,
 * toate astea ar cadea pe Supabase (unde proprietarul nu e superuser) si ar
 * trece in CI (unde e) — cel mai prost fel de divergenta posibil.
 */
do $$
begin
  execute format(
    'create or replace function app.owner_role() returns name language sql immutable as $f$ select %L::name $f$',
    current_user
  );
end
$$;
--> statement-breakpoint

create or replace function app.is_definer() returns boolean
  language sql
  stable
as $$
  select current_user = app.owner_role()
$$;
--> statement-breakpoint

-- ── Scoping prin parinte ────────────────────────────────────────────────────
--
-- `security definer`: verificarea trebuie sa vada randul-parinte indiferent de
-- ce vede apelantul, altfel un rand cu parinte invizibil ar fi si el invizibil
-- din alt motiv decat cel intentionat, si n-am mai putea distinge cele doua
-- cazuri la depanare.

create or replace function app.contract_in_scope(p_contract uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select exists (
    select 1 from app.contracts c
     where c.id = p_contract and c.company_id = any(app.current_company_ids())
  )
$$;
--> statement-breakpoint

create or replace function app.component_in_scope(p_component uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select exists (
    select 1
      from app.contract_components cc
      join app.contracts c on c.id = cc.contract_id
     where cc.id = p_component and c.company_id = any(app.current_company_ids())
  )
$$;
--> statement-breakpoint

create or replace function app.period_in_scope(p_period uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select exists (
    select 1 from app.periods p
     where p.id = p_period and p.company_id = any(app.current_company_ids())
  )
$$;
--> statement-breakpoint

create or replace function app.team_in_scope(p_team uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select exists (
    select 1 from app.teams t
     where t.id = p_team and t.company_id = any(app.current_company_ids())
  )
$$;
--> statement-breakpoint

-- Functiile de scop se apeleaza din politici, deci de catre orice persona.
grant execute on function
  app.current_claims(), app.current_person_id(), app.current_persona(),
  app.current_company_ids(), app.current_subcontractor_id(), app.current_client_id(),
  app.has_office_role(app.office_role), app.is_definer(), app.owner_role(),
  app.contract_in_scope(uuid), app.component_in_scope(uuid),
  app.period_in_scope(uuid), app.team_in_scope(uuid)
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

/*
 * Aprinderea RLS pe o tabela, cu cele doua politici pe care le are ORICE tabela:
 *
 *   `definer` — proprietarul, adica functiile `security definer` (vezi mai sus);
 *   `service` — `app_service`, adica worker-ul si integrarile. Bypass-ul lui e
 *               controlat: rolul nu e accesibil dintr-o sesiune de utilizator,
 *               iar tot ce scrie trece prin acelasi trigger de audit.
 *
 * Se pastreaza dupa migrare, dinadins: fiecare pas urmator adauga tabele, iar
 * `docs/security.md` cere exact trei linii pentru una noua.
 */
create or replace function app.rls_enable(p_table regclass) returns void
  language plpgsql
as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format(
    'create policy "definer" on %s for all to public using (app.is_definer()) with check (app.is_definer())',
    p_table
  );
  execute format(
    'create policy "service" on %s for all to app_service using (true) with check (true)',
    p_table
  );
end
$$;
--> statement-breakpoint

revoke execute on function app.rls_enable(regclass) from public;
--> statement-breakpoint

do $$
declare
  t text;
begin
  foreach t in array array[
    'app.companies', 'app.clients', 'app.subcontractors', 'app.suppliers',
    'app.qualifications', 'app.rate_cards', 'app.persons',
    'app.person_company_access', 'app.person_office_roles', 'app.teams',
    'app.team_members', 'app.person_authorizations',
    'app.periods', 'app.period_close_checks', 'app.document_series',
    'app.products', 'app.work_queue_items', 'app.notifications', 'app.alerts',
    'app.outbox_events',
    'app.contracts', 'app.contract_years', 'app.contract_components',
    'app.component_ceilings',
    'app.objectives', 'app.checklists', 'app.checklist_items',
    'app.inspection_profiles', 'app.inspection_profile_items',
    'app.contract_objectives'
  ]
  loop
    perform app.rls_enable(t::regclass);
  end loop;
end
$$;
--> statement-breakpoint

-- ── Firme ───────────────────────────────────────────────────────────────────
-- Verificarea #4: `app_field` care cere o firma la care n-are acces primeste
-- ZERO RANDURI, nu eroare. Filtrarea de randuri nu trebuie sa se simta ca un
-- refuz — un refuz spune ca firma exista.
create policy "office" on app.companies for all to app_office
  using (id = any(app.current_company_ids()) or app.has_office_role('admin'))
  with check (app.has_office_role('admin'));
--> statement-breakpoint

create policy "read" on app.companies for select to app_field, app_subcontractor, app_client
  using (id = any(app.current_company_ids()));
--> statement-breakpoint

-- ── Nomenclatoare comune celor 5 firme ──────────────────────────────────────
-- Nu au `company_id`, deci nu au ce filtra pe firma. Ce se filtreaza e PERSONA:
-- portalurile nu vad nomenclatorul intern, ci doar propria fisa.
create policy "office" on app.clients for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.clients for select to app_field using (true);
--> statement-breakpoint
create policy "own" on app.clients for select to app_client
  using (id = app.current_client_id());
--> statement-breakpoint

create policy "office" on app.subcontractors for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.subcontractors for select to app_field using (true);
--> statement-breakpoint
create policy "own" on app.subcontractors for select to app_subcontractor
  using (id = app.current_subcontractor_id());
--> statement-breakpoint

create policy "office" on app.suppliers for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.suppliers for select to app_field using (true);
--> statement-breakpoint

create policy "office" on app.qualifications for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.qualifications
  for select to app_field, app_subcontractor, app_client using (true);
--> statement-breakpoint

-- Tarifele orare sunt bani curati: nicio persona in afara de birou n-are nici
-- macar `select` pe tabela (0004). Politica e a doua plasa, nu prima.
create policy "office" on app.rate_cards for all to app_office using (true) with check (true);
--> statement-breakpoint

create policy "office" on app.products for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.products
  for select to app_field, app_subcontractor, app_client using (true);
--> statement-breakpoint

-- ── Oameni ──────────────────────────────────────────────────────────────────
-- Biroul citeste nomenclatorul de personal (il alege in formulare), dar il
-- MODIFICA doar administratorul: cine poate schimba rolurile poate schimba tot.
create policy "office_read" on app.persons for select to app_office using (true);
--> statement-breakpoint
create policy "office_write" on app.persons for all to app_office
  using (app.has_office_role('admin')) with check (app.has_office_role('admin'));
--> statement-breakpoint
create policy "self" on app.persons for select to app_field, app_subcontractor, app_client
  using (id = app.current_person_id());
--> statement-breakpoint

create policy "office_read" on app.person_company_access for select to app_office using (true);
--> statement-breakpoint
create policy "office_write" on app.person_company_access for all to app_office
  using (app.has_office_role('admin')) with check (app.has_office_role('admin'));
--> statement-breakpoint
create policy "self" on app.person_company_access
  for select to app_field, app_subcontractor, app_client
  using (person_id = app.current_person_id());
--> statement-breakpoint

create policy "office_read" on app.person_office_roles for select to app_office using (true);
--> statement-breakpoint
create policy "office_write" on app.person_office_roles for all to app_office
  using (app.has_office_role('admin')) with check (app.has_office_role('admin'));
--> statement-breakpoint
create policy "self" on app.person_office_roles
  for select to app_field, app_subcontractor, app_client
  using (person_id = app.current_person_id());
--> statement-breakpoint

create policy "office_read" on app.person_authorizations for select to app_office using (true);
--> statement-breakpoint
create policy "office_write" on app.person_authorizations for all to app_office
  using (app.has_office_role('admin')) with check (app.has_office_role('admin'));
--> statement-breakpoint
create policy "self" on app.person_authorizations
  for select to app_field, app_subcontractor, app_client
  using (person_id = app.current_person_id());
--> statement-breakpoint

create policy "office" on app.teams for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint
create policy "read" on app.teams for select to app_field
  using (company_id = any(app.current_company_ids()));
--> statement-breakpoint

create policy "office" on app.team_members for all to app_office
  using (app.team_in_scope(team_id)) with check (app.team_in_scope(team_id));
--> statement-breakpoint
create policy "read" on app.team_members for select to app_field
  using (app.team_in_scope(team_id));
--> statement-breakpoint

-- ── Perioade si serii ───────────────────────────────────────────────────────
-- Starea lunii o vede toata lumea: lacatul de pe ecranul de teren e aceeasi
-- informatie ca lacatul din birou.
create policy "office" on app.periods for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint
create policy "read" on app.periods
  for select to app_field, app_subcontractor, app_client
  using (company_id = any(app.current_company_ids()));
--> statement-breakpoint

create policy "office" on app.period_close_checks for all to app_office
  using (app.period_in_scope(period_id)) with check (app.period_in_scope(period_id));
--> statement-breakpoint

create policy "office" on app.document_series for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint

-- ── Coada, clopotel, alerte ─────────────────────────────────────────────────
-- Coada si notificarile sunt PERSONALE. Nu „ale firmei mele”, nu „ale echipei”:
-- un badge care numara si sarcinile altcuiva nu se poate goli prin actiune.
create policy "own" on app.work_queue_items
  for all to app_office, app_field, app_subcontractor, app_client
  using (person_id = app.current_person_id())
  with check (person_id = app.current_person_id());
--> statement-breakpoint

create policy "own" on app.notifications
  for all to app_office, app_field, app_subcontractor, app_client
  using (person_id = app.current_person_id())
  with check (person_id = app.current_person_id());
--> statement-breakpoint

create policy "read" on app.alerts
  for select to app_office, app_field, app_subcontractor, app_client
  using (company_id = any(app.current_company_ids()));
--> statement-breakpoint

-- `app.outbox_events` ramane doar cu `definer` si `service`: efectele secundare
-- nu sunt ale nimanui, sunt ale sistemului.

-- ── Contracte ───────────────────────────────────────────────────────────────
create policy "office" on app.contracts for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint
create policy "read" on app.contracts
  for select to app_field, app_subcontractor, app_client
  using (company_id = any(app.current_company_ids()));
--> statement-breakpoint

create policy "office" on app.contract_years for all to app_office
  using (app.contract_in_scope(contract_id)) with check (app.contract_in_scope(contract_id));
--> statement-breakpoint

create policy "office" on app.contract_components for all to app_office
  using (app.contract_in_scope(contract_id)) with check (app.contract_in_scope(contract_id));
--> statement-breakpoint
create policy "read" on app.contract_components
  for select to app_field, app_subcontractor, app_client
  using (app.contract_in_scope(contract_id));
--> statement-breakpoint

create policy "office" on app.component_ceilings for all to app_office
  using (app.component_in_scope(component_id)) with check (app.component_in_scope(component_id));
--> statement-breakpoint

-- ── Obiective ───────────────────────────────────────────────────────────────
-- Obiectivele sunt nomenclator comun (un obiectiv poate sta pe doua contracte,
-- la firme diferite — verificarea #11 din pasul 04). Legatura, in schimb,
-- poarta contractul, deci ea se filtreaza pe firma.
create policy "office" on app.objectives for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.objectives
  for select to app_field, app_subcontractor, app_client using (true);
--> statement-breakpoint

create policy "office" on app.checklists for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.checklists for select to app_field using (true);
--> statement-breakpoint

create policy "office" on app.checklist_items for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.checklist_items for select to app_field using (true);
--> statement-breakpoint

create policy "office" on app.inspection_profiles for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.inspection_profiles for select to app_field using (true);
--> statement-breakpoint

create policy "office" on app.inspection_profile_items for all to app_office using (true) with check (true);
--> statement-breakpoint
create policy "read" on app.inspection_profile_items for select to app_field using (true);
--> statement-breakpoint

create policy "office" on app.contract_objectives for all to app_office
  using (app.contract_in_scope(contract_id)) with check (app.contract_in_scope(contract_id));
--> statement-breakpoint
create policy "read" on app.contract_objectives
  for select to app_field, app_subcontractor, app_client
  using (app.contract_in_scope(contract_id));
--> statement-breakpoint

-- ── Jurnalul de audit ───────────────────────────────────────────────────────
--
-- Citire: doar birou cu rol `admin` (§3.4). `financiar` NU are acces —
-- verificarea #19 din pas.
--
-- Aici RLS se aprinde FARA `force`, spre deosebire de tot restul: singurul care
-- scrie in jurnal e trigger-ul `audit.record_change()`, `security definer`,
-- adica proprietarul tabelei. Cu `force` ar fi trebuit sa-i dam proprietarului o
-- politica de scriere, iar o politica de scriere pe jurnal e exact lucrul care
-- nu trebuie sa existe.
alter table audit.entries enable row level security;
--> statement-breakpoint

create policy "admin_read" on audit.entries for select to app_office
  using (app.has_office_role('admin'));
--> statement-breakpoint

create policy "service" on audit.entries for select to app_service using (true);
