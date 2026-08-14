#!/usr/bin/env node
/**
 * Verificarea #13 din Pasul 01.
 *
 * Scaneaza bundle-ul de client dupa secrete si esueaza daca gaseste vreunul.
 * Regula (PLAN_TEHNIC §3.8): SUPABASE_SERVICE_ROLE_KEY si cheile R2 nu au voie
 * sa ajunga niciodata in `.next/static`.
 *
 * Cauta doua lucruri:
 *   1. valorile reale din mediu, daca sunt setate (cazul care conteaza in CI);
 *   2. numele variabilelor, care ar indica un `process.env.X` inlocuit la build.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const BUNDLE_DIR = join(ROOT, 'apps/web/.next/static');

/** Variabile care nu au voie sa apara in client, nici ca nume, nici ca valoare. */
const FORBIDDEN_ENV = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID',
  'DATABASE_URL',
  'DATABASE_URL_SESSION',
  'APP_RUNTIME_PASSWORD',
  'ANAF_CLIENT_SECRET',
  'MAIL_OAUTH_REFRESH_TOKEN',
];

/** Valorile care sunt prea scurte sau prea generice ca sa fie cautate util. */
const MIN_VALUE_LENGTH = 12;

async function collectFiles(dir) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectFiles(full)));
    } else if (/\.(js|mjs|css|json|map)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

async function main() {
  if (!existsSync(BUNDLE_DIR)) {
    console.error(`Nu exista ${BUNDLE_DIR}. Ruleaza intai: pnpm build`);
    process.exit(1);
  }

  const needles = [];
  for (const name of FORBIDDEN_ENV) {
    needles.push({ label: `numele variabilei ${name}`, text: name });
    const value = process.env[name];
    if (typeof value === 'string' && value.length >= MIN_VALUE_LENGTH) {
      needles.push({ label: `VALOAREA lui ${name}`, text: value });
    }
  }

  const files = await collectFiles(BUNDLE_DIR);
  const findings = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    for (const needle of needles) {
      if (content.includes(needle.text)) {
        findings.push({ file: file.replace(ROOT, '.'), what: needle.label });
      }
    }
  }

  const totalBytes = (
    await Promise.all(files.map(async (f) => (await stat(f)).size))
  ).reduce((a, b) => a + b, 0);

  console.log(
    `Scanat: ${files.length} fisiere, ${(totalBytes / 1024 / 1024).toFixed(1)} MB in .next/static`,
  );

  if (findings.length > 0) {
    console.error('\nSECRETE GASITE IN BUNDLE-UL DE CLIENT:\n');
    for (const f of findings) {
      console.error(`  ${f.file}\n    -> ${f.what}`);
    }
    console.error('\nBuild-ul e respins.');
    process.exit(1);
  }

  console.log('Niciun secret in bundle-ul de client.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
