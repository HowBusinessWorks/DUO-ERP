import { isPersona, type Persona } from '@damina/shared';

/**
 * Rolurile de birou (§2). Nu schimba aplicatia — schimba dashboard-ul de start,
 * ce badge-uri apar, ce butoane sunt active si daca tab-urile financiare exista.
 */
export const OFFICE_ROLES = [
  'pm',
  'devizist',
  'achizitii',
  'magazie',
  'flota',
  'financiar',
  'admin',
] as const;

export type OfficeRole = (typeof OFFICE_ROLES)[number];

export function isOfficeRole(value: string): value is OfficeRole {
  return (OFFICE_ROLES as readonly string[]).includes(value);
}

/**
 * Cine e omul din fata ecranului. Se construieste o data, la marginea
 * sistemului, si se plimba intact prin toata randarea.
 */
export interface Session {
  readonly personId: string;
  readonly fullName: string;
  readonly persona: Persona;
  readonly officeRoles: readonly OfficeRole[];
  /** Firmele la care are acces. Selectorul de firma nu poate iesi din lista. */
  readonly companyIds: readonly string[];
  /** Firma proprie, pentru personele de portal. `null` pentru birou si teren. */
  readonly subcontractorId: string | null;
  readonly clientId: string | null;
  /** Parola temporara nu s-a schimbat inca — singurul ecran permis e cel de schimbare. */
  readonly mustChangePassword: boolean;
  /**
   * Cat de tare s-a autentificat omul, in vocabularul GoTrue: `aal1` = parola,
   * `aal2` = parola + al doilea factor.
   *
   * Nu e claim de-al nostru — il pune GoTrue nativ, langa `amr`, si hook-ul din
   * 0013 nici nu-l atinge. Conteaza ca e ASA: un claim pe care il calculeaza
   * serverul de autentificare nu poate fi influentat de datele noastre.
   */
  readonly aal: AuthenticatorLevel;
}

/** Nivelul de asigurare al autentificarii (`aal` din JWT). */
export type AuthenticatorLevel = 'aal1' | 'aal2';

export function isAuthenticatorLevel(value: string): value is AuthenticatorLevel {
  return value === 'aal1' || value === 'aal2';
}

/*
 * `canSeeFinancials` si `canEditNomenclature` s-au mutat in `permissions.ts`,
 * unde citesc din matricea rol × use-case. Suprafata publica e neschimbata: se
 * importa tot din `@damina/auth`.
 */

export function hasRole(session: Session, ...roles: readonly OfficeRole[]): boolean {
  return session.officeRoles.some((role) => roles.includes(role));
}

/**
 * ── Sesiunea de dezvoltare ──────────────────────────────────────────────────
 *
 * Pasul 03 construieste shell-ul PESTE identitate, dar pasul 02c (Supabase Auth,
 * JWT hook, provizionare) inca nu e facut. Ca sa nu blocam un pas pe altul,
 * sesiunea se rezolva provizoriu dintr-un cookie de dezvoltare.
 *
 * Contractul e ales dinadins ca sa nu ceara rescrieri: interfata si tot ce
 * consuma `Session` raman neatinse cand 02c inlocuieste functia asta cu
 * verificarea JWT-ului. Se schimba UN fisier.
 *
 * `parseDevSession` nu citeste cookie-uri singura si nu stie de Next: primeste
 * sirul brut. Asa `packages/auth` ramane fara dependinte de framework.
 */
export interface DevSessionSeed {
  readonly personId: string;
  readonly fullName: string;
  readonly persona: string;
  readonly officeRoles: readonly string[];
  readonly companyIds: readonly string[];
  readonly subcontractorId?: string | null;
  readonly clientId?: string | null;
}

export function parseDevSession(raw: string | undefined): Session | null {
  if (raw === undefined || raw === '') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const seed = parsed as Partial<DevSessionSeed>;
  if (
    typeof seed.personId !== 'string' ||
    typeof seed.fullName !== 'string' ||
    typeof seed.persona !== 'string' ||
    !isPersona(seed.persona) ||
    !Array.isArray(seed.companyIds)
  ) {
    return null;
  }

  const officeRoles = (Array.isArray(seed.officeRoles) ? seed.officeRoles : []).filter(isOfficeRole);

  return {
    personId: seed.personId,
    fullName: seed.fullName,
    persona: seed.persona,
    officeRoles,
    companyIds: seed.companyIds.filter((id): id is string => typeof id === 'string'),
    subcontractorId: typeof seed.subcontractorId === 'string' ? seed.subcontractorId : null,
    clientId: typeof seed.clientId === 'string' ? seed.clientId : null,
    // Sesiunea de dezvoltare nu trece niciodata prin ecranul de schimbare a
    // parolei: n-are parola. Din acelasi motiv e `aal2` — n-are nici al doilea
    // factor pe care sa-l ceara cineva, iar un `pnpm dev` care se opreste la un
    // cod TOTP inexistent ar fi o poarta fara usa.
    mustChangePassword: false,
    aal: 'aal2',
  };
}

export function serializeDevSession(session: Session): string {
  return JSON.stringify({
    personId: session.personId,
    fullName: session.fullName,
    persona: session.persona,
    officeRoles: session.officeRoles,
    companyIds: session.companyIds,
    subcontractorId: session.subcontractorId,
    clientId: session.clientId,
  });
}

/** Numele cookie-ului de dezvoltare. Dispare odata cu 02c. */
export const DEV_SESSION_COOKIE = 'damina_dev_session';
