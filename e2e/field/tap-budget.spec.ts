import { expect, test } from '@playwright/test';
import { FIELD_PERSON, signIn } from '../support/session';
import { installTapCounter, resetTaps, taps } from '../support/taps';

/**
 * Bugetul de tapuri (pasul 10, §0, verificarile #12–15).
 *
 * Testul asta nu verifica functionalitate. Verifica **pretul ei in atingeri**,
 * si e blocant in CI dinadins: o cerinta de UX fara masuratoare dispare la a
 * treia iteratie, cand cineva adauga „doar un pas de confirmare".
 *
 * Tinta e 3, pragul de cadere e 4. Diferenta e marja: 4 inseamna „inca merge,
 * dar uita-te ce ai facut", nu „e in regula".
 *
 * **Ce se masoara acum:** drumul de la `Azi` pana la ecranul unei actiuni
 * frecvente. Sunt doua tapuri — ＋ si actiunea — si asta e tot ce se poate
 * masura cat timp ecranele de sub ＋ inca se construiesc. Restul bugetului
 * (completarea si trimiterea) se masoara pe fiecare ecran, cand exista: la
 * `Necesar material`, cele doua tapuri ramase sunt tot bugetul, si de asta
 * ecranul trebuie sa se deschida cu gestiunea si produsele precompletate din
 * felie, nu cu un formular gol.
 */

/** Peste atat, testul cade. Nu e o convenite de test, e regula din §0. */
const MAX_TAPS = 4;

/** Cat costa doar drumul pana la ecran, fara completare. */
const NAVIGATION_BUDGET = 2;

test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, FIELD_PERSON, baseURL ?? 'http://127.0.0.1:3100');
  await installTapCounter(context);
});

test.describe('bugetul de tapuri pe teren', () => {
  test('de la Azi la Necesar material in cel mult doua atingeri', async ({ page }) => {
    await page.goto('/field');
    await expect(page.getByRole('heading', { name: 'Azi' })).toBeVisible();

    await resetTaps(page);

    await page.getByTestId('quick-actions-toggle').click();
    await page.getByRole('link', { name: 'Necesar material' }).click();

    await expect(page.getByRole('heading', { name: 'Necesar material' })).toBeVisible();

    const used = await taps(page);
    expect(used).toBeLessThanOrEqual(NAVIGATION_BUDGET);
    expect(used).toBeLessThanOrEqual(MAX_TAPS);
  });

  test('cele patru actiuni frecvente sunt toate la un tap de ＋', async ({ page }) => {
    await page.goto('/field');
    await resetTaps(page);

    await page.getByTestId('quick-actions-toggle').click();

    // §3.5 le numeste pe toate patru. Daca una dispare sub un submeniu, costa
    // un tap in plus si testul trebuie sa spuna asta aici, nu la raportare.
    await expect(page.getByTestId('quick-action')).toHaveCount(4);
    expect(await taps(page)).toBe(1);
  });

  test('coada de poze e la un tap din bara de jos', async ({ page }) => {
    await page.goto('/field');
    await resetTaps(page);

    await page.getByRole('link', { name: 'Poze' }).click();

    await expect(page.getByRole('heading', { name: 'Poze' })).toBeVisible();
    expect(await taps(page)).toBe(1);
  });
});
