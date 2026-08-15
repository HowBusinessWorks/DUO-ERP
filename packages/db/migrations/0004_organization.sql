-- ── Extensii ────────────────────────────────────────────────────────────────
-- Ambele in `public`, nu in `extensions` cum e conventia Supabase.
--
-- Rolurile noastre sunt NOLOGIN si se intra in ele prin `SET ROLE`, iar
-- `alter role ... set search_path` se aplica la CONECTARE, dupa utilizatorul de
-- sesiune — deci nu ajunge niciodata la ele. Operatorii `citext = citext` se
-- rezolva prin search_path, care implicit e `"$user", public`. Din `extensions`
-- orice `where email = $1` ar pica cu "operator does not exist".
--
-- `public` ramane fara tabele: extensiile adauga doar tipuri, functii si clase
-- de operatori. Invarianta din pasul 01 se pastreaza.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;--> statement-breakpoint

CREATE TYPE "app"."audit_op" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "app"."numbered_document_type" AS ENUM('factura', 'situatie_lucrari', 'comanda', 'nir', 'aviz_transfer', 'aviz_retur', 'bon_consum', 'pv_receptie', 'pv_custodie', 'lista_inventar', 'decizie_inventariere', 'nota_diferente', 'nota_realocare');--> statement-breakpoint
CREATE TABLE "app"."clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cui" text,
	"address" jsonb,
	"payment_term_days" smallint DEFAULT 70 NOT NULL,
	"report_template_id" uuid,
	"is_intercompany" boolean DEFAULT false NOT NULL,
	"intercompany_company_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_intercompany_consistent" CHECK (("app"."clients"."is_intercompany") = ("app"."clients"."intercompany_company_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."person_authorizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"issued_at" date NOT NULL,
	"expires_at" date,
	"document_node_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_authorizations_valid_range" CHECK ("app"."person_authorizations"."expires_at" is null or "app"."person_authorizations"."expires_at" >= "app"."person_authorizations"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "app"."person_company_access" (
	"person_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	CONSTRAINT "person_company_access_person_id_company_id_pk" PRIMARY KEY("person_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "app"."person_office_roles" (
	"person_id" uuid NOT NULL,
	"role" "app"."office_role" NOT NULL,
	CONSTRAINT "person_office_roles_person_id_role_pk" PRIMARY KEY("person_id","role")
);
--> statement-breakpoint
CREATE TABLE "app"."persons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_user_id" uuid,
	"persona" "app"."persona" NOT NULL,
	"category" "app"."person_category" NOT NULL,
	"full_name" text NOT NULL,
	"email" "citext",
	"phone" text,
	"qualification_id" uuid,
	"subcontractor_id" uuid,
	"client_id" uuid,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persons_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "persons_email_unique" UNIQUE("email"),
	CONSTRAINT "persons_subcontractor_consistent" CHECK (("app"."persons"."persona" = 'subcontractor') = ("app"."persons"."subcontractor_id" is not null)),
	CONSTRAINT "persons_client_consistent" CHECK (("app"."persons"."persona" = 'client') = ("app"."persons"."client_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."qualifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualifications_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "app"."rate_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"qualification_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"hourly_salary" numeric(14, 2) NOT NULL,
	"tax_coefficient" numeric(6, 4) NOT NULL,
	"unproductivity_coefficient" numeric(6, 4) NOT NULL,
	"hourly_cost" numeric(14, 2) GENERATED ALWAYS AS (round(hourly_salary * (1 + tax_coefficient) * (1 + unproductivity_coefficient), 2)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_cards_valid_range" CHECK ("app"."rate_cards"."valid_to" is null or "app"."rate_cards"."valid_to" > "app"."rate_cards"."valid_from"),
	CONSTRAINT "rate_cards_salary_positive" CHECK ("app"."rate_cards"."hourly_salary" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."subcontractors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cui" text,
	"address" jsonb,
	"specialties" text[],
	"warranty_retention_pct" numeric(6, 4),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cui" text,
	"address" jsonb,
	"default_lead_time_days" smallint,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."team_members" (
	"team_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "team_members_team_id_person_id_valid_from_pk" PRIMARY KEY("team_id","person_id","valid_from"),
	CONSTRAINT "team_members_valid_range" CHECK ("app"."team_members"."valid_to" is null or "app"."team_members"."valid_to" > "app"."team_members"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "app"."teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lead_person_id" uuid,
	"location_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."companies" ADD COLUMN "reg_com" text;--> statement-breakpoint
ALTER TABLE "app"."companies" ADD COLUMN "address" jsonb;--> statement-breakpoint
ALTER TABLE "app"."companies" ADD COLUMN "logo_node_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."companies" ADD COLUMN "is_group_member" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."companies" ADD COLUMN "efactura_config" jsonb;--> statement-breakpoint
ALTER TABLE "app"."companies" ADD COLUMN "default_indexation_pct" numeric(6, 4) DEFAULT '0.0500' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."companies" ADD COLUMN "default_delta_threshold" numeric(14, 2) DEFAULT '2000.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."clients" ADD CONSTRAINT "clients_intercompany_company_id_companies_id_fk" FOREIGN KEY ("intercompany_company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."person_authorizations" ADD CONSTRAINT "person_authorizations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."person_company_access" ADD CONSTRAINT "person_company_access_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."person_company_access" ADD CONSTRAINT "person_company_access_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."person_office_roles" ADD CONSTRAINT "person_office_roles_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."persons" ADD CONSTRAINT "persons_qualification_id_qualifications_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "app"."qualifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."persons" ADD CONSTRAINT "persons_subcontractor_id_subcontractors_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "app"."subcontractors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."persons" ADD CONSTRAINT "persons_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "app"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."rate_cards" ADD CONSTRAINT "rate_cards_qualification_id_qualifications_id_fk" FOREIGN KEY ("qualification_id") REFERENCES "app"."qualifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "app"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."team_members" ADD CONSTRAINT "team_members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "app"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."teams" ADD CONSTRAINT "teams_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."teams" ADD CONSTRAINT "teams_lead_person_id_persons_id_fk" FOREIGN KEY ("lead_person_id") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_authorizations_person_expires_idx" ON "app"."person_authorizations" USING btree ("person_id","expires_at");--> statement-breakpoint

-- ── Ce nu poate drizzle sa exprime ──────────────────────────────────────────

-- Tarifele sunt istoricizate, deci doua intervale nu au voie sa se suprapuna pe
-- aceeasi calificare. Fara asta, "care era tariful de electrician in martie?"
-- ar putea avea doua raspunsuri, iar pontajele lunii ar fi nereproductibile.
-- `valid_to` null inseamna interval deschis la dreapta, deci tariful curent.
alter table app.rate_cards
  add constraint rate_cards_no_overlap
  exclude using gist (
    qualification_id with =,
    daterange(valid_from, valid_to, '[)') with &&
  );
--> statement-breakpoint

-- ── SSM: autorizatia expirata blocheaza, nu avertizeaza ─────────────────────

/*
 * Verifica daca o persoana are toate autorizatiile cerute, valabile la o data.
 * Ridica AUTHORIZATION_EXPIRED daca lipseste macar una.
 *
 * `security definer` e obligatoriu: verificarea trebuie sa vada TOATE
 * autorizatiile persoanei, nu doar pe cele pe care apelantul are voie sa le
 * citeasca prin RLS. Altfel un rol cu vizibilitate partiala ar primi "lipseste
 * autorizatia" pentru una care exista — sau, mai rau, invers, daca politica se
 * schimba. `search_path` e fixat, ca functia sa nu poata fi deturnata.
 */
create function app.assert_authorizations_valid(
  p_person_id uuid,
  p_kinds     text[],
  p_on_date   date
) returns void
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $$
declare
  v_missing text[];
begin
  if p_kinds is null or cardinality(p_kinds) = 0 then
    return;
  end if;

  select array_agg(k order by k)
    into v_missing
    from unnest(p_kinds) as k
   where not exists (
     select 1
       from app.person_authorizations a
      where a.person_id  = p_person_id
        and a.kind       = k
        and a.issued_at <= p_on_date
        and (a.expires_at is null or a.expires_at >= p_on_date)
   );

  if v_missing is not null then
    raise exception
      'AUTHORIZATION_EXPIRED: persoana % nu are valabile la % autorizatiile: %',
      p_person_id, p_on_date, array_to_string(v_missing, ', ')
      using errcode = 'P0001';
  end if;
end
$$;
--> statement-breakpoint

/*
 * Ambalajul de trigger. Se ataseaza in pasul 05, pe `work_unit_assignments`:
 *
 *   create trigger assignments_require_authorizations
 *     before insert or update on app.work_unit_assignments
 *     for each row execute function
 *       app.guard_person_authorizations('person_id', 'starts_on', 'ssm,inaltime');
 *
 * Argumentele sunt: coloana cu persoana, coloana cu data, lista de tipuri
 * cerute separate prin virgula. Generic, ca sa nu presupunem acum forma unei
 * tabele care nu exista inca.
 */
create function app.guard_person_authorizations() returns trigger
  language plpgsql
as $$
declare
  v_row jsonb := to_jsonb(new);
begin
  perform app.assert_authorizations_valid(
    (v_row ->> tg_argv[0])::uuid,
    string_to_array(tg_argv[2], ','),
    (v_row ->> tg_argv[1])::date
  );
  return new;
end
$$;
--> statement-breakpoint

-- ── Grant-uri provizorii ────────────────────────────────────────────────────
-- Minimul cat sa fie tabelele utilizabile. Politicile RLS si REVOKE-urile pe
-- coloanele de pret vin imediat, in migrarile 0008 si 0009, si strang aici.

grant select on
  app.clients, app.subcontractors, app.suppliers, app.qualifications,
  app.persons, app.person_company_access, app.person_office_roles,
  app.teams, app.team_members, app.person_authorizations
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

-- `rate_cards` NU intra in lista de mai sus: poarta salariu si cost orar, adica
-- exact ce nu au voie sa vada terenul si portalurile.
grant select on app.rate_cards to app_office, app_service;
--> statement-breakpoint

grant insert, update, delete on
  app.clients, app.subcontractors, app.suppliers, app.qualifications,
  app.rate_cards, app.persons, app.person_company_access,
  app.person_office_roles, app.teams, app.team_members,
  app.person_authorizations
  to app_office, app_service;
