import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright — instalat pentru **bugetul de tapuri** (pasul 10, §0).
 *
 * Regula pe care o apara: daca seful de santier are nevoie de 7 tapuri ca sa
 * comande material, da telefon la magazie, si toata trasabilitatea ramane goala.
 * Baza de date e perfecta si complet inutila. Tinta e 3 tapuri, iar testele cad
 * la peste 4 — singurul mod in care o cerinta de UX ramane adevarata dupa sase
 * luni de features.
 *
 * **Fara baza de date, dinadins.** Testele astea masoara interactiunea, nu
 * datele: pornesc aplicatia cu sesiunea de dezvoltare si cu felia locala goala.
 * Un Postgres in plus ar fi facut jobul de cinci ori mai lung si ar fi mutat
 * cauza esecurilor din UI in infrastructura. Ce tine de date se verifica deja
 * in `test:db`, cu testcontainers.
 *
 * Un singur browser: Chromium, la dimensiunea unui telefon de santier. Terenul
 * nu deschide aplicatia pe desktop, iar trei motoare inseamna trei ori timpul
 * pentru aceeasi masuratoare.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: process.env.CI === 'true',
  retries: 0,
  reporter: process.env.CI === 'true' ? 'github' : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'teren',
      use: { ...devices['Pixel 7'] },
    },
  ],

  /*
   * `next start`, nu `next dev`: masuram ecranul care ajunge pe telefon. In dev,
   * recompilarile fac ca prima navigare sa dureze secunde, iar un test de tapuri
   * n-are ce invata din asta.
   */
  webServer: {
    // Scriptul CONSTRUIESTE, apoi porneste. Nu e risipa: `ALLOW_DEV_SESSION` e
    // citit de middleware, care ruleaza pe Edge, unde Next inlocuieste
    // `process.env` la build. Pus doar la pornire, steagul n-ar exista in bundle
    // si fiecare test ar vedea ecranul de login. Vezi `tools/scripts/e2e-server.mjs`.
    command: 'node tools/scripts/e2e-server.mjs',
    url: 'http://127.0.0.1:3100/field',
    reuseExistingServer: process.env.CI !== 'true',
    timeout: 300_000,
  },
});
