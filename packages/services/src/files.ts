import type { CompleteUploadInput, PresignUploadInput, ShareNodeInput } from '@damina/contracts';
import {
  completeUploadInputSchema,
  createFolderInputSchema,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  moveNodeInputSchema,
  presignUploadInputSchema,
  renameNodeInputSchema,
  shareNodeInputSchema,
  UPLOAD_PART_BYTES,
} from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import { enqueue, filesDerive } from '@damina/jobs';
import {
  AppError,
  MAGIC_BYTES_NEEDED,
  isImageMime,
  isVideoMime,
  sniffMime,
  uuidv7,
} from '@damina/shared';
import {
  abortMultipart,
  blobKey,
  completeMultipart,
  createMultipartUpload,
  deleteObject,
  getObjectBytes,
  objectSize,
  presignGet,
  presignPart,
  type MultipartUpload,
} from '@damina/storage';
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { translateDbError } from './db-errors';

/**
 * Fisierele: upload direct in R2, descarcare prin poarta, organizare, partajare.
 *
 * **Serverul nu vede niciodata byte-ii.** Nici la urcare (clientul urca direct
 * pe URL-uri presemnate, parte cu parte), nici la descarcare (ruta verifica
 * dreptul si intoarce un redirect catre un URL semnat de 60 de secunde). Ce face
 * serverul e sa decida cine are voie si sa verifice ce a ajuns acolo.
 *
 * Ce se verifica la `complete`, si de ce fiecare:
 *
 *   - **`ContentLength` real** — limita verificata doar din `size`-ul declarat la
 *     presign e o sugestie: clientul declara 1 MB si urca 900.
 *   - **magic bytes** — extensia si `Content-Type` sunt text scris de client. Un
 *     HTML urcat ca „aviz.pdf" si servit inapoi ar rula pe domeniul aplicatiei.
 *   - **suma de control** — un upload de 200 MB pe conexiune de santier se poate
 *     corupe fara ca nimeni sa primeasca vreo eroare.
 *
 * Ce cade la oricare dintre ele nu ramane pe jumatate: blobul se sterge, iar
 * versiunea trece in `failed` si nu devine niciodata versiunea curenta a nodului.
 */

/** Cate secunde traieste un URL de descarcare. Scurt dinadins: nu are voie sa circule. */
const DOWNLOAD_TTL_SECONDS = 60;

/**
 * Miniaturile primesc TTL mai lung: sunt multe, mici si publice-in-context, iar
 * o galerie de 300 de poze ar cere altfel 300 de semnaturi la fiecare derulare.
 */
const THUMBNAIL_TTL_SECONDS = 15 * 60;

/** Dupa atatea ore, un upload nefinalizat e abandonat si se curata. */
const ABANDONED_UPLOAD_HOURS = 24;

/** Cate zile stau blob-urile in R2 dupa golirea cosului. */
const TRASH_RETENTION_DAYS = 30;

// ── Citiri ───────────────────────────────────────────────────────────────────

export interface NodeRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: 'folder' | 'file';
  readonly nodeRole: string;
  readonly isSystem: boolean;
  readonly currentVersionId: string | null;
  readonly size: number | null;
  readonly mime: string | null;
  readonly capturedAt: Date | null;
  readonly geoLat: string | null;
  readonly geoLng: string | null;
  readonly geoSource: string | null;
  readonly createdAt: Date;
}

/**
 * Copiii unui folder: folderele intai, apoi fisierele, alfabetic.
 *
 * RLS-ul face filtrarea, nu interogarea: ce nu se vede nu apare, indiferent din
 * ce persona vine cererea. De aceea nu exista niciun `where` de drepturi aici —
 * unul scris de mana s-ar putea abate de la politici.
 */
