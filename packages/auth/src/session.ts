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
  /** Firma proprie, pentru personele de portal. `null` pentru birou si teren. */
  readonly subcontractorId: string | null;
  readonly clientId: string | null;
  /** Parola temporara nu s-a schimbat inca — singurul ecran permis e cel de schimbare. */
  readonly mustChangePassword: boolean;
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
      // Se trimit si cand sunt null, ca setul de claim-uri vazut de RLS prin
      // `withActor` sa fie IDENTIC cu cel din JWT. Un `null` se comporta ca o
      // absenta — `app.current_subcontractor_id()` cade atunci pe `app.persons`
      // — iar pentru birou si teren tabela raspunde tot null, garantat de
      // `persons_subcontractor_consistent` din 0004.
      subcontractor_id: session.subcontractorId,
      client_id: session.clientId,
    },
    ...(reason === undefined ? {} : { reason }),
  };
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
    // parolei: n-are parola.
    mustChangePassword: false,
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
