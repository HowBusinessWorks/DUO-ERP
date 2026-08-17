/**
 * Coordonatele proiectului Supabase, citite dintr-un singur loc.
 *
 * `NEXT_PUBLIC_*` se inlocuiesc la build de Next, deci trebuie scrise ca acces
 * literal la `process.env.X` — o citire dinamica (`process.env[name]`) ramane
 * `undefined` in browser. De aceea sunt copiate aici pe litere, nu intr-o bucla.
 *
 * Cheia anonima e publica prin definitie: tot ce apara datele in spatele ei e
 * RLS. Cheia de service NU trece niciodata pe aici (§4.6) — ea traieste doar in
 * worker si in scripturile de provizionare.
 */
export interface SupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || url === '' || anonKey === undefined || anonKey === '') {
    return null;
  }
  return { url, anonKey };
}

/**
 * Mai merge sesiunea de dezvoltare (cea dinaintea lui 02c)?
 *
 * Doua cazuri, si niciunul nu e implicit in productie:
 *
 *   1. **Supabase neconfigurat** si nu suntem in productie — un checkout
 *      proaspat, fara `.env.local`, trebuie sa porneasca si sa arate ecranele.
 *      Cu Auth configurat, drumul e login-ul real: altfel n-am putea nici
 *      macar testa login-ul, pentru ca sesiunea implicita ne-ar duce direct in
 *      aplicatie.
 *   2. **`ALLOW_DEV_SESSION=1`**, pus explicit in `apps/web/.env.local` (fisier
 *      ignorat de git). E scara pe care se urca cine vrea sa parcurga ecranele
 *      fara cont — cum s-a facut parcursul pasului 04b.
 *
 * Predicatul traieste aici, si nu in `lib/session.ts`, pentru ca il citeste si
 * middleware-ul, care ruleaza pe Edge si n-are voie sa atinga `@damina/db`.
 */
export function devSessionAllowed(): boolean {
  if (process.env.ALLOW_DEV_SESSION === '1') {
    return true;
  }
  return supabaseConfig() === null && process.env.NODE_ENV !== 'production';
}

/**
 * Aceeasi configuratie, dar obligatorie. Se cheama pe drumurile care nu au ce
 * face fara ea (login, schimbare de parola): un mesaj clar la prima cerere e
 * mai bun decat o eroare de retea la a treia.
 */
export function requireSupabaseConfig(): SupabaseConfig {
  const config = supabaseConfig();
  if (config === null) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL și NEXT_PUBLIC_SUPABASE_ANON_KEY lipsesc. Completează .env.local.',
    );
  }
  return config;
}
