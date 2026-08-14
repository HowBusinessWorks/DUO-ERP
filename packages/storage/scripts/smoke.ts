import { createHash, randomBytes } from 'node:crypto';
import {
  abortMultipart,
  completeMultipart,
  createMultipartUpload,
  deleteObject,
  presignGet,
  presignPart,
  tmpKey,
  type CompletedPart,
} from '../src/index';

/**
 * Verificarea #10 din Pasul 01: upload multipart de ~20 MB in `damina-tmp`,
 * apoi presignGet + download, si comparatie SHA-256.
 *
 * Ruleaza cu: pnpm --filter @damina/storage smoke:r2
 */
const PART_SIZE = 8 * 1024 * 1024; // 8 MB — R2 cere minim 5 MB pe parte, in afara de ultima
const TOTAL_SIZE = 20 * 1024 * 1024;
const CONCURRENCY = 3;

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function splitIntoParts(payload: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < payload.length; offset += PART_SIZE) {
    parts.push(payload.subarray(offset, Math.min(offset + PART_SIZE, payload.length)));
  }
  return parts;
}

/** Urca o parte, cu retry — exact comportamentul cerut pentru conexiuni de santier. */
async function uploadPart(url: string, body: Buffer, partNumber: number): Promise<CompletedPart> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'PUT', body: new Uint8Array(body) });
      if (!response.ok) {
        throw new Error(`PUT parte ${partNumber} a intors ${response.status}`);
      }
      const etag = response.headers.get('etag');
      if (etag === null) {
        throw new Error(`Parte ${partNumber} fara ETag.`);
      }
      return { partNumber, etag };
    } catch (error) {
      lastError = error;
      process.stdout.write(`  parte ${partNumber}: incercarea ${attempt} a esuat, reincerc\n`);
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const payload = randomBytes(TOTAL_SIZE);
  const expected = sha256(payload);
  const parts = splitIntoParts(payload);

  process.stdout.write(`Fisier de test: ${TOTAL_SIZE / 1024 / 1024} MB in ${parts.length} parti\n`);
  process.stdout.write(`SHA-256 asteptat: ${expected}\n`);

  const key = tmpKey('smoke');
  const upload = await createMultipartUpload('tmp', key, {
    contentType: 'application/octet-stream',
  });
  process.stdout.write(`Upload deschis: ${key}\n`);

  try {
    const completed: CompletedPart[] = [];
    for (let i = 0; i < parts.length; i += CONCURRENCY) {
      const batch = parts.slice(i, i + CONCURRENCY).map(async (body, offset) => {
        const partNumber = i + offset + 1;
        const url = await presignPart(upload, partNumber);
        return uploadPart(url, body, partNumber);
      });
      completed.push(...(await Promise.all(batch)));
    }

    await completeMultipart(upload, completed);
    process.stdout.write('Upload finalizat.\n');

    const downloadUrl = await presignGet('tmp', key, 120);
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Download-ul a intors ${response.status}`);
    }
    const downloaded = Buffer.from(await response.arrayBuffer());
    const actual = sha256(downloaded);

    process.stdout.write(`SHA-256 descarcat: ${actual}\n`);
    if (actual !== expected) {
      throw new Error('Fisierul descarcat difera de cel urcat.');
    }
    if (downloaded.length !== TOTAL_SIZE) {
      throw new Error(`Dimensiune diferita: ${downloaded.length} vs ${TOTAL_SIZE}`);
    }

    process.stdout.write('R2 OK — multipart, presign si integritate confirmate.\n');
  } catch (error) {
    await abortMultipart(upload).catch(() => undefined);
    throw error;
  } finally {
    await deleteObject('tmp', key).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
