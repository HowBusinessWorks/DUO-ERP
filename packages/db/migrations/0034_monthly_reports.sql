CREATE TABLE "app"."monthly_report_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"artifact_node_id" uuid,
	"archive_key" text NOT NULL,
	"web_token" text NOT NULL,
	"web_token_expires_at" timestamp with time zone NOT NULL,
	"included_work_unit_ids" uuid[] NOT NULL,
	"inspection_count" integer DEFAULT 0 NOT NULL,
	"intervention_count" integer DEFAULT 0 NOT NULL,
	"journal_count" integer DEFAULT 0 NOT NULL,
	"photo_count" integer DEFAULT 0 NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid,
	CONSTRAINT "monthly_report_versions_web_token_unique" UNIQUE("web_token"),
	CONSTRAINT "monthly_report_versions_report_version_unique" UNIQUE("report_id","version"),
	CONSTRAINT "monthly_report_versions_version_positive" CHECK ("app"."monthly_report_versions"."version" >= 1),
	CONSTRAINT "monthly_report_versions_counts_non_negative" CHECK ("app"."monthly_report_versions"."photo_count" >= 0 and "app"."monthly_report_versions"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."monthly_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"template_id" text DEFAULT 'standard' NOT NULL,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"frozen_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_reports_contract_period_unique" UNIQUE("contract_id","period_id"),
	CONSTRAINT "monthly_reports_status_known" CHECK ("app"."monthly_reports"."status" in ('building','review','approved','frozen','sent')),
	CONSTRAINT "monthly_reports_approved_pair" CHECK (num_nonnulls("app"."monthly_reports"."approved_at", "app"."monthly_reports"."approved_by") <> 1),
	CONSTRAINT "monthly_reports_freeze_after_approve" CHECK ("app"."monthly_reports"."frozen_at" is null or "app"."monthly_reports"."approved_at" is not null),
	CONSTRAINT "monthly_reports_send_after_freeze" CHECK ("app"."monthly_reports"."sent_at" is null or "app"."monthly_reports"."frozen_at" is not null),
	CONSTRAINT "monthly_reports_progress_non_negative" CHECK ("app"."monthly_reports"."progress_done" >= 0 and "app"."monthly_reports"."progress_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."monthly_report_versions" ADD CONSTRAINT "monthly_report_versions_report_id_monthly_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "app"."monthly_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monthly_report_versions" ADD CONSTRAINT "monthly_report_versions_generated_by_persons_id_fk" FOREIGN KEY ("generated_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monthly_reports" ADD CONSTRAINT "monthly_reports_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monthly_reports" ADD CONSTRAINT "monthly_reports_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "app"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."monthly_reports" ADD CONSTRAINT "monthly_reports_approved_by_persons_id_fk" FOREIGN KEY ("approved_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monthly_report_versions_report_idx" ON "app"."monthly_report_versions" USING btree ("report_id",version desc);--> statement-breakpoint
CREATE INDEX "monthly_reports_period_idx" ON "app"."monthly_reports" USING btree ("period_id","status");--> statement-breakpoint

/*
 * Raportul lunar catre client (pasul 10, §3.6) — RLS, grant-uri, imutabilitate.
 *
 * Patru decizii, toate din aceeasi propozitie: **banii se primesc in baza
 * raportului.**
 *
 * 1. **Terenul nu are niciun drept aici.** Nici macar `select`. Raportul e
 *    documentul comercial al lunii; pe teren nu se citeste, nu se aproba si nu
 *    se trimite. E acelasi rationament ca la regula „zero lei pe teren", dus
 *    pana la capat: ce nu se acorda nu se poate scapa pe ecran.
 * 2. **Versiunile sunt imutabile.** `update` si `delete` nu se acorda nimanui,
 *    nici lui `app_service`. Un raport inghetat care se poate rescrie e o
 *    hartie pe care clientul n-o mai poate opune nimanui — inclusiv noua.
 *    Regenerarea produce versiunea urmatoare, nu o rescrie pe cea trimisa.
 * 3. **Vizibilitatea o mosteneste prin contract** (`app.contract_in_scope`), ca
 *    tot ce atarna de contract din 0011.
 * 4. **Audit pe capul raportului.** Aprobarea si inghetul sunt ireversibile si
 *    au consecinta directa in facturare; „cine a aprobat raportul pe august?"
 *    trebuie sa aiba raspuns si dupa ce omul a plecat din firma. Versiunile NU
 *    primesc audit: sunt append-only si isi poarta autorul pe rand.
 */

select app.rls_enable('app.monthly_reports'::regclass);
--> statement-breakpoint
select app.rls_enable('app.monthly_report_versions'::regclass);
--> statement-breakpoint

create policy "office" on app.monthly_reports for all to app_office
  using (app.contract_in_scope(contract_id))
  with check (app.contract_in_scope(contract_id));
--> statement-breakpoint

create policy "office" on app.monthly_report_versions for all to app_office
  using (
    exists (
      select 1 from app.monthly_reports r
       where r.id = report_id and app.contract_in_scope(r.contract_id)
    )
  )
  with check (
    exists (
      select 1 from app.monthly_reports r
       where r.id = report_id and app.contract_in_scope(r.contract_id)
    )
  );
--> statement-breakpoint

/*
 * `app_service` scrie progresul si versiunea din worker, si citeste versiunea
 * prin token pentru raportul web. Nu are politica proprie: rolul de serviciu
 * ocoleste RLS prin `bypassrls`, ca peste tot in ERP (0011).
 *
 * `delete` nu apare in nicio lista: un raport se anuleaza prin stare, nu prin
 * disparitie. Perioada inchisa nu-l blocheaza — raportul se genereaza chiar
 * DUPA ce luna s-a inchis, si asta e ordinea normala.
 */
grant select, insert, update on app.monthly_reports to app_office, app_service;
--> statement-breakpoint
grant select, insert on app.monthly_report_versions to app_office, app_service;
--> statement-breakpoint

select app.attach_audit('app.monthly_reports');
--> statement-breakpoint

-- Plasa de bani, a noua rulare. Tabelele n-au coloane de valoare, dar plasa se
-- trage la fiecare migrare care adauga tabele — altfel ar fi o obisnuinta, nu o
-- verificare.
select app.assert_no_money_leak();