export async function listChildren(
  actor: Actor,
  parentId: string,
  options: { readonly includeDeleted?: boolean } = {},
): Promise<NodeRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.nodes.id,
        parentId: schema.nodes.parentId,
        name: schema.nodes.name,
        kind: schema.nodes.kind,
        nodeRole: schema.nodes.nodeRole,
        isSystem: schema.nodes.isSystem,
        currentVersionId: schema.nodes.currentVersionId,
        createdAt: schema.nodes.createdAt,
        size: schema.fileVersions.size,
        mime: schema.fileVersions.mime,
        capturedAt: schema.fileVersions.capturedAt,
        geoLat: schema.fileVersions.geoLat,
        geoLng: schema.fileVersions.geoLng,
        geoSource: schema.fileVersions.geoSource,
      })
      .from(schema.nodes)
      .leftJoin(schema.fileVersions, eq(schema.fileVersions.id, schema.nodes.currentVersionId))
      .where(
        and(
          eq(schema.nodes.parentId, parentId),
          options.includeDeleted === true ? undefined : isNull(schema.nodes.deletedAt),
        ),
      )
      .orderBy(desc(schema.nodes.kind), asc(schema.nodes.name));

    return rows as NodeRow[];
  });
}

export interface Crumb {
  readonly id: string;
  readonly name: string;
}

/** Firimiturile de la radacina pana la nod, prin CTE recursiv (§3.1). */
export async function breadcrumb(actor: Actor, nodeId: string): Promise<Crumb[]> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute<{ id: string; name: string; depth: number }>(sql`
      with recursive up as (
        select n.id, n.parent_id, n.name, 0 as depth
          from app.nodes n where n.id = ${nodeId}
        union all
        select p.id, p.parent_id, p.name, up.depth + 1
          from app.nodes p join up on p.id = up.parent_id
      )
      select id, name, depth from up order by depth desc`);
    return result.rows.map((row) => ({ id: row.id, name: row.name }));
  });
}

