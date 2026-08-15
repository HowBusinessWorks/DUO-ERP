import type {
  ComponentInput,
  ContractInput,
  CostCeilingInput,
  RevenueCeilingInput,
} from '@damina/contracts';
import {
  componentInputSchema,
  contractInputSchema,
  costCeilingInputSchema,
  revenueCeilingInputSchema,
} from '@damina/contracts';
import { type Actor, schema, withActor, type ActorTx } from '@damina/db';
import {
  buildContractYears,
  ceilingUsage,
  deltaFill,
  type CeilingUsage,
  type DeltaFill,
} from '@damina/domain';
import { AppError, Money, Period, uuidv7 } from '@damina/shared';
import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

/**
 * Contracte, componente, plafoane — motorul de bani.
 *
 * Diferenta fata de nomenclatoare: aici **exista `company_id`**. Un contract
 * apartine unei firme din grup, iar listele se filtreaza pe firmele selectate in
 * shell. Un contract vizibil pe firma gresita nu e o inconveniența de interfata,
 * e o cifra pusa in P&L-ul altcuiva.
 */

const sqlstate = (error: unknown): string | undefined => {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code } = current as Error & { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
    current = current.cause;
  }
  return undefined;
};

/** Mesajul original al erorii Postgres, de sub ambalajul Drizzle. */
const pgMessage = (error: unknown): string => {
  let current: unknown = error;
  let last = '';
  while (current instanceof Error) {
    last = current.message;
    current = current.cause;
  }
  return last;
};

/**
 * Erorile ridicate de triggere ajung pe ecran ca propozitii, nu ca stack trace.
 *
 * `PERIOD_CLOSED` si `VALIDATION_FAILED` vin din baza cu mesaj deja scris in
 * romana (verificarile #6 si #11 cer exact asta). Le despachetam din prefix; nu
 * le rescriem, ca sa nu existe doua formulari ale aceleiasi reguli.
 */
function translateDbError(error: unknown): never {
  const state = sqlstate(error);
  const message = pgMessage(error);

  if (state === 'P0001') {
    const raised = /(?:PERIOD_CLOSED|VALIDATION_FAILED|AUTHORIZATION_EXPIRED):\s*(.+)/.exec(message);
    if (raised?.[1] !== undefined) {
      const code = message.startsWith('PERIOD_CLOSED') ? 'PERIOD_CLOSED' : 'VALIDATION_FAILED';
      throw new AppError(code, capitalize(raised[1].trim()));
    }
  }
  throw error;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// ── Contracte ────────────────────────────────────────────────────────────────

export type ContractRow = typeof schema.contracts.$inferSelect & {
  readonly clientName: string;
  readonly companyName: string;
  readonly ownerName: string | null;
  /** Al catelea an contractual e azi. `null` in afara perioadei contractului. */
  readonly currentYearIndex: number | null;
  readonly yearCount: number;
};

export interface ListContractsOptions {
  /** Firmele selectate in shell. Lista goala nu inseamna „toate”, ci „niciuna”. */
  readonly companyIds: readonly string[];
  readonly query?: string;
  readonly statuses?: readonly string[];
  readonly clientId?: string;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 200;

function like(query: string): string {
  return `%${query.replace(/([%_\\])/g, '\\$1')}%`;
}

const contractSelection = {
  contract: schema.contracts,
  clientName: schema.clients.name,
  companyName: schema.companies.name,
  ownerName: schema.persons.fullName,
  currentYearIndex: sql<number | null>`(
    select y.year_index from app.contract_years y
     where y.contract_id = ${schema.contracts.id}
       and current_date between y.starts_on and y.ends_on
     limit 1
  )`,
  yearCount: sql<string>`(
    select count(*)::text from app.contract_years y where y.contract_id = ${schema.contracts.id}
  )`,
};

type ContractSelectionRow = {
  contract: typeof schema.contracts.$inferSelect;
  clientName: string;
  companyName: string;
  ownerName: string | null;
  currentYearIndex: number | null;
  yearCount: string;
};

const toContractRow = (row: ContractSelectionRow): ContractRow => ({
  ...row.contract,
  clientName: row.clientName,
  companyName: row.companyName,
  ownerName: row.ownerName,
  currentYearIndex: row.currentYearIndex,
  yearCount: Number(row.yearCount),
});

export async function listContracts(
  actor: Actor,
  options: ListContractsOptions,
): Promise<ContractRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }
  const { query, statuses, clientId, limit = DEFAULT_LIMIT } = options;

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select(contractSelection)
      .from(schema.contracts)
      .innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
      .innerJoin(schema.companies, eq(schema.contracts.companyId, schema.companies.id))
      .leftJoin(schema.persons, eq(schema.contracts.ownerPersonId, schema.persons.id))
      .where(
        and(
          inArray(schema.contracts.companyId, [...options.companyIds]),
          statuses === undefined || statuses.length === 0
            ? undefined
            : inArray(schema.contracts.status, [...statuses]),
          clientId === undefined ? undefined : eq(schema.contracts.clientId, clientId),
          query === undefined || query === ''
            ? undefined
            : or(
                ilike(schema.contracts.code, like(query)),
                ilike(schema.contracts.reference, like(query)),
                ilike(schema.clients.name, like(query)),
              ),
        ),
      )
      .orderBy(asc(schema.contracts.code))
      .limit(limit);

    return rows.map(toContractRow);
  });
}

