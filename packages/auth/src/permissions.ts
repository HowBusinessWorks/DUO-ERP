import { AppError, type Persona } from '@damina/shared';
import { OFFICE_ROLES, type OfficeRole, type Session } from './session';

/**
 * Matricea rol de birou × use-case, intr-un SINGUR fisier (pasul 02, §3.6).
 *
 * Regula care justifica fisierul: ecranul „Administrare › Utilizatori si
 * roluri” (02d) se randeaza din tabelul de mai jos, nu dintr-o lista scrisa
 * separat in UI. Asa nu poate exista un ecran care promite un drept pe care
 * codul nu-l da, sau invers.
 *
 * Ce NU e fisierul asta: stratul care apara. Adevarul despre ce randuri si ce
 * coloane ies din baza sta in RLS si in grant-urile pe coloana (0011, 0012).
 * Aici se decide ce se randeaza si ce eroare primesti — adica sa vezi „nu ai
 * dreptul”, nu o pagina goala sau un `42501` in log.
 *
 * Lista se completeaza pe masura ce apar use-case-urile. Un drept care nu
 * exista inca nu se trece aici „ca sa fie”: o linie fara ecran in spate e o
 * promisiune pe care n-o verifica nimeni.
 */

export const CAPABILITIES = [
  'nomenclature.read',
  'nomenclature.write',
  'contracts.read',
  'contracts.write',
  'contracts.ceilings.write',
  'objectives.read',
  'objectives.write',
  'objectives.link',
  /** Lei, marje, indexari — orice cifra comerciala. */
  'financials.read',
  'periods.close',
  'audit.read',
  'admin.users',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface CapabilitySpec {
  readonly key: Capability;
  /** Gruparea din ecranul de administrare. */
  readonly group: string;
  readonly label: string;
  /** Personele care pot avea dreptul. Restul nu-l capata nici cu rol de birou. */
  readonly personas: readonly Persona[];
  /** Rolurile de birou care il au. Gol = niciunul (drept doar de persona). */
  readonly officeRoles: readonly OfficeRole[];
}

/** Toate rolurile de birou. Se scrie asa unde dreptul nu depinde de rol. */
const ALL_OFFICE: readonly OfficeRole[] = OFFICE_ROLES;

const INTERNAL: readonly Persona[] = ['office', 'field'];
const OFFICE_ONLY: readonly Persona[] = ['office'];

export const PERMISSION_MATRIX: readonly CapabilitySpec[] = [
  {
    key: 'nomenclature.read',
    group: 'Nomenclatoare',
    label: 'Vede produsele, furnizorii, clienții, calificările',
    personas: INTERNAL,
    officeRoles: ALL_OFFICE,
  },
  {
    key: 'nomenclature.write',
    group: 'Nomenclatoare',
    label: 'Adaugă și modifică nomenclatoare',
    personas: OFFICE_ONLY,
    officeRoles: ['admin', 'achizitii', 'devizist', 'magazie'],
  },
  {
    key: 'contracts.read',
    group: 'Contracte',
    label: 'Deschide contractele firmelor la care are acces',
    personas: INTERNAL,
    officeRoles: ALL_OFFICE,
  },
  {
    key: 'contracts.write',
    group: 'Contracte',
    label: 'Creează și modifică contracte și componente',
    personas: OFFICE_ONLY,
    officeRoles: ['admin', 'pm'],
  },
  {
    key: 'contracts.ceilings.write',
    group: 'Contracte',
    label: 'Stabilește plafoanele lunare și planul anual',
    personas: OFFICE_ONLY,
    officeRoles: ['admin', 'pm', 'financiar'],
  },
  {
    key: 'objectives.read',
    group: 'Obiective',
    label: 'Vede obiectivele și harta',
    personas: INTERNAL,
    officeRoles: ALL_OFFICE,
  },
  {
    key: 'objectives.write',
    group: 'Obiective',
    label: 'Adaugă și modifică obiective, fișe și profile de inspecție',
    personas: OFFICE_ONLY,
    officeRoles: ['admin', 'pm', 'devizist'],
  },
  {
    key: 'objectives.link',
    group: 'Obiective',
    label: 'Leagă obiective de contracte și schimbă frecvențele',
    personas: OFFICE_ONLY,
    officeRoles: ['admin', 'pm'],
  },
  {
    key: 'financials.read',
    group: 'Financiar',
    label: 'Vede valori, marje și indexări',
    // Terenul si portalurile lipsesc DIN CONSTRUCTIE, nu din configurare:
    // rolurile lor Postgres n-au `select` pe coloanele de bani (0012).
    personas: OFFICE_ONLY,
    officeRoles: ['admin', 'financiar', 'pm'],
  },
  {
    key: 'periods.close',
    group: 'Financiar',
    label: 'Închide și redeschide luna',
    personas: OFFICE_ONLY,
    officeRoles: ['admin', 'financiar'],
  },
  {
    key: 'audit.read',
    group: 'Administrare',
    label: 'Citește jurnalul de audit',
    // Doar `admin`. Verificarea #19 din pas: `financiar` nu are acces, iar
    // politica de pe `audit.entries` spune acelasi lucru in baza.
    personas: OFFICE_ONLY,
    officeRoles: ['admin'],
  },
  {
    key: 'admin.users',
    group: 'Administrare',
    label: 'Administrează persoane, roluri și conturi',
    personas: OFFICE_ONLY,
    officeRoles: ['admin'],
  },
];

const BY_KEY: ReadonlyMap<Capability, CapabilitySpec> = new Map(
  PERMISSION_MATRIX.map((spec) => [spec.key, spec]),
);

export function can(session: Session, capability: Capability): boolean {
  const spec = BY_KEY.get(capability);
  if (spec === undefined) {
    return false;
  }
  if (!spec.personas.includes(session.persona)) {
    return false;
  }
  // Personele non-birou n-au roluri: pentru ele decide doar linia `personas`.
  if (session.persona !== 'office') {
    return true;
  }
  return session.officeRoles.some((role) => spec.officeRoles.includes(role));
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
  return can(session, 'financials.read');
}

/** Poate modifica nomenclatoarele? Ele sunt comune celor 5 firme. */
export function canEditNomenclature(session: Session): boolean {
  return can(session, 'nomenclature.write');
}

/** Ce vede si ce NU vede rolul curent. Ecranul de administrare cere ambele liste. */
export function capabilitiesOf(session: Session): {
  readonly granted: readonly CapabilitySpec[];
  readonly denied: readonly CapabilitySpec[];
} {
  const granted: CapabilitySpec[] = [];
  const denied: CapabilitySpec[] = [];
  for (const spec of PERMISSION_MATRIX) {
    (can(session, spec.key) ? granted : denied).push(spec);
  }
  return { granted, denied };
}

/*
 * ── Guard-uri ───────────────────────────────────────────────────────────────
 *
 * Sunt AL DOILEA strat, nu primul (§3.6). Primul e RLS. Rolul lor e sa dea o
 * eroare buna — 403 cu mesaj in romana — in locul unei liste goale sau al unui
 * `42501` care ajunge in log ca eroare de sistem.
 */

export function requirePersona(session: Session, ...personas: readonly Persona[]): void {
  if (!personas.includes(session.persona)) {
    throw AppError.forbidden('Ecranul acesta nu aparține spațiului tău de lucru.');
  }
}

export function requireOfficeRole(session: Session, ...roles: readonly OfficeRole[]): void {
  if (session.persona !== 'office' || !session.officeRoles.some((role) => roles.includes(role))) {
    throw AppError.forbidden('Rolul tău nu deschide ecranul acesta.');
  }
}

export function requireCapability(session: Session, capability: Capability): void {
  if (!can(session, capability)) {
    const spec = BY_KEY.get(capability);
    throw AppError.forbidden(
      spec === undefined
        ? 'Nu ai dreptul pentru această operațiune.'
        : `Nu ai dreptul „${spec.label}”.`,
    );
  }
}
