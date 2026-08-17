'use server';

import { actorFor, createRateLimiter, mfaSatisfied, sessionFromClaims } from '@damina/auth';
import { roRO } from '@damina/i18n';
import { clearMustChangePassword } from '@damina/services';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CHANGE_PASSWORD_PATH, homeFor, LOGIN_PATH, MFA_PATH } from '../../lib/personas';
import type { AuthFormState } from './form-state';
import { decodeAccessTokenClaims } from '../../lib/supabase/claims';
import { supabaseServer } from '../../lib/supabase/server';

/**
 * Autentificarea, ca server actions.
 *
 * Toate cele patru operatii stau pe server pentru ca acolo stau si cookie-urile:
 * `httpOnly` inseamna ca browser-ul nu are cum sa scrie el sesiunea. Efectul
 * secundar util e ca parola nu trece niciodata prin starea unui component de
 * client — pleaca din `<form>` direct in cererea POST.
 */

/** Parola minima ceruta de politica din §3.5. Supabase o verifica si el. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Limita de incercari la login (§5: „simplu, pe IP”).
 *
 * Zece incercari la zece minute e larg pentru un om care greseste parola si
 * strans pentru un program care le incearca pe rand. Contorul e in memoria
 * procesului: se pierde la repornire si nu se imparte intre instante. E o
 * franare, nu un zid — zidul e limita proprie a lui GoTrue, care vede toate
 * instantele si raspunde 429 (tradus mai jos).
 */
const loginLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

/**
 * De unde vine cererea.
 *
 * In spatele unui proxy, `x-forwarded-for` e o lista, iar prima adresa e a
 * clientului. E un antet pe care clientul il poate minti daca ajunge direct la
 * aplicatie — inca un motiv pentru care limitatorul asta e o franare, nu o
 * aparare. Cheia include si emailul, ca sa nu blocheze un birou intreg iesit
 * prin acelasi NAT doar pentru ca unul dintre ei si-a uitat parola.
 */
async function limiterKey(email: string): Promise<string> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() ?? '';
  return `${ip === '' ? 'necunoscut' : ip}|${email.toLowerCase()}`;
}

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Erorile GoTrue in romana.
 *
 * „Email sau parola gresite” e deliberat acelasi mesaj si cand emailul nu
 * exista, si cand parola e gresita: doua mesaje diferite spun unui atacator
 * care adrese sunt conturi reale.
 */
function authMessage(error: { message: string; status?: number }): string {
  if (error.status === 429) {
    return roRO.auth.rateLimited;
  }
  const message = error.message.toLowerCase();
  if (message.includes('invalid login credentials') || message.includes('invalid')) {
    return roRO.auth.invalidCredentials;
  }
  if (message.includes('password')) {
    return roRO.auth.passwordRejected;
  }
  return roRO.auth.generic;
}

/**
 * Unde duce sesiunea proaspata. Se citeste din token, nu din formular: persona
 * o decide baza de date, prin hook, si nimeni altcineva.
 */
async function landingPath(accessToken: string | undefined, requested: string): Promise<string> {
  const result = sessionFromClaims(decodeAccessTokenClaims(accessToken ?? ''));
  if (!result.ok) {
    // Token valid, dar fara persoana in spate. `/login` stie sa explice care
    // din cazuri e; aici nu ghicim.
    return LOGIN_PATH;
  }
  if (result.session.mustChangePassword) {
    return CHANGE_PASSWORD_PATH;
  }
  // Al doilea factor vine dupa parola, si inaintea oricarui ecran de lucru.
  // Middleware-ul face acelasi calcul la fiecare cerere; aici il facem ca omul
  // sa nu vada o clipa dashboard-ul din care e scos imediat.
  if (!mfaSatisfied(result.session)) {
    return MFA_PATH;
  }
  // `next` se accepta doar ca ruta interna. Un `next` absolut ar face din
  // ecranul de login un redirector catre orice site.
  const safeNext = requested.startsWith('/') && !requested.startsWith('//') ? requested : '';
  return safeNext === '' ? homeFor(result.session.persona) : safeNext;
}

