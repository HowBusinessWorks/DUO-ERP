import { type Actor, schema, withActor } from '@damina/db';
import {
  aggregateDeltaFill,
  ceilingUsage,
  consumptionRisk,
  deltaFill,
  physicalProgress,
  type CeilingUsage,
  type ConsumptionRisk,
  type DeltaFill,
  type DeltaFillPart,
} from '@damina/domain';
import { Money, Period } from '@damina/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

/**
 * Panoul PM (§3.7 al pasului 10).
 *
 * Nu introduce nicio cifra noua si nicio tabela noua: ia cifrele care exista
 * deja — plafoane, rollup-uri, etape, fise nevalidate — si le pune in ordinea in
 * care le foloseste un PM la 8 dimineata:
 *
 *   1. **Delta** — singurul lucru care se pierde iremediabil daca nu faci nimic.
 *   2. **Contractele mele** — cat s-a umplut, cat s-a consumat.
 *   3. **De aprobat** — ce sta blocat din cauza mea.
 *   4. **Lucrari in risc** — unde banii au luat-o inaintea muncii.
 *
 * Totul intr-o singura citire, cu numar FIX de interogari. O interogare pe
 * contract ar face panoul sa incetineasca liniar cu portofoliul, adica exact la
 * omul care are cele mai multe contracte si cel mai putin timp.
 */

// ── Formele returnate ────────────────────────────────────────────────────────

export interface PmContractCard {
  readonly contractId: string;
  readonly code: string;
  readonly clientName: string;
  /** Umplerea Deltei contractului. `null` cand contractul n-are componenta Delta. */
  readonly fill: DeltaFill | null;
  /** Consumul cumulat al componentelor de COST, fata de plafoanele lor. */
  readonly usage: CeilingUsage;
}

export type PmApprovalKind = 'inspectii' | 'interventii' | 'pontaje';

export interface PmApproval {
  readonly kind: PmApprovalKind;
  readonly label: string;
  readonly count: number;
  readonly href: string;
}

export interface PmRiskRow {
  readonly workUnitId: string;
  readonly code: string;
  readonly name: string;
  readonly costBudget: Money;
  readonly consumed: Money;
  readonly consumedPercent: number;
  readonly progressPercent: number;
  readonly risk: ConsumptionRisk;
  /** Progresul vine din ponderi scrise pe etape, nu din etape numarate egal. */
  readonly weighted: boolean;
}

export interface PmPanel {
  /** Delta contractelor privite, insumata pe lei. Gauge-ul de sus. */
  readonly delta: DeltaFill;
  /** Cate componente Delta n-au plafon setat — cifra care LIPSESTE din gauge. */
  readonly deltaUnset: number;
  /**
   * `mine` cand omul are contracte pe numele lui; `toate` altfel.
   *
   * Distinctia se scrie pe ecran. Un panou care spune „contractele mele" si
   * arata contractele altcuiva e mai rau decat unul gol.
   */
  readonly scope: 'mine' | 'toate';
  readonly contracts: readonly PmContractCard[];
  readonly approvals: readonly PmApproval[];
  readonly atRisk: readonly PmRiskRow[];
}

// ── Citirea ──────────────────────────────────────────────────────────────────

/** Ziua fata de care se judeca ritmul, pentru luna privita in shell. */
function asOfWithin(period: Period): string {
  const now = new Date();
  const comparison = period.compare(Period.fromDate(now));
  if (comparison === 0) {
    return `${period.toKey()}-${String(now.getDate()).padStart(2, '0')}`;
  }
  return comparison < 0 ? period.lastDay() : period.firstDay();
}

const fillPartsOf = (
  rows: readonly {
    readonly revenueCeiling: string | null;
    readonly allocatedRevenue: string | null;
  }[],
): DeltaFillPart[] =>
  rows.map((row) => ({
    revenueCeiling: row.revenueCeiling === null ? null : Money.fromDb(row.revenueCeiling),
    allocatedRevenue: Money.fromDb(row.allocatedRevenue),
  }));

/** Cate lucrari in risc incap intr-un panou care se citeste dintr-o privire. */
const RISK_LIMIT = 8;

