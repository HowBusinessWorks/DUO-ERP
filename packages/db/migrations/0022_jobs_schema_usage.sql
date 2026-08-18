/*
 * Enqueue-ul tranzactional din aplicatie n-a functionat niciodata.
 *
 * `jobs.grant_queue_access()` (migrarea 0003) da drepturi pe TABELELE din schema
 * `jobs`, dar nu da niciodata `usage` pe schema insasi — iar fara `usage`,
 * drepturile pe tabele sunt inaccesibile. Orice `enqueue` facut de un rol de
 * aplicatie cadea cu „permission denied for schema jobs".
 *
 * N-a observat nimeni pana la 07b pentru ca toate cozile de pana acum erau
 * pornite de cron, din worker, care ruleaza cu rolul proprietar. `files.derive`
 * e prima coada pusa la coada DIN CEREREA UNUI OM, la finalizarea unui upload.
 *
 * Se rescrie functia, nu se adauga un `grant` liber: functia e chemata de worker
 * la fiecare pornire, deci reparatia se aplica si pe bazele care exista deja,
 * fara sa depinda de ordinea migrarilor si de cand a fost creata schema `jobs`
 * (pg-boss si-o creeaza singur, la primul start).
 */

create or replace function jobs.grant_queue_access() returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  execute 'grant usage on schema jobs to app_office, app_field, app_subcontractor, app_client, app_service';

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

/*
 * Si o rulare acum, pentru bazele in care schema `jobs` exista deja. Pe un
 * cluster gol schema inca nu exista, deci sarim tacut: worker-ul o va crea si
 * va chema functia la primul start.
 */
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'jobs') then
    perform jobs.grant_queue_access();
  end if;
end
$$;