/** Folderul unei entitati, cautat pe ROL — niciodata pe nume (Anexa E.3). */
export async function folderForEntity(
  actor: Actor,
  scope: { readonly workUnitId?: string; readonly contractId?: string; readonly stageId?: string },
  role = 'work_unit',
): Promise<string | null> {
  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      select id from app.nodes
       where node_role = ${role}::app.node_role
         and deleted_at is null
         and (${scope.workUnitId ?? null}::uuid is null or work_unit_id = ${scope.workUnitId ?? null}::uuid)
         and (${scope.contractId ?? null}::uuid is null or contract_id = ${scope.contractId ?? null}::uuid)
         and (${scope.stageId ?? null}::uuid is null or stage_id = ${scope.stageId ?? null}::uuid)
       limit 1`);
    return rows.rows[0]?.id ?? null;
  });
}

export interface VersionRow {
  readonly id: string;
  readonly nodeId: string;
  readonly name: string;
  readonly blobKey: string;
  readonly size: number;
  readonly mime: string;
  readonly state: string;
  readonly createdAt: Date;
}

/** Istoricul de versiuni al unui fisier, cea mai noua prima. */
export async function listVersions(actor: Actor, nodeId: string): Promise<VersionRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.fileVersions.id,
        nodeId: schema.fileVersions.nodeId,
        name: schema.nodes.name,
        blobKey: schema.fileVersions.blobKey,
        size: schema.fileVersions.size,
        mime: schema.fileVersions.mime,
        state: schema.fileVersions.state,
        createdAt: schema.fileVersions.createdAt,
      })
      .from(schema.fileVersions)
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.fileVersions.nodeId))
      .where(eq(schema.fileVersions.nodeId, nodeId))
      .orderBy(desc(schema.fileVersions.createdAt));
    return rows as VersionRow[];
  });
}

// ── Organizare ───────────────────────────────────────────────────────────────

export async function createFolder(
  actor: Actor,
  input: { parentId: string; name: string },
): Promise<{ id: string }> {
  const values = createFolderInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const parent = await requireNode(tx, values.parentId);
      if (parent.kind !== 'folder') {
        throw new AppError('VALIDATION_FAILED', 'Un fișier nu poate conține alt fișier.');
      }

      const id = uuidv7();
      await tx.insert(schema.nodes).values({
        id,
        parentId: values.parentId,
        companyId: parent.companyId,
        kind: 'folder',
        name: values.name,
        // Rolul `user` e singurul care se poate sterge, redenumi si muta. Tot ce
        // genereaza sistemul are rol propriu si `is_system`.
        nodeRole: 'user',
        contractId: parent.contractId,
        objectiveId: parent.objectiveId,
        workUnitId: parent.workUnitId,
        stageId: parent.stageId,
        createdBy: actor.personId,
      });
      return { id };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

export async function renameNode(
  actor: Actor,
  input: { nodeId: string; name: string },
): Promise<{ id: string }> {
  const values = renameNodeInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .update(schema.nodes)
        .set({ name: values.name })
        .where(and(eq(schema.nodes.id, values.nodeId), isNull(schema.nodes.deletedAt)))
        .returning({ id: schema.nodes.id });
      if (row === undefined) {
        throw AppError.notFound('Nodul', values.nodeId);
      }
      return row;
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/**
 * Muta un nod. Un singur `update parent_id`, oricat de multe fisiere ar fi
 * dedesubt, si zero operatii pe R2 — toata separarea arbore/blob exista pentru
 * randul asta.
 */
export async function moveNode(
  actor: Actor,
  input: { nodeId: string; parentId: string },
): Promise<{ id: string }> {
  const values = moveNodeInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const target = await requireNode(tx, values.parentId);
      if (target.kind !== 'folder') {
        throw new AppError('VALIDATION_FAILED', 'Ținta mutării nu e un folder.');
      }

      const [row] = await tx
        .update(schema.nodes)
        .set({ parentId: values.parentId })
        .where(and(eq(schema.nodes.id, values.nodeId), isNull(schema.nodes.deletedAt)))
        .returning({ id: schema.nodes.id });
      if (row === undefined) {
        throw AppError.notFound('Nodul', values.nodeId);
      }
      return row;
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/**
 * Cosul de gunoi: `deleted_at`, instant si pentru un folder cu 3.000 de poze.
 *
 * Nu coboara in subarbore, si nici n-are nevoie: ce e sub un nod sters e
 * inaccesibil prin navigare, iar la golirea cosului subarborele pleaca odata cu
 * radacina lui. Ce se elibereaza imediat e NUMELE, fiindca unicitatea e partiala
 * — altfel cine sterge din greseala n-ar putea recrea timp de 30 de zile.
 */
export async function trashNode(actor: Actor, nodeId: string): Promise<{ id: string }> {
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .update(schema.nodes)
        .set({ deletedAt: new Date(), deletedBy: actor.personId })
        .where(and(eq(schema.nodes.id, nodeId), isNull(schema.nodes.deletedAt)))
        .returning({ id: schema.nodes.id });
      if (row === undefined) {
        throw AppError.notFound('Nodul', nodeId);
      }
      return row;
    });
  } catch (error) {
    return translateDbError(error);
  }
}

export async function restoreNode(actor: Actor, nodeId: string): Promise<{ id: string }> {
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .update(schema.nodes)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(schema.nodes.id, nodeId))
        .returning({ id: schema.nodes.id });
      if (row === undefined) {
        throw AppError.notFound('Nodul', nodeId);
      }
      return row;
    });
  } catch (error) {
    if (sqlstateOf(error) === '23505') {
      throw new AppError(
        'CONFLICT',
        'Există deja ceva cu numele ăsta în folder. Redenumește-l pe cel nou și încearcă din nou.',
      );
    }
    return translateDbError(error);
  }
}

export async function listTrash(actor: Actor, companyId: string): Promise<NodeRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.nodes.id,
        parentId: schema.nodes.parentId,
        name: schema.nodes.name,
        kind: schema.nodes.kind,
        nodeRole: schema.nodes.nodeRole,
        isSystem: schema.nodes.isSystem,
        currentVersionId: schema.nodes.currentVersionId,
        createdAt: schema.nodes.createdAt,
        deletedAt: schema.nodes.deletedAt,
      })
      .from(schema.nodes)
      .where(and(eq(schema.nodes.companyId, companyId), sql`${schema.nodes.deletedAt} is not null`))
      .orderBy(desc(schema.nodes.deletedAt))
      .limit(500);
    return rows as unknown as NodeRow[];
  });
}

// ── Partajare ────────────────────────────────────────────────────────────────

export async function shareNode(actor: Actor, input: ShareNodeInput): Promise<void> {
  const values = shareNodeInputSchema.parse(input);
  try {
    await withActor(actor, async (tx) => {
      await tx
        .insert(schema.nodeShares)
        .values({
          nodeId: values.nodeId,
          subjectType: values.subjectType,
          subjectId: values.subjectId,
          permission: values.permission,
          grantedBy: actor.personId,
        })
        .onConflictDoUpdate({
          target: [
            schema.nodeShares.nodeId,
            schema.nodeShares.subjectType,
            schema.nodeShares.subjectId,
          ],
          set: { permission: values.permission, grantedBy: actor.personId },
        });
    });
  } catch (error) {
    translateDbError(error);
  }
}

export async function unshareNode(
  actor: Actor,
  input: { nodeId: string; subjectType: 'person' | 'subcontractor'; subjectId: string },
): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .delete(schema.nodeShares)
      .where(
        and(
          eq(schema.nodeShares.nodeId, input.nodeId),
          eq(schema.nodeShares.subjectType, input.subjectType),
          eq(schema.nodeShares.subjectId, input.subjectId),
        ),
      );
  });
}

export async function listShares(
  actor: Actor,
  nodeId: string,
): Promise<{ subjectType: string; subjectId: string; permission: string }[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        subjectType: schema.nodeShares.subjectType,
        subjectId: schema.nodeShares.subjectId,
        permission: schema.nodeShares.permission,
      })
      .from(schema.nodeShares)
      .where(eq(schema.nodeShares.nodeId, nodeId)),
  );
}

// ── Upload ───────────────────────────────────────────────────────────────────

export interface PresignedUpload {
  readonly nodeId: string;
  readonly versionId: string;
  readonly uploadId: string;
  readonly partSize: number;
  /** Cate un URL per parte — de aici vine retry-ul per parte. */
  readonly partUrls: readonly string[];
  readonly expiresInSeconds: number;
}

/**
 * Deschide un upload: creeaza nodul (sau o versiune noua a unuia existent) si
 * intoarce URL-urile presemnate.
 *
 * Un fisier cu acelasi nume in acelasi folder NU produce conflict, ci o versiune
 * noua a aceluiasi nod. Asa se comporta orice explorer de fisiere pe care l-a
 * folosit vreodata cineva, si asa nu se pierde istoricul.
 */
export async function presignUpload(
  actor: Actor,
  input: PresignUploadInput,
): Promise<PresignedUpload> {
  const values = presignUploadInputSchema.parse(input);
  const key = blobKey();

  let upload: MultipartUpload | undefined;
  try {
    return await withActor(actor, async (tx) => {
      const parent = await requireNode(tx, values.parentId);
      if (parent.kind !== 'folder') {
        throw new AppError('VALIDATION_FAILED', 'Fișierele se urcă în foldere.');
      }

      const existing = await tx
        .select({ id: schema.nodes.id, kind: schema.nodes.kind })
        .from(schema.nodes)
        .where(
          and(
            eq(schema.nodes.parentId, values.parentId),
            eq(schema.nodes.name, values.filename),
            isNull(schema.nodes.deletedAt),
          ),
        )
        .limit(1);

      if (existing[0] !== undefined && existing[0].kind !== 'file') {
        throw new AppError('CONFLICT', 'Există deja un folder cu numele ăsta.');
      }

      let nodeId = existing[0]?.id;
      if (nodeId === undefined) {
        nodeId = uuidv7();
        await tx.insert(schema.nodes).values({
          id: nodeId,
          parentId: values.parentId,
          companyId: parent.companyId,
          kind: 'file',
          name: values.filename,
          nodeRole: 'user',
          contractId: parent.contractId,
          objectiveId: parent.objectiveId,
          workUnitId: parent.workUnitId,
          stageId: parent.stageId,
          createdBy: actor.personId,
        });
      }

      upload = await createMultipartUpload('docs', key);

      const versionId = uuidv7();
      await tx.insert(schema.fileVersions).values({
        id: versionId,
        nodeId,
        blobKey: key,
        size: values.size,
        // Tipul declarat e doar un punct de plecare; la `complete` se rescrie cu
        // ce spun magic bytes. Pana atunci nimeni nu serveste fisierul: e
        // `uploading`, deci nu e versiunea curenta a nodului.
        mime: values.declaredMime ?? 'application/octet-stream',
        state: 'uploading',
        uploadId: upload.uploadId,
        ...(values.checksumSha256 === undefined
          ? {}
          : { checksumSha256: Buffer.from(values.checksumSha256, 'hex') }),
        ...(values.deviceLat === undefined || values.deviceLng === undefined
          ? {}
          : {
              geoLat: values.deviceLat.toFixed(7),
              geoLng: values.deviceLng.toFixed(7),
              geoSource: 'device' as const,
              ...(values.deviceAccuracy === undefined
                ? {}
                : { geoAccuracy: values.deviceAccuracy.toFixed(2) }),
            }),
        createdBy: actor.personId,
      });

      const partCount = Math.max(1, Math.ceil(values.size / UPLOAD_PART_BYTES));
      const partUrls: string[] = [];
      for (let part = 1; part <= partCount; part += 1) {
        partUrls.push(await presignPart(upload, part));
      }

      return {
        nodeId,
        versionId,
        uploadId: upload.uploadId,
        partSize: UPLOAD_PART_BYTES,
        partUrls,
        expiresInSeconds: 15 * 60,
      };
    });
  } catch (error) {
    // Tranzactia a cazut dupa ce R2 deschisese uploadul: fara asta ar ramane
    // parti orfane care se platesc lunar pana la expirarea regulii de bucket.
    if (upload !== undefined) {
      await abortMultipart(upload).catch(() => undefined);
    }
    return translateDbError(error);
  }
}

export interface CompletedUpload {
  readonly nodeId: string;
  readonly versionId: string;
  readonly mime: string;
  readonly size: number;
}

export async function completeUpload(
  actor: Actor,
  input: CompleteUploadInput,
): Promise<CompletedUpload> {
  const values = completeUploadInputSchema.parse(input);

  const version = await withActor(actor, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.fileVersions)
      .where(eq(schema.fileVersions.id, values.versionId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw AppError.notFound('Versiunea', values.versionId);
    }
    if (row.state !== 'uploading') {
      throw new AppError('CONFLICT', 'Uploadul ăsta a fost deja finalizat.');
    }
    return row;
  });

  const upload: MultipartUpload = {
    bucket: 'docs',
    key: version.blobKey,
    uploadId: version.uploadId ?? '',
  };

  try {
    await completeMultipart(upload, values.parts);

    // ── Verificarile, in ordinea „cea mai ieftina intai" ──────────────────────
    const realSize = await objectSize('docs', version.blobKey);
    if (realSize === undefined) {
      throw new AppError('VALIDATION_FAILED', 'Fișierul nu a ajuns în storage.');
    }

    const head = await getObjectBytes('docs', version.blobKey, MAGIC_BYTES_NEEDED);
    const mime = sniffMime(head);
    if (mime === undefined) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Formatul fișierului nu e recunoscut. Acceptăm poze, video, PDF și documente Office.',
      );
    }

    const limit = isImageMime(mime)
      ? MAX_IMAGE_BYTES
      : isVideoMime(mime)
        ? MAX_VIDEO_BYTES
        : MAX_DOCUMENT_BYTES;
    if (realSize > limit) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Fișierul are ${formatMb(realSize)}, peste limita de ${formatMb(limit)} pentru tipul ăsta.`,
      );
    }

    if (version.checksumSha256 !== null) {
      const actual = await sha256Of('docs', version.blobKey);
      if (actual !== Buffer.from(version.checksumSha256).toString('hex')) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Fișierul s-a corupt la încărcare. Încearcă din nou — nu s-a salvat nimic.',
        );
      }
    }

    return await withActor(actor, async (tx) => {
      await tx
        .update(schema.fileVersions)
        .set({ state: 'ready', size: realSize, mime })
        .where(eq(schema.fileVersions.id, values.versionId));

      await tx
        .update(schema.nodes)
        .set({ currentVersionId: values.versionId })
        .where(eq(schema.nodes.id, version.nodeId));

      // In aceeasi tranzactie: daca `update`-ul cade, jobul dispare cu el si nu
      // ramane un worker care prelucreaza o versiune inexistenta.
      await enqueue(tx, filesDerive, { versionId: values.versionId });

      return { nodeId: version.nodeId, versionId: values.versionId, mime, size: realSize };
    });
  } catch (error) {
    await markFailed(actor, values.versionId).catch(() => undefined);
    await deleteObject('docs', version.blobKey).catch(() => undefined);
    if (error instanceof AppError) {
      throw error;
    }
    return translateDbError(error);
  }
}

