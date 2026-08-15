import { type Actor, schema, withActor } from '@damina/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

/**
 * Contextul global de firma si de luna (I8).
 *
 * Se citeste in RSC, la fiecare randare de layout, si intra in cheia de cache a
 * ecranelor. Nu e stare de client: un ecran care afiseaza lei trebuie sa stie pe
 * ce firme si pe ce luna e INAINTE sa randeze prima cifra.
 */

export interface CompanyOption {
  readonly id: string;
  readonly name: string;
  readonly cui: string | null;
  readonly isGroupMember: boolean;
}

export async function listCompanies(
  actor: Actor,
  allowedIds?: readonly string[],
): Promise<CompanyOption[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: schema.companies.id,
        name: schema.companies.name,
        cui: schema.companies.cui,
        isGroupMember: schema.companies.isGroupMember,
      })
      .from(schema.companies)
      .where(
        allowedIds === undefined || allowedIds.length === 0
          ? eq(schema.companies.isActive, true)
          : inArray(schema.companies.id, [...allowedIds]),
      )
      .orderBy(asc(schema.companies.name)),
  );
}

export type PeriodStatus = 'open' | 'closing' | 'closed' | 'missing';

export interface PeriodState {
  readonly companyId: string;
  readonly companyName: string;
  readonly status: PeriodStatus;
}

export interface PeriodContext {
  readonly year: number;
  readonly month: number;
  /** Starea lunii in fiecare firma selectata. */
  readonly perCompany: readonly PeriodState[];
  /**
   * Ecranul e blocat la scriere?
   *
   * Adevarat daca MACAR o firma selectata are luna inchisa. Regula e dinadins
   * conservatoare: cand privesti trei firme si una si-a inchis august, o
   * scriere „pe context” ar cadea imprevizibil pe firma inchisa. Mai bine
   * blocam si spunem care, decat sa lasam omul sa descopere din eroarea
   * triggerului.
   */
  readonly locked: boolean;
  readonly closedCompanyNames: readonly string[];
}

/**
 * Starea lunii pentru firmele selectate.
 *
 * O luna care nu exista in `app.periods` NU e o eroare: lunile se deschid de un
 * job (`ensureOpenPeriods`), iar navigarea in viitor e permisa. E `missing`, si
 * se comporta ca deschisa pentru citire si ca blocata pentru scriere.
 */
export async function getPeriodContext(
  actor: Actor,
  companyIds: readonly string[],
  year: number,
  month: number,
): Promise<PeriodContext> {
  if (companyIds.length === 0) {
    return { year, month, perCompany: [], locked: false, closedCompanyNames: [] };
  }

  // Anul si luna intra in conditia de JOIN, nu in `WHERE`: cu ele in `WHERE`,
  // firmele care inca n-au luna deschisa ar disparea tacut din rezultat, si
  // ecranul ar arata trei firme cand omul a selectat cinci.
  const rows = await withActor(actor, async (tx) =>
    tx
      .select({
        companyId: schema.companies.id,
        companyName: schema.companies.name,
        status: schema.periods.status,
      })
      .from(schema.companies)
      .leftJoin(
        schema.periods,
        and(
          eq(schema.periods.companyId, schema.companies.id),
          eq(schema.periods.year, year),
          eq(schema.periods.month, month),
        ),
      )
      .where(inArray(schema.companies.id, [...companyIds]))
      .orderBy(asc(schema.companies.name)),
  );

  const perCompany: PeriodState[] = rows.map((row) => ({
    companyId: row.companyId,
    companyName: row.companyName,
    status: row.status ?? 'missing',
  }));
  const closed = perCompany.filter((state) => state.status === 'closed');

  return {
    year,
    month,
    perCompany,
    locked: closed.length > 0,
    closedCompanyNames: closed.map((state) => state.companyName),
  };
}
