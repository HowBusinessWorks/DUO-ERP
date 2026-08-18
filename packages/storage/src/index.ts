import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { bucket, r2 } from './client';
import type { BucketName } from './keys';

export { blobKey, derivedKey, tmpKey } from './keys';
export type { BucketName } from './keys';
export { closeStorage } from './client';

/** URL-urile presemnate expira in 15 minute (PLAN_TEHNIC §9.3). */
const UPLOAD_TTL_SECONDS = 15 * 60;

/** Download-urile primesc TTL scurt: link-ul nu are voie sa circule. */
const DOWNLOAD_TTL_SECONDS = 60;

export interface MultipartUpload {
  readonly bucket: BucketName;
  readonly key: string;
  readonly uploadId: string;
}

export interface CompletedPart {
  readonly partNumber: number;
  readonly etag: string;
}

/**
 * Deschide un upload multipart. Serverul nu vede niciodata byte-ii: clientul
 * urca direct in R2, parte cu parte, pe URL-uri presemnate.
 */
export async function createMultipartUpload(
  target: BucketName,
  key: string,
  options: { contentType?: string } = {},
): Promise<MultipartUpload> {
  const response = await r2().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(target),
      Key: key,
      ...(options.contentType === undefined ? {} : { ContentType: options.contentType }),
    }),
  );

  if (response.UploadId === undefined) {
    throw new Error('R2 nu a intors un uploadId.');
  }
  return { bucket: target, key, uploadId: response.UploadId };
}

/**
 * URL presemnat pentru o singura parte.
 *
 * Cate unul per parte, ca retry-ul sa fie PER PARTE, nu pe tot fisierul —
 * cerinta explicita pentru conexiunile proaste de santier.
 */
export async function presignPart(upload: MultipartUpload, partNumber: number): Promise<string> {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new RangeError(`Numar de parte invalid: ${partNumber}.`);
  }

  return getSignedUrl(
    r2(),
    new UploadPartCommand({
      Bucket: bucket(upload.bucket),
      Key: upload.key,
      UploadId: upload.uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: UPLOAD_TTL_SECONDS },
  );
}

export async function completeMultipart(
  upload: MultipartUpload,
  parts: readonly CompletedPart[],
): Promise<void> {
  if (parts.length === 0) {
    throw new Error('Uploadul multipart nu are nicio parte.');
  }

  await r2().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(upload.bucket),
      Key: upload.key,
      UploadId: upload.uploadId,
      MultipartUpload: {
        Parts: [...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    }),
  );
}

export async function abortMultipart(upload: MultipartUpload): Promise<void> {
  await r2().send(
    new AbortMultipartUploadCommand({
      Bucket: bucket(upload.bucket),
      Key: upload.key,
      UploadId: upload.uploadId,
    }),
  );
}

export interface PresignGetOptions {
  readonly ttlSeconds?: number;
  /**
   * Antetele cu care R2 va servi obiectul. Se dau DIN BAZA, niciodata din
   * request: un HTML urcat ca „aviz" si servit cu `text/html` ruleaza
   * JavaScript pe domeniul aplicatiei, cu sesiunea utilizatorului in el.
   * Semnatura le acopera, deci nici clientul nu le poate schimba pe drum.
   */
  readonly contentType?: string;
  readonly downloadName?: string;
  /** `inline` doar pentru miniaturi si previzualizari, unde e si scopul. */
  readonly disposition?: 'attachment' | 'inline';
}

/**
 * URL presemnat de citire, cu TTL scurt.
 *
 * Interfata nu primeste niciodata un URL direct catre R2: accesele trec printr-o
 * ruta care verifica permisiunea prin RLS si abia apoi emite link-ul asta.
 */
export async function presignGet(
  target: BucketName,
  key: string,
  options: PresignGetOptions = {},
): Promise<string> {
  const disposition = options.disposition ?? 'attachment';
  // Numele de fisier din antet trece prin RFC 5987: diacriticele romanesti nu
  // sunt ASCII, iar un antet cu octeti bruti e respins de unele proxy-uri.
  const filename =
    options.downloadName === undefined
      ? undefined
      : `${disposition}; filename*=UTF-8''${encodeURIComponent(options.downloadName)}`;

  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: bucket(target),
      Key: key,
      ...(options.contentType === undefined ? {} : { ResponseContentType: options.contentType }),
      ...(filename === undefined
        ? { ResponseContentDisposition: disposition }
        : { ResponseContentDisposition: filename }),
    }),
    { expiresIn: options.ttlSeconds ?? DOWNLOAD_TTL_SECONDS },
  );
}

/**
 * Citeste octeti din obiect, optional doar primii `length`.
 *
 * Cu `length` mic e cum verificam magic bytes la `complete` fara sa aducem
 * fisierul: 64 de octeti dintr-un video de 500 MB, printr-un `Range`. Fara
 * `length`, aduce tot — asa lucreaza worker-ul cu pozele.
 */
export async function getObjectBytes(
  target: BucketName,
  key: string,
  length?: number,
): Promise<Buffer> {
  const response = await r2().send(
    new GetObjectCommand({
      Bucket: bucket(target),
      Key: key,
      ...(length === undefined ? {} : { Range: `bytes=0-${String(length - 1)}` }),
    }),
  );

  const body = response.Body;
  if (body === undefined) {
    throw new Error(`Obiectul ${key} n-are continut.`);
  }
  return Buffer.from(await body.transformToByteArray());
}

/** Urca un obiect mic dintr-un buffer. Pentru miniaturile produse de worker. */
export async function putObject(
  target: BucketName,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await r2().send(
    new PutObjectCommand({ Bucket: bucket(target), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function deleteObject(target: BucketName, key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: bucket(target), Key: key }));
}

/** Dimensiunea reala a obiectului, ca sa validam limita declarata la presign. */
export async function objectSize(target: BucketName, key: string): Promise<number | undefined> {
  const response = await r2().send(new HeadObjectCommand({ Bucket: bucket(target), Key: key }));
  return response.ContentLength;
}

/**
 * Verificare de sanatate: bucket-ul de documente raspunde si credentialele sunt
 * valide.
 *
 * Deliberat `HeadBucket` pe bucket-ul pe care chiar il folosim, nu `ListBuckets`
 * pe tot contul: un token R2 corect e limitat la bucket-urile lui, deci
 * enumerarea contului ar pica tocmai la configuratia cea mai sigura.
 */
export async function checkStorageHealth(): Promise<boolean> {
  try {
    await r2().send(new HeadBucketCommand({ Bucket: bucket('docs') }));
    return true;
  } catch {
    return false;
  }
}