async function markFailed(actor: Actor, versionId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .update(schema.fileVersions)
      .set({ state: 'failed' })
      .where(eq(schema.fileVersions.id, versionId));
  });
}

// ── Descarcare ───────────────────────────────────────────────────────────────

export interface DownloadTarget {
  readonly url: string;
  readonly ttlSeconds: number;
}

/**
 * URL de descarcare, valabil 60 de secunde.
 *
 * Dreptul se verifica prin RLS: daca `select`-ul nu intoarce nimic, apelantul
 * n-avea voie sa vada versiunea, si primeste acelasi „nu exista" ca pentru un id
 * inventat. Nu exista niciodata un URL R2 direct in HTML-ul paginii.
 */
export async function downloadUrl(actor: Actor, versionId: string): Promise<DownloadTarget> {
  const row = await withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        blobKey: schema.fileVersions.blobKey,
        mime: schema.fileVersions.mime,
        state: schema.fileVersions.state,
        name: schema.nodes.name,
      })
      .from(schema.fileVersions)
      .innerJoin(schema.nodes, eq(schema.nodes.id, schema.fileVersions.nodeId))
      .where(and(eq(schema.fileVersions.id, versionId), isNull(schema.nodes.deletedAt)))
      .limit(1);
    return rows[0];
  });

  if (row === undefined) {
    throw AppError.notFound('Fișierul', versionId);
  }
  if (row.state !== 'ready') {
    throw new AppError('VALIDATION_FAILED', 'Fișierul nu e gata: încărcarea nu s-a finalizat.');
  }

  return {
    url: await presignGet('docs', row.blobKey, {
      ttlSeconds: DOWNLOAD_TTL_SECONDS,
      // Din baza, nu din request — altfel antetul devine ce scrie clientul.
      contentType: row.mime,
      downloadName: row.name,
      disposition: 'attachment',
    }),
    ttlSeconds: DOWNLOAD_TTL_SECONDS,
  };
}

