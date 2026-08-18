/*
 * Service worker-ul aplicației de teren (pasul 10, §3.1).
 *
 * Scris de mână, ~70 de linii, în loc de Workbox printr-un plugin de build.
 * Motivul nu e purismul: un plugin care rescrie ieșirea lui Next e o piesă care
 * se strică la fiecare minor al framework-ului, iar ce avem nevoie aici încape
 * în două strategii. Dacă vreodată cere precache calculat din manifest, Workbox
 * se adaugă atunci — fișierul ăsta e înlocuibil fără să atingă nimic altceva.
 *
 * **Fără logică de business.** Service worker-ul nu știe ce e o fișă. Tot ce
 * ține de mutații trăiește în IndexedDB și în `lib/field/sync.ts`, unde poate fi
 * citit și testat. Un worker care ar încerca să „ajute" cu sincronizarea ar fi a
 * doua implementare a cozii, actualizată pe jumătate.
 */

const VERSION = 'damina-field-v1';
const SHELL = `${VERSION}-shell`;

/**
 * Ce se precachează: doar pagina de start a terenului și manifestul.
 *
 * Nu tot bundle-ul: hash-urile lui Next se schimbă la fiecare build, iar o listă
 * scrisă de mână ar fi expirat la primul deploy. Restul intră în cache pe măsură
 * ce e cerut — prima deschidere e oricum online.
 */
const PRECACHE = ['/field', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Doar GET-uri de pe origine. Un POST pus în cache ar fi o mutație trimisă de
  // două ori — exact ce previne jurnalul de idempotență, stricat aici.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  const url = new URL(request.url);

  /*
   * Sincronizarea NU se cachează, niciodată. Un răspuns de `/api/field/sync`
   * servit din cache ar spune telefonului că a primit felia, fără s-o fi primit.
   */
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Assets cu hash în nume: cache-first. Sunt imutabile prin construcție.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            void caches.open(SHELL).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  /*
   * Restul: network-first, cu cache-ul ca plasă. În subsol rețeaua nu răspunde
   * cu eroare, ci **atârnă** — de aia contează ordinea: încerci, și când cade,
   * servești ce ai. Invers ar fi însemnat un ecran vechi chiar când e semnal.
   */
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(SHELL).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((hit) => hit ?? caches.match('/field'))
          .then(
            (hit) =>
              hit ??
              new Response('Fără semnal și fără copie locală.', {
                status: 503,
                headers: { 'content-type': 'text/plain; charset=utf-8' },
              }),
          ),
      ),
  );
});
