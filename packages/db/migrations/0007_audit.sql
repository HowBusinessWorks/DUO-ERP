-- Jurnalul de modificari. Scris de mana: schema `audit` nu e sub drizzle
-- (`schemaFilter: ['app']`), iar un trigger generic nu se exprima in TypeScript.

create table audit.entries (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),

  -- Cine. Din `app.actor_id`, pus de `withActor`. Nu e cheie straina catre
  -- `app.persons`: jurnalul trebuie sa supravietuiasca stergerii persoanei, si
  -- exista un actor tehnic pentru worker care nu e o persoana reala.
  actor_id     uuid,
  persona      app.persona,

  -- Ce.
  table_name   text not null,
  record_id    uuid not null,
  operation    app.audit_op not null,

  -- DOAR diferenta: {"coloana": {"old": ..., "new": ...}}. Randul intreg ar
  -- face jurnalul de zece ori mai mare si necitibil — cel care il deschide
  -- vrea sa vada ce s-a schimbat, nu ce a ramas la fel.
  changed      jsonb not null,

  -- De ce. Din `app.action_reason`.
  reason       text,
  request_id   text,

  -- Marcat de trigger cand tabela a fost inregistrata ca cerand motiv scris.
  requires_reason boolean not null default false,

  -- Regula 4 din pasul 02: motivul scris e impus de baza, nu de formular.
  -- Constrangerea e plasa: trigger-ul ridica mai devreme o eroare cu mesaj
  -- bun, dar orice alta cale de scriere in jurnal se loveste tot de ea.
  constraint entries_reason_required
    check (not requires_reason or (reason is not null and btrim(reason) <> ''))
);
--> statement-breakpoint

-- Intrebarea pusa cel mai des: "ce s-a intamplat cu randul asta".
create index entries_record_idx on audit.entries (table_name, record_id, occurred_at desc);
--> statement-breakpoint

-- A doua: "ce a facut omul asta", pe ecranul de administrare.
create index entries_actor_idx on audit.entries (actor_id, occurred_at desc);
--> statement-breakpoint

create index entries_occurred_idx on audit.entries (occurred_at desc);
--> statement-breakpoint

-- ── Trigger-ul generic ──────────────────────────────────────────────────────
/*
 * `security definer`: niciun rol de aplicatie nu are `insert` pe
 * `audit.entries`. Singurul mod de a scrie in jurnal e sa modifici o tabela
 * auditata — deci jurnalul nu poate fi falsificat din aplicatie si nu poate fi
 * sarit.
 *
 * `tg_argv[0]` = "true" daca tabela cere motiv scris la fiecare modificare.
 */
create function audit.record_change() returns trigger
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
  -- Motivul se cere la UPDATE si DELETE, nu la INSERT. A crea ceva nu e o
  -- actiune ireversibila; a modifica sau a sterge, da. Altfel deschiderea
  -- lunilor sau adaugarea unui tarif nou ar cere justificare degeaba.
  v_required boolean := coalesce(tg_argv[0], 'false')::boolean and tg_op <> 'INSERT';
begin
  -- Diferenta, cheie cu cheie. `is distinct from` si nu `<>`, ca sa prinda si
  -- trecerile catre si dinspre null — exact modificarile care se pierd cel mai
  -- usor si care conteaza cel mai mult (o data de expirare stearsa, de pilda).
  for v_key in select jsonb_object_keys(v_old || v_new) loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changed := v_changed || jsonb_build_object(
        v_key,
        jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key)
      );
    end if;
  end loop;

  -- Un UPDATE care nu schimba nimic nu e un eveniment.
  if tg_op = 'UPDATE' and v_changed = '{}'::jsonb then
    return new;
  end if;

  v_record := coalesce(nullif(v_new ->> 'id', ''), nullif(v_old ->> 'id', ''))::uuid;

  v_claims  := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_persona := nullif(v_claims ->> 'persona', '')::app.persona;
  v_actor   := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_reason  := nullif(btrim(coalesce(current_setting('app.action_reason', true), '')), '');

  -- Eroarea buna vine de aici, inaintea constrangerii. Utilizatorul trebuie sa
  -- afle ca ii lipseste motivul, nu sa vada o violare de check.
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

