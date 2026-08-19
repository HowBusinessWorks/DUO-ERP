import { THUMBNAIL_WIDTHS, thumbnailVariant } from '@damina/contracts';
import { serviceActor } from '@damina/db';
import { filesCleanup, filesDerive } from '@damina/jobs';
import {
  applyExif,
  cleanupFiles,
  deriveSource,
  recordDerivedAsset,
  type ExifFacts,
} from '@damina/services';
import { isImageMime } from '@damina/shared';
import { logger } from '@damina/shared/logger';
import { derivedKey, getObjectBytes, putObject } from '@damina/storage';
import exifr from 'exifr';
import type PgBoss from 'pg-boss';
import sharp from 'sharp';

/**
 * Prelucrarea unei versiuni proaspat urcate: EXIF, geotag, miniaturi.
 *
 * **EXIF-ul se extrage aici, pe server, la ingest** — nu in browser. Motivul e
 * practic: orice recompresie, si unele browsere de la sine, pierd EXIF-ul pe
 * drum. La 700 de obiective, `captured_at` si coordonatele sunt singura dovada
 * ca inspectia s-a facut acolo si atunci.
 *
 * Coordonatele trimise de aparat (`geo_source = 'device'`) NU se suprascriu cu
 * cele din EXIF. Sunt doua marturii despre acelasi lucru, iar cea culeasa la
 * fata locului cantareste mai mult decat una scoasa dintr-un fisier editabil.
 */
export async function registerFilesDerive(boss: PgBoss): Promise<void> {
  await boss.work(filesDerive.name, async (jobs) => {
    for (const job of jobs) {
      // pg-boss intoarce payload-ul ca `unknown`. Il trecem prin schema cozii,
      // nu printr-un cast: un job scris de o versiune veche a aplicatiei trebuie
      // sa cada aici, cu mesaj, nu trei linii mai jos cu „undefined".
      const { versionId } = filesDerive.schema.parse(job.data);
      await deriveOne(versionId, job.id);
    }
  });

  await boss.work(filesCleanup.name, async (jobs) => {
    for (const job of jobs) {
      const report = await cleanupFiles(serviceActor(filesCleanup.name));
      logger.info(
        { use_case: filesCleanup.name, job_id: job.id, ...report },
        'curatenie terminata',
      );
    }
  });
}

async function deriveOne(versionId: string, jobId: string): Promise<void> {
  const actor = serviceActor(filesDerive.name);
  const source = await deriveSource(actor, versionId);

  if (source === null) {
    // Versiunea a disparut sau n-a ajuns niciodata `ready`. Nu e o eroare: e
    // exact ce se intampla cand `complete` a picat pe checksum si a curatat.
    logger.info(
      { use_case: filesDerive.name, job_id: jobId, version_id: versionId },
      'nimic de prelucrat',
    );
    return;
  }

  if (!isImageMime(source.mime)) {
    // Video si PDF isi capata previzualizarile cand apare nevoia lor reala
    // (pasul 09 pentru fise, pasul 10 pentru raport). Pana atunci, un job care
    // nu face nimic e mai bun decat unul care produce artefacte nefolosite.
    logger.debug(
      { use_case: filesDerive.name, job_id: jobId, mime: source.mime },
      'tip fara derivate deocamdata',
    );
    return;
  }

  const bytes = await getObjectBytes('docs', source.blobKey);

  await extractExif(actor, versionId, bytes, jobId);
  const produced = await buildThumbnails(actor, versionId, bytes);

  logger.info(
    { use_case: filesDerive.name, job_id: jobId, version_id: versionId, miniaturi: produced },
    'derivate gata',
  );
}

async function extractExif(
  actor: ReturnType<typeof serviceActor>,
  versionId: string,
  bytes: Buffer,
  jobId: string,
): Promise<void> {
  try {
    const parsed: unknown = await exifr.parse(bytes, { gps: true, tiff: true, exif: true });
    if (parsed === null || typeof parsed !== 'object') {
      return;
    }

    const data = parsed as Record<string, unknown>;
    const facts: ExifFacts = {
      ...(data['DateTimeOriginal'] instanceof Date
        ? { capturedAt: data['DateTimeOriginal'] }
        : data['CreateDate'] instanceof Date
          ? { capturedAt: data['CreateDate'] }
          : {}),
      ...(typeof data['latitude'] === 'number' && typeof data['longitude'] === 'number'
        ? { lat: data['latitude'], lng: data['longitude'] }
        : {}),
      // Doar campurile utile, nu tot blocul: EXIF-ul brut al unui telefon are
      // sute de chei si ar umfla `jsonb`-ul fara ca nimeni sa-l citeasca.
      raw: pick(data, [
        'Make',
        'Model',
        'LensModel',
        'Orientation',
        'ISO',
        'FNumber',
        'ExposureTime',
      ]),
    };

    await applyExif(actor, versionId, facts);
  } catch (error) {
    // O poza fara EXIF, sau cu EXIF stricat, NU e un job esuat: miniaturile
    // trebuie sa se faca oricum. Un retry n-ar schimba nimic.
    logger.debug({ use_case: filesDerive.name, job_id: jobId, err: error }, 'EXIF indisponibil');
  }
}

async function buildThumbnails(
  actor: ReturnType<typeof serviceActor>,
  versionId: string,
  bytes: Buffer,
): Promise<number> {
  let produced = 0;

  for (const width of THUMBNAIL_WIDTHS) {
    const variant = thumbnailVariant(width);

    let output;
    try {
      output = await sharp(bytes, { failOn: 'none' })
        // `rotate()` fara argument aplica orientarea din EXIF. Fara ea, jumatate
        // din pozele de telefon apar culcate in galerie.
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
    } catch (error) {
      /*
       * O imagine pe care decodorul n-o poate citi e un esec PERMANENT: al
       * treilea retry o va gasi la fel de stricata, doar ca dupa doua minute si
       * doua descarcari din R2 in plus.
       *
       * Impartirea e dinadins aici, in jurul singurului apel care poate esua
       * din cauza continutului. Ce e inainte — citirea din R2 — si ce e dupa —
       * scrierea in baza — sunt exact lucrurile care merita reincercate, si
       * raman in afara lui `catch`.
       */
      logger.warn(
        { use_case: filesDerive.name, version_id: versionId, variant, err: error },
        'imagine indescifrabila, fara miniaturi',
      );
      return produced;
    }

    const key = derivedKey(versionId, variant);
    await putObject('derived', key, output.data, 'image/webp');
    await recordDerivedAsset(actor, {
      versionId,
      variant,
      blobKey: key,
      width: output.info.width,
      height: output.info.height,
    });
    produced += 1;
  }

  return produced;
}

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}
