CREATE TABLE "app"."companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cui" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_cui_unique" UNIQUE("cui")
);
--> statement-breakpoint

-- Grant-uri minime, cat sa existe ceva de citit prin withActor().
-- Grant-urile pe coloane (izolarea pretului) si politicile RLS vin in pasul 02,
-- migrarile 0013_rls_policies si 0014_column_grants.
grant select on app.companies to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint
grant insert, update on app.companies to app_office, app_service;
