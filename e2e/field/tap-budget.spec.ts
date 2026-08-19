import { expect, test } from '@playwright/test';
import { FIELD_PERSON, signIn } from '../support/session';
import { installSlice } from '../support/slice';
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
 * frecvente (doua tapuri — ＋ si actiunea) SI fluxul cap-coada al celor doua
 * actiuni care au ecran real: `Necesar material` si `Jurnal`. Amandoua trebuie
 * sa incapa in trei, deci fiecare se deschide cu tot ce se poate ghici deja
 * completat — unitate, data, cursor in camp — nu cu un formular gol.
 *
 * Celelalte doua de sub ＋ (`Fisa de interventie`, `Solicita utilaj`) se masoara
 * cap-coada cand capata ecran propriu sub buton.
 */

/** Peste atat, testul cade. Nu e o convenite de test, e regula din §0. */
const MAX_TAPS = 4;

/** Cat costa doar drumul pana la ecran, fara completare. */
const NAVIGATION_BUDGET = 2;

test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, FIELD_PERSON, baseURL ?? 'http://127.0.0.1:3100');
  await installSlice(context);
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

  test('necesarul de material pleaca in trei atingeri, cap-coada', async ({ page }) => {
    await page.goto('/field');
    // Felia trebuie sa fi ajuns: fara o unitate de lucru, ecranul arata starea
    // goala si n-ar avea ce masura.
    await expect(page.getByText('Lucrarea de test')).toBeVisible();

    await resetTaps(page);

    await page.getByTestId('quick-actions-toggle').click();
    await page.getByRole('link', { name: 'Necesar material' }).click();

    // Campul e deja focalizat (`autoFocus`) si unitatea precompletata — de asta
    // scrisul nu costa un tap si alegerea lucrarii nu costa niciunul.
    await page.getByTestId('material-text').fill('20 m teava PEHD 63, 4 coliere');
    await page.getByTestId('send-request').click();

    await expect(page.getByRole('heading', { name: 'Azi' })).toBeVisible();

    const used = await taps(page);
    expect(used).toBe(3);
    expect(used).toBeLessThanOrEqual(MAX_TAPS);
  });

  test('jurnalul de santier pleaca in trei atingeri, cap-coada', async ({ page }) => {
    await page.goto('/field');
    await expect(page.getByText('Lucrarea de test')).toBeVisible();

    await resetTaps(page);

    await page.getByTestId('quick-actions-toggle').click();
    await page.getByRole('link', { name: 'Adaugă în jurnal' }).click();

    // Unitatea e precompletata, data e azi, campul e focalizat, iar etapa nu
    // apare deloc cat timp lucrarea n-are etape. Fiecare dintre ele ar fi fost
    // „corect" ca formular si ar fi costat cate un tap.
    await page.getByTestId('journal-text').fill('Turnat radier zona 2, oprit 2 ore de ploaie');
    await page.getByTestId('send-journal').click();

    await expect(page.getByRole('heading', { name: 'Azi' })).toBeVisible();

    const used = await taps(page);
    expect(used).toBe(3);
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
