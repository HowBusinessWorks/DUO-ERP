import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Regula de dependente din PLAN_TEHNIC §3.2 / Pasul 01 §3.1.
 * Sageata inseamna "poate importa". Nu exista sageti inverse.
 *
 *   ui ──▶ contracts ──▶ shared
 *   web ──▶ services ──▶ domain ──▶ shared
 *   worker ──▶ services            └──▶ db ──▶ shared
 *   web/worker ──▶ auth ──▶ db
 */
const ELEMENTS = [
  { type: 'app-web', pattern: 'apps/web/**/*', mode: 'full' },
  { type: 'app-worker', pattern: 'apps/worker/**/*', mode: 'full' },
  { type: 'ui', pattern: 'packages/ui/**/*', mode: 'full' },
  { type: 'i18n', pattern: 'packages/i18n/**/*', mode: 'full' },
  { type: 'contracts', pattern: 'packages/contracts/**/*', mode: 'full' },
  { type: 'services', pattern: 'packages/services/**/*', mode: 'full' },
  { type: 'domain', pattern: 'packages/domain/**/*', mode: 'full' },
  { type: 'auth', pattern: 'packages/auth/**/*', mode: 'full' },
  { type: 'jobs', pattern: 'packages/jobs/**/*', mode: 'full' },
  { type: 'storage', pattern: 'packages/storage/**/*', mode: 'full' },
  { type: 'db', pattern: 'packages/db/**/*', mode: 'full' },
  { type: 'shared', pattern: 'packages/shared/**/*', mode: 'full' },
];

const ALLOWED = [
  // Un pachet poate importa mereu din el insusi.
  ...ELEMENTS.map((e) => ({ from: [e.type], allow: [e.type] })),

  // Frunzele grafului.
  { from: ['shared'], allow: [] },
  { from: ['i18n'], allow: [] },

  { from: ['contracts'], allow: ['shared'] },

  // domain NU are voie sa importe db. Regulile de business sunt functii pure.
  { from: ['domain'], allow: ['shared'] },

  { from: ['db'], allow: ['shared'] },
  { from: ['storage'], allow: ['shared'] },
  { from: ['jobs'], allow: ['shared', 'contracts', 'db'] },
  { from: ['auth'], allow: ['shared', 'db'] },

  // services e singurul loc care are voie sa deschida tranzactii.
  { from: ['services'], allow: ['shared', 'contracts', 'domain', 'db', 'jobs', 'storage'] },

  { from: ['ui'], allow: ['shared', 'contracts', 'i18n'] },

  { from: ['app-web'], allow: ['shared', 'contracts', 'i18n', 'ui', 'services', 'auth', 'jobs', 'storage'] },
  { from: ['app-worker'], allow: ['shared', 'contracts', 'services', 'auth', 'jobs', 'storage', 'db'] },
];

/**
 * Nimeni in afara de packages/db nu atinge *driverul* si nu deschide conexiuni.
 * `sql` din 'drizzle-orm' ramane permis in pachetele care compun interogari
 * peste o tranzactie primita din afara (packages/jobs).
 */
const RESTRICTED_DRIVER_IMPORTS = {
  patterns: [
    {
      group: ['drizzle-orm/node-postgres', 'drizzle-orm/node-postgres/*'],
      message:
        'Driverul Drizzle traieste doar in packages/db. In rest se foloseste withActor()/withServiceActor().',
    },
    {
      group: ['pg', 'pg-pool', 'postgres', 'postgres-js'],
      message:
        'Nu deschide conexiuni proprii la Postgres. Singura poarta e withActor() din @damina/db.',
    },
  ],
};

/** In apps/* e interzis tot drizzle: acolo se folosesc doar services si auth. */
const RESTRICTED_APP_IMPORTS = {
  patterns: [
    ...RESTRICTED_DRIVER_IMPORTS.patterns,
    {
      group: ['drizzle-orm', 'drizzle-orm/*', 'drizzle-orm/**'],
      message:
        'Accesul la Postgres dintr-o aplicatie se face exclusiv prin @damina/services, peste withActor(). Fara drizzle in apps/.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'packages/db/migrations/**',
      // Generat de Next la fiecare build.
      '**/next-env.d.ts',
      '**/*.config.{js,mjs,cjs}',
      'tools/scripts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  /*
   * Service worker-ul aplicatiei de teren.
   *
   * Nu se ignora, se declara: e cod real, care ruleaza pe telefonul unui om
   * fara semnal, si merita aceleasi reguli ca restul. Ce-i lipsea erau doar
   * globalele — `self`, `caches`, `fetch` — care nu exista in `browser`.
   */
  {
    files: ['apps/*/public/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Bani: niciodata prin float. Vezi Money din @damina/shared.
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: 'Valorile monetare si cantitatile se parseaza prin Money/Quantity din @damina/shared.',
        },
      ],
    },
  },

  // Regula de dependente intre pachete.
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // Fara rezolvator, boundaries vede doar importurile relative. Cu el,
      // `@damina/db` se rezolva la packages/db si regula prinde si importurile
      // intre pachete — stratul care conteaza de fapt.
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        },
      },
      'boundaries/include': ['apps/**/*', 'packages/**/*'],
      'boundaries/elements': ELEMENTS,
    },
    rules: {
      'boundaries/element-types': ['error', { default: 'disallow', rules: ALLOWED }],
    },
  },

  // Driverul de Postgres e permis doar in packages/db — si in harness-urile de
  // test, care trebuie sa poata ridica o baza de la zero inainte ca `withActor`
  // sa aiba unde sa se conecteze. Fisierele de test propriu-zise nu-l ating:
  // exceptia e pentru `tests/global-setup.ts`, nu pentru interogari de business.
  {
    files: ['packages/**/*.{ts,tsx}'],
    ignores: ['packages/db/**', 'packages/*/tests/global-setup.ts'],
    rules: {
      'no-restricted-imports': ['error', RESTRICTED_DRIVER_IMPORTS],
    },
  },

  // In aplicatii nu intra nici macar constructorul de interogari.
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', RESTRICTED_APP_IMPORTS],
    },
  },

  // Next.js — doar in apps/web.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  // Testele au voie sa fie mai relaxate.
  {
    files: ['**/*.test.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'boundaries/element-types': 'off',
    },
  },

  prettier,
);
