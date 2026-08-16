import { type Actor, schema, withActor } from '@damina/db';
import { AppError } from '@damina/shared';
import { and, eq } from 'drizzle-orm';

/**
 * Deschide lunile care lipsesc, de la `fromYear` pana la luna curenta inclusiv.
 *
 * Lunile nu apar singure. Daca nimeni nu le deschide, prima linie de cost dintr-o
 * luna noua ar cadea pe o perioada inexistenta. Serviciul asta se cheama la
 * provizionarea unei firme si apoi, lunar, dintr-un job.
 *
 * Idempotent: lunile existente raman neatinse, indiferent de starea lor. O luna
 * inchisa nu se redeschide din greseala pentru ca a rulat jobul inca o data.
 */
export interface EnsureOpenPeriodsResult {
  readonly created: number;
  readonly existing: number;
}

export async function ensureOpenPeriods(
  actor: Actor,
  companyId: string,
  fromYear: number,
  today: Date = new Date(),
): Promise<EnsureOpenPeriodsResult> {
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth() + 1;

  if (!Number.isInteger(fromYear) || fromYear < 2000 || fromYear > currentYear) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Anul de start ${String(fromYear)} e in afara intervalului 2000..${String(currentYear)}.`,
    );
  }

  const wanted: { year: number; month: number }[] = [];
  for (let year = fromYear; year <= currentYear; year += 1) {
    const lastMonth = year === currentYear ? currentMonth : 12;
    for (let month = 1; month <= lastMonth; month += 1) {
      wanted.push({ year, month });
    }
  }

  return withActor(actor, async (tx) => {
    // `on conflict do nothing` muta idempotenta in baza, nu in cod: doua joburi
    // pornite in acelasi timp nu se calca pe picioare, si nu exista fereastra
    // intre "verific daca exista" si "inserez".
    const inserted = await tx
      .insert(schema.periods)
      .values(wanted.map((p) => ({ companyId, year: p.year, month: p.month })))
      .onConflictDoNothing()
      .returning({ id: schema.periods.id });

    return { created: inserted.length, existing: wanted.length - inserted.length };
  });
}

/**
 * Id-ul lunii unei firme. `null` cand luna nu e deschisa inca.
 *
 * Plafoanele se leaga de `app.periods`, nu de un an si o luna scrise ca numere:
 * asa garda de perioada (triggerul din 02a) are ce sa verifice, iar o luna
 * inchisa refuza scrierea din baza, nu din ecran.
 *
 * `null` NU e o eroare de programare — lunile viitoare chiar nu exista pana
 * ruleaza `ensureOpenPeriods`. Apelantul spune omului ce lipseste.
 */
export async function findPeriodId(
  actor: Actor,
  companyId: string,
  year: number,
  month: number,
): Promise<string | null> {
  const row = await withActor(actor, async (tx) => {
    const [found] = await tx
      .select({ id: schema.periods.id })
      .from(schema.periods)
      .where(
        and(
          eq(schema.periods.companyId, companyId),
          eq(schema.periods.year, year),
          eq(schema.periods.month, month),
        ),
      )
      .limit(1);
    return found;
  });
  return row?.id ?? null;
}
