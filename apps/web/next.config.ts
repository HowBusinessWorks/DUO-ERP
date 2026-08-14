import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

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
