import { CHECKSUM_MAX_BYTES } from '@damina/contracts';
import { putPart, readError, sha256Hex } from '../upload-part';
import { fieldDb, hasIndexedDb, type MediaRow } from './db';

/**
 * Golirea cozii de poze (pasul 10, §3.1).
 *
 * Pozele urca **dupa** date si **una cate una**. Ambele sunt reguli, nu
 * optimizari:
 *
 *  - dupa date, fiindca o fisa ajunsa fara poze e o fisa pe care cineva poate
 *    lucra, iar o poza fara fisa nu e nimic;
 *  - una cate una, fiindca pe o conexiune de santier trei poze in paralel
 *    inseamna trei transferuri care esueaza impreuna la iesirea din tunel, in
 *    loc de doua reusite si una reluata.
 *
 * Distinctia care conteaza in toata bucla: **retea versus server.** Un esec de
 * retea nu marcheaza nimic — poza ramane in asteptare si bucla se opreste,
 * pentru ca urmatoarea ar pica la fel. Un raspuns de server marcheaza poza drept
 * cazuta, cu mesajul lui, si bucla merge mai departe: e o problema a pozei ala,
 * nu a zilei.
 */

/** Cate ori se reia o parte inainte sa se dea vina pe retea. */
const PART_ATTEMPTS = 3;

interface PresignResponse {
  readonly versionId: string;
  readonly partSize: number;
  readonly partUrls: readonly string[];
}

export interface MediaDrain {
  readonly uploaded: number;
  readonly failed: number;
  /** `true` cand bucla s-a oprit din lipsa de retea, nu pentru ca a terminat. */
  readonly stopped: boolean;
}

/** Semnalat la fiecare miscare a barei. Ecranul `Poze` asculta. */
export type MediaWatcher = (id: string, sent: number, total: number) => void;

/** Aruncata cand cade reteaua. Deosebeste „mai incearca" de „e stricat". */
class OfflineError extends Error {}

async function targetFolder(row: MediaRow): Promise<string> {
  const response = await fetch('/api/field/media/target', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workUnitId: row.workUnitId, phase: row.phase }),
  }).catch(() => null);

  if (response === null) {
    throw new OfflineError('Fără rețea.');
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return ((await response.json()) as { parentId: string }).parentId;
}

async function uploadOne(row: MediaRow, watch?: MediaWatcher): Promise<void> {
  const parentId = await targetFolder(row);
  const checksum = await sha256Hex(row.blob, CHECKSUM_MAX_BYTES);

  const presign = await fetch('/api/files/presign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      parentId,
      filename: row.filename,
      size: row.blob.size,
      declaredMime: row.mime === '' ? undefined : row.mime,
      checksumSha256: checksum,
      /*
       * Coordonatele aparatului, cand le-a dat. Se salveaza separat de cele din
       * EXIF (`geo_source = 'device'`): la 700 de obiective, dovada ca inspectia
       * s-a facut acolo trebuie sa spuna si de unde stie.
       */
      deviceLat: row.lat,
      deviceLng: row.lng,
      deviceAccuracy: row.accuracy,
    }),
  }).catch(() => null);

  if (presign === null) {
    throw new OfflineError('Fără rețea.');
  }
  if (!presign.ok) {
    throw new Error(await readError(presign));
  }
  const plan = (await presign.json()) as PresignResponse;

  const db = fieldDb();
  const sentByPart = new Map<number, number>();
  const bump = (part: number, sent: number): void => {
    sentByPart.set(part, sent);
    let total = 0;
    for (const value of sentByPart.values()) {
      total += value;
    }
    watch?.(row.id, total, row.blob.size);
    // Se scrie si in baza, ca bara sa supravietuiasca unei reincarcari de tab.
    void db.media.update(row.id, { uploadedParts: total });
  };

  const etags: string[] = [];
  for (const [index, url] of plan.partUrls.entries()) {
    const chunk = row.blob.slice(index * plan.partSize, (index + 1) * plan.partSize);
    let lastError: unknown;
    for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt += 1) {
      try {
        etags[index] = await putPart(url, chunk, (sent) => {
          bump(index, sent);
        });
        bump(index, chunk.size);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        // Se reia PARTEA, nu poza. Ce s-a trimis din ea se pierde; restul, nu.
        bump(index, 0);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
    if (lastError !== undefined) {
      // Trei incercari cazute pe aceeasi parte inseamna retea, nu fisier.
      throw new OfflineError('Conexiunea s-a întrerupt.');
    }
  }

  const complete = await fetch('/api/files/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      versionId: plan.versionId,
      parts: etags.map((etag, index) => ({ partNumber: index + 1, etag })),
    }),
  }).catch(() => null);

  if (complete === null) {
    throw new OfflineError('Fără rețea.');
  }
  if (!complete.ok) {
    throw new Error(await readError(complete));
  }
}

/**
 * Urca pozele care asteapta, in ordinea in care au fost facute.
 *
 * Pozele cazute NU se reiau singure: au picat pe un raspuns al serverului, iar
 * aceiasi octeti vor primi acelasi raspuns. Ele asteapta omul, pe ecranul
 * `Poze`. Aceeasi regula ca la mutatiile blocate — cu diferenta ca o poza cazuta
 * nu opreste coada, fiindca nimic nu depinde de ea.
 */
export async function uploadPending(watch?: MediaWatcher): Promise<MediaDrain> {
  if (!hasIndexedDb()) {
    return { uploaded: 0, failed: 0, stopped: true };
  }

  const db = fieldDb();
  const queue = await db.media.where('status').equals('pending').sortBy('createdAt');

  let uploaded = 0;
  let failed = 0;

  for (const row of queue) {
    await db.media.update(row.id, { status: 'uploading' });
    try {
      await uploadOne(row, watch);
      // Urcata inseamna PLECATA: blob-ul nu mai are ce cauta pe telefon, iar o
      // zi de teren inseamna sute de MB care altfel ar umple stocarea.
      await db.media.delete(row.id);
      uploaded += 1;
    } catch (error) {
      if (error instanceof OfflineError) {
        await db.media.update(row.id, {
          status: 'pending',
          attempts: row.attempts + 1,
          uploadedParts: 0,
        });
        return { uploaded, failed, stopped: true };
      }
      await db.media.update(row.id, {
        status: 'failed',
        attempts: row.attempts + 1,
        uploadedParts: 0,
        errorMessage: error instanceof Error ? error.message : 'Poza nu s-a putut urca.',
      });
      failed += 1;
    }
  }

  return { uploaded, failed, stopped: false };
}

/** Toate pozele din coada, in ordinea in care au fost facute. */
export async function pendingMedia(): Promise<MediaRow[]> {
  if (!hasIndexedDb()) {
    return [];
  }
  return fieldDb().media.orderBy('createdAt').toArray();
}

/** Pune la loc in coada o poza cazuta, dupa ce omul a rezolvat cauza. */
export async function retryMedia(id: string): Promise<void> {
  await fieldDb().media.update(id, {
    status: 'pending',
    attempts: 0,
    uploadedParts: 0,
    errorMessage: undefined,
  });
}

/**
 * Sterge o poza din coada.
 *
 * E singura pierdere ireversibila pe care o poate provoca omul din aplicatia de
 * teren, si de asta ecranul intreaba inainte: poza nu se mai poate face a doua
 * oara, obiectivul e la 40 de km.
 */
export async function discardMedia(id: string): Promise<void> {
  await fieldDb().media.delete(id);
}
