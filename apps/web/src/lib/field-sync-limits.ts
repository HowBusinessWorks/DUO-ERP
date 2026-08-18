import { createRateLimiter } from '@damina/auth';

/**
 * Limita de rată a sincronizării de teren (pasul 10, §3.2).
 *
 * Stă într-un fișier propriu pentru că App Router acceptă doar handlere și
 * configurare exportate dintr-un `route.ts` — la fel ca `api-errors.ts`.
 *
 * **60 de sincronizări pe minut, pe (persoană, dispozitiv).** Cifra vine dintr-un
 * calcul, nu din reflex: un telefon care revine după o zi offline are de urcat
 * cel mult câteva sute de mutații, adică vreo cinci loturi. Șaizeci lasă loc de
 * retry-uri și de canalul separat de poze, și oprește totuși o buclă scăpată de
 * sub control.
 *
 * Ca la login: e o **frânare**, nu un zid. Contorul trăiește în memoria
 * procesului, deci se pierde la repornire și nu se împarte între instanțe.
 * Alternativa — un tabel în Postgres — ar fi însemnat o scriere la fiecare
 * sincronizare a fiecărui telefon, adică exact suprafața pe care vrea s-o
 * obosească o buclă scăpată.
 */
export const fieldSyncLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  // Fiecare pereche (om, telefon) e o cheie. Douăzeci de oameni cu două
  // telefoane încap de o sută de ori în plafonul ăsta.
  maxKeys: 2_000,
});
