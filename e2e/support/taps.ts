import type { BrowserContext, Page } from '@playwright/test';

/**
 * Numaratorul de tapuri (pasul 10, §0).
 *
 * **Se masoara, nu se declara.** Contorul creste dintr-un `pointerdown` pe
 * fereastra, cu captura, deci numara ce ar numara si degetul: fiecare atingere
 * reala, indiferent ce element o primeste. Un test care ar aduna singur cate
 * `click()`-uri a scris ar fi masurat intentia autorului, nu ecranul.
 *
 * Ce NU se numara, si de ce: tastarea. Un camp de text e o interactiune, dar
 * nu e un tap — regula din teren e despre cate ATINGERI separate cere fluxul
 * pana la salvare, nu despre cate caractere. Scrisul unei cantitati e un tap
 * (intrarea in camp), nu patru.
 *
 * Contorul traieste in `sessionStorage`, nu intr-o variabila: o navigare
 * completa reincarca pagina si ar fi sters un contor din `window`, facand orice
 * flux care schimba pagina sa para mai ieftin decat e.
 */

const KEY = 'e2e:taps';

/** Se cheama pe CONTEXT, inainte de prima navigare. */
export async function installTapCounter(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.addEventListener(
      'pointerdown',
      () => {
        const current = Number(window.sessionStorage.getItem('e2e:taps') ?? '0');
        window.sessionStorage.setItem('e2e:taps', String(current + 1));
      },
      true,
    );
  });
}

/** Aduce contorul la zero. Se cheama exact la inceputul fluxului masurat. */
export async function resetTaps(page: Page): Promise<void> {
  await page.evaluate((key) => {
    window.sessionStorage.setItem(key, '0');
  }, KEY);
}

/** Cate atingeri a cerut fluxul de pana acum. */
export async function taps(page: Page): Promise<number> {
  return page.evaluate((key) => Number(window.sessionStorage.getItem(key) ?? '0'), KEY);
}
