CREATE TYPE "app"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TABLE "app"."products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"uom" text NOT NULL,
	"category" text,
	"default_supplier_id" uuid,
	"is_stock_item" boolean DEFAULT true NOT NULL,
	"min_stock" numeric(14, 4),
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_not_blank" CHECK (length(btrim("app"."products"."code")) > 0),
	CONSTRAINT "products_uom_not_blank" CHECK (length(btrim("app"."products"."uom")) > 0),
	CONSTRAINT "products_min_stock_non_negative" CHECK ("app"."products"."min_stock" is null or "app"."products"."min_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"severity" "app"."alert_severity" DEFAULT 'warning' NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb,
	"href" text,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"company_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" uuid,
	"href" text,
	"action_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app"."outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "app"."work_queue_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"href" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_default_supplier_id_suppliers_id_fk" FOREIGN KEY ("default_supplier_id") REFERENCES "app"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alerts" ADD CONSTRAINT "alerts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_queue_items" ADD CONSTRAINT "work_queue_items_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_queue_items" ADD CONSTRAINT "work_queue_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "app"."products" USING btree ("name");--> statement-breakpoint
CREATE INDEX "alerts_scope_idx" ON "app"."alerts" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "notifications_person_created_idx" ON "app"."notifications" USING btree ("person_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_events_unprocessed_idx" ON "app"."outbox_events" USING btree ("created_at") WHERE processed_at is null;--> statement-breakpoint
CREATE INDEX "work_queue_items_open_idx" ON "app"."work_queue_items" USING btree ("person_id","kind","company_id") WHERE resolved_at is null;--> statement-breakpoint

-- ══ Completari scrise de mana ═══════════════════════════════════════════════
-- Ce urmeaza nu poate fi exprimat in schema drizzle: indecsi pe expresie,
-- indecsi unici partiali, grant-uri, triggere si publicatia de Realtime.

-- Codul de produs e unic INDIFERENT de scris. Magazionerul care tasteaza
-- "cim-42" si devizistul care scrie "CIM-42" trebuie sa cada pe acelasi produs;
-- doua randuri ar insemna doua stocuri paralele pentru acelasi obiect fizic.
create unique index products_code_unique on app.products (lower(btrim(code)));
--> statement-breakpoint

-- Regula centrala a mecanismului de alerte (§28, Anexa C.15): o singura alerta
-- DESCHISA per (scope, kind). Fara ea, un buget depasit produce cate o alerta la
-- fiecare rulare a resolver-ului, iar in doua zile bannerul devine zgomot pe
-- care nimeni nu-l mai citeste. Alertele inchise nu intra in index, deci
-- istoricul ramane complet: aceeasi conditie poate reaparea de 40 de ori in timp,
-- dar niciodata de doua ori simultan.
create unique index alerts_open_unique
  on app.alerts (scope_type, scope_id, kind)
  where resolved_at is null;
--> statement-breakpoint

-- Clopotelul cere "cate necitite am", nu "toate notificarile mele".
create index notifications_unread_idx
  on app.notifications (person_id, created_at desc)
  where read_at is null;
--> statement-breakpoint

-- Bannerul de alerte se randeaza pe fiecare pagina de birou, filtrat pe firmele
-- selectate. Indexul partial il tine ieftin oricat ar creste istoricul.
create index alerts_open_idx
  on app.alerts (company_id, severity)
  where resolved_at is null;
--> statement-breakpoint

-- ── Grant-uri ───────────────────────────────────────────────────────────────
-- Nomenclatorul de produse e citit de toata lumea: terenul are nevoie de el ca
-- sa scrie un bon de consum, subcontractantul ca sa raporteze cantitati. Nu
-- poarta niciun pret, deci nu incalca izolarea de la decizia 3.
grant select on app.products
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

grant insert, update, delete on app.products to app_office, app_service;
--> statement-breakpoint

-- Cozile si notificarile sunt personale: fiecare persona isi vede randurile ei
-- (politicile RLS vin in 02b). `update` exista pentru "am citit" si "am rezolvat".
grant select, update on app.work_queue_items, app.notifications
  to app_office, app_field, app_subcontractor, app_client;
--> statement-breakpoint

grant select on app.alerts to app_office, app_field, app_subcontractor, app_client;
--> statement-breakpoint

-- Cine PRODUCE randuri de coada/alerta e sistemul, nu omul. Un utilizator care
-- si-ar putea insera propriile alerte ar putea si sa si le stearga.
grant select, insert, update, delete
  on app.work_queue_items, app.notifications, app.alerts, app.outbox_events
  to app_service;
--> statement-breakpoint

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Nomenclatorul intra in audit: un produs redenumit sau dezactivat schimba
-- sensul documentelor vechi, si trebuie sa se stie cine a facut-o.
select app.attach_audit('app.products');
--> statement-breakpoint

-- Cozile, notificarile si outbox-ul NU intra in audit, intentionat: sunt
-- efemere si de mare volum. Auditul lor ar dubla scrierile fara sa raspunda la
-- vreo intrebare — "cine a citit notificarea" nu e o intrebare de audit.

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Badge-urile de coada si clopotelul sunt singurele lucruri care au voie sa se
-- miste singure pe ecran (PLAN_TEHNIC §13.1). Datele de business, niciodata.
-- Publicatia exista doar pe Supabase; in Postgres-ul efemer din CI, blocul
-- trece fara sa faca nimic.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table app.work_queue_items;
    alter publication supabase_realtime add table app.notifications;
  end if;
end
$$;