export async function getContract(actor: Actor, id: string): Promise<ContractRow> {
  const row = await withActor(actor, async (tx) => {
    const [found] = await tx
      .select(contractSelection)
      .from(schema.contracts)
      .innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
      .innerJoin(schema.companies, eq(schema.contracts.companyId, schema.companies.id))
      .leftJoin(schema.persons, eq(schema.contracts.ownerPersonId, schema.persons.id))
      .where(eq(schema.contracts.id, id))
      .limit(1);
    return found;
  });

  if (row === undefined) {
    throw AppError.notFound('Contractul', id);
  }
  return toContractRow(row);
}

/**
 * Creeaza contractul SI anii lui contractuali, in aceeasi tranzactie.
 *
 * Anii nu se genereaza de un trigger, ci aici, din `buildContractYears` —
 * functie pura, testata fara baza de date (verificarea #18). Motivul e regula 5
 * a pasului: indexarea e istoricizata, deci aritmetica ei trebuie sa aiba UN
 * singur loc. Un trigger care ar face acelasi calcul in plpgsql ar fi a doua
 * implementare a aceleiasi reguli, si cele doua diverg la prima corectie.
 *
 * Atomicitatea o da tranzactia: un contract fara ani n-a existat niciodata.
 */
export async function createContract(actor: Actor, input: ContractInput): Promise<{ id: string }> {
  const values = contractInputSchema.parse(input);
  const contractId = uuidv7();

  try {
    return await withActor(actor, async (tx) => {
      await tx.insert(schema.contracts).values({ id: contractId, ...values });

      if (values.monthlyValue !== null) {
        const years = buildContractYears({
          startsOn: values.startsOn,
          endsOn: values.endsOn,
          monthlyValue: Money.of(values.monthlyValue),
          indexationPct: values.indexationPct,
        });

        await tx.insert(schema.contractYears).values(
          years.map((year) => ({
            id: uuidv7(),
            contractId,
            yearIndex: year.yearIndex,
            startsOn: year.startsOn,
            endsOn: year.endsOn,
            monthlyValue: year.monthlyValue.toDbString(),
            indexationAppliedPct: year.indexationAppliedPct,
          })),
        );
      }

      return { id: contractId };
    });
  } catch (error) {
    if (sqlstate(error) === '23505') {
      throw new AppError('CONFLICT', `Există deja un contract cu codul ${values.code} la firma asta.`);
    }
    return translateDbError(error);
  }
}

