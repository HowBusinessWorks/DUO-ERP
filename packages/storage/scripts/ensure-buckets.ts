import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  type BucketLocationConstraint,
  type LifecycleRule,
} from '@aws-sdk/client-s3';
import { bucket, r2 } from '../src/client';
import type { BucketName } from '../src/keys';

/**
 * Creeaza bucket-urile R2 lipsa si le aplica politicile de retentie.
 *
 * Idempotent: bucket-urile care exista deja sunt lasate in pace, iar regulile
 * de lifecycle se rescriu la fiecare rulare (sunt declarative).
 *
 * Ruleaza doar bucket-urile numite:
 *   pnpm --filter @damina/storage ensure:buckets tmp
 * Sau pe toate cele configurate in .env.local:
 *   pnpm --filter @damina/storage ensure:buckets
 */

/**
 * Sugestia de plasare pentru R2: `weur` = Europa de Vest.
 * Nu e o regiune S3, deci nu apare in enumerarea din SDK — R2 o accepta oricum.
 */
const LOCATION_HINT = 'weur' as BucketLocationConstraint;

const LIFECYCLE: Partial<Record<BucketName, LifecycleRule[]>> = {
  // Uploaduri incomplete si artefacte de job: dispar singure.
  tmp: [
    {
      ID: 'expira-obiectele-la-7-zile',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      Expiration: { Days: 7 },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    },
  ],
  // Miniaturi si previzualizari: regenerabile, deci expira.
  derived: [
    {
      ID: 'expira-derivatele-la-180-zile',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      Expiration: { Days: 180 },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    },
  ],
  // docs si archive nu expira niciodata — doar curatam uploadurile abandonate.
  docs: [
    {
      ID: 'curata-uploadurile-abandonate',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 3 },
    },
  ],
  archive: [
    {
      ID: 'curata-uploadurile-abandonate',
      Status: 'Enabled',
      Filter: { Prefix: '' },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 3 },
    },
  ],
};

const ALL: BucketName[] = ['docs', 'derived', 'tmp', 'archive'];

async function exists(name: string): Promise<boolean> {
  try {
    await r2().send(new HeadBucketCommand({ Bucket: name }));
    return true;
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = e.$metadata?.httpStatusCode;
    if (status === 404) return false;
    if (status === 403) {
      throw new Error(
        `Acces refuzat pe bucket-ul "${name}" (403). Tokenul R2 pare limitat la anumite bucket-uri — are nevoie de permisiune "Admin Read & Write" pe tot contul ca sa poata crea bucket-uri.`,
      );
    }
    throw new Error(
      `HeadBucket "${name}" a esuat: ${e.name ?? 'necunoscut'} (HTTP ${status ?? '?'})`,
    );
  }
}

async function ensure(target: BucketName): Promise<void> {
  let name: string;
  try {
    name = bucket(target);
  } catch {
    process.stdout.write(`  ${target}: variabila de mediu nu e completata — sar peste\n`);
    return;
  }

  if (await exists(name)) {
    process.stdout.write(`  ${target} -> ${name}: exista deja\n`);
  } else {
    await r2().send(
      new CreateBucketCommand({
        Bucket: name,
        CreateBucketConfiguration: { LocationConstraint: LOCATION_HINT },
      }),
    );
    process.stdout.write(`  ${target} -> ${name}: CREAT (${LOCATION_HINT})\n`);
  }

  const rules = LIFECYCLE[target];
  if (rules !== undefined) {
    await r2().send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: name,
        LifecycleConfiguration: { Rules: rules },
      }),
    );
    process.stdout.write(`     lifecycle aplicat: ${rules.map((r) => r.ID).join(', ')}\n`);
  }
}

async function main(): Promise<void> {
  const requested = process.argv
    .slice(2)
    .filter((a): a is BucketName => ALL.includes(a as BucketName));
  const targets = requested.length > 0 ? requested : ALL;

  process.stdout.write(`Verific bucket-urile: ${targets.join(', ')}\n`);
  for (const target of targets) {
    await ensure(target);
  }
  process.stdout.write('Gata.\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
