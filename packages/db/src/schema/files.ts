import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { contracts } from './contracts';
import {
  app,
  fileStateEnum,
  geoSourceEnum,
  nodeKindEnum,
  nodeRoleEnum,
  sharePermissionEnum,
  shareSubjectTypeEnum,
} from './enums';
import { objectives } from './objectives';
import { persons } from './organization';
import { workStages, workUnits } from './work-units';

/**
 * Arborele de fisiere (PLAN_TEHNIC §9, Anexa E).
 *
 * **Ierarhia traieste in Postgres, continutul in R2.** Cheia din R2 e
 * `blobs/{uuid}` si nu contine niciodata calea. Consecinta pentru care e facut
 * asa: mutarea unui folder cu 100.000 de fisiere e un singur `update parent_id`
 * si zero operatii pe R2. Daca ierarhia ar sta in cheie, aceeasi mutare ar
 * insemna 100.000 de copieri urmate de 100.000 de stergeri.
 *
 * Patru reguli care se rateaza cel mai des, si unde se vede fiecare aici:
 *
 *   1. **Arborele se genereaza singur, prin trigger**, la fiecare eveniment de
 *      business — nu din aplicatie. La fel ca `period_id` pe registrul de cost:
 *      daca ar depinde de codul care creeaza entitatea, primul import sau prima
 *      ruta noua l-ar sari, si structura s-ar erodă in trei luni.
 *   2. **Arborele e construit pe analitica „folosit"**, nu pe „descarcat".
 *      Mutarea finantarii nu atinge niciun nod. Daca folderul s-ar muta odata
 *      cu banii, istoricul obiectivului s-ar rupe tacut.
 *   3. **Folderele de sistem nu se sterg, redenumesc sau muta** (`is_system`).
 *      Utilizatorul poate crea foldere proprii oriunde, dar cele generate raman
 *      fixe — altfel rapoartele care cauta „folderul PV al lucrarii" nu mai
 *      gasesc nimic.
 *   4. **Stergerea e `deleted_at`**, instant si pentru un folder cu 3.000 de
 *      poze. Numele redevine liber imediat (unicitatea e partiala), nu la
 *      golirea cosului — altfel utilizatorul nu poate recrea folderul pe care
 *      tocmai l-a sters.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** `bytea` pentru sha256: 32 de octeti, nu 64 de caractere hex. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const nodes = app.table(
  'nodes',
  {
    id: id(),
    /** Null doar pentru radacina firmei. */
    parentId: uuid('parent_id').references((): AnyPgColumn => nodes.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    kind: nodeKindEnum('kind').notNull(),
    name: text('name').notNull(),

    /*
     * Analitica „folosit", denormalizata din parinte printr-un trigger la
     * insert. Nu e redundanta de dragul vitezei: fara ea, fiecare verificare de
     * drepturi pe un subfolder creat de utilizator ar trebui sa urce recursiv
     * pana gaseste unitatea de lucru. Asa, `can_access_node` e o comparatie
     * directa pentru birou si teren, si recursiva doar pentru partajari.
     */
    contractId: uuid('contract_id').references(() => contracts.id),
    objectiveId: uuid('objective_id').references(() => objectives.id),
    workUnitId: uuid('work_unit_id').references(() => workUnits.id),
    stageId: uuid('stage_id').references(() => workStages.id),

    nodeRole: nodeRoleEnum('node_role').notNull().default('user'),
    /** Foldere generate automat: nu se sterg, nu se redenumesc, nu se muta. */
    isSystem: boolean('is_system').notNull().default(false),

    /** Versiunea curenta a fisierului. Null pe foldere si pe fisierele in curs de urcare. */
    currentVersionId: uuid('current_version_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => persons.id),
    /**
     * Null = generat de sistem. Nu e o scapare: folderele din Anexa E.3 sunt
     * facute de trigger la crearea entitatii, iar a le pune in cont cui a apasat
     * „salveaza" pe contract ar fi o minciuna mica pe care s-ar sprijini apoi un
     * raport de „cine a creat folderul".
     */
    createdBy: uuid('created_by').references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    /*
     * Unicitatea numelui in folder, DOAR pe randurile nesterse — de aceea
     * numele redevine liber la stergere, nu la golirea cosului.
     *
     * `company_id` e in cheie pentru ca radacinile de firma au `parent_id` null,
     * iar in Postgres doua null-uri sunt distincte: fara el, doua firme cu
     * acelasi nume nu s-ar ciocni, dar nici n-ar fi verificate. Unicitatea
     * radacinii o tine indexul urmator, care spune direct ce vrem: o singura
     * radacina per firma.
     */
    uniqueIndex('nodes_parent_name_unique')
      .on(t.companyId, t.parentId, t.name)
      .where(sql`deleted_at is null`),
    uniqueIndex('nodes_root_unique')
      .on(t.companyId)
      .where(sql`node_role = 'root_company' and deleted_at is null`),
    // Listarea copiilor unui folder — interogarea explorer-ului, de zece ori pe minut.
    index('nodes_parent_idx')
      .on(t.parentId)
      .where(sql`deleted_at is null`),
    index('nodes_work_unit_idx')
      .on(t.workUnitId)
      .where(sql`deleted_at is null`),
    index('nodes_contract_idx')
      .on(t.contractId)
      .where(sql`deleted_at is null`),
    index('nodes_objective_idx')
      .on(t.objectiveId)
      .where(sql`deleted_at is null`),
    /*
     * Cautarea folderului de sistem: `where work_unit_id = X and node_role = 'pv'`.
     * Partial pe `is_system`, pentru ca folderele utilizatorului au toate rolul
     * `user` si n-ar face decat sa umfle indexul.
     */
    index('nodes_role_idx')
      .on(t.nodeRole, t.workUnitId)
      .where(sql`is_system and deleted_at is null`),
    // Cosul de gunoi si jobul de curatenie: „ce s-a sters, si cand".
    index('nodes_deleted_idx')
      .on(t.companyId, t.deletedAt)
      .where(sql`deleted_at is not null`),

    check('nodes_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    // Numele de fisier nu are voie sa contina separator de cale: altfel un nod
    // numit „../secret" devine o ambiguitate in orice export sau breadcrumb.
    check('nodes_name_no_slash', sql`${t.name} !~ '[/\\\\]'`),
    check('nodes_not_own_parent', sql`${t.parentId} is distinct from ${t.id}`),
    // Doar fisierele au versiuni. Un folder cu `current_version_id` e un bug.
    check('nodes_version_only_on_files', sql`${t.kind} = 'file' or ${t.currentVersionId} is null`),
    // Folderele de sistem au intotdeauna un rol; rolul `user` nu e de sistem.
    check('nodes_system_has_role', sql`${t.isSystem} = (${t.nodeRole} <> 'user')`),
    check('nodes_deleted_pair', sql`num_nonnulls(${t.deletedAt}, ${t.deletedBy}) <> 1`),
  ],
);

export const fileVersions = app.table(
  'file_versions',
  {
    id: id(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    /** `blobs/{uuid}` in bucket-ul `docs`. Fara cale semantica, niciodata. */
    blobKey: text('blob_key').notNull().unique(),
    /**
     * Declarata la `presign`, rescrisa la `complete` cu `ContentLength`-ul real.
     * Verificata doar la presign, limita de marime e o sugestie.
     */
    size: bigint('size', { mode: 'number' }).notNull(),
    /** Determinat prin magic bytes la `complete`, nu din extensie si nu din ce declara browserul. */
    mime: text('mime').notNull(),
    checksumSha256: bytea('checksum_sha256'),
    state: fileStateEnum('state').notNull().default('uploading'),
    /** `uploadId` de la R2, pastrat ca sa se poata relua sau abandona upload-ul. */
    uploadId: text('upload_id'),

    /** Cand a fost facuta poza, nu cand a fost urcata. Din EXIF. */
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    geoLat: numeric('geo_lat', { precision: 10, scale: 7 }),
    geoLng: numeric('geo_lng', { precision: 10, scale: 7 }),
    geoAccuracy: numeric('geo_accuracy', { precision: 10, scale: 2 }),
    geoSource: geoSourceEnum('geo_source'),
    exif: jsonb('exif'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    // Istoricul de versiuni al unui fisier, cea mai noua prima.
    index('file_versions_node_idx').on(t.nodeId, sql`created_at desc`),
    // Harta pozelor de teren: doar cele geotagate, in ordine de captura.
    index('file_versions_geo_idx')
      .on(t.capturedAt)
      .where(sql`geo_lat is not null`),
    // Jobul de curatenie: upload-uri abandonate.
    index('file_versions_state_idx')
      .on(t.state)
      .where(sql`state = 'uploading'`),

    check('file_versions_size_non_negative', sql`${t.size} >= 0`),
    check('file_versions_lat_range', sql`${t.geoLat} is null or ${t.geoLat} between -90 and 90`),
    check('file_versions_lng_range', sql`${t.geoLng} is null or ${t.geoLng} between -180 and 180`),
    check('file_versions_geo_pair', sql`num_nonnulls(${t.geoLat}, ${t.geoLng}) <> 1`),
    // Coordonate fara sursa nu se pot cantari: EXIF-ul e dovada, „manual" nu e.
    check('file_versions_geo_has_source', sql`${t.geoLat} is null or ${t.geoSource} is not null`),
    check(
      'file_versions_checksum_length',
      sql`${t.checksumSha256} is null or length(${t.checksumSha256}) = 32`,
    ),
  ],
);

export const derivedAssets = app.table(
  'derived_assets',
  {
    id: id(),
    fileVersionId: uuid('file_version_id')
      .notNull()
      .references(() => fileVersions.id, { onDelete: 'cascade' }),
    /** `thumb160`, `thumb480`, `thumb1200`, `preview_p1`… */
    variant: text('variant').notNull(),
    blobKey: text('blob_key').notNull(),
    width: integer('width'),
    height: integer('height'),
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('derived_assets_version_variant_unique').on(t.fileVersionId, t.variant),
    check('derived_assets_status_valid', sql`${t.status} in ('pending', 'ready', 'failed')`),
    check('derived_assets_variant_shape', sql`${t.variant} ~ '^[a-z0-9_-]{1,32}$'`),
  ],
);

/**
 * Partajarea explicita. Pentru subcontractant e SINGURA cale de acces: nu
 * mosteneste nimic de la contract sau de la lucrare. Asta **e** izolarea
 * A-vs-B, si de-aia nu exista nicio politica de tip „vede ce e la contractul
 * lui" pe `nodes`.
 */
export const nodeShares = app.table(
  'node_shares',
  {
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    subjectType: shareSubjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    permission: sharePermissionEnum('permission').notNull().default('read'),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.subjectType, t.subjectId] }),
    // „Ce mi s-a partajat mie" — punctul de plecare al arborelui de subcontractant.
    index('node_shares_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;
export type FileVersion = typeof fileVersions.$inferSelect;
export type DerivedAsset = typeof derivedAssets.$inferSelect;
export type NodeShare = typeof nodeShares.$inferSelect;
