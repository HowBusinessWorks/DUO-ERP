import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * Radacina monorepo-ului, calculata din pozitia acestui fisier.
 *
 * Fara ea, Next o INFERA din lockfile-uri si o poate nimeri gresit: pe masina de
 * dezvoltare exista un `package-lock.json` ratacit in `C:\Users\<user>`, iar
 * Next alegea acel director ca radacina de workspace. De acolo ies doua lucruri
 * urate — urmarirea de fisiere la build merge pe alt arbore, iar in `dev`
 * watcher-ul si rezolvarea de module lucreaza pe un prefix care nu e al nostru.
 */
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

/**
 * `.env.local` din RADACINA monorepo-ului.
 *
 * Next citeste doar `.env*` din directorul aplicatiei, iar noi tinem un singur
 * fisier de mediu, in radacina, folosit deopotriva de `packages/db`, de worker
 * si de scripturi. Fara randurile astea, `NEXT_PUBLIC_SUPABASE_URL` lipsea din
 * aplicatie — si nu se vedea, pentru ca lipsa ei aprindea exact sesiunea de
 * dezvoltare, care face totul sa para ca merge.
 *
 * Se ruleaza si la `dev`, si la `build`: `NEXT_PUBLIC_*` se inlocuiesc la
 * compilare, deci trebuie sa fie in `process.env` inainte de a incepe.
 * Variabilele deja setate in mediu au prioritate — un deploy isi pastreaza
 * propria configuratie.
 */
loadDotenv({ path: new URL('.env.local', new URL('../../', import.meta.url)), quiet: true });
loadDotenv({ path: new URL('.env', new URL('../../', import.meta.url)), quiet: true });

const config: NextConfig = {
  reactStrictMode: true,

  outputFileTracingRoot: workspaceRoot,

  // Pachetele din workspace se publica direct ca sursa TypeScript, fara pas de
  // build propriu. Next le compileaza impreuna cu aplicatia.
  transpilePackages: [
    '@damina/auth',
    '@damina/contracts',
    '@damina/i18n',
    '@damina/jobs',
    '@damina/services',
    '@damina/shared',
    '@damina/storage',
    '@damina/ui',
  ],

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },

  experimental: {
    // Driverul de Postgres si SDK-ul S3 nu se bundluiesc — raman require-uri Node.
    serverActions: { bodySizeLimit: '2mb' },
  },

  serverExternalPackages: ['pg', 'pg-boss', '@aws-sdk/client-s3', 'pino'],
};

export default config;
