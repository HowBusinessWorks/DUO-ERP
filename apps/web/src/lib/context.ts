import 'server-only';

import { type Actor, type Session } from '@damina/auth';
import {
  getPeriodContext,
  listCompanies,
  type CompanyOption,
  type PeriodContext,
} from '@damina/services';
import { cookies } from 'next/headers';
import { requireActor, requireSession } from './session';

/**
 * Contextul global de firma si de luna (I8).
 *
 * Cum e tinut: intr-un cookie, citit identic in layout si in fiecare pagina.
 *
 * De ce nu in URL, desi planul spune „URL + cookie”: shell-ul (sidebar, bara de
 * sus, badge-uri) traieste in `layout.tsx`, iar in Next 15 layout-urile NU
 * primesc `searchParams`. Cu contextul in URL, layout-ul si pagina ar citi din
 * doua surse diferite si s-ar contrazice exact in cazul care conteaza — omul
 * schimba luna si sidebar-ul ramane pe cea veche. Cookie-ul e citit de amandoua,
 * deci nu au cum sa divergheze, si persista intre sesiuni, ceea ce planul cere
 * explicit. Pretul: un link copiat nu poarta contextul. Se plateste cand exista
 * un caz real care il cere.
 */

const CONTEXT_COOKIE = 'damina_ctx';

export type CompanyMode = 'one' | 'some' | 'all';
/** Cum se citeste vederea pe mai multe firme (§5.1). */
export type ConsolidationMode = 'consolidated' | 'gross';

interface StoredContext {
  readonly companyIds: readonly string[];
  readonly consolidation: ConsolidationMode;
  readonly year: number;
  readonly month: number;
}

export interface AppContext {
  readonly session: Session;
  /** Actorul de baza de date al cererii. Se plimba mai departe intact. */
  readonly actor: Actor;
  readonly companies: readonly CompanyOption[];
  /** Firmele bifate acum. Niciodata goala: cade pe toate cele accesibile. */
  readonly selectedCompanyIds: readonly string[];
  readonly companyMode: CompanyMode;
  readonly consolidation: ConsolidationMode;
  readonly year: number;
  readonly month: number;
  readonly period: PeriodContext;
}

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function parseStored(raw: string | undefined): Partial<StoredContext> {
  if (raw === undefined || raw === '') {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<StoredContext>) : {};
  } catch {
    return {};
  }
}

/**
 * Contextul complet al cererii. Se cheama in layout si in pagini deopotriva.
 *
 * Face doua interogari (firme + starea lunii). Ambele sunt mici si indexate, si
 * ambele sunt necesare inainte de prima cifra afisata — de aceea nu sunt in
 * `Suspense`: un shell care apare fara sa stie pe ce firma esti e mai rau decat
 * unul care apare cu 20 ms mai tarziu.
 */
export async function getAppContext(): Promise<AppContext> {
  const session = await requireSession();
  const actor = await requireActor();
  const store = await cookies();
  const stored = parseStored(store.get(CONTEXT_COOKIE)?.value);

  const companies = await listCompanies(actor, session.companyIds);
  const allIds = companies.map((company) => company.id);

  // Selectia se intersecteaza mereu cu ce e permis: o firma la care omul a
  // pierdut accesul nu ramane bifata pentru ca asa scria in cookie.
  const requested = Array.isArray(stored.companyIds) ? stored.companyIds : [];
  const selected = requested.filter((id) => allIds.includes(id));
  const selectedCompanyIds = selected.length > 0 ? selected : allIds;

  const fallback = currentPeriod();
  const year = isValidYear(stored.year) ? stored.year : fallback.year;
  const month = isValidMonth(stored.month) ? stored.month : fallback.month;

  const period = await getPeriodContext(actor, selectedCompanyIds, year, month);

  return {
    session,
    actor,
    companies,
    selectedCompanyIds,
    companyMode:
      selectedCompanyIds.length === allIds.length && allIds.length > 1
        ? 'all'
        : selectedCompanyIds.length === 1
          ? 'one'
          : 'some',
    consolidation: stored.consolidation === 'gross' ? 'gross' : 'consolidated',
    year,
    month,
    period,
  };
}

function isValidYear(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2000 && value <= 2100;
}

function isValidMonth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;
}

/** Scrie contextul. Se cheama doar din server actions. */
export async function writeContext(next: Partial<StoredContext>): Promise<void> {
  const store = await cookies();
  const current = parseStored(store.get(CONTEXT_COOKIE)?.value);
  const fallback = currentPeriod();

  const merged: StoredContext = {
    companyIds: next.companyIds ?? current.companyIds ?? [],
    consolidation: next.consolidation ?? current.consolidation ?? 'consolidated',
    year: next.year ?? (isValidYear(current.year) ? current.year : fallback.year),
    month: next.month ?? (isValidMonth(current.month) ? current.month : fallback.month),
  };

  store.set(CONTEXT_COOKIE, JSON.stringify(merged), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Un an: „persista intre sesiuni” din §5.1 inseamna si dupa re-login.
    maxAge: 60 * 60 * 24 * 365,
  });
}
