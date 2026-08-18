'use client';

import { useEffect } from 'react';

/**
 * Inregistrarea service worker-ului (pasul 10, §3.1).
 *
 * Doar in `(field)`, si doar in productie. In dezvoltare un service worker
 * serveste bundle-uri vechi din cache dupa fiecare salvare, iar cinci minute
 * pierdute intrebandu-te de ce nu se schimba nimic sunt cinci minute pe care
 * nu le castiga inapoi niciun offline.
 *
 * `scope: '/field'` nu e cosmetic: aplicatia de birou n-are voie sa fie servita
 * din cache. Ea arata bani si stari care se schimba sub tine, iar un ecran de
 * contract vechi de o ora e mai rau decat unul care nu se incarca.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/field' }).catch(() => {
      // Un service worker care nu se inregistreaza nu e o eroare de aratat
      // omului: aplicatia merge, doar ca fara cache de shell.
    });
  }, []);

  return null;
}