export async function updateContract(
  actor: Actor,
  id: string,
  input: ContractInput,
): Promise<{ id: string }> {
  const values = contractInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .update(schema.contracts)
        .set(values)
        .where(eq(schema.contracts.id, id))
        .returning({ id: schema.contracts.id });
      if (row === undefined) {
        throw AppError.notFound('Contractul', id);
      }
      return row;
    });
  } catch (error) {
    if (sqlstate(error) === '23505') {
      throw new AppError('CONFLICT', `Există deja un contract cu codul ${values.code} la firma asta.`);
    }
    return translateDbError(error);
  }
}

export type ContractYearRow = typeof schema.contractYears.$inferSelect;

export async function listContractYears(
  actor: Actor,
  contractId: string,
): Promise<ContractYearRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.contractYears)
      .where(eq(schema.contractYears.contractId, contractId))
      .orderBy(asc(schema.contractYears.yearIndex)),
  );
}

// ── Componente ───────────────────────────────────────────────────────────────

export type ComponentRow = typeof schema.contractComponents.$inferSelect;

export async function listComponents(actor: Actor, contractId: string): Promise<ComponentRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.contractComponents)
      .where(eq(schema.contractComponents.contractId, contractId))
      .orderBy(asc(schema.contractComponents.type)),
  );
}

/**
 * `is_fill_target` se DERIVA din tip, nu se cere de la apelant.
 *
 * E singurul camp din tot pasul care inverseaza sensul unui indicator pe ecran:
 * cu el pe `false`, gauge-ul de Delta s-ar desena ca o limita de cheltuiala, si
 * omul ar incerca sa n-o depaseasca exact cand ar trebui s-o umple. Un camp de
 * formular care poate fi bifat gresit nu are ce cauta pe un asemenea comutator.
 * Baza impune aceeasi egalitate, ca plasa (verificarile #3 si #4).
 */
export async function createComponent(actor: Actor, input: ComponentInput): Promise<{ id: string }> {
  const values = componentInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.contractComponents)
        .values({ ...values, isFillTarget: values.type === 'delta' })
        .returning({ id: schema.contractComponents.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Componenta nu a putut fi salvată.');
      }
      return row;
    });
  } catch (error) {
    if (sqlstate(error) === '23505') {
      throw new AppError(
        'CONFLICT',
        'Contractul are deja o componentă de tipul ăsta. O componentă per tip, altfel plafoanele s-ar dubla.',
      );
    }
    return translateDbError(error);
  }
}

// ── Plafoane ─────────────────────────────────────────────────────────────────

export type CeilingRow = typeof schema.componentCeilings.$inferSelect;

export interface ListCeilingsOptions {
  readonly componentIds: readonly string[];
  /** Doar plafoanele lunii. Fara el vin si randurile anuale. */
  readonly periodId?: string;
  readonly contractYearId?: string;
}

export async function listCeilings(
  actor: Actor,
  options: ListCeilingsOptions,
): Promise<CeilingRow[]> {
  if (options.componentIds.length === 0) {
    return [];
  }
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.componentCeilings)
      .where(
        and(
          inArray(schema.componentCeilings.componentId, [...options.componentIds]),
          options.periodId === undefined
            ? undefined
            : eq(schema.componentCeilings.periodId, options.periodId),
          options.contractYearId === undefined
            ? undefined
            : eq(schema.componentCeilings.contractYearId, options.contractYearId),
        ),
      ),
  );
}

/**
 * Scrie un plafon. `reason` e OBLIGATORIU, si la creare, si la modificare.
 *
 * Baza cere motiv scris doar la UPDATE si DELETE (decizia din 02a: a crea ceva
 * nu e ireversibil). Verificarea #5 a pasului cere insa ca si prima setare fara
 * motiv sa fie respinsa — si are dreptate: un plafon nu se pune „ca sa fie”.
 * Diferenta se rezolva aici, nu prin slabirea regulii din baza.
 */
