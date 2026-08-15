CREATE TABLE "app"."period_close_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"period_id" uuid NOT NULL,
	"check_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"blocking_count" integer DEFAULT 0 NOT NULL,
	"detail" jsonb,
	"evaluated_at" timestamp with time zone,
	CONSTRAINT "period_close_checks_period_key_unique" UNIQUE("period_id","check_key"),
	CONSTRAINT "period_close_checks_status" CHECK ("app"."period_close_checks"."status" in ('pending', 'ok', 'blocked')),
	CONSTRAINT "period_close_checks_blocking_count" CHECK ("app"."period_close_checks"."blocking_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"status" "app"."period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "periods_company_year_month_unique" UNIQUE("company_id","year","month"),
	CONSTRAINT "periods_month_range" CHECK ("app"."periods"."month" between 1 and 12),
	CONSTRAINT "periods_year_range" CHECK ("app"."periods"."year" between 2000 and 2100),
	CONSTRAINT "periods_closed_has_author" CHECK (("app"."periods"."status" = 'closed') = ("app"."periods"."closed_at" is not null and "app"."periods"."closed_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."period_close_checks" ADD CONSTRAINT "period_close_checks_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."periods" ADD CONSTRAINT "periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."periods" ADD CONSTRAINT "periods_closed_by_persons_id_fk" FOREIGN KEY ("closed_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── UUID v7 in SQL ──────────────────────────────────────────────────────────
/*
 * Aplicatia genereaza UUID-uri v7 in TypeScript (offline-first: clientul de
 * teren trebuie sa poata crea id-uri fara sa intrebe serverul). Dar functiile
 * `security definer` de mai jos creeaza randuri singure, deci au nevoie si ele
 * de un generator.
 *
 * `gen_random_uuid()` e in nucleul Postgres din 13, deci nu depindem de
 * pgcrypto si de schema in care l-a pus Supabase. Peste el suprascriem primii
 * 48 de biti cu timestamp-ul in milisecunde si refacem nibble-ul de versiune.
 * Restul bitilor raman aleatori, ca in v4.
 */
create function app.uuid_generate_v7() returns uuid
  language sql
  volatile
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;
--> statement-breakpoint

-- ── Perioade: cautare, creare, stare ────────────────────────────────────────

/*
 * Toate functiile de mai jos sunt `security definer`: starea unei luni e un
 * fapt al sistemului, nu ceva ce depinde de ce are voie sa vada apelantul.
 * Daca RLS-ul de pe `app.periods` ar ascunde randul, blocarea ar disparea exact
 * pentru rolul caruia i se aplica cel mai strict — adica exact pe dos.
 */

create function app.find_period(p_company_id uuid, p_effect_date date) returns uuid
  language sql
  stable
  security definer
  set search_path = app, pg_catalog
as $$
  select id
    from app.periods
   where company_id = p_company_id
     and year  = extract(year  from p_effect_date)::smallint
     and month = extract(month from p_effect_date)::smallint;
$$;
--> statement-breakpoint

-- Perioada lunii, creata daca lipseste. Folosita de triggerele care deriva
-- `period_id` din `effect_date`.
create function app.period_of(p_company_id uuid, p_effect_date date) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_id uuid;
begin
  v_id := app.find_period(p_company_id, p_effect_date);
  if v_id is not null then
    return v_id;
  end if;

  -- `on conflict` acopera cursa dintre doua tranzactii care deschid aceeasi
  -- luna in acelasi timp; `do update`, nu `do nothing`, ca `returning` sa dea
  -- randul si pe ramura de conflict.
  insert into app.periods (id, company_id, year, month)
  values (
    app.uuid_generate_v7(),
    p_company_id,
    extract(year  from p_effect_date)::smallint,
    extract(month from p_effect_date)::smallint
  )
  on conflict (company_id, year, month)
    do update set company_id = excluded.company_id
  returning id into v_id;

  return v_id;
end
$$;
--> statement-breakpoint

create function app.period_status_of(p_period_id uuid) returns app.period_status
  language sql
  stable
  security definer
  set search_path = app, pg_catalog
as $$
  select status from app.periods where id = p_period_id;
$$;
--> statement-breakpoint

create function app.assert_period_open(p_period_id uuid) returns void
  language plpgsql
  stable
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_year  smallint;
  v_month smallint;
  v_state app.period_status;
begin
  if p_period_id is null then
    return;
  end if;

  select year, month, status into v_year, v_month, v_state
    from app.periods where id = p_period_id;

  -- O luna care nu exista nu poate fi inchisa. Lasam randul sa treaca; daca
  -- `period_id` e o cheie straina invalida, o prinde constrangerea, nu noi.
  if not found or v_state <> 'closed' then
    return;
  end if;

  raise exception 'PERIOD_CLOSED: luna %/% este inchisa', lpad(v_month::text, 2, '0'), v_year
    using errcode = 'P0001';
end
$$;
--> statement-breakpoint

-- ── Usa unica pentru scrierea intr-o luna inchisa ───────────────────────────
/*
 * Singurul mod legitim de a ocoli blocarea. Cere motiv scris si il pune tot ea
 * in `app.action_reason`, de unde il ia trigger-ul de audit — deci o scriere
 * intr-o luna inchisa ajunge in jurnal cu motiv prin constructie, nu pentru ca
 * si-a amintit cineva sa-l treaca.
 *
 * Ambele setari sunt LOCALE tranzactiei, ca sa nu ramana lipite de o conexiune
 * din pool si sa deschida luna pentru altcineva.
 *
 * Deliberat FARA `security definer` si fara clauza `set`: functia nu atinge
 * niciun obiect protejat, deci nu are de ce sa ruleze cu drepturi imprumutate.
 * In plus, o functie cu clauza `set` isi restaureaza la iesire variabilele
 * numite acolo — iar noi vrem exact opusul, ca setarile sa ramana pana la
 * finalul tranzactiei. Controlul e in grant: doar biroul si worker-ul o pot
 * apela.
 */
create function app.allow_closed_period_writes(p_reason text) returns void
  language plpgsql
  volatile
as $$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'VALIDATION_FAILED: scrierea intr-o luna inchisa cere un motiv scris'
      using errcode = 'P0001';
  end if;

  perform set_config('app.action_reason', p_reason, true);
  perform set_config('app.allow_closed_period', 'on', true);
end
$$;
--> statement-breakpoint

-- ── Trigger-ul generic de blocare ───────────────────────────────────────────

-- Perioada careia ii apartine un rand: direct prin `period_id`, sau dedusa din
-- `company_id` + `effect_date`.
create function app.period_of_row(p_row jsonb) returns uuid
  language plpgsql
  stable
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_company uuid;
  v_date    date;
  v_period  uuid;
begin
  if p_row is null then
    return null;
  end if;

  v_period := nullif(p_row ->> 'period_id', '')::uuid;
  if v_period is not null then
    return v_period;
  end if;

  -- Tabelele care poarta doar `effect_date` nu-si deschid luna singure aici:
  -- daca luna nu exista, nu e inchisa, deci nu avem ce bloca.
  v_company := nullif(p_row ->> 'company_id', '')::uuid;
  v_date    := nullif(p_row ->> 'effect_date', '')::date;
  if v_company is null or v_date is null then
    return null;
  end if;

  return app.find_period(v_company, v_date);
end
$$;
--> statement-breakpoint

create function app.guard_closed_period() returns trigger
  language plpgsql
as $$
declare
  v_period uuid;
begin
  if current_setting('app.allow_closed_period', true) is not distinct from 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- La UPDATE verificam ambele luni: si cea din care pleaca randul, si cea in
  -- care ajunge. Altfel o linie s-ar putea muta DIN august inchis in
  -- septembrie deschis, iar august ar arata altfel decat cand a fost raportat.
  for v_period in
    select p
      from unnest(array[
        app.period_of_row(case when tg_op = 'DELETE' then null else to_jsonb(new) end),
        app.period_of_row(case when tg_op = 'INSERT' then null else to_jsonb(old) end)
      ]) as p
     where p is not null
  loop
    perform app.assert_period_open(v_period);
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;
--> statement-breakpoint

-- Ataseaza blocarea pe o tabela. Idempotent, ca migrarile sa se poata rerula.
create function app.attach_period_guard(p_table regclass) returns void
  language plpgsql
  volatile
as $$
declare
  v_trigger text := format('%s_guard_closed_period', replace(p_table::text, '.', '_'));
begin
  execute format('drop trigger if exists %I on %s', v_trigger, p_table);
  execute format(
    'create trigger %I before insert or update or delete on %s
       for each row execute function app.guard_closed_period()',
    v_trigger, p_table
  );
end
$$;
--> statement-breakpoint

select app.attach_period_guard('app.period_close_checks');
--> statement-breakpoint

-- ── Grant-uri ───────────────────────────────────────────────────────────────
grant select on app.periods, app.period_close_checks
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint
grant insert, update on app.periods, app.period_close_checks to app_office, app_service;
--> statement-breakpoint

grant execute on function
  app.uuid_generate_v7(),
  app.find_period(uuid, date),
  app.period_of(uuid, date),
  app.period_status_of(uuid),
  app.assert_period_open(uuid),
  app.period_of_row(jsonb)
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

-- Usa de avarie e doar pentru birou si pentru worker. Terenul si portalurile
-- n-au ce cauta intr-o luna inchisa, nici cu motiv.
grant execute on function app.allow_closed_period_writes(text) to app_office, app_service;
