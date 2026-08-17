import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

/** Un ceas pe care il misc eu, ca testele sa nu astepte. */
function clock(start = 1_000_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

describe('limitatorul de incercari la login', () => {
  it('lasa sa treaca pana la plafon, apoi refuza', () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: time.now });

    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip').allowed).toBe(true);
    expect(limiter.hit('ip')).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
    expect(limiter.hit('ip').allowed).toBe(false);
  });

  it('nu impinge fereastra la fiecare incercare respinsa', () => {
    // Daca incercarile refuzate s-ar inregistra si ele, cine insista si-ar
    // prelungi singur pedeapsa la infinit — si n-ar mai iesi niciodata din ea.
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: time.now });

    limiter.hit('ip');
    time.advance(30_000);
    expect(limiter.hit('ip').retryAfterMs).toBe(30_000);
    time.advance(20_000);
    expect(limiter.hit('ip').retryAfterMs).toBe(10_000);
    time.advance(10_001);
    expect(limiter.hit('ip').allowed).toBe(true);
  });

  it('numara separat fiecare cheie', () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: time.now });

    expect(limiter.hit('a').allowed).toBe(true);
    expect(limiter.hit('b').allowed).toBe(true);
    expect(limiter.hit('a').allowed).toBe(false);
  });

  it('uita istoricul dupa un login reusit', () => {
    const time = clock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: time.now });

    limiter.hit('ip');
    limiter.hit('ip');
    limiter.reset('ip');
    expect(limiter.hit('ip').allowed).toBe(true);
  });

  it('nu creste la nesfarsit cand cheile sunt mereu altele', () => {
    // Un limitator care poate fi umplut cu chei inventate ar fi el insusi calea
    // de a darama procesul.
    const time = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10, now: time.now });

    for (let i = 0; i < 500; i += 1) {
      limiter.hit(`ip-${i}`);
    }
    // Cheia veche a fost uitata, deci are din nou dreptul la o incercare.
    expect(limiter.hit('ip-0').allowed).toBe(true);
    // Cea recenta e inca tinuta minte.
    expect(limiter.hit('ip-499').allowed).toBe(false);
  });
});
