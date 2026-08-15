import type { Actor } from '@damina/db';
import { PG_ROLE_BY_PERSONA } from '@damina/db';
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
}

/** Actorul de baza de date al sesiunii. `reason` se adauga per operatie. */
export function actorFor(session: Session, reason?: string): Actor {
  return {
    personId: session.personId,
    persona: session.persona,
    pgRole: PG_ROLE_BY_PERSONA[session.persona],
    claims: {
      persona: session.persona,
      person_id: session.personId,
      office_roles: session.officeRoles,
      company_ids: session.companyIds,
    },
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * Are dreptul sa vada cifre financiare?
 *
 * De aici pleaca §30 regula 5: tab-urile financiare LIPSESC pentru cine n-are
 * dreptul, nu apar gri. Functia decide ce se pune in registry, nu ce se
 * coloreaza — un tab absent nu ajunge in DOM si nu poate fi deschis cu URL.
 *
 * Izolarea reala ramane la nivel de date (roluri Postgres fara `select` pe
 * coloanele de pret, decizia 3). Asta e stratul de interfata peste ea, nu in
 * locul ei: daca cele doua nu coincid, adevarul e in baza.
 */
export function canSeeFinancials(session: Session): boolean {
  if (session.persona !== 'office') {
    return false;
  }
  return session.officeRoles.some((role) => role === 'admin' || role === 'financiar' || role === 'pm');
}

/** Poate modifica nomenclatoarele? Ele sunt comune celor 5 firme. */
export function canEditNomenclature(session: Session): boolean {
  if (session.persona !== 'office') {
    return false;
  }
  return session.officeRoles.some(
    (role) => role === 'admin' || role === 'achizitii' || role === 'devizist' || role === 'magazie',
  );
}

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
  };
}

export function serializeDevSession(session: Session): string {
  return JSON.stringify({
    personId: session.personId,
    fullName: session.fullName,
    persona: session.persona,
    officeRoles: session.officeRoles,
    companyIds: session.companyIds,
  });
}

/** Numele cookie-ului de dezvoltare. Dispare odata cu 02c. */
export const DEV_SESSION_COOKIE = 'damina_dev_session';