async function upsertCeiling(
  actor: Actor,
  reason: string,
  values: {
    componentId: string;
    periodId: string | null;
    contractYearId: string | null;
    allocatedRevenue: string | null;
    costCeiling: string | null;
    revenueCeiling: string | null;
  },
): Promise<{ id: string }> {
  const withReason: Actor = { ...actor, reason };

  try {
    return await withActor(withReason, async (tx: ActorTx) => {
      const [row] = await tx
        .insert(schema.componentCeilings)
        .values({
          id: uuidv7(),
          ...values,
          setBy: actor.personId,
        })
        .onConflictDoUpdate({
          target: [
            schema.componentCeilings.componentId,
            schema.componentCeilings.periodId,
            schema.componentCeilings.contractYearId,
          ],
          set: {
            allocatedRevenue: values.allocatedRevenue,
            costCeiling: values.costCeiling,
            revenueCeiling: values.revenueCeiling,
            setBy: actor.personId,
            setAt: new Date(),
          },
        })
        .returning({ id: schema.componentCeilings.id });

      if (row === undefined) {
        throw new AppError('CONFLICT', 'Plafonul nu a putut fi salvat.');
      }
      return row;
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/** Plafon de COST — mentenanta, lucrari, individual. Consumi cat mai putin. */
export async function setCostCeiling(
  actor: Actor,
  input: CostCeilingInput,
): Promise<{ id: string }> {
  const values = costCeilingInputSchema.parse(input);
  return upsertCeiling(actor, values.reason, {
    componentId: values.componentId,
    periodId: values.periodId,
    contractYearId: values.contractYearId,
    allocatedRevenue: values.allocatedRevenue,
    costCeiling: values.costCeiling,
    revenueCeiling: null,
  });
}

/** Plafon de VENIT — doar Delta. Il umpli; ce ramane se pierde. */
export async function setRevenueCeiling(
  actor: Actor,
  input: RevenueCeilingInput,
): Promise<{ id: string }> {
  const values = revenueCeilingInputSchema.parse(input);
  return upsertCeiling(actor, values.reason, {
    componentId: values.componentId,
    periodId: values.periodId,
    contractYearId: null,
    allocatedRevenue: values.allocatedRevenue,
    costCeiling: null,
    revenueCeiling: values.revenueCeiling,
  });
}

// ── Prezentarea contractului pe o luna ───────────────────────────────────────

/**
 * O banda de componenta de pe ecranul de Prezentare.
 *
 * `committed` si `consumed` sunt ZERO in pasul 04, si asta e corect: rollup-urile
 * (`component_period_rollup`) vin in pasul 06. Cifrele sunt separate de acum, ca
 * sa nu fie nevoie sa se schimbe forma ecranului cand incep sa aiba continut.
 */
export interface ComponentBand {
  readonly component: ComponentRow;
  readonly allocatedRevenue: Money;
  /** Umplerea Deltei. Prezent DOAR pe componenta cu `isFillTarget`. */
  readonly fill: DeltaFill | null;
  /** Consumul fata de plafonul de cost. Prezent pe restul componentelor. */
  readonly usage: CeilingUsage | null;
}

export interface ContractOverview {
  readonly contract: ContractRow;
  readonly year: number;
  readonly month: number;
  /** Abonamentul lunii, luat din anul contractual in care cade luna. */
  readonly monthlyValue: Money | null;
  readonly contractYear: ContractYearRow | null;
  readonly bands: readonly ComponentBand[];
}

export async function getContractOverview(
  actor: Actor,
  contractId: string,
  year: number,
  month: number,
): Promise<ContractOverview> {
  const contract = await getContract(actor, contractId);
  const period = Period.of(year, month);
  // Luna se raporteaza la anul contractual dupa PRIMA ei zi. O luna taiata de
  // aniversare apartine anului in care a inceput — asa se emite si factura.
  const anchor = period.firstDay();

  const [years, components] = await Promise.all([
    listContractYears(actor, contractId),
    listComponents(actor, contractId),
  ]);

  const contractYear =
    years.find((row) => anchor >= row.startsOn && anchor <= row.endsOn) ?? null;

  const ceilings = await withActor(actor, async (tx) =>
    components.length === 0
      ? []
      : tx
          .select({ ceiling: schema.componentCeilings })
          .from(schema.componentCeilings)
          .innerJoin(schema.periods, eq(schema.componentCeilings.periodId, schema.periods.id))
          .where(
            and(
              inArray(
                schema.componentCeilings.componentId,
                components.map((component) => component.id),
              ),
              eq(schema.periods.year, year),
              eq(schema.periods.month, month),
            ),
          ),
  );

  const byComponent = new Map(ceilings.map((row) => [row.ceiling.componentId, row.ceiling]));
  const asOf = todayWithin(period);

  const bands: ComponentBand[] = components.map((component) => {
    const ceiling = byComponent.get(component.id);
    const allocatedRevenue = Money.fromDb(ceiling?.allocatedRevenue);

    if (component.isFillTarget) {
      return {
        component,
        allocatedRevenue,
        fill: deltaFill({
          revenueCeiling:
            ceiling?.revenueCeiling == null ? null : Money.fromDb(ceiling.revenueCeiling),
          allocatedRevenue,
          asOf,
        }),
        usage: null,
      };
    }

    return {
      component,
      allocatedRevenue,
      fill: null,
      usage: ceilingUsage({
        ceiling: ceiling?.costCeiling == null ? null : Money.fromDb(ceiling.costCeiling),
        // Pasul 06 le umple. Pana atunci sunt zero, si se vede ca sunt zero.
        committed: Money.ZERO,
        consumed: Money.ZERO,
      }),
    };
  });

  return {
    contract,
    year,
    month,
    monthlyValue: contractYear === null ? null : Money.fromDb(contractYear.monthlyValue),
    contractYear,
    bands,
  };
}

/**
 * Ziua fata de care se judeca ritmul Deltei.
 *
 * Pentru luna curenta e azi. Pentru o luna trecuta e ultima ei zi — altfel
 * august privit in octombrie ar arata „mai ai 20 de zile sa umpli”. Pentru o
 * luna viitoare e prima zi: nu s-a consumat inca nimic din ea.
 */
function todayWithin(period: Period): string {
  const now = new Date();
  const today = Period.fromDate(now);
  const comparison = period.compare(today);

  if (comparison === 0) {
    return `${period.toKey()}-${String(now.getDate()).padStart(2, '0')}`;
  }
  return comparison < 0 ? period.lastDay() : period.firstDay();
}

// ── Alerte (§3.7) ────────────────────────────────────────────────────────────

export interface ExpiringContract {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly clientName: string;
  readonly endsOn: string;
  readonly expiryAlertMonths: number;
}

/**
 * Contractele active care expira in mai putin de `expiry_alert_months`.
 *
 * Pragul e PER CONTRACT, nu global: unele se renegociaza in trei luni, altele
 * cer un an. Un prag global ar insemna ori alerte premature pe cele scurte, ori
 * alerte inutil de tarzii pe cele lungi.
 */
export async function listExpiringContracts(
  actor: Actor,
  companyIds?: readonly string[],
): Promise<ExpiringContract[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.contracts.id,
        companyId: schema.contracts.companyId,
        code: schema.contracts.code,
        clientName: schema.clients.name,
        endsOn: schema.contracts.endsOn,
        expiryAlertMonths: schema.contracts.expiryAlertMonths,
      })
      .from(schema.contracts)
      .innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
      .where(
        and(
          eq(schema.contracts.status, 'activ'),
          companyIds === undefined || companyIds.length === 0
            ? undefined
            : inArray(schema.contracts.companyId, [...companyIds]),
          sql`${schema.contracts.endsOn} >= current_date`,
          sql`${schema.contracts.endsOn} < current_date + make_interval(months => ${schema.contracts.expiryAlertMonths}::int)`,
        ),
      )
      .orderBy(asc(schema.contracts.endsOn));

    return rows;
  });
}