export async function signIn(_state: AuthFormState, data: FormData): Promise<AuthFormState> {
  const email = field(data, 'email');
  const password = String(data.get('password') ?? '');

  if (email === '' || password === '') {
    return { error: roRO.auth.invalidCredentials };
  }

  const key = await limiterKey(email);
  if (!loginLimiter.hit(key).allowed) {
    // Acelasi mesaj ca la 429-ul lui GoTrue: pentru omul din fata ecranului,
    // cele doua limite sunt acelasi lucru.
    return { error: roRO.auth.rateLimited };
  }

  const supabase = await supabaseServer();
  const { data: signed, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error !== null) {
    return { error: authMessage(error) };
  }

  // Cine a nimerit parola nu mai are de ce sa fie numarat: contorul e pentru
  // ghicit, nu pentru cat de des te loghezi.
  loginLimiter.reset(key);

  redirect(await landingPath(signed.session?.access_token, field(data, 'next')));
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect(LOGIN_PATH);
}

export async function requestPasswordReset(
  _state: AuthFormState,
  data: FormData,
): Promise<AuthFormState> {
  const email = field(data, 'email');
  if (email === '') {
    return { error: roRO.auth.generic };
  }

  const supabase = await supabaseServer();
  const origin = field(data, 'origin');
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(CHANGE_PASSWORD_PATH)}`,
  });

  // Raspunsul nu se uita la eroare, si nu e o scapare: un ecran care spune
  // „adresa asta nu exista” e un instrument de enumerare a conturilor.
  redirect('/resetare?trimis=1');
}

export async function changePassword(
  _state: AuthFormState,
  data: FormData,
): Promise<AuthFormState> {
  const password = String(data.get('password') ?? '');
  const confirmation = String(data.get('confirmation') ?? '');

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: roRO.auth.passwordTooShort };
  }
  if (password !== confirmation) {
    return { error: roRO.auth.passwordMismatch };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error !== null) {
    return { error: authMessage(error) };
  }

  /*
   * Ordinea de aici conteaza, si e singura care functioneaza:
   *
   *   1. parola noua la GoTrue;
   *   2. flagul stins in baza — altfel `must_change_password` ramane `true`;
   *   3. token reimprospatat, ca hook-ul sa RECITEASCA flagul deja stins.
   *
   * Fara pasul 3, omul si-ar schimba parola si ar fi trimis inapoi la acelasi
   * ecran de middleware, la nesfarsit: claim-ul din token inca spune „trebuie
   * sa-ti schimbi parola”.
   */
  const { data: current } = await supabase.auth.getSession();
  const result = sessionFromClaims(decodeAccessTokenClaims(current.session?.access_token ?? ''));
  if (!result.ok) {
    return { error: roRO.auth.malformed };
  }

  await clearMustChangePassword(actorFor(result.session, 'schimbare de parola'));
  const { data: refreshed } = await supabase.auth.refreshSession();

  redirect(await landingPath(refreshed.session?.access_token, ''));
}

/**
 * Confirma codul din aplicatia de autentificare.
 *
 * Acopera amandoua cazurile — primul cod, care CONFIRMA factorul proaspat
 * inrolat, si codul de la fiecare login ulterior — pentru ca GoTrue le face la
 * fel: `challengeAndVerify` cere o provocare si o rezolva dintr-o miscare, iar
 * un factor `unverified` devine `verified` la prima reusita.
 *
 * Efectul secundar e cel care conteaza: raspunsul aduce o pereche noua de
 * token-uri, cu `aal2`, iar clientul de server le scrie in cookie-uri. De acolo
 * incolo middleware-ul nu-l mai opreste.
 */
export async function verifyMfaCode(
  _state: AuthFormState,
  data: FormData,
): Promise<AuthFormState> {
  const factorId = field(data, 'factorId');
  const code = field(data, 'code').replace(/\s+/g, '');

  if (factorId === '' || code === '') {
    return { error: roRO.mfa.invalidCode };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error !== null) {
    // Un cod gresit si un cod expirat sunt acelasi lucru pentru om: mai
    // incearca. GoTrue le distinge, dar distinctia nu-l ajuta cu nimic.
    return { error: error.status === 429 ? roRO.auth.rateLimited : roRO.mfa.invalidCode };
  }

  const { data: refreshed } = await supabase.auth.getSession();
  redirect(await landingPath(refreshed.session?.access_token, ''));
}
