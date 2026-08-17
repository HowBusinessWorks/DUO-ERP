import 'server-only';

import {
  actorFor,
  DEV_SESSION_COOKIE,
  parseDevSession,
  sessionFromClaims,
  type Actor,
  type ClaimsRejection,
  type Persona,
  type Session,
} from '@damina/auth';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { homeFor, LOGIN_PATH } from './personas';
import { decodeAccessTokenClaims } from './supabase/claims';
import { devSessionAllowed, supabaseConfig } from './supabase/config';
import { supabaseServer } from './supabase/server';

/**
 * Cine e in fata ecranului, citit o data per cerere.
 *
 * Promisiunea din pasul 03 s-a tinut: 02c a schimbat FISIERUL ASTA si nimic
 * deasupra lui. Shell-ul, registry-ul si ecranele consuma acelasi `Session`.
 *
 * Drumul normal: cookie-urile de sesiune → `getUser()` (care intreaba serverul
 * Auth, nu are incredere in cookie) → claim-urile din access token, puse de
 * `app.custom_access_token_hook` → `Session`.
 *
 * Sesiunea de dezvoltare a ramas ca scara laterala, cu conditiile stricte din
 * `devSessionAllowed()`. Nu mai e drumul implicit: cu Supabase configurat, se
 * intra prin login, altfel n-am putea nici testa login-ul.
 */

/**
 * Persoana implicita de dezvoltare. ID-ul e fix si recunoscibil in audit, ca sa
 * se vada dintr-o privire ce randuri au fost scrise inainte de a exista conturi.
 */
const DEV_PERSON_ID = '00000000-0000-7000-8000-0000000000de';

function devFallbackSession(): Session {
  return {
    personId: DEV_PERSON_ID,
    fullName: 'Utilizator de dezvoltare',
    persona: 'office',
    officeRoles: ['admin'],
    // Gol = toate firmele la care ajunge interogarea. `listCompanies` trateaza
    // lista goala ca „fara filtru”, nu ca „nicio firma”.
    companyIds: [],
    subcontractorId: null,
    clientId: null,
    mustChangePassword: false,
    // `aal2` din acelasi motiv pentru care `mustChangePassword` e `false`:
    // sesiunea de dezvoltare n-are cont in spate, deci n-are nici parola de
    // schimbat, nici al doilea factor de dovedit. Rolul ei e `admin`, care CERE
    // verificare in doi pasi — pe `aal1` ar fi trimisa la un ecran care ar
    // incerca sa inroleze un factor pentru un utilizator care nu exista.
    aal: 'aal2',
  };
}

async function devSession(): Promise<Session | null> {
  if (!devSessionAllowed()) {
    return null;
  }
  const store = await cookies();
  return parseDevSession(store.get(DEV_SESSION_COOKIE)?.value) ?? devFallbackSession();
}

/**
 * Sesiunea reala, plus motivul cand lipseste.
 *
 * Motivul urca pana la ecranul de login: „contul nu e legat de nicio persoana”
 * si „hook-ul nu e activat in proiect” arata identic pentru utilizator, dar
 * primul se rezolva in Administrare si al doilea in setarile Supabase.
 */
export async function getSessionOrReason(): Promise<
  { readonly session: Session } | { readonly session: null; readonly reason: ClaimsRejection | null }
> {
  if (supabaseConfig() !== null) {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();

    if (data.user !== null) {
      const { data: sessionData } = await supabase.auth.getSession();
      const claims = decodeAccessTokenClaims(sessionData.session?.access_token ?? '');
      const result = sessionFromClaims(claims);
      if (result.ok) {
        return { session: result.session };
      }
      return { session: null, reason: result.reason };
    }
  }

  const fallback = await devSession();
  return fallback === null ? { session: null, reason: null } : { session: fallback };
}

export async function getSession(): Promise<Session | null> {
  return (await getSessionOrReason()).session;
}

/** Sesiunea sau eroare. Se foloseste unde absenta ei e un bug, nu un caz. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (session === null) {
    throw new Error('Sesiune inexistentă.');
  }
  return session;
}

/**
 * Poarta de spatiu de lucru, chemata din layout-ul fiecarui route group.
 *
 * E a doua verificare a aceluiasi lucru pe care il verifica si middleware-ul, si
 * asta e intentionat (§3.7). Middleware-ul se bazeaza pe un `matcher` — o
 * expresie regulata pe care o poate strica oricine adauga maine o ruta. Layout-ul
 * nu poate fi ocolit: ruta lui trece prin el prin constructie.
 *
 * Raspunsul la persona gresita e REDIRECT, nu 403: un 403 pe `/contracte` ii
 * confirma unui om de teren ca ruta exista si ce e pe ea.
 */
export async function requireWorkspace(...allowed: readonly Persona[]): Promise<Session> {
  const session = await getSession();
  if (session === null) {
    redirect(LOGIN_PATH);
  }
  if (!allowed.includes(session.persona)) {
    redirect(homeFor(session.persona));
  }
  return session;
}

/** Actorul de baza de date al cererii curente. `reason` se da la scrieri. */
export async function requireActor(reason?: string): Promise<Actor> {
  return actorFor(await requireSession(), reason);
}
