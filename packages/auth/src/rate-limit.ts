/**
 * Limitatorul de incercari la login (§5: „doar pe login, simplu, pe IP”).
 *
 * ── Ce apara si ce nu ───────────────────────────────────────────────────────
 *
 * Apara impotriva unui atacator care incearca parole una dupa alta pe acelasi
 * cont, de pe aceeasi masina. Nu apara impotriva unui botnet cu o mie de IP-uri
 * si nici nu pretinde ca o face — pentru asta exista limita proprie a lui GoTrue
 * (raspunsul 429, tradus deja in `authMessage`), care e centralizata si vede
 * toate instantele.
 *
 * ── De ce e in memorie ──────────────────────────────────────────────────────
 *
 * Fereastra e mica si contorul e o optimizare, nu o garantie: numaratoarea se
 * pierde la repornire si nu se imparte intre procese. Alternativa — un tabel in
 * Postgres — ar fi insemnat o scriere la fiecare incercare de login, adica exact
 * suprafata pe care vrea s-o oboseasca un atacator. Un contor care se poate
 * reseta e mai bun decat un contor care poate fi folosit ca amplificator.
 *
 * Fisierul e pur: nu stie de Next, de cereri sau de ceas. Ceasul se injecteaza,
 * ca sa poata fi testat fara sa astepte.
 */

export interface RateLimitOptions {
  /** Cate incercari sunt permise intr-o fereastra. */
  readonly limit: number;
  /** Lungimea ferestrei, in milisecunde. */
  readonly windowMs: number;
  /**
   * Cate chei se tin minte. Peste plafon, cele mai vechi se uita.
   *
   * Fara el, o singura sursa care variaza adresa la fiecare cerere ar umple
   * memoria procesului — adica un limitator de incercari ar deveni chiar el
   * calea de a darama serverul.
   */
  readonly maxKeys?: number;
  /** Ceasul. Injectat ca sa poata fi testat. */
  readonly now?: () => number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Cate incercari mai sunt in fereastra curenta. */
  readonly remaining: number;
  /** Peste cat timp se elibereaza o incercare. `0` cand nu e blocat. */
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  /** Inregistreaza o incercare si spune daca era permisa. */
  readonly hit: (key: string) => RateLimitVerdict;
  /** Sterge istoricul unei chei. Se cheama dupa un login REUSIT. */
  readonly reset: (key: string) => void;
}

const DEFAULT_MAX_KEYS = 5_000;

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const now = options.now ?? Date.now;

  // `Map` isi tine cheile in ordinea inserarii, deci prima cheie e si cea mai
  // veche atinsa — de aia stergerea la plafon nu are nevoie de un heap.
  const hits = new Map<string, number[]>();

  function fresh(key: string, at: number): number[] {
    const previous = hits.get(key) ?? [];
    const kept = previous.filter((stamp) => at - stamp < windowMs);
    // Reinserarea muta cheia la coada, ca sa nu fie uitata cea activa.
    hits.delete(key);
    hits.set(key, kept);
    return kept;
  }

  return {
    hit(key: string): RateLimitVerdict {
      const at = now();
      const stamps = fresh(key, at);

      if (stamps.length >= limit) {
        const oldest = stamps[0] ?? at;
        return {
          allowed: false,
          remaining: 0,
          // Cat mai are de asteptat pana pica cea mai veche incercare din
          // fereastra. Nu se inregistreaza incercarea respinsa: altfel cine
          // insista si-ar impinge singur fereastra la infinit.
          retryAfterMs: Math.max(0, windowMs - (at - oldest)),
        };
      }

      stamps.push(at);
      while (hits.size > maxKeys) {
        const oldestKey = hits.keys().next().value;
        if (oldestKey === undefined) {
          break;
        }
        hits.delete(oldestKey);
      }

      return { allowed: true, remaining: limit - stamps.length, retryAfterMs: 0 };
    },

    reset(key: string): void {
      hits.delete(key);
    },
  };
}
