CREATE TABLE "app"."journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"stage_id" uuid,
	"person_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_text_not_blank" CHECK (length(btrim("app"."journal_entries"."text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."journal_entries" ADD CONSTRAINT "journal_entries_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."journal_entries" ADD CONSTRAINT "journal_entries_stage_id_work_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "app"."work_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."journal_entries" ADD CONSTRAINT "journal_entries_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_work_unit_idx" ON "app"."journal_entries" USING btree ("work_unit_id","entry_date");--> statement-breakpoint

/*
 * Jurnalul de santier (pasul 10, §3.5) — tabela, RLS, grant-uri.
 *
 * Trei decizii, toate cu acelasi rost: jurnalul e o CONSEMNARE, nu un camp de
 * text pe fisa.
 *
 * 1. **Append-only pentru toata lumea.** `update` si `delete` nu se acorda
 *    nimanui, nici biroului. O corectie se scrie ca intrare noua, cu data ei —
 *    altfel, peste sase luni, jurnalul ar spune ce credem acum ca s-a
 *    intamplat atunci.
 * 2. **Vizibilitatea o mosteneste prin unitate**, ca fisele din 0026: biroul
 *    vede ce e la firmele lui, terenul doar ce e al lui.
 * 3. **Fara audit.** `attach_audit` ar produce acelasi jurnal a doua oara:
 *    tabela e append-only si isi poarta autorul si momentul pe rand. Acelasi
 *    motiv pentru care `stock_movements` n-a primit audit la 0026.
 */

select app.rls_enable('app.journal_entries'::regclass);
--> statement-breakpoint

create policy "office" on app.journal_entries for all to app_office
  using (app.work_unit_in_scope(work_unit_id))
  with check (app.work_unit_in_scope(work_unit_id));
--> statement-breakpoint

create policy "assigned" on app.journal_entries for all to app_field
  using (app.work_unit_assigned_to_me(work_unit_id))
  with check (app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

-- Nici `app_service` n-are `update`/`delete`: un job care ar putea rescrie
-- jurnalul face regula 1 de mai sus sa fie doar o intentie.
grant select, insert on app.journal_entries to app_office, app_service;
--> statement-breakpoint

/*
 * Terenul: aceleasi doua drepturi, si toate coloanele.
 *
 * Enumerarea pe coloane, obligatorie oriunde exista bani, n-are ce enumera
 * aici — tabela n-are nicio coloana de valoare, si nici nu trebuie sa capete.
 * Costul jurnalului se vede in pontaj si in materialele fisei, unde exista deja
 * mecanism; o suma scrisa in text ar fi o cifra fara nicio verificare in spate.
 *
 * `delete` NU se acorda, spre deosebire de `inspection_answers` la 0031:
 * serviciul nu rescrie un set, ci adauga o intrare. Idempotenta la retrimitere
 * o da `app.applied_mutations`, nu o stergere.
 */
grant select, insert on app.journal_entries to app_field;
--> statement-breakpoint

-- Plasa de bani, a opta rulare.
select app.assert_no_money_leak();