/** URL pentru o miniatura. `inline`, TTL mai lung: se vede in pagina, nu se salveaza. */
export async function thumbnailUrl(
  actor: Actor,
  versionId: string,
  variant: string,
): Promise<DownloadTarget | null> {
  const row = await withActor(actor, async (tx) => {
    const rows = await tx
      .select({ blobKey: schema.derivedAssets.blobKey, status: schema.derivedAssets.status })
      .from(schema.derivedAssets)
      .where(
        and(
          eq(schema.derivedAssets.fileVersionId, versionId),
          eq(schema.derivedAssets.variant, variant),
        ),
      )
      .limit(1);
    return rows[0];
  });

  if (row === undefined || row.status !== 'ready') {
    return null;
  }

  return {
    url: await presignGet('derived', row.blobKey, {
      ttlSeconds: THUMBNAIL_TTL_SECONDS,
      contentType: 'image/webp',
      disposition: 'inline',
    }),
    ttlSeconds: THUMBNAIL_TTL_SECONDS,
  };
}

// ── Ce cheama worker-ul ──────────────────────────────────────────────────────

export interface DeriveSource {
  readonly versionId: string;
  readonly blobKey: string;
  readonly mime: string;
  readonly size: number;
  readonly hasDeviceGeo: boolean;
}

