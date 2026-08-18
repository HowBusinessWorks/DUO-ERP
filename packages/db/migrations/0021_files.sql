DROP TYPE "app"."node_role";
--> statement-breakpoint
CREATE TYPE "app"."node_role" AS ENUM('root_company', 'contracts_root', 'contract', 'contract_docs', 'objectives_root', 'objective', 'objective_tech_docs', 'objective_photos', 'activity_root', 'month', 'work_unit', 'sheet', 'photos', 'photo_phase', 'consumption_notes', 'estimate', 'offers', 'permits', 'invoices', 'pv', 'video', 'receptions', 'user');
--> statement-breakpoint
CREATE TYPE "app"."share_subject_type" AS ENUM('person', 'subcontractor');
--> statement-breakpoint
CREATE TABLE "app"."derived_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_version_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"blob_key" text NOT NULL,
	"width" integer,
	"height" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "derived_assets_version_variant_unique" UNIQUE("file_version_id","variant"),
	CONSTRAINT "derived_assets_status_valid" CHECK ("app"."derived_assets"."status" in ('pending', 'ready', 'failed')),
	CONSTRAINT "derived_assets_variant_shape" CHECK ("app"."derived_assets"."variant" ~ '^[a-z0-9_-]{1,32}$')
);
--> statement-breakpoint
CREATE TABLE "app"."file_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"node_id" uuid NOT NULL,
	"blob_key" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text NOT NULL,
	"checksum_sha256" "bytea",
	"state" "app"."file_state" DEFAULT 'uploading' NOT NULL,
	"upload_id" text,
	"captured_at" timestamp with time zone,
	"geo_lat" numeric(10, 7),
	"geo_lng" numeric(10, 7),
	"geo_accuracy" numeric(10, 2),
	"geo_source" "app"."geo_source",
	"exif" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_versions_blob_key_unique" UNIQUE("blob_key"),
	CONSTRAINT "file_versions_size_non_negative" CHECK ("app"."file_versions"."size" >= 0),
	CONSTRAINT "file_versions_lat_range" CHECK ("app"."file_versions"."geo_lat" is null or "app"."file_versions"."geo_lat" between -90 and 90),
	CONSTRAINT "file_versions_lng_range" CHECK ("app"."file_versions"."geo_lng" is null or "app"."file_versions"."geo_lng" between -180 and 180),
	CONSTRAINT "file_versions_geo_pair" CHECK (num_nonnulls("app"."file_versions"."geo_lat", "app"."file_versions"."geo_lng") <> 1),
	CONSTRAINT "file_versions_geo_has_source" CHECK ("app"."file_versions"."geo_lat" is null or "app"."file_versions"."geo_source" is not null),
	CONSTRAINT "file_versions_checksum_length" CHECK ("app"."file_versions"."checksum_sha256" is null or length("app"."file_versions"."checksum_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "app"."node_shares" (
	"node_id" uuid NOT NULL,
	"subject_type" "app"."share_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"permission" "app"."share_permission" DEFAULT 'read' NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_shares_node_id_subject_type_subject_id_pk" PRIMARY KEY("node_id","subject_type","subject_id")
);
--> statement-breakpoint
CREATE TABLE "app"."nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"company_id" uuid NOT NULL,
	"kind" "app"."node_kind" NOT NULL,
	"name" text NOT NULL,
	"contract_id" uuid,
	"objective_id" uuid,
	"work_unit_id" uuid,
	"stage_id" uuid,
	"node_role" "app"."node_role" DEFAULT 'user' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"current_version_id" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_name_not_blank" CHECK (length(btrim("app"."nodes"."name")) > 0),
	CONSTRAINT "nodes_name_no_slash" CHECK ("app"."nodes"."name" !~ '[/\\]'),
	CONSTRAINT "nodes_not_own_parent" CHECK ("app"."nodes"."parent_id" is distinct from "app"."nodes"."id"),
	CONSTRAINT "nodes_version_only_on_files" CHECK ("app"."nodes"."kind" = 'file' or "app"."nodes"."current_version_id" is null),
	CONSTRAINT "nodes_system_has_role" CHECK ("app"."nodes"."is_system" = ("app"."nodes"."node_role" <> 'user')),
	CONSTRAINT "nodes_deleted_pair" CHECK (num_nonnulls("app"."nodes"."deleted_at", "app"."nodes"."deleted_by") <> 1)
);
--> statement-breakpoint
ALTER TABLE "app"."contract_objectives" ADD COLUMN "root_node_id" uuid;
--> statement-breakpoint
ALTER TABLE "app"."derived_assets" ADD CONSTRAINT "derived_assets_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "app"."file_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."file_versions" ADD CONSTRAINT "file_versions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "app"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."file_versions" ADD CONSTRAINT "file_versions_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."node_shares" ADD CONSTRAINT "node_shares_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "app"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."node_shares" ADD CONSTRAINT "node_shares_granted_by_persons_id_fk" FOREIGN KEY ("granted_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."nodes" ADD CONSTRAINT "nodes_parent_id_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."nodes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."nodes" ADD CONSTRAINT "nodes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "app"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."nodes" ADD CONSTRAINT "nodes_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "app"."contracts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."nodes" ADD CONSTRAINT "nodes_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "app"."objectives"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."nodes" ADD CONSTRAINT "nodes_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "app"."work_units"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."nodes" ADD CONSTRAINT "nodes_stage_id_work_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "app"."work_stages"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."nodes" ADD CONSTRAINT "nodes_deleted_by_persons_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "app"."nodes" ADD CONSTRAINT "nodes_created_by_persons_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."persons"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "file_versions_node_idx" ON "app"."file_versions" USING btree ("node_id",created_at desc);
--> statement-breakpoint
CREATE INDEX "file_versions_geo_idx" ON "app"."file_versions" USING btree ("captured_at") WHERE geo_lat is not null;
--> statement-breakpoint
CREATE INDEX "file_versions_state_idx" ON "app"."file_versions" USING btree ("state") WHERE state = 'uploading';
--> statement-breakpoint
CREATE INDEX "node_shares_subject_idx" ON "app"."node_shares" USING btree ("subject_type","subject_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_parent_name_unique" ON "app"."nodes" USING btree ("company_id","parent_id","name") WHERE deleted_at is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_root_unique" ON "app"."nodes" USING btree ("company_id") WHERE node_role = 'root_company' and deleted_at is null;
--> statement-breakpoint
CREATE INDEX "nodes_parent_idx" ON "app"."nodes" USING btree ("parent_id") WHERE deleted_at is null;
--> statement-breakpoint
CREATE INDEX "nodes_work_unit_idx" ON "app"."nodes" USING btree ("work_unit_id") WHERE deleted_at is null;
--> statement-breakpoint
CREATE INDEX "nodes_contract_idx" ON "app"."nodes" USING btree ("contract_id") WHERE deleted_at is null;
--> statement-breakpoint
CREATE INDEX "nodes_objective_idx" ON "app"."nodes" USING btree ("objective_id") WHERE deleted_at is null;
--> statement-breakpoint
CREATE INDEX "nodes_role_idx" ON "app"."nodes" USING btree ("node_role","work_unit_id") WHERE is_system and deleted_at is null;
--> statement-breakpoint
CREATE INDEX "nodes_deleted_idx" ON "app"."nodes" USING btree ("company_id","deleted_at") WHERE deleted_at is not null;
--> statement-breakpoint
ALTER TABLE "app"."objectives" DROP COLUMN "root_node_id";
--> statement-breakpoint

/* ═══════════════════════════════════════════════════════════════════════════
 * Partea scrisa de mana: ce nu exprima drizzle.
 * ═══════════════════════════════════════════════════════════════════════════ */

-- ── FK-urile care inchid ciclul ─────────────────────────────────────────────
-- Declarate aici, nu in schema TS: `work_units` si `contract_objectives` sunt
-- referite de `app.nodes`, iar `app.nodes` e referit inapoi de ele. In TypeScript
-- asta ar fi un ciclu de import intre fisierele de schema; in SQL e doar o
-- constrangere adaugata dupa ce ambele tabele exista.

alter table app.work_units
  add constraint work_units_root_node_id_nodes_id_fk
  foreign key (root_node_id) references app.nodes(id);
--> statement-breakpoint

alter table app.contract_objectives
  add constraint contract_objectives_root_node_id_nodes_id_fk
  foreign key (root_node_id) references app.nodes(id);
--> statement-breakpoint

alter table app.companies
  add constraint companies_logo_node_id_nodes_id_fk
  foreign key (logo_node_id) references app.nodes(id);
--> statement-breakpoint

alter table app.nodes
  add constraint nodes_current_version_id_file_versions_id_fk
  foreign key (current_version_id) references app.file_versions(id);
--> statement-breakpoint

-- ═══ Constructia arborelui ═════════════════════════════════════════════════
--
-- Totul trece prin `app.ensure_folder`, si totul e IDEMPOTENT: apelat de doua
-- ori pe acelasi parinte cu acelasi rol, intoarce acelasi nod. Proprietatea asta
-- e ce face ca backfill-ul de la finalul migrarii sa fie exact acelasi cod ca
-- triggerele — nu o a doua implementare care se poate abate de la prima.

create or replace function app.ensure_folder(
  p_company    uuid,
  p_parent     uuid,
  p_name       text,
  p_role       app.node_role,
  p_contract   uuid default null,
  p_objective  uuid default null,
  p_work_unit  uuid default null,
  p_stage      uuid default null
) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  v_id       uuid;
  v_parent   app.nodes%rowtype;
begin
  if p_company is null or p_name is null or btrim(p_name) = '' then
    raise exception 'ensure_folder: firma si numele sunt obligatorii.';
  end if;

  /*
   * Cautarea se face pe ROL, nu pe nume — regula din Anexa E.3. Daca cineva a
   * redenumit „PV" in „Procese verbale" (nu poate din interfata, dar poate un
   * script), folderul tot se gaseste si nu se creeaza un al doilea.
   *
   * Exceptie: rolurile care se repeta sub acelasi parinte — folderul de luna si
   * cel de faza foto. Acolo numele ESTE identitatea.
   */
  if p_role in ('month', 'photo_phase', 'user') then
    select n.id into v_id
      from app.nodes n
     where n.company_id = p_company
       and n.parent_id is not distinct from p_parent
       and n.name = p_name
       and n.deleted_at is null;
  else
    select n.id into v_id
      from app.nodes n
     where n.company_id = p_company
       and n.parent_id is not distinct from p_parent
       and n.node_role = p_role
       and n.work_unit_id is not distinct from p_work_unit
       and n.stage_id is not distinct from p_stage
       and n.deleted_at is null;
  end if;

  if v_id is not null then
    return v_id;
  end if;

  if p_parent is not null then
    select * into v_parent from app.nodes where id = p_parent;
  end if;

  -- Analitica se mosteneste din parinte, iar argumentele explicite o ingusteaza.
  -- Asa, un subfolder facut de utilizator sub `L-233/Poze` stie singur ca e al
  -- lucrarii, si verificarea de drepturi ramane o comparatie, nu o recursie.
  insert into app.nodes (
    id, parent_id, company_id, kind, name, node_role, is_system,
    contract_id, objective_id, work_unit_id, stage_id, created_by
  )
  values (
    gen_random_uuid(), p_parent, p_company, 'folder', p_name, p_role, p_role <> 'user',
    coalesce(p_contract,  v_parent.contract_id),
    coalesce(p_objective, v_parent.objective_id),
    coalesce(p_work_unit, v_parent.work_unit_id),
    coalesce(p_stage,     v_parent.stage_id),
    /*
     * Folderele generate n-au autor, si `created_by` ramane null dinadins.
     * Doua motive, in ordinea importantei: nu e adevarat ca le-a facut cine a
     * apasat „salveaza" pe contract, si nu vrem ca generarea arborelui sa cada
     * cand actorul curent n-are rand in `app.persons` — un job, un import sau un
     * test. Nodurile create de om vin pe alt drum si isi poarta autorul.
     */
    null
  )
  returning id into v_id;

  return v_id;
end
$$;
--> statement-breakpoint

revoke execute on function app.ensure_folder(uuid, uuid, text, app.node_role, uuid, uuid, uuid, uuid) from public;
--> statement-breakpoint
grant execute on function app.ensure_folder(uuid, uuid, text, app.node_role, uuid, uuid, uuid, uuid) to app_service;
--> statement-breakpoint

/* Redenumirea unui folder de sistem cand se schimba eticheta entitatii. */
create or replace function app.rename_system_folder(p_node uuid, p_name text) returns void
  language sql
  volatile
  security definer
  set search_path = pg_catalog
as $$
  update app.nodes set name = p_name
   where id = p_node and name <> p_name and deleted_at is null
$$;
--> statement-breakpoint

revoke execute on function app.rename_system_folder(uuid, text) from public;
--> statement-breakpoint

-- ── Radacina de firma ──────────────────────────────────────────────────────

create or replace function app.build_company_tree(p_company uuid) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  v_root uuid;
  v_name text;
begin
  select name into v_name from app.companies where id = p_company;
  if v_name is null then
    return null;
  end if;

  v_root := app.ensure_folder(p_company, null, v_name, 'root_company');
  perform app.ensure_folder(p_company, v_root, 'Contracte', 'contracts_root');
  /*
   * „Activitate" la nivel de firma e plasa de siguranta pentru unitatile fara
   * contract: o inspectie poate exista inaintea deciziei de rutare (pasul 08),
   * si trebuie sa aiba unde sa-si tina pozele pana atunci. Cand primeste
   * contract, folderul ei se MUTA — un singur `update parent_id`.
   */
  perform app.ensure_folder(p_company, v_root, 'Activitate', 'activity_root');
  return v_root;
end
$$;
--> statement-breakpoint

create or replace function app.company_tree_trigger() returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    perform app.build_company_tree(new.id);
  else
    perform app.rename_system_folder(
      (select id from app.nodes
        where company_id = new.id and node_role = 'root_company' and deleted_at is null),
      new.name
    );
  end if;
  return null;
end
$$;
--> statement-breakpoint

create trigger companies_build_tree
  after insert on app.companies
  for each row execute function app.company_tree_trigger();
--> statement-breakpoint

create trigger companies_rename_tree
  after update of name on app.companies
  for each row when (old.name is distinct from new.name)
  execute function app.company_tree_trigger();
--> statement-breakpoint

-- ── Contract ───────────────────────────────────────────────────────────────

/*
 * Eticheta folderului de contract: „4700 · Apa Nova".
 *
 * A doua jumatate e numele CLIENTULUI — `app.contracts` n-are coloana `name`,
 * si nici n-are de ce sa aiba: contractul se numeste in vorbire dupa cod, iar
 * omul care rasfoieste arborele cauta clientul.
 */
create or replace function app.contract_folder_name(p_contract uuid) returns text
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select c.code || ' · ' || cl.name
    from app.contracts c join app.clients cl on cl.id = c.client_id
   where c.id = p_contract
$$;
--> statement-breakpoint

create or replace function app.build_contract_tree(p_contract uuid) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  c        app.contracts%rowtype;
  v_root   uuid;
  v_parent uuid;
begin
  select * into c from app.contracts where id = p_contract;
  if not found then
    return null;
  end if;

  perform app.build_company_tree(c.company_id);
  select id into v_parent from app.nodes
   where company_id = c.company_id and node_role = 'contracts_root' and deleted_at is null;

  v_root := app.ensure_folder(
    c.company_id, v_parent, app.contract_folder_name(p_contract), 'contract', p_contract
  );

  perform app.ensure_folder(c.company_id, v_root, 'Contract și acte adiționale', 'contract_docs', p_contract);
  perform app.ensure_folder(c.company_id, v_root, 'Obiective', 'objectives_root', p_contract);
  perform app.ensure_folder(c.company_id, v_root, 'Activitate', 'activity_root', p_contract);
  return v_root;
end
$$;
--> statement-breakpoint

create or replace function app.contract_tree_trigger() returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    perform app.build_contract_tree(new.id);
  else
    perform app.rename_system_folder(
      (select id from app.nodes
        where contract_id = new.id and node_role = 'contract' and deleted_at is null),
      app.contract_folder_name(new.id)
    );
  end if;
  return null;
end
$$;
--> statement-breakpoint

create trigger contracts_build_tree
  after insert on app.contracts
  for each row execute function app.contract_tree_trigger();
--> statement-breakpoint

create trigger contracts_rename_tree
  after update of code, client_id on app.contracts
  for each row when (old.code is distinct from new.code or old.client_id is distinct from new.client_id)
  execute function app.contract_tree_trigger();
--> statement-breakpoint

-- ── Obiectiv, in arborele contractului ─────────────────────────────────────
--
-- Folderul obiectivului sta pe LEGATURA, nu pe obiectiv: acelasi bazin poate fi
-- pe doua contracte, si fiecare contract isi are propriul „Obiective/<nume>".
-- De aceea `root_node_id` a fost mutat la 07a de pe `objectives` pe
-- `contract_objectives` — pe obiectiv ar fi trebuit sa aleaga arbitrar unul.

create or replace function app.build_contract_objective_tree(p_link uuid) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  l        app.contract_objectives%rowtype;
  c        app.contracts%rowtype;
  v_name   text;
  v_parent uuid;
  v_root   uuid;
begin
  select * into l from app.contract_objectives where id = p_link;
  if not found then
    return null;
  end if;

  select * into c from app.contracts where id = l.contract_id;
  select o.name into v_name from app.objectives o where o.id = l.objective_id;

  perform app.build_contract_tree(l.contract_id);
  select id into v_parent from app.nodes
   where contract_id = l.contract_id and node_role = 'objectives_root' and deleted_at is null;

  v_root := app.ensure_folder(
    c.company_id, v_parent, v_name, 'objective', l.contract_id, l.objective_id
  );
  perform app.ensure_folder(c.company_id, v_root, 'Documentație tehnică', 'objective_tech_docs',
                            l.contract_id, l.objective_id);
  perform app.ensure_folder(c.company_id, v_root, 'Poze obiectiv', 'objective_photos',
                            l.contract_id, l.objective_id);

  update app.contract_objectives set root_node_id = v_root
   where id = p_link and root_node_id is distinct from v_root;
  return v_root;
end
$$;
--> statement-breakpoint

create or replace function app.contract_objective_tree_trigger() returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
begin
  perform app.build_contract_objective_tree(new.id);
  return null;
end
$$;
--> statement-breakpoint

create trigger contract_objectives_build_tree
  after insert on app.contract_objectives
  for each row execute function app.contract_objective_tree_trigger();
--> statement-breakpoint

-- ── Unitatea de lucru ──────────────────────────────────────────────────────

/*
 * Subfolderele depind de tip, si sunt CUMULATIVE: promovarea unei interventii in
 * lucrare adauga, nu muta si nu copiaza. Folderul ramane acelasi nod, deci
 * pozele facute cand era interventie raman exact unde erau — verificarea #3.
 */
create or replace function app.build_work_unit_folders(p_work_unit uuid) returns void
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  wu       app.work_units%rowtype;
  v_root   uuid;
  v_photos uuid;
begin
  select * into wu from app.work_units where id = p_work_unit;
  v_root := wu.root_node_id;
  if v_root is null then
    return;
  end if;

  perform app.ensure_folder(wu.company_id, v_root, 'Fișă', 'sheet', null, null, p_work_unit);
  v_photos := app.ensure_folder(wu.company_id, v_root, 'Poze', 'photos', null, null, p_work_unit);

  if wu.type in ('interventie', 'lucrare') then
    perform app.ensure_folder(wu.company_id, v_root, 'Bonuri de consum', 'consumption_notes',
                              null, null, p_work_unit);
  end if;

  if wu.type = 'lucrare' then
    perform app.ensure_folder(wu.company_id, v_root, 'Deviz', 'estimate', null, null, p_work_unit);
    perform app.ensure_folder(wu.company_id, v_root, 'Oferte', 'offers', null, null, p_work_unit);
    perform app.ensure_folder(wu.company_id, v_root, 'Avize', 'permits', null, null, p_work_unit);
    perform app.ensure_folder(wu.company_id, v_root, 'Facturi', 'invoices', null, null, p_work_unit);
    perform app.ensure_folder(wu.company_id, v_root, 'PV', 'pv', null, null, p_work_unit);
    perform app.ensure_folder(wu.company_id, v_root, 'Video', 'video', null, null, p_work_unit);
    perform app.ensure_folder(wu.company_id, v_root, 'Recepții', 'receptions', null, null, p_work_unit);
    -- Fazele fixe ale unei lucrari. „Etapa N" se adauga la crearea etapei.
    perform app.ensure_folder(wu.company_id, v_photos, 'Înainte', 'photo_phase', null, null, p_work_unit);
    perform app.ensure_folder(wu.company_id, v_photos, 'După', 'photo_phase', null, null, p_work_unit);
  end if;
end
$$;
--> statement-breakpoint

/* Unde sta folderul unitatii: „Activitate/2026-08" al contractului, daca are. */
create or replace function app.work_unit_month_folder(p_work_unit uuid) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  wu         app.work_units%rowtype;
  v_contract uuid;
  v_activity uuid;
begin
  select * into wu from app.work_units where id = p_work_unit;

  select co.contract_id into v_contract
    from app.contract_objectives co where co.id = wu.contract_objective_id;

  if v_contract is not null then
    perform app.build_contract_tree(v_contract);
    select id into v_activity from app.nodes
     where contract_id = v_contract and node_role = 'activity_root' and deleted_at is null;
  else
    perform app.build_company_tree(wu.company_id);
    select id into v_activity from app.nodes
     where company_id = wu.company_id and node_role = 'activity_root'
       and contract_id is null and deleted_at is null;
  end if;

  return app.ensure_folder(
    wu.company_id, v_activity,
    to_char(coalesce(wu.starts_on, wu.created_at::date), 'YYYY-MM'), 'month', v_contract
  );
end
$$;
--> statement-breakpoint

create or replace function app.build_work_unit_tree(p_work_unit uuid) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  wu     app.work_units%rowtype;
  v_month uuid;
  v_root  uuid;
begin
  select * into wu from app.work_units where id = p_work_unit;
  if not found then
    return null;
  end if;

  v_month := app.work_unit_month_folder(p_work_unit);
  v_root := app.ensure_folder(
    wu.company_id, v_month, wu.code || ' ' || wu.name, 'work_unit',
    null, wu.objective_id, p_work_unit
  );

  if wu.root_node_id is distinct from v_root then
    update app.work_units set root_node_id = v_root where id = p_work_unit;
  end if;

  perform app.build_work_unit_folders(p_work_unit);
  return v_root;
end
$$;
--> statement-breakpoint

create or replace function app.work_unit_tree_trigger() returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  v_month uuid;
begin
  if tg_op = 'INSERT' then
    perform app.build_work_unit_tree(new.id);
    return null;
  end if;

  if old.contract_objective_id is distinct from new.contract_objective_id then
    /*
     * Rutarea unei unitati pe alt contract ii MUTA folderul. E o schimbare de
     * analitica „folosit" — unde se executa — si de aceea are voie sa atinga
     * arborele. Mutarea finantarii, care e analitica „descarcat", NU are:
     * regula 8 din pas, si nu exista niciun trigger pe `funding_allocations`.
     *
     * Costul mutarii e un singur `update parent_id`, oricat de multe fisiere ar
     * fi dedesubt. Asta e toata justificarea separarii arbore/blob.
     */
    v_month := app.work_unit_month_folder(new.id);
    update app.nodes
       set parent_id = v_month,
           contract_id = (select co.contract_id from app.contract_objectives co
                           where co.id = new.contract_objective_id)
     where id = new.root_node_id;
  end if;

  if old.code is distinct from new.code or old.name is distinct from new.name then
    perform app.rename_system_folder(new.root_node_id, new.code || ' ' || new.name);
  end if;

  if old.type is distinct from new.type then
    perform app.build_work_unit_folders(new.id);
  end if;

  return null;
end
$$;
--> statement-breakpoint

create trigger work_units_build_tree
  after insert on app.work_units
  for each row execute function app.work_unit_tree_trigger();
--> statement-breakpoint

create trigger work_units_sync_tree
  after update of type, code, name, contract_objective_id on app.work_units
  for each row execute function app.work_unit_tree_trigger();
--> statement-breakpoint

-- ── Etapa ──────────────────────────────────────────────────────────────────

create or replace function app.build_work_stage_tree(p_stage uuid) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  st       app.work_stages%rowtype;
  wu       app.work_units%rowtype;
  v_photos uuid;
begin
  select * into st from app.work_stages where id = p_stage;
  if not found then
    return null;
  end if;
  select * into wu from app.work_units where id = st.work_unit_id;

  select id into v_photos from app.nodes
   where work_unit_id = st.work_unit_id and node_role = 'photos' and deleted_at is null;
  if v_photos is null then
    return null;
  end if;

  return app.ensure_folder(
    wu.company_id, v_photos, 'Etapa ' || st.position, 'photo_phase',
    null, null, st.work_unit_id, p_stage
  );
end
$$;
--> statement-breakpoint

create or replace function app.work_stage_tree_trigger() returns trigger
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    perform app.build_work_stage_tree(new.id);
  else
    perform app.rename_system_folder(
      (select id from app.nodes
        where stage_id = new.id and node_role = 'photo_phase' and deleted_at is null),
      'Etapa ' || new.position
    );
  end if;
  return null;
end
$$;
--> statement-breakpoint

create trigger work_stages_build_tree
  after insert on app.work_stages
  for each row execute function app.work_stage_tree_trigger();
--> statement-breakpoint

create trigger work_stages_rename_tree
  after update of position on app.work_stages
  for each row when (old.position is distinct from new.position)
  execute function app.work_stage_tree_trigger();
--> statement-breakpoint

-- ═══ Nodurile de sistem nu se ating ════════════════════════════════════════
--
-- Regula 7 din pas. Fara ea, structura implicita se erodeaza in trei luni si
-- rapoartele care cauta „folderul PV al lucrarii" nu mai gasesc nimic. Guard-ul
-- sta in baza, nu in interfata, pentru ca interfata e doar una din caile de
-- acces si nu e cea prin care se strica lucrurile.

create or replace function app.guard_node_system() returns trigger
  language plpgsql
  volatile
  set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'Folderul „%" e generat automat si nu se poate sterge.', old.name
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.is_system and not app.is_definer() then
    if new.name is distinct from old.name then
      raise exception 'Folderul „%" e generat automat si nu se poate redenumi.', old.name
        using errcode = 'restrict_violation';
    end if;
    if new.parent_id is distinct from old.parent_id then
      raise exception 'Folderul „%" e generat automat si nu se poate muta.', old.name
        using errcode = 'restrict_violation';
    end if;
    if new.deleted_at is not null and old.deleted_at is null then
      raise exception 'Folderul „%" e generat automat si nu se poate sterge.', old.name
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- Rolul si apartenenta la firma nu se schimba niciodata, pentru nimeni: un nod
  -- care isi schimba `company_id` iese din raza politicilor fara sa lase urma.
  if new.company_id is distinct from old.company_id or new.node_role is distinct from old.node_role then
    raise exception 'Firma si rolul unui nod nu se pot schimba.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end
$$;
--> statement-breakpoint

create trigger nodes_guard_system
  before update or delete on app.nodes
  for each row execute function app.guard_node_system();
--> statement-breakpoint

/* Un nod nu poate ajunge propriul stramos: „muta A in B" cu B sub A. */
create or replace function app.guard_node_cycle() returns trigger
  language plpgsql
  volatile
  set search_path = pg_catalog
as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  if exists (
    with recursive up as (
      select n.id, n.parent_id from app.nodes n where n.id = new.parent_id
      union all
      select p.id, p.parent_id from app.nodes p join up on p.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'Mutarea ar face folderul propriul lui parinte.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;
--> statement-breakpoint

create trigger nodes_guard_cycle
  before update of parent_id on app.nodes
  for each row when (new.parent_id is distinct from old.parent_id)
  execute function app.guard_node_cycle();
--> statement-breakpoint

-- ═══ Drepturi pe arbore ════════════════════════════════════════════════════

create or replace function app.share_rank(p_permission app.share_permission) returns integer
  language sql
  immutable
as $$
  select case p_permission when 'read' then 1 when 'write' then 2 when 'manage' then 3 end
$$;
--> statement-breakpoint

/*
 * Cat mi s-a partajat pe nodul asta sau pe oricare stramos al lui.
 *
 * Recursia urca, nu coboara: o partajare pusa pe un folder se vede pe tot ce e
 * sub el, adica exact „il vede pe el si pe copiii lui" din verificarea #15.
 * Aici e singurul loc unde chiar e nevoie de CTE recursiv — pentru birou si
 * teren, coloanele denormalizate din `app.nodes` fac verificarea o comparatie.
 */
create or replace function app.node_share_rank(p_node uuid) returns integer
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  with recursive up as (
    select n.id, n.parent_id from app.nodes n where n.id = p_node and n.deleted_at is null
    union all
    select p.id, p.parent_id from app.nodes p join up on p.id = up.parent_id where p.deleted_at is null
  )
  select coalesce(max(app.share_rank(s.permission)), 0)
    from app.node_shares s
    join up on up.id = s.node_id
   where (s.subject_type = 'person' and s.subject_id = app.current_person_id())
      or (s.subject_type = 'subcontractor' and s.subject_id = app.current_subcontractor_id())
$$;
--> statement-breakpoint

/*
 * Poarta unica ceruta de §3.5: trei surse de acces, in ordinea in care se
 * verifica ieftin.
 *
 *   - **birou** — prin apartenenta nodului la una din firmele mele;
 *   - **teren** — prin asignarea pe unitatea de lucru;
 *   - **subcontractant** — DOAR prin partajare explicita. Nu mosteneste nimic de
 *     la contract sau de la lucrare, si nu exista nicio politica prin care ar
 *     putea. Asta E izolarea A-vs-B.
 */
create or replace function app.can_access_node(
  p_node uuid,
  p_permission app.share_permission default 'read'
) returns boolean
  language sql
  stable
  security definer
  set search_path = pg_catalog
as $$
  select exists (
    select 1 from app.nodes n
     where n.id = p_node
       and n.deleted_at is null
       and (
         n.company_id = any(app.current_company_ids())
         or (
           -- Terenul urca pana la scriere, dar nu administreaza partajari.
           app.share_rank(p_permission) <= 2
           and n.work_unit_id is not null
           and app.work_unit_assigned_to_me(n.work_unit_id)
         )
         or app.share_rank(p_permission) <= app.node_share_rank(n.id)
       )
  )
$$;
--> statement-breakpoint

grant execute on function
  app.can_access_node(uuid, app.share_permission),
  app.node_share_rank(uuid),
  app.share_rank(app.share_permission)
  to app_office, app_field, app_subcontractor, app_client, app_service;
--> statement-breakpoint

-- ═══ Audit si RLS ══════════════════════════════════════════════════════════

select app.attach_audit('app.nodes');
--> statement-breakpoint
select app.attach_audit('app.node_shares');
--> statement-breakpoint

select app.rls_enable('app.nodes'::regclass);
--> statement-breakpoint
select app.rls_enable('app.file_versions'::regclass);
--> statement-breakpoint
select app.rls_enable('app.derived_assets'::regclass);
--> statement-breakpoint
select app.rls_enable('app.node_shares'::regclass);
--> statement-breakpoint

create policy "office" on app.nodes for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint

-- Terenul vede si scrie in folderele unitatilor lui. Nu vede nimic la nivel de
-- contract, si nu vede unitatile colegilor — verificarea #21.
create policy "assigned" on app.nodes for select to app_field
  using (work_unit_id is not null and app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint
create policy "assigned_write" on app.nodes for insert to app_field
  with check (work_unit_id is not null and app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

create policy "shared" on app.nodes for select to app_subcontractor
  using (app.node_share_rank(id) >= 1);
--> statement-breakpoint
create policy "shared_write" on app.nodes for insert to app_subcontractor
  with check (app.node_share_rank(id) >= 2);
--> statement-breakpoint

create policy "accessible" on app.file_versions for select to app_office, app_field, app_subcontractor
  using (app.can_access_node(node_id));
--> statement-breakpoint
create policy "accessible_write" on app.file_versions for insert to app_office, app_field, app_subcontractor
  with check (app.can_access_node(node_id, 'write'));
--> statement-breakpoint

create policy "accessible" on app.derived_assets for select to app_office, app_field, app_subcontractor
  using (exists (
    select 1 from app.file_versions v
     where v.id = file_version_id and app.can_access_node(v.node_id)
  ));
--> statement-breakpoint

-- Partajarile le administreaza doar biroul. Subcontractantul isi vede propriile
-- randuri, ca sa stie ce i s-a dat — dar nu poate adauga.
create policy "office" on app.node_shares for all to app_office
  using (app.can_access_node(node_id, 'manage'))
  with check (app.can_access_node(node_id, 'manage'));
--> statement-breakpoint
create policy "own" on app.node_shares for select to app_subcontractor
  using (subject_type = 'subcontractor' and subject_id = app.current_subcontractor_id());
--> statement-breakpoint

-- ═══ Grant-uri ═════════════════════════════════════════════════════════════
--
-- `delete` nu se acorda nimanui in afara worker-ului: stergerea din interfata e
-- `deleted_at`, iar randurile pleaca din baza doar prin jobul de curatenie, la
-- 30 de zile dupa golirea cosului. Regula 4 din antetul schemei.

grant select, insert, update on app.nodes to app_office;
--> statement-breakpoint
grant select, insert on app.nodes to app_field, app_subcontractor;
--> statement-breakpoint
grant select, insert, update, delete on app.nodes to app_service;
--> statement-breakpoint

grant select, insert, update on app.file_versions to app_office;
--> statement-breakpoint
grant select, insert on app.file_versions to app_field, app_subcontractor;
--> statement-breakpoint
grant select, insert, update, delete on app.file_versions to app_service;
--> statement-breakpoint

grant select on app.derived_assets to app_office, app_field, app_subcontractor;
--> statement-breakpoint
grant select, insert, update, delete on app.derived_assets to app_service;
--> statement-breakpoint

grant select, insert, update, delete on app.node_shares to app_office;
--> statement-breakpoint
grant select on app.node_shares to app_subcontractor;
--> statement-breakpoint
grant select, insert, update, delete on app.node_shares to app_service;
--> statement-breakpoint


-- ═══ Jurnalul ignora coloanele derivate ════════════════════════════════════
--
-- Inlocuieste versiunea din 0007 cu una singura linie in plus. Vezi comentariul
-- dinauntru: motivul e ca `root_node_id` se scrie din trigger, nu din mana
-- cuiva, si un jurnal in care jumatate din intrari sunt scrise de sistem devine
-- un jurnal pe care nu-l mai citeste nimeni.

create or replace function audit.record_change() returns trigger
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
  v_required boolean := coalesce(tg_argv[0], 'false')::boolean and tg_op <> 'INSERT';
begin
  for v_key in select jsonb_object_keys(v_old || v_new) loop
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changed := v_changed || jsonb_build_object(
        v_key,
        jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key)
      );
    end if;
  end loop;

  /*
   * Coloanele derivate nu sunt evenimente (pasul 07).
   *
   * `root_node_id` e completat de triggerul care construieste arborele de
   * fisiere, in aceeasi tranzactie cu crearea entitatii. Lasat in jurnal, ar
   * face doua rele: ar dubla intrarile de la fiecare unitate de lucru creata, si
   * — pe tabelele cu motiv obligatoriu — ar cere un motiv scris pentru ceva ce
   * n-a facut niciun om. Cine vrea sa stie unde e folderul se uita la coloana,
   * nu la istoricul ei. Scoasa din diferenta INAINTE de verificarea de mai jos,
   * ca un update numai pe ea sa devina exact ce este: un neeveniment.
   */
  v_changed := v_changed - 'root_node_id';

  if tg_op = 'UPDATE' and v_changed = '{}'::jsonb then
    return new;
  end if;

  v_record := coalesce(
    nullif(v_new ->> 'id', ''),
    nullif(v_old ->> 'id', ''),
    md5((case when tg_op = 'DELETE' then v_old else v_new end)::text)
  )::uuid;

  v_claims  := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_persona := nullif(v_claims ->> 'persona', '')::app.persona;
  v_actor   := nullif(current_setting('app.actor_id', true), '')::uuid;
  v_reason  := nullif(btrim(coalesce(current_setting('app.action_reason', true), '')), '');

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

-- ═══ Backfill ══════════════════════════════════════════════════════════════
--
-- Acelasi cod ca triggerele, in ordinea dependentelor. Nu o a doua
-- implementare: `ensure_folder` e idempotenta, deci rularea peste o baza care
-- deja are arborele nu produce nimic.

do $$
declare
  r record;
begin
  for r in select id from app.companies loop
    perform app.build_company_tree(r.id);
  end loop;

  for r in select id from app.contracts loop
    perform app.build_contract_tree(r.id);
  end loop;

  for r in select id from app.contract_objectives loop
    perform app.build_contract_objective_tree(r.id);
  end loop;

  for r in select id from app.work_units order by created_at loop
    perform app.build_work_unit_tree(r.id);
  end loop;

  for r in select id from app.work_stages loop
    perform app.build_work_stage_tree(r.id);
  end loop;
end
$$;
--> statement-breakpoint

/*
 * Plasa: dupa backfill, nicio unitate si nicio legare obiectiv×contract nu are
 * voie sa ramana fara folder. Daca ramane, migrarea cade aici si nu peste trei
 * saptamani, intr-un ecran gol pe care nimeni nu-l leaga de pasul asta.
 */
do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing from app.work_units where root_node_id is null;
  if v_missing > 0 then
    raise exception 'Backfill incomplet: % unitati de lucru fara folder.', v_missing;
  end if;

  select count(*) into v_missing from app.contract_objectives where root_node_id is null;
  if v_missing > 0 then
    raise exception 'Backfill incomplet: % legari obiectiv×contract fara folder.', v_missing;
  end if;
end
$$;
