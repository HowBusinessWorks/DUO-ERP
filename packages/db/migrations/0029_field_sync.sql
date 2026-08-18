CREATE TABLE "app"."applied_mutations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"type" text NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applied_mutations_type_not_blank" CHECK (length(btrim("app"."applied_mutations"."type")) > 0),
	CONSTRAINT "applied_mutations_device_not_blank" CHECK (length(btrim("app"."applied_mutations"."device_id")) > 0),
	CONSTRAINT "applied_mutations_outcome_exclusive" CHECK (("app"."applied_mutations"."result" is not null) <> ("app"."applied_mutations"."error_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."sync_cursors" (
	"person_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"last_pulled_at" timestamp with time zone,
	"last_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_cursors_person_id_device_id_pk" PRIMARY KEY("person_id","device_id"),
	CONSTRAINT "sync_cursors_device_not_blank" CHECK (length(btrim("app"."sync_cursors"."device_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."applied_mutations" ADD CONSTRAINT "applied_mutations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sync_cursors" ADD CONSTRAINT "sync_cursors_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applied_mutations_person_idx" ON "app"."applied_mutations" USING btree ("person_id","applied_at");--> statement-breakpoint
CREATE INDEX "applied_mutations_device_idx" ON "app"."applied_mutations" USING btree ("device_id","applied_at");--> statement-breakpoint
CREATE INDEX "applied_mutations_applied_at_idx" ON "app"."applied_mutations" USING btree ("applied_at");--> statement-breakpoint

/*
 * ── Sincronizarea de teren (pasul 10, §3.2) ─────────────────────────────────
 *
 * Doua tabele care exista pentru acelasi lucru: conexiunea cade la jumatatea
 * cererii, in subsol. Jurnalul de mutatii face retry-ul sigur prin constructie,
 * iar cursorul spune fiecarui TELEFON, nu fiecarui om, ce a primit deja.
 *
 * Politicile sunt „ale mele si atat", pe ambele: un rand din jurnalul altcuiva
 * n-are ce cauta pe telefonul meu, nici macar ca numar. Biroul le vede pe toate
 * — depanarea unei cozi blocate se face de la birou, nu de pe teren.
 */

select app.rls_enable('app.applied_mutations'::regclass);
--> statement-breakpoint
select app.rls_enable('app.sync_cursors'::regclass);
--> statement-breakpoint

create policy "office" on app.applied_mutations for all to app_office
  using (true) with check (true);
--> statement-breakpoint
create policy "mine" on app.applied_mutations for all to app_field
  using (person_id = app.current_person_id())
  with check (person_id = app.current_person_id());
--> statement-breakpoint

create policy "office" on app.sync_cursors for all to app_office
  using (true) with check (true);
--> statement-breakpoint
create policy "mine" on app.sync_cursors for all to app_field
  using (person_id = app.current_person_id())
  with check (person_id = app.current_person_id());
--> statement-breakpoint

grant select, insert, update on app.applied_mutations to app_office, app_field, app_service;
--> statement-breakpoint
grant select, insert, update on app.sync_cursors to app_office, app_field, app_service;
--> statement-breakpoint

-- Curatenia de 90 de zile ruleaza cu rolul de serviciu, ca stergerea din
-- pasul 07: un rol de aplicatie n-are `delete` pe jurnalul propriilor mutatii.
grant delete on app.applied_mutations to app_service;
--> statement-breakpoint

/**
 * Retentia jurnalului: 90 de zile.
 *
 * Un dispozitiv care revine dupa 90 de zile isi pierde memoria de idempotenta,
 * deci face pull complet — de asta cursorul lui se sterge odata cu randurile.
 * Alternativa, sa pastram jurnalul la nesfarsit, ar fi insemnat o tabela care
 * creste cu fiecare tap al fiecarui om, pentru o garantie care conteaza doar
 * cateva zile.
 */
create or replace function app.prune_applied_mutations(p_days integer default 90)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = app, pg_catalog
as $fn$
declare
  v_deleted integer;
  v_cutoff timestamptz := now() - make_interval(days => p_days);
begin
  delete from app.applied_mutations where applied_at < v_cutoff;
  get diagnostics v_deleted = row_count;

  -- Cursorul unui dispozitiv care n-a mai vorbit de atunci nu mai are ce
  -- pazi: fara jurnal, urmatorul lui push nu mai poate fi verificat.
  delete from app.sync_cursors
   where last_pulled_at is not null and last_pulled_at < v_cutoff;

  return v_deleted;
end
$fn$;
--> statement-breakpoint

revoke execute on function app.prune_applied_mutations(integer) from public;
--> statement-breakpoint
grant execute on function app.prune_applied_mutations(integer) to app_service;
--> statement-breakpoint

-- Plasa de bani, a cincea rulare. Tabelele noi n-au coloane de pret, si nici
-- n-o sa aiba: `result` e jsonb, iar ce intra in el e raspunsul unui use-case
-- care si-a aplicat deja propriile reguli de vizibilitate.
select app.assert_no_money_leak();
