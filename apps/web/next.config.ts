import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

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
