import 'server-only';

import { supabaseServer } from '../../lib/supabase/server';

/**
 * Starea celui de-al doilea factor, citita din GoTrue la randarea ecranului.
 *
 * ── De ce nu sta in JWT ─────────────────────────────────────────────────────
 *
 * Token-ul spune `aal1` sau `aal2` — adica DACA omul si-a dovedit al doilea
 * factor acum — dar nu spune daca are unul configurat. Sunt doua intrebari
 * diferite si duc la doua ecrane diferite: „scaneaza codul asta” pentru cine
 * n-are, „scrie codul din aplicatie” pentru cine are. Diferenta se afla doar
 * intrebandu-l pe GoTrue, si se intreaba o singura data, aici, nu in middleware
 * — middleware-ul ruleaza la fiecare cerere si un round-trip in plus acolo s-ar
 * plati pe toata aplicatia.
 */

export type MfaState =
  | {
      /** N-are inca niciun factor confirmat: se configureaza acum. */
      readonly kind: 'enroll';
      readonly factorId: string;
      /** SVG gata de pus in `<img src>`. GoTrue il intoarce ca data URI. */
      readonly qrCode: string;
      /** Aceeasi cheie, pentru cine nu poate scana. */
      readonly secret: string;
    }
  | {
      /** Are factor confirmat: trebuie doar sa dovedeasca. */
      readonly kind: 'challenge';
      readonly factorId: string;
    }
  | { readonly kind: 'failed' };

const FRIENDLY_NAME = 'Damina ERP';

export async function mfaState(): Promise<MfaState> {
  const supabase = await supabaseServer();

  /*
   * `getUser()`, nu `mfa.listFactors()`, si diferenta ne-a costat o repornire
   * de ecran ca s-o aflam.
   *
   * `listFactors()` citeste lista din utilizatorul deja aflat in sesiune — adica
   * din cookie. Cookie-ul se scrie la login si NU se rescrie cand se inroleaza
   * un factor, deci a doua deschidere a ecranului vedea o lista goala desi
   * factorul exista. Urma un `enroll` care cadea cu 422, „A factor with the
   * friendly name «Damina ERP» for this user already exists”, si omul primea
   * „nu am putut porni configurarea” la fiecare refresh.
   *
   * `getUser()` intreaba serverul Auth, ca peste tot in aplicatie unde se ia o
   * decizie. Aceeasi regula, acelasi motiv.
   */
  const { data: userData, error } = await supabase.auth.getUser();
  if (error !== null || userData.user === null) {
    return { kind: 'failed' };
  }

  const factors = (userData.user.factors ?? []).filter(
    (factor) => factor.factor_type === 'totp',
  );

  const verified = factors.find((factor) => factor.status === 'verified');
  if (verified !== undefined) {
    return { kind: 'challenge', factorId: verified.id };
  }

  /*
   * Factorii nefinalizati se sterg inainte de a incepe unul nou.
   *
   * Motivul e ca `enroll` intoarce cheia SECRETA o singura data, la creare — la
   * un refresh n-o mai putem afla, deci n-am putea reafisa acelasi QR. Asa,
   * exista mereu cel mult unul, si e cel de pe ecran.
   *
   * Numele fix e ce face curatenia VERIFICABILA: daca `enroll` de mai jos cade
   * cu 422 pe nume duplicat, inseamna ca pasul asta n-a rulat. Un nume unic per
   * incercare ar fi ascuns exact eroarea pe care vrem s-o vedem.
   */
  for (const stale of factors) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }

  const { data, error: enrollError } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: FRIENDLY_NAME,
  });

  if (enrollError !== null || data === null) {
    return { kind: 'failed' };
  }

  return {
    kind: 'enroll',
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}
