import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { isPersona } from '@damina/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { CHANGE_PASSWORD_PATH, canEnter, homeFor, isPublicPath, LOGIN_PATH } from './lib/personas';
import { decodeAccessTokenClaims } from './lib/supabase/claims';
import { devSessionAllowed, supabaseConfig } from './lib/supabase/config';

/**
 * Middleware-ul de sesiune (§3.5, §3.7). Face trei lucruri, in ordinea asta:
 *
 *   1. **Reimprospateaza token-ul.** Singurul loc din aplicatie care POATE
 *      scrie cookie-uri la fiecare cerere; un Server Component nu poate. Fara
 *      el, sesiunea ar muri dupa o ora si omul ar fi dat afara in mijlocul unui
 *      formular.
 *   2. **Duce la login** cine n-are sesiune, cu ruta ceruta pastrata in `next`.
 *   3. **Tine fiecare persona in spatiul ei.** Redirect, nu 403 (§3.7).
 *
 * E primul strat, nu singurul: layout-urile refac verificarea, iar sub ele stau
 * RLS si grant-urile pe coloana. Un middleware ocolit nu deschide date — face
 * doar ca refuzul sa vina mai tarziu si mai urat.
 */
export async function middleware(request: NextRequest) {
  const config = supabaseConfig();
  const { pathname, search } = request.nextUrl;

  // Pe sesiunea de dezvoltare middleware-ul nu are ce reimprospata si n-are
  // dreptul sa blocheze — altfel `pnpm dev` pe un checkout proaspat ar fi un
  // ecran de login fara niciun cont in spate. Conditiile exacte sunt in
  // `devSessionAllowed`, si sunt aceleasi pe care le foloseste `lib/session.ts`.
  if (config === null || devSessionAllowed()) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(items: { name: string; value: string; options: CookieOptions }[]) {
        for (const item of items) {
          request.cookies.set(item.name, item.value);
        }
        response = NextResponse.next({ request });
        for (const item of items) {
          response.cookies.set(item.name, item.value, {
            ...item.options,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
          });
        }
      },
    },
  });

  // `getUser`, nu `getSession`: primul intreaba serverul Auth daca token-ul e
  // valid, al doilea are incredere in cookie. Aici se ia o decizie de acces.
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (user === null) {
    if (isPublicPath(pathname)) {
      return response;
    }
    return redirectToLogin(request, `${pathname}${search}`);
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const claims = decodeAccessTokenClaims(sessionData.session?.access_token ?? '');
  const record = typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : {};
  const persona = record['persona'];

  // Cont valid, dar fara persoana in nomenclator (sau cu una dezactivata).
  // Ecranul de login stie sa explice; aici doar il scoatem din aplicatie.
  if (typeof persona !== 'string' || !isPersona(persona)) {
    if (isPublicPath(pathname)) {
      return response;
    }
    return redirectToLogin(request, `${pathname}${search}`);
  }

  // Parola temporara: singurul ecran permis e cel de schimbare. Verificarea #15
  // cere sa nu se poata sari peste, deci se aplica inaintea rutarii pe persone.
  if (record['must_change_password'] === true && pathname !== CHANGE_PASSWORD_PATH) {
    return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, request.url));
  }

  if (pathname === LOGIN_PATH || pathname === '/') {
    return NextResponse.redirect(new URL(homeFor(persona), request.url));
  }

  if (!isPublicPath(pathname) && pathname !== CHANGE_PASSWORD_PATH && !canEnter(persona, pathname)) {
    return NextResponse.redirect(new URL(homeFor(persona), request.url));
  }

  return response;
}

function redirectToLogin(request: NextRequest, next: string): NextResponse {
  const url = new URL(LOGIN_PATH, request.url);
  if (next !== '/' && next !== '') {
    url.searchParams.set('next', next);
  }
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Tot, in afara de fisierele statice si de imaginile optimizate de Next.
   * Cererile alea nu poarta decizie de acces si ar plati degeaba un round-trip
   * la serverul Auth.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