export interface DeltaUnderfilled {
  readonly contractId: string;
  readonly companyId: string;
  readonly contractCode: string;
  readonly componentId: string;
  readonly fill: DeltaFill;
}

/**
 * Componentele Delta ramase in urma fata de ritm, in luna data.
 *
 * Se ruleaza pe 10 si pe 20 ale lunii, nu la inchidere — la inchidere raspunsul
 * nu mai foloseste la nimic: venitul neumplut e deja pierdut.
 */
export async function listUnderfilledDelta(
  actor: Actor,
  year: number,
  month: number,
  asOf: string,
): Promise<DeltaUnderfilled[]> {
  const rows = await withActor(actor, async (tx) =>
    tx
      .select({
        contractId: schema.contracts.id,
        companyId: schema.contracts.companyId,
        contractCode: schema.contracts.code,
        componentId: schema.contractComponents.id,
        revenueCeiling: schema.componentCeilings.revenueCeiling,
        allocatedRevenue: schema.componentCeilings.allocatedRevenue,
      })
      .from(schema.componentCeilings)
      .innerJoin(
        schema.contractComponents,
        eq(schema.componentCeilings.componentId, schema.contractComponents.id),
      )
      .innerJoin(schema.contracts, eq(schema.contractComponents.contractId, schema.contracts.id))
      .innerJoin(schema.periods, eq(schema.componentCeilings.periodId, schema.periods.id))
      .where(
        and(
          eq(schema.contractComponents.isFillTarget, true),
          eq(schema.contracts.status, 'activ'),
          eq(schema.periods.year, year),
          eq(schema.periods.month, month),
        ),
      ),
  );

  return rows
    .map((row) => ({
      contractId: row.contractId,
      companyId: row.companyId,
      contractCode: row.contractCode,
      componentId: row.componentId,
      fill: deltaFill({
        revenueCeiling: row.revenueCeiling === null ? null : Money.fromDb(row.revenueCeiling),
        allocatedRevenue: Money.fromDb(row.allocatedRevenue),
        asOf,
      }),
    }))
    .filter((row) => row.fill.state === 'in_urma');
}

