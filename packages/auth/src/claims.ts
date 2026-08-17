import { isPersona } from '@damina/shared';
import {
  isAuthenticatorLevel,
  isOfficeRole,
  type AuthenticatorLevel,
  type OfficeRole,
  type Session,
} from './session';

/**
 * JWT-ul emis de GoTrue → `Session`.
 *
 * Claim-urile sunt puse de `app.custom_access_token_hook` (migrarea 0013).
 * Aici NU se verifica semnatura: pana la locul asta, token-ul a trecut deja
 * prin `supabase.auth.getUser()`, care intreaba serverul Auth. Un parser care
 * si-ar valida singur semnatura ar fi al doilea loc care decide daca cineva e
 * autentificat, si doua locuri se contrazic mai devreme sau mai tarziu.
 *
 * Ce face in schimb: refuza tot ce nu recunoaste. Un claim `persona` cu o
 * valoare inventata nu produce o sesiune ciudata, ci nicio sesiune.
 */

/** De ce nu exista sesiune. Ecranul de login spune omului exact care din ele. */
export type ClaimsRejection =
  /** Token valid, dar contul nu e legat de nicio persoana din nomenclator. */
  | 'unlinked'
  /** Persoana exista, dar e dezactivata. */
  | 'inactive'
  /** Token fara claim-urile noastre: hook-ul nu e activat in proiectul Supabase. */
  | 'no_claims'
  /** Claim-uri prezente, dar deteriorate. Nu se intampla in mod normal. */
  | 'malformed';

export type ClaimsResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly reason: ClaimsRejection };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function sessionFromClaims(claims: unknown): ClaimsResult {
  if (typeof claims !== 'object' || claims === null) {
    return { ok: false, reason: 'no_claims' };
  }

  const raw = claims as Record<string, unknown>;
  const status = asString(raw['damina_status']);

  if (status === 'unlinked' || status === 'inactive') {
    return { ok: false, reason: status };
  }

  // Nici status, nici persona: hook-ul n-a rulat deloc. E o eroare de
  // configurare a proiectului, nu a utilizatorului, si merita mesaj propriu —
  // altfel toata lumea vede „contul tau nu e configurat” si nimeni nu se uita
  // in setarile Supabase.
  if (status === null && raw['persona'] === undefined) {
    return { ok: false, reason: 'no_claims' };
  }

  const persona = asString(raw['persona']);
  const personId = asString(raw['person_id']);
  if (persona === null || !isPersona(persona) || personId === null) {
    return { ok: false, reason: 'malformed' };
  }

  const officeRoles: readonly OfficeRole[] =
    persona === 'office' ? asStringArray(raw['office_roles']).filter(isOfficeRole) : [];

  return {
    ok: true,
    session: {
      personId,
      // Numele lipsa nu invalideaza sesiunea: e eticheta din coltul ecranului,
      // nu o cheie de acces.
      fullName: asString(raw['full_name']) ?? 'Utilizator',
      persona,
      officeRoles,
      companyIds: asStringArray(raw['company_ids']),
      subcontractorId: asString(raw['subcontractor_id']),
      clientId: asString(raw['client_id']),
      mustChangePassword: raw['must_change_password'] === true,
      aal: authenticatorLevel(raw['aal']),
    },
  };
}

/**
 * `aal` lipsa sau necunoscut se citeste ca `aal1`, adica „nu s-a dovedit al
 * doilea factor”.
 *
 * Directia contează: un claim deteriorat trebuie sa te faca sa ceri mai mult, nu
 * mai putin. Daca maine GoTrue scoate un `aal3`, un admin va fi trimis o data
 * degeaba la ecranul de verificare — enervant, dar nu deschis.
 */
function authenticatorLevel(value: unknown): AuthenticatorLevel {
  return typeof value === 'string' && isAuthenticatorLevel(value) ? value : 'aal1';
}