/** Datele de care are nevoie jobul `files.derive`. Rulat cu actorul de serviciu. */
export async function deriveSource(actor: Actor, versionId: string): Promise<DeriveSource | null> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        versionId: schema.fileVersions.id,
        blobKey: schema.fileVersions.blobKey,
        mime: schema.fileVersions.mime,
        size: schema.fileVersions.size,
        geoSource: schema.fileVersions.geoSource,
        state: schema.fileVersions.state,
      })
      .from(schema.fileVersions)
      .where(eq(schema.fileVersions.id, versionId))
      .limit(1);

    const row = rows[0];
    if (row === undefined || row.state !== 'ready') {
      return null;
    }
    return {
      versionId: row.versionId,
      blobKey: row.blobKey,
      mime: row.mime,
      size: row.size,
      hasDeviceGeo: row.geoSource === 'device',
    };
  });
}

export interface ExifFacts {
  readonly capturedAt?: Date;
  readonly lat?: number;
  readonly lng?: number;
  readonly raw?: Record<string, unknown>;
}

/**
 * Scrie ce a gasit worker-ul in EXIF.
 *
 * Coordonatele din EXIF NU suprascriu pe cele trimise de aparat: daca aplicatia
 * a trimis deja `geo_source = 'device'`, alea raman. Sunt doua marturii diferite
 * despre acelasi lucru, iar cea de la aparat e cea culeasa in momentul si locul
 * faptei — a o inlocui cu una scoasa dintr-un fisier care poate fi editat ar
 * slabi exact dovada pentru care exista campurile astea.
 */
