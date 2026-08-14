import { S3Client } from '@aws-sdk/client-s3';
import { requiredEnv } from './env';
import type { BucketName } from './keys';

let client: S3Client | undefined;

/**
 * Client S3-compatibil pentru Cloudflare R2.
 *
 * R2 nu are regiuni in sensul S3: regiunea trebuie sa fie literalmente `auto`,
 * iar endpoint-ul e per cont.
 */
export function r2(): S3Client {
  if (client !== undefined) return client;

  client = new S3Client({
    region: 'auto',
    endpoint: requiredEnv('R2_ENDPOINT'),
    credentials: {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
  return client;
}

const BUCKET_ENV: Readonly<Record<BucketName, string>> = {
  docs: 'R2_BUCKET_DOCS',
  derived: 'R2_BUCKET_DERIVED',
  tmp: 'R2_BUCKET_TMP',
  archive: 'R2_BUCKET_ARCHIVE',
};

export function bucket(name: BucketName): string {
  return requiredEnv(BUCKET_ENV[name]);
}

/** Inchide clientul. Doar la oprirea worker-ului si in teste. */
export function closeStorage(): void {
  client?.destroy();
  client = undefined;
}
