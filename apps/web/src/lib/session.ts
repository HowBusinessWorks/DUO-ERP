import 'server-only';

import {
  actorFor,
  DEV_SESSION_COOKIE,
  parseDevSession,
  type Actor,
  type Session,
} from '@damina/auth';
import { cookies } from 'next/headers';

/**
 * Cine e in fata ecranului, citit o data per cerere.
 *
 * ATENTIE, e provizoriu: pasul 02c (Supabase Auth + JWT hook) inca nu e facut,
 * asa ca sesiunea vine dintr-un cookie de dezvoltare, iar cand acesta lipseste
 * se foloseste un administrator implicit. Nu e o gaura de securitate lasata din
 * neatentie — e o scara ridicata dinadins, si e SINGURUL loc care se schimba
 * cand soseste 02c. Tot ce e deasupra (shell, registry, ecrane) consuma deja
 * `Session` si nu va sti ca s-a schimbat ceva.
 *
 * `DEV_FALLBACK_SESSION` se activeaza doar cand `NODE_ENV !== 'production'`.
 * In productie, lipsa sesiunii inseamna redirect la autentificare.
 */

/**
 * Persoana implicita de dezvoltare. ID-ul e fix si recunoscibil in audit, ca sa
 * se vada dintr-o privire ce randuri au fost scrise inainte de a exista conturi.
 */
const DEV_PERSON_ID = '00000000-0000-7000-8000-0000000000de';

async function devFallbackSession(): Promise<Session> {
  return {
    personId: DEV_PERSON_ID,
    fullName: 'Utilizator de dezvoltare',
    persona: 'office',
    officeRoles: ['admin'],
    // Gol = toate firmele la care ajunge interogarea. `listCompanies` trateaza
    // lista goala ca „fara filtru”, nu ca „nicio firma”.
    companyIds: [],
  };
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const fromCookie = parseDevSession(store.get(DEV_SESSION_COOKIE)?.value);
  if (fromCookie !== null) {
    return fromCookie;
  }
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  return devFallbackSession();
}

/** Sesiunea sau eroare. Se foloseste unde absenta ei e un bug, nu un caz. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (session === null) {
    throw new Error('Sesiune inexistentă.');
  }
  return session;
}

/** Actorul de baza de date al cererii curente. `reason` se da la scrieri. */
export async function requireActor(reason?: string): Promise<Actor> {
  return actorFor(await requireSession(), reason);
}