export async function applyExif(
  actor: Actor,
  versionId: string,
  facts: ExifFacts,
): Promise<void> {
  await withActor(actor, async (tx) => {
    const current = await tx
      .select({ geoSource: schema.fileVersions.geoSource })
      .from(schema.fileVersions)
      .where(eq(schema.fileVersions.id, versionId))
      .limit(1);

    const keepDeviceGeo = current[0]?.geoSource === 'device';
    const hasExifGeo = facts.lat !== undefined && facts.lng !== undefined;

    await tx
      .update(schema.fileVersions)
      .set({
        ...(facts.capturedAt === undefined ? {} : { capturedAt: facts.capturedAt }),
        ...(facts.raw === undefined ? {} : { exif: facts.raw }),
        ...(hasExifGeo && !keepDeviceGeo
          ? {
              geoLat: (facts.lat ?? 0).toFixed(7),
              geoLng: (facts.lng ?? 0).toFixed(7),
              geoSource: 'exif' as const,
            }
          : {}),
      })
      .where(eq(schema.fileVersions.id, versionId));
  });
}

export async function recordDerivedAsset(
  actor: Actor,
  input: {
    versionId: string;
    variant: string;
    blobKey: string;
    width: number;
    height: number;
  },
): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .insert(schema.derivedAssets)
      .values({
        id: uuidv7(),
        fileVersionId: input.versionId,
        variant: input.variant,
        blobKey: input.blobKey,
        width: input.width,
        height: input.height,
        status: 'ready',
      })
      .onConflictDoUpdate({
        target: [schema.derivedAssets.fileVersionId, schema.derivedAssets.variant],
        set: {
          blobKey: input.blobKey,
          width: input.width,
          height: input.height,
          status: 'ready',
        },
      });
  });
}

export interface CleanupReport {
  readonly abandonedUploads: number;
  readonly purgedNodes: number;
  readonly deletedBlobs: number;
}

/**
 * Curatenia nocturna (§3.4).
 *
 * Trei lucruri, in ordinea in care se strica banii: uploaduri abandonate (parti
 * multipart care se platesc lunar), noduri din cosul golit acum peste 30 de zile,
 * si blob-urile lor. Pasul de 30 de zile e lent DINADINS: la 40 de oameni care
 * invata aplicatia, stergerea gresita se va intampla.
 */
