CREATE TABLE "app"."deviz_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"objective_kind" text,
	"source_deviz_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deviz_templates_company_name_unique" UNIQUE("company_id","name"),
	CONSTRAINT "deviz_templates_name_not_blank" CHECK (length(btrim("app"."deviz_templates"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."normed_article_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"article_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"product_id" uuid,
	"qualification_id" uuid,
	"position" smallint NOT NULL,
	"quantity_per_uom" numeric(14, 4) NOT NULL,
	"norm_hours" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "normed_article_components_kind_known" CHECK ("app"."normed_article_components"."kind" in ('material','manopera','utilaj','transport')),
	CONSTRAINT "normed_article_components_position_positive" CHECK ("app"."normed_article_components"."position" > 0),
	CONSTRAINT "normed_article_components_quantity_positive" CHECK ("app"."normed_article_components"."quantity_per_uom" > 0),
	CONSTRAINT "normed_article_components_norm_hours_non_negative" CHECK ("app"."normed_article_components"."norm_hours" is null or "app"."normed_article_components"."norm_hours" >= 0),
	CONSTRAINT "normed_article_components_single_source" CHECK (num_nonnulls("app"."normed_article_components"."product_id", "app"."normed_article_components"."qualification_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."normed_articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"uom" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "normed_articles_company_code_unique" UNIQUE("company_id","code"),
	CONSTRAINT "normed_articles_code_not_blank" CHECK (length(btrim("app"."normed_articles"."code")) > 0),
	CONSTRAINT "normed_articles_name_not_blank" CHECK (length(btrim("app"."normed_articles"."name")) > 0),
	CONSTRAINT "normed_articles_uom_not_blank" CHECK (length(btrim("app"."normed_articles"."uom")) > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."deviz_templates" ADD CONSTRAINT "deviz_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."deviz_templates" ADD CONSTRAINT "deviz_templates_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."normed_article_components" ADD CONSTRAINT "normed_article_components_article_id_normed_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "app"."normed_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."normed_article_components" ADD CONSTRAINT "normed_article_components_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "app"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."normed_article_components" ADD CONSTRAINT "normed_article_components_qualification_id_qualifications_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "app"."qualifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."normed_articles" ADD CONSTRAINT "normed_articles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."normed_articles" ADD CONSTRAINT "normed_articles_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deviz_templates_objective_kind_idx" ON "app"."deviz_templates" USING btree ("company_id","objective_kind");--> statement-breakpoint
CREATE INDEX "normed_article_components_article_idx" ON "app"."normed_article_components" USING btree ("article_id","position");--> statement-breakpoint
CREATE INDEX "normed_articles_company_idx" ON "app"."normed_articles" USING btree ("company_id","is_active");--> statement-breakpoint
ALTER TABLE "app"."deviz_lines" ADD CONSTRAINT "deviz_lines_normed_article_id_normed_articles_id_fk" FOREIGN KEY ("normed_article_id") REFERENCES "app"."normed_articles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

/*
 * Biblioteca de articole normate si sabloanele (pasul 11, sec. 3.2).
 *
 * Trei tabele fara nicio coloana de bani, si asta e o alegere, nu o omisiune:
 * pretul materialului sta in nomenclator, al manoperei in `rate_cards`, ambele
 * istoricizate. Un pret copiat in articol ar fi inghetat in ziua in care s-a
 * scris articolul si ar minti la prima scumpire — iar devizele facute din el
 * ar mosteni minciuna fara sa se vada.
 *
 * Vizibilitatea e pe firma, nu pe unitate de lucru: biblioteca nu apartine unei
 * lucrari, ea traieste intre lucrari. Asta e chiar rostul ei.
 */

-- Sablonul arata catre devizul care-i serveste de tipar. FK-ul se pune aici, nu
-- in schema TypeScript, fiindca acolo ar fi inchis un ciclu de import.
ALTER TABLE "app"."deviz_templates" ADD CONSTRAINT "deviz_templates_source_deviz_id_devize_id_fk"
  FOREIGN KEY ("source_deviz_id") REFERENCES "app"."devize"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

select app.rls_enable('app.normed_articles'::regclass);
--> statement-breakpoint
select app.rls_enable('app.normed_article_components'::regclass);
--> statement-breakpoint
select app.rls_enable('app.deviz_templates'::regclass);
--> statement-breakpoint

create policy "office" on app.normed_articles for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint

create policy "office" on app.normed_article_components for all to app_office
  using (
    exists (
      select 1 from app.normed_articles a
       where a.id = article_id and a.company_id = any(app.current_company_ids())
    )
  )
  with check (
    exists (
      select 1 from app.normed_articles a
       where a.id = article_id and a.company_id = any(app.current_company_ids())
    )
  );
--> statement-breakpoint

create policy "office" on app.deviz_templates for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint

/*
 * Grant-uri.
 *
 * `delete` pe articole si sabloane NU se acorda: un articol folosit intr-un
 * deviz e referit de `deviz_lines.normed_article_id`, iar disparitia lui ar
 * lasa in urma linii care nu mai stiu de unde vin. Se dezactiveaza
 * (`is_active = false`) si iese din cautare, dar ramane citibil in istoric —
 * acelasi tipar ca la nomenclatoarele din 0004.
 *
 * `delete` pe componente se acorda: schimbarea retetei unui articol inseamna si
 * scoaterea unei componente, iar acolo nu exista istoric de aparat.
 */
grant select, insert, update on app.normed_articles, app.deviz_templates to app_office;
--> statement-breakpoint
grant select, insert, update, delete on app.normed_article_components to app_office;
--> statement-breakpoint

grant select on
  app.normed_articles, app.normed_article_components, app.deviz_templates to app_service;
--> statement-breakpoint

/*
 * Biblioteca nu e secreta — n-are niciun pret — dar nu se acorda in afara
 * biroului fiindca n-are cine s-o citeasca acolo: terenul nu vede devizul
 * deloc (sec. 10.3), iar subcontractantul vede pachetul, la pasul 12. Un grant
 * dat „ca sa fie" e un drept pe care nu-l revizuieste nimeni.
 */
revoke all on
  app.normed_articles, app.normed_article_components, app.deviz_templates
  from app_field, app_subcontractor, app_client;
--> statement-breakpoint

-- Nomenclator: se auditeaza, ca `products` si `qualifications` din 0007. O
-- norma de timp schimbata tacut se vede abia in marja, peste trei luni.
select app.attach_audit('app.normed_articles');
--> statement-breakpoint
select app.attach_audit('app.normed_article_components');
--> statement-breakpoint
select app.attach_audit('app.deviz_templates');
--> statement-breakpoint

-- Plasa de bani, a unsprezecea rulare.
select app.assert_no_money_leak(array['total']);