/** Contractele in care apare un obiectiv — pentru tab-ul Contracte al obiectivului. */
export async function listContractsForObjective(
  actor: Actor,
  objectiveId: string,
): Promise<
  {
    readonly contractId: string;
    readonly code: string;
    readonly companyName: string;
    readonly clientName: string;
    readonly validFrom: string;
    readonly validTo: string | null;
    readonly isCurrent: boolean;
  }[]
> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        contractId: schema.contracts.id,
        code: schema.contracts.code,
        companyName: schema.companies.name,
        clientName: schema.clients.name,
        validFrom: schema.contractObjectives.validFrom,
        validTo: schema.contractObjectives.validTo,
      })
      .from(schema.contractObjectives)
      .innerJoin(schema.contracts, eq(schema.contractObjectives.contractId, schema.contracts.id))
      .innerJoin(schema.companies, eq(schema.contracts.companyId, schema.companies.id))
      .innerJoin(schema.clients, eq(schema.contracts.clientId, schema.clients.id))
      .where(eq(schema.contractObjectives.objectiveId, objectiveId))
      .orderBy(asc(schema.contractObjectives.validFrom));

    const today = new Date().toISOString().slice(0, 10);
    return rows.map((row) => ({
      ...row,
      isCurrent: row.validFrom <= today && (row.validTo === null || row.validTo > today),
    }));
  });
}

/** Componentele active fara plafon pe luna curenta. Folosit de ecranul de Componente. */
export async function countCeilingsWithoutValue(
  actor: Actor,
  contractId: string,
): Promise<number> {
  const rows = await withActor(actor, async (tx) =>
    tx
      .select({ id: schema.contractComponents.id })
      .from(schema.contractComponents)
      .leftJoin(
        schema.componentCeilings,
        eq(schema.componentCeilings.componentId, schema.contractComponents.id),
      )
      .where(
        and(
          eq(schema.contractComponents.contractId, contractId),
          isNull(schema.componentCeilings.id),
        ),
      ),
  );
  return rows.length;
}