export async function cleanupFiles(actor: Actor): Promise<CleanupReport> {
  const cutoffUpload = new Date(Date.now() - ABANDONED_UPLOAD_HOURS * 3600_000);
  const cutoffTrash = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000);

  const abandoned = await withActor(actor, async (tx) =>
    tx
      .select({
        id: schema.fileVersions.id,
        blobKey: schema.fileVersions.blobKey,
        uploadId: schema.fileVersions.uploadId,
      })
      .from(schema.fileVersions)
      .where(
        and(
          eq(schema.fileVersions.state, 'uploading'),
          lt(schema.fileVersions.createdAt, cutoffUpload),
        ),
      )
      .limit(500),
  );

  for (const row of abandoned) {
    if (row.uploadId !== null) {
      await abortMultipart({ bucket: 'docs', key: row.blobKey, uploadId: row.uploadId }).catch(
        () => undefined,
      );
    }
    await deleteObject('docs', row.blobKey).catch(() => undefined);
  }

  if (abandoned.length > 0) {
    await withActor(actor, async (tx) => {
      await tx.delete(schema.fileVersions).where(
        inArray(
          schema.fileVersions.id,
          abandoned.map((row) => row.id),
        ),
      );
    });
  }

  const expired = await withActor(actor, async (tx) => {
    const result = await tx.execute<{ id: string; blob_key: string | null }>(sql`
      with recursive doomed as (
        select n.id from app.nodes n
         where n.deleted_at is not null and n.deleted_at < ${cutoffTrash.toISOString()}
        union
        select c.id from app.nodes c join doomed d on c.parent_id = d.id
      )
      select d.id, v.blob_key
        from doomed d
        left join app.file_versions v on v.node_id = d.id`);
    return result.rows;
  });

  const nodeIds = [...new Set(expired.map((row) => row.id))];
  const blobKeys = expired.flatMap((row) => (row.blob_key === null ? [] : [row.blob_key]));

  for (const key of blobKeys) {
    await deleteObject('docs', key).catch(() => undefined);
  }

  if (nodeIds.length > 0) {
    await withActor(actor, async (tx) => {
      const derived = await tx.execute<{ blob_key: string }>(sql`
        select a.blob_key from app.derived_assets a
          join app.file_versions v on v.id = a.file_version_id
         where v.node_id in ${nodeIds}`);
      for (const row of derived.rows) {
        await deleteObject('derived', row.blob_key).catch(() => undefined);
      }

      // Copiii intai: `nodes.parent_id` n-are cascade dinadins, ca o stergere
      // accidentala sa nu poata lua un subarbore cu ea.
      await tx.execute(sql`
        with recursive doomed as (
          select n.id, 0 as depth from app.nodes n where n.id in ${nodeIds}
          union all
          select c.id, doomed.depth + 1 from app.nodes c join doomed on c.parent_id = doomed.id
        )
        delete from app.nodes where id in (select id from doomed)`);
    });
  }

  return {
    abandonedUploads: abandoned.length,
    purgedNodes: nodeIds.length,
    deletedBlobs: blobKeys.length,
  };
}

// ── Ajutoare ─────────────────────────────────────────────────────────────────

interface ParentNode {
  readonly id: string;
  readonly companyId: string;
  readonly kind: 'folder' | 'file';
  readonly contractId: string | null;
  readonly objectiveId: string | null;
  readonly workUnitId: string | null;
  readonly stageId: string | null;
}

async function requireNode(tx: ActorTx, nodeId: string): Promise<ParentNode> {
  const rows = await tx
    .select({
      id: schema.nodes.id,
      companyId: schema.nodes.companyId,
      kind: schema.nodes.kind,
      contractId: schema.nodes.contractId,
      objectiveId: schema.nodes.objectiveId,
      workUnitId: schema.nodes.workUnitId,
      stageId: schema.nodes.stageId,
    })
    .from(schema.nodes)
    .where(and(eq(schema.nodes.id, nodeId), isNull(schema.nodes.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    throw AppError.notFound('Folderul', nodeId);
  }
  return row as ParentNode;
}

/**
 * Suma de control a obiectului urcat.
 *
 * Citeste blobul in memorie, deci se face DOAR cand clientul a trimis o suma cu
 * care sa comparam — la 500 MB de video fara suma declarata, calculul ar fi o
 * jumatate de gigaoctet prin worker degeaba.
 */
async function sha256Of(bucket: 'docs' | 'derived', key: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const bytes = await getObjectBytes(bucket, key);
  return createHash('sha256').update(bytes).digest('hex');
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sqlstateOf(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code } = current as Error & { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
    current = current.cause;
  }
  return undefined;
}
