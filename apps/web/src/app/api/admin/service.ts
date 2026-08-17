import 'server-only';

import { AppError } from '@damina/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Admin API-ul GoTrue, pentru rutele administrative.
 *
 * ── De ce fisierul asta exista ──────────────────────────────────────────────
 *
 * Regula 6 din §4 al pasului 02 spune ca `SUPABASE_SERVICE_ROLE_KEY` traieste
 * doar in worker si in rute `/api` dedicate. Regula nu e despre unde se executa
 * codul — un server action ar fi tot pe server — ci despre unde se poate CAUTA:
 * cu cheia intr-un loc, `grep` peste `apps/web` da un raspuns complet la
 * intrebarea „cine o atinge”.
 *
 * La 02d locul ala era chiar ruta de provizionare. La 02c′ au aparut inca doua
 * operatii care au nevoie de aceeasi cheie — revocarea sesiunii si resetarea
 * celui de-al doilea factor — iar alternativa ar fi fost sa copiem
 * `serviceClient()` in trei fisiere. Modulul sta in `app/api/admin/`, deci
 * raspunsul la „cine atinge cheia” ramane la fel de scurt: folderul asta.
 *
 * Nu e ruta: in app router doar `route.ts` si `page.tsx` devin rute, restul e
 * cod colocat.
 */

/**
 * Codul de eroare al domeniului → codul HTTP.
 *
 * `FORBIDDEN` trebuie sa iasa 403, nu 400: un `fetch` care primeste 400 pentru
 * un refuz de drepturi nu are cum sa deosebeasca „n-ai voie” de „ai trimis
 * prostii”, si nici omul din fata ecranului.
 */
export function statusForError(code: string): number {
  switch (code) {
    case 'CONFLICT':
      return 409;
    case 'NOT_FOUND':
      return 404;
    case 'FORBIDDEN':
      return 403;
    default:
      return 400;
  }
}

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || url === '' || key === undefined || key === '') {
    throw new AppError(
      'VALIDATION_FAILED',
      'Operațiunea cere SUPABASE_SERVICE_ROLE_KEY în .env.local. Cheia se ia din Supabase → Project Settings → API.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/*
 * ── Unde s-a dus revocarea de sesiuni ───────────────────────────────────────
 *
 * Nu e aici, si nu din alegere: Admin API-ul GoTrue nu poate deconecta pe
 * cineva dupa id. `auth.admin.signOut(jwt)` cere ACCESS TOKEN-UL omului — pe
 * ecranul de administrare n-ai token-ul altcuiva — iar endpoint-urile care ar
 * fi facut-o dupa id raspund 404. Prima versiune a lui 02c′ chema
 * `signOut(userId, 'global')` si primea „invalid JWT: token contains an invalid
 * number of segments”, adica exact ce trebuia sa primeasca: id-ul nu e un token.
 *
 * Revocarea traieste in `revokeSessions` din `@damina/services`, peste functia
 * `app.revoke_sessions` din migrarea 0015, care sterge randurile din
 * `auth.sessions`. Vezi migrarea pentru de ce merge si de ce e „imediat”.
 */

/**
 * Sterge toti factorii TOTP ai unui cont — reteta pentru telefonul pierdut.
 *
 * Nu e ceruta de pas, dar fara ea un `admin` care si-a schimbat telefonul e
 * blocat definitiv, iar daca e singurul administrator, aplicatia e blocata cu
 * el. Un mecanism obligatoriu fara cale de iesire nu e o masura de securitate,
 * e o capcana.
 *
 * Sesiunile se inchid separat, de catre apelant, prin `revokeSessions` din
 * servicii: un factor sters in timp ce omul are o sesiune `aal2` deschisa i-ar
 * lasa-o valida pana la expirare.
 */
export async function resetMfaFactors(
  supabase: SupabaseClient,
  authUserId: string,
): Promise<number> {
  const { data, error } = await supabase.auth.admin.mfa.listFactors({ userId: authUserId });
  if (error !== null) {
    throw new Error(`Nu am putut citi factorii de autentificare: ${error.message}`);
  }

  let removed = 0;
  for (const factor of data.factors) {
    const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({
      userId: authUserId,
      id: factor.id,
    });
    if (deleteError !== null) {
      throw new Error(`Nu am putut șterge factorul: ${deleteError.message}`);
    }
    removed += 1;
  }
  return removed;
}
