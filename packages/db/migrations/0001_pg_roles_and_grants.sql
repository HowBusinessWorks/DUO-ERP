-- Rolurile Postgres si modelul de acces (PLAN_TEHNIC §4.3).
--
-- Cele patru persona plus rolul de serviciu sunt NOLOGIN: nu te conectezi ca ele,
-- intri in ele cu `SET LOCAL ROLE` din interiorul lui withActor(). Asa izolarea
-- pretului si RLS-ul sunt proprietati ale conexiunii, nu ale codului de aplicatie.
--
-- Rolurile sunt obiecte de cluster, nu de baza de date: le cream idempotent, ca
-- migrarea sa poata rula si pe un cluster unde exista deja alta baza Damina.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_office') then
    create role app_office nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_field') then
    create role app_field nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_subcontractor') then
    create role app_subcontractor nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_client') then
    create role app_client nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_service') then
    create role app_service nologin;
  end if;
end
$$;
--> statement-breakpoint

-- Rolul cu care se conecteaza efectiv aplicatia. NOINHERIT: pana nu face
-- `SET ROLE`, nu are privilegiile niciunei persona — deci o conexiune fara
-- withActor() nu poate citi nimic din `app`.
--
-- Parola NU se pune aici. Se seteaza separat, o singura data, cu
-- `pnpm db:set-runtime-password` (citeste APP_RUNTIME_PASSWORD din .env.local).
-- Fara parola, rolul exista dar nu se poate autentifica.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime login noinherit;
  end if;
end
$$;
--> statement-breakpoint

grant app_office, app_field, app_subcontractor, app_client, app_service to app_runtime;
--> statement-breakpoint

-- Rolul care ruleaza migratiile si testele trebuie sa poata face SET ROLE
-- catre persona, altfel testele de izolare nu au cum sa fie scrise.
do $$
declare
  migrator text := current_user;
begin
  execute format(
    'grant app_office, app_field, app_subcontractor, app_client, app_service, app_runtime to %I',
    migrator
  );
end
$$;
--> statement-breakpoint

grant usage on schema app to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

-- pg-boss isi creeaza singur tabelele in schema `jobs`, pe conexiunea
-- worker-ului. Are nevoie de drept direct, inainte de orice SET ROLE.
grant usage, create on schema jobs to app_runtime, app_service;
--> statement-breakpoint

grant usage on schema audit to app_office, app_field, app_subcontractor, app_client, app_service;