export async function readPmPanel(
  actor: Actor,
  personId: string,
  companyIds: readonly string[],
  year: number,
  month: number,
): Promise<PmPanel> {
  const period = Period.of(year, month);
  const asOf = asOfWithin(period);
  // Luna privita e in trecut: nu mai are zile de umplut, iar cifra care conteaza
  // e cat s-a pierdut, nu cat mai ai.
  const monthEnded = period.compare(Period.fromDate(new Date())) < 0;

  const empty: PmPanel = {
    delta: deltaFill({ revenueCeiling: null, allocatedRevenue: Money.ZERO, asOf, monthEnded }),
    deltaUnset: 0,
    scope: 'toate',
    contracts: [],
    approvals: [],
    atRisk: [],
  };

  if (companyIds.length === 0) {
    return empty;
  }
  const companies = [...companyIds];

  return withActor(actor, async (tx) => {
    // 1. Contractele active vizibile, cu PM-ul lor.
    const contractRows = await tx
      .select({
        id: schema.contracts.id,
        code: schema.contracts.code,
        ownerPersonId: schema.contracts.ownerPersonId,
        clientName: schema.clients.name,
      })
      .from(schema.contracts)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.contracts.clientId))
      .where(
        and(eq(schema.contracts.status, 'activ'), inArray(schema.contracts.companyId, companies)),
      );

    const mine = contractRows.filter((row) => row.ownerPersonId === personId);
    const scope: 'mine' | 'toate' = mine.length > 0 ? 'mine' : 'toate';
    const visible = scope === 'mine' ? mine : contractRows;
    const contractIds = visible.map((row) => row.id);

    if (contractIds.length === 0) {
      return { ...empty, scope };
    }

    // 2. Lunile firmelor, o singura data: asa `periods` nu mai intra in fiecare
    //    join de mai jos, iar plafoanele si rollup-urile se citesc pe id.
    const periodRows = await tx
      .select({ id: schema.periods.id })
      .from(schema.periods)
      .where(
        and(
          inArray(schema.periods.companyId, companies),
          eq(schema.periods.year, year),
          eq(schema.periods.month, month),
        ),
      );
    const periodIds = periodRows.map((row) => row.id);

    // 3. Componentele contractelor, cu plafonul si rollup-ul lunii — o interogare
    //    pentru tot portofoliul. Rollup-ul (pasul 06a) e sursa consumului; nu se
    //    agrega registrul de cost la fiecare deschidere de panou.
    const componentRows =
      periodIds.length === 0
        ? []
        : await tx
            .select({
              contractId: schema.contractComponents.contractId,
              isFillTarget: schema.contractComponents.isFillTarget,
              revenueCeiling: schema.componentCeilings.revenueCeiling,
              costCeiling: schema.componentCeilings.costCeiling,
              allocatedRevenue: schema.componentCeilings.allocatedRevenue,
              committed: schema.componentPeriodRollup.committed,
              consumed: schema.componentPeriodRollup.consumed,
            })
            .from(schema.contractComponents)
            .leftJoin(
              schema.componentCeilings,
              and(
                eq(schema.componentCeilings.componentId, schema.contractComponents.id),
                inArray(schema.componentCeilings.periodId, periodIds),
              ),
            )
            .leftJoin(
              schema.componentPeriodRollup,
              and(
                eq(schema.componentPeriodRollup.componentId, schema.contractComponents.id),
                inArray(schema.componentPeriodRollup.periodId, periodIds),
              ),
            )
            .where(inArray(schema.contractComponents.contractId, contractIds));

    const contracts: PmContractCard[] = visible
      .map((contract) => {
        const rows = componentRows.filter((row) => row.contractId === contract.id);
        const fillParts = fillPartsOf(rows.filter((row) => row.isFillTarget));
        const cost = rows.filter((row) => !row.isFillTarget);
        // Plafon nesetat NU e plafon zero: `ceilingUsage` spune „nesetat", si
        // ecranul afiseaza asta in loc de un procent inventat.
        const hasCeiling = cost.some((row) => row.costCeiling !== null);

        return {
          contractId: contract.id,
          code: contract.code,
          clientName: contract.clientName,
          fill: fillParts.length === 0 ? null : aggregateDeltaFill(fillParts, asOf, monthEnded),
          usage: ceilingUsage({
            ceiling: hasCeiling
              ? Money.sum(cost.map((row) => Money.fromDb(row.costCeiling)))
              : null,
            committed: Money.sum(cost.map((row) => Money.fromDb(row.committed))),
            consumed: Money.sum(cost.map((row) => Money.fromDb(row.consumed))),
          }),
        };
      })
      // Sus, contractul pe care se pierd cei mai multi lei. Panoul se citeste de
      // sus in jos, deci prima linie trebuie sa fie cea care costa cel mai mult.
      .sort((a, b) => (b.fill?.unfilled ?? Money.ZERO).compare(a.fill?.unfilled ?? Money.ZERO));

    const allFillParts = fillPartsOf(componentRows.filter((row) => row.isFillTarget));

    // 4. Ce asteapta aprobarea. Trei numaratori, nu trei liste: panoul spune cate
    //    sunt si trimite in ecranul care le rezolva in masa.
    const [inspections, interventions, timesheets] = await Promise.all([
      tx
        .select({ count: sql<string>`count(*)::text` })
        .from(schema.inspections)
        .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.inspections.workUnitId))
        .where(
          and(
            inArray(schema.workUnits.companyId, companies),
            isNull(schema.inspections.validatedAt),
          ),
        ),
      tx
        .select({ count: sql<string>`count(*)::text` })
        .from(schema.interventions)
        .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.interventions.workUnitId))
        .where(
          and(
            inArray(schema.workUnits.companyId, companies),
            isNull(schema.interventions.validatedAt),
          ),
        ),
      tx
        .select({ count: sql<string>`count(*)::text` })
        .from(schema.timesheets)
        .where(
          and(
            inArray(schema.timesheets.companyId, companies),
            eq(schema.timesheets.status, 'submitted'),
            sql`${schema.timesheets.workDate} between ${period.firstDay()} and ${period.lastDay()}`,
          ),
        ),
    ]);

    const approvals: PmApproval[] = (
      [
        {
          kind: 'inspectii',
          label: 'Fișe de inspecție',
          count: Number(inspections[0]?.count ?? '0'),
          href: '/activitate?view=validare',
        },
        {
          kind: 'interventii',
          label: 'Fișe de intervenție',
          count: Number(interventions[0]?.count ?? '0'),
          href: '/activitate?view=validare',
        },
        {
          kind: 'pontaje',
          label: 'Pontaje trimise',
          count: Number(timesheets[0]?.count ?? '0'),
          href: '/activitate?view=pontaj',
        },
      ] satisfies PmApproval[]
    ).filter((row) => row.count > 0);

    // 5. Lucrari in risc. Consumul vine din registru, progresul din etape; nu se
    //    deduc unul din altul, tocmai ca sa poata divergea — iar divergenta lor e
    //    chiar semnalul.
    const budgetRows = await tx
      .select({
        id: schema.workUnits.id,
        code: schema.workUnits.code,
        name: schema.workUnits.name,
        costBudget: schema.workUnits.costBudget,
        consumed: sql<string>`coalesce(sum(${schema.costLines.amount}) filter (where ${schema.costLines.stage} = 'consumat'), 0)::text`,
      })
      .from(schema.workUnits)
      .innerJoin(
        schema.contractObjectives,
        eq(schema.contractObjectives.id, schema.workUnits.contractObjectiveId),
      )
      .leftJoin(schema.costLines, eq(schema.costLines.workUnitId, schema.workUnits.id))
      .where(
        and(
          inArray(schema.contractObjectives.contractId, contractIds),
          inArray(schema.workUnits.status, ['planificata', 'in_executie', 'suspendata']),
          sql`${schema.workUnits.costBudget} > 0`,
        ),
      )
      .groupBy(
        schema.workUnits.id,
        schema.workUnits.code,
        schema.workUnits.name,
        schema.workUnits.costBudget,
      );

    const workUnitIds = budgetRows.map((row) => row.id);
    const stageRows =
      workUnitIds.length === 0
        ? []
        : await tx
            .select({
              workUnitId: schema.workStages.workUnitId,
              position: schema.workStages.position,
              plannedStart: schema.workStages.plannedStart,
              plannedEnd: schema.workStages.plannedEnd,
              actualStart: schema.workStages.actualStart,
              actualEnd: schema.workStages.actualEnd,
              pctOfWork: schema.workStages.pctOfWork,
            })
            .from(schema.workStages)
            .where(inArray(schema.workStages.workUnitId, workUnitIds));

    const atRisk: PmRiskRow[] = budgetRows
      .map((row) => {
        const costBudget = Money.fromDb(row.costBudget);
        const consumed = Money.fromDb(row.consumed);
        const consumedPercent = (consumed.toUnsafeNumber() / costBudget.toUnsafeNumber()) * 100;
        const progress = physicalProgress(
          stageRows
            .filter((stage) => stage.workUnitId === row.id)
            .map((stage) => ({
              position: stage.position,
              plannedStart: stage.plannedStart,
              plannedEnd: stage.plannedEnd,
              actualStart: stage.actualStart,
              actualEnd: stage.actualEnd,
              pctOfWork: stage.pctOfWork === null ? null : Number(stage.pctOfWork),
            })),
        );

        return {
          workUnitId: row.id,
          code: row.code,
          name: row.name,
          costBudget,
          consumed,
          consumedPercent,
          progressPercent: progress.percent,
          risk: consumptionRisk(consumedPercent, progress.percent),
          weighted: progress.weighted,
        };
      })
      .filter((row) => row.risk.atRisk)
      .sort((a, b) => b.risk.gap - a.risk.gap)
      .slice(0, RISK_LIMIT);

    return {
      delta: aggregateDeltaFill(allFillParts, asOf, monthEnded),
      deltaUnset: allFillParts.filter((part) => part.revenueCeiling === null).length,
      scope,
      contracts,
      approvals,
      atRisk,
    };
  });
}
