-- Doua tabele operationale in schema `jobs`, langa cele ale lui pg-boss.
-- Nu sunt tabele de business, deci nu apar in schema Drizzle.

-- Tinta cozii de test `system.ping`. Exista ca sa putem dovedi ca lantul
-- enqueue tranzactional -> worker -> scriere in baza chiar functioneaza.
create table jobs.ping_log (
  id           uuid primary key,
  job_id       uuid not null,
  note         text,
  processed_by text not null,
  processed_at timestamptz not null default now()
);
--> statement-breakpoint

-- Bataia de inima a worker-ului, citita de /api/health. Un singur rand.
create table jobs.worker_heartbeat (
  worker_id  text primary key,
  version    text,
  beat_at    timestamptz not null default now()
);
--> statement-breakpoint

grant select, insert on jobs.ping_log to app_service;
--> statement-breakpoint
grant select, insert, update on jobs.worker_heartbeat to app_service;
--> statement-breakpoint

-- Aplicatia web citeste heartbeat-ul si scrie in coada, dar nu proceseaza joburi.
grant select on jobs.ping_log, jobs.worker_heartbeat
  to app_office, app_field, app_subcontractor, app_client;
--> statement-breakpoint

-- Enqueue-ul tranzactional se face din contextul persona care declanseaza
-- mutatia, deci toate rolurile trebuie sa poata scrie in tabelele pg-boss.
--
-- pg-boss isi creeaza tabelele abia la prima pornire a worker-ului, deci
-- grant-ul se pune prin default privileges. Acestea se aplica doar obiectelor
-- create de un anumit rol, si nu stim dinainte care va fi: in productie
-- worker-ul se conecteaza ca `app_runtime`, in teste migrarea si pg-boss
-- ruleaza amandoua sub rolul care a creat baza. Le acoperim pe amandoua.
alter default privileges for role app_runtime in schema jobs
  grant select, insert, update, delete on tables
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

do $$
begin
  execute format(
    'alter default privileges for role %I in schema jobs
       grant select, insert, update, delete on tables
       to app_office, app_field, app_subcontractor, app_client, app_service',
    current_user
  );
end
$$;
--> statement-breakpoint

-- Plasa de siguranta: worker-ul reaplica grant-urile dupa ce pg-boss isi
-- creeaza tabelele, prin functia asta. E idempotenta.
create function jobs.grant_queue_access() returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select tablename from pg_tables where schemaname = 'jobs'
  loop
    execute format(
      'grant select, insert, update, delete on jobs.%I to app_office, app_field, app_subcontractor, app_client, app_service',
      r.tablename
    );
  end loop;
  execute 'grant usage on all sequences in schema jobs to app_office, app_field, app_subcontractor, app_client, app_service';
end
$$;
--> statement-breakpoint

grant execute on function jobs.grant_queue_access() to app_service, app_runtime;