/*
 * Ataseaza jurnalul pe o tabela. Idempotent.
 *
 * `p_require_reason` marcheaza tabelele pe care o modificare e ireversibila sau
 * contabila: mutari de finantare, anulari de document, suprascrieri de pret,
 * inchideri de luna. Se aplica la UPDATE si DELETE, nu la INSERT.
 *
 * AFTER, nu BEFORE: jurnalizam ce s-a intamplat efectiv, dupa ce toate
 * constrangerile au trecut. Exceptia e verificarea motivului, care ridica
 * eroare si de aici — dar tot in aceeasi tranzactie, deci randul nu ramane.
 */
create function app.attach_audit(
  p_table          regclass,
  p_require_reason boolean default false,
  p_operations     text default 'insert or update or delete'
) returns void
  language plpgsql
  volatile
as $$
declare
  v_trigger text := format('%s_audit', replace(p_table::text, '.', '_'));
begin
  -- `p_operations` intra intr-un `format('%s')`, deci se verifica dintr-o lista
  -- inchisa. Functia ruleaza doar din migrari, dar o gaura de injectie intr-un
  -- helper de DDL nu merita lasata deschisa pentru trei caractere economisite.
  if p_operations not in (
    'insert or update or delete',
    'insert or update',
    'insert or delete',
    'update or delete',
    'insert', 'update', 'delete'
  ) then
    raise exception 'Lista de operatii nerecunoscuta: %', p_operations;
  end if;

  execute format('drop trigger if exists %I on %s', v_trigger, p_table);
  execute format(
    'create trigger %I after %s on %s
       for each row execute function audit.record_change(%L)',
    v_trigger, p_operations, p_table, p_require_reason
  );
end
$$;
--> statement-breakpoint

-- ── Tabelele auditate din pasul 02a ─────────────────────────────────────────
select app.attach_audit('app.companies');
--> statement-breakpoint
select app.attach_audit('app.clients');
--> statement-breakpoint
select app.attach_audit('app.subcontractors');
--> statement-breakpoint
select app.attach_audit('app.suppliers');
--> statement-breakpoint
select app.attach_audit('app.qualifications');
--> statement-breakpoint
select app.attach_audit('app.persons');
--> statement-breakpoint
select app.attach_audit('app.person_office_roles');
--> statement-breakpoint
select app.attach_audit('app.person_company_access');
--> statement-breakpoint
select app.attach_audit('app.person_authorizations');
--> statement-breakpoint
select app.attach_audit('app.teams');
--> statement-breakpoint
select app.attach_audit('app.team_members');
--> statement-breakpoint
-- Definirea si stergerea unei serii se auditeaza; incrementarea numarului, nu.
-- Alocatorul face un UPDATE la fiecare document emis, iar un rand de jurnal per
-- factura care spune doar "next_number 41 -> 42" ar ineca tot ce conteaza.
select app.attach_audit('app.document_series', false, 'insert or delete');
--> statement-breakpoint

-- Auditat ca sa se vada scrierile facute prin usa de avarie: motivul dat lui
-- `app.allow_closed_period_writes()` ajunge aici singur.
select app.attach_audit('app.period_close_checks');
--> statement-breakpoint

-- Tarifele sunt preturi si sunt istoricizate: orice atingere cere motiv.
select app.attach_audit('app.rate_cards', true);
--> statement-breakpoint

-- Inchiderea de luna e ireversibila.
select app.attach_audit('app.periods', true);
--> statement-breakpoint

-- ── Grant-uri ───────────────────────────────────────────────────────────────
-- Citire: doar biroul, si acolo doar rolul `admin` — filtrul fin se pune ca
-- politica RLS in 0008. Scriere: nimeni. Jurnalul se scrie doar prin trigger.
grant select on audit.entries to app_office;

-- `app.attach_audit` si `app.attach_period_guard` NU se acorda nimanui: sunt
-- helpere de DDL pentru migrari. Un rol de aplicatie care poate atasa sau
-- detasa triggere poate si sa-si stearga propriile urme.
