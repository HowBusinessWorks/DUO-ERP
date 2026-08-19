import type { CostQuery, RecordCostInput, StornoCostInput } from '@damina/contracts';
import { costQuerySchema, recordCostInputSchema, stornoCostInputSchema } from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import { AppError, Money, Quantity, uuidv7 } from '@damina/shared';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { translateDbError } from './db-errors';

/**
 * Registrul de cost: inregistrare, storno, citiri.
 *
 * **Serviciul nu decide nimic despre bani.** Regulile stau in baza — analitica
 * obligatorie de la receptie in sus, etapa pe lucrari, luna derivata din data de
 * efect, append-only. Aici se orchestreaza tranzactia si se traduc erorile.
 *
 * Ce face totusi serviciul, si e important: **face cele doua analitici egale
 * cand apelantul nu le desparte**. Implicit sunt egale (§12); cine le desparte o
 * face explicit, si atunci linia intra automat in raportul de reconciliere.
 */

const DEFAULT_LIMIT = 200;

// ── Scriere ──────────────────────────────────────────────────────────────────

export interface RecordCostResult {
  readonly costLineId: string;
  /** Luna in care a cazut linia, derivata din `effectDate` de trigger. */
  readonly periodId: string;
}

/**
 * Inregistreaza o linie de cost.
 *
 * E use-case-ul generic pe care il vor chema toate documentele care produc
 * costuri — bon de consum, NIR, pontaj, fisa de motorina (pasii 09-10). Pana
 * atunci e si singura cale de a pune ceva in registru.
 *
 * `periodId` nu se trimite si nu se poate trimite: il pune trigger-ul din
 * `effect_date`. Daca ai nevoie sa stii in ce luna a cazut linia, il primesti
 * inapoi — nu-l calcula a doua oara in apelant.
 */
export async function recordCost(actor: Actor, input: RecordCostInput): Promise<RecordCostResult> {
  const values = recordCostInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => recordCostTx(tx, actor, values));
  } catch (error) {
    return translateDbError(error);
  }
}

/**
 * Scrierea propriu-zisa, pe o tranzactie DEJA deschisa.
 *
 * Exista exportata din acelasi motiv ca `createWorkUnitTx` din `work-units.ts`:
 * validarea unei fise (pasul 09) scrie bonul de consum, miscarile de stoc si
 * liniile de cost in ACEEASI tranzactie, iar un `withActor` in plus ar lua alta
 * conexiune din pool si ar rupe rollback-ul. Regula 8 a pasului 09 — „validarea
 * unei fise = o tranzactie" — trece pe aici.
 */
export async function recordCostTx(
  tx: ActorTx,
  actor: Actor,
  values: RecordCostInput,
  extra: { readonly reallocationOfId?: string; readonly isReallocation?: boolean } = {},
): Promise<RecordCostResult> {
  const id = uuidv7();

  // Implicit cele doua analitici sunt egale. Le desparte doar cine trimite
  // explicit `charged*` — si atunci linia apare in raportul de reconciliere.
  const chargedContractId = values.chargedContractId ?? values.usedContractId;
  const chargedComponentId =
    values.chargedContractId === null
      ? values.usedComponentId
      : (values.chargedComponentId ?? null);

  const rows = await tx
    .insert(schema.costLines)
    .values({
      id,
      companyId: values.companyId,
      documentDate: values.documentDate,
      effectDate: values.effectDate,
      usedContractId: values.usedContractId,
      usedComponentId: values.usedComponentId,
      objectiveId: values.objectiveId,
      workUnitId: values.workUnitId,
      stageId: values.stageId,
      chargedContractId,
      chargedComponentId,
      expenseType: values.expenseType,
      productId: values.productId,
      qualificationId: values.qualificationId,
      quantity: values.quantity,
      uom: values.uom,
      amount: Money.fromDb(values.amount).toDbString(),
      stage: values.stage,
      documentType: values.documentType,
      documentId: values.documentId,
      documentLineId: values.documentLineId,
      supplierId: values.supplierId,
      subcontractorId: values.subcontractorId,
      reallocationOfId: extra.reallocationOfId ?? null,
      isReallocation: extra.isReallocation ?? false,
      createdBy: actor.personId,
    })
    .returning({ id: schema.costLines.id, periodId: schema.costLines.periodId });

  const row = rows[0];
  if (row === undefined || row.periodId === null) {
    throw new AppError('VALIDATION_FAILED', 'Linia de cost nu s-a putut înregistra.');
  }

  return { costLineId: row.id, periodId: row.periodId };
}

/**
 * Corectia unei linii gresite, prin storno.
 *
 * Registrul e append-only: linia gresita ramane, iar deasupra ei se scrie una
 * egala si opusa. Amandoua se vad, si de aceea cifra finala poate fi explicata —
 * un `update` ar fi sters intrebarea „de ce 250 si nu 2500".
 *
 * Suma nu se trimite din afara: se ia din linia stornata si se inverseaza. O
 * suma scrisa a doua oara de mana e o suma care se poate scrie gresit a doua oara.
 *
 * Storno-ul intra in **luna liniei originale** daca ea e deschisa. Daca s-a
 * inchis, `guard_closed_period` refuza scrierea — si atunci corectia trece prin
 * documentul de re-alocare, ca orice miscare pe o luna raportata.
 */
export async function stornoCost(actor: Actor, input: StornoCostInput): Promise<RecordCostResult> {
  const values = stornoCostInputSchema.parse(input);

  try {
    return await withActor({ ...actor, reason: values.reason }, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.costLines)
        .where(eq(schema.costLines.id, values.costLineId))
        .limit(1);

      const original = rows[0];
      if (original === undefined) {
        throw new AppError('NOT_FOUND', 'Linia de cost nu există sau nu e vizibilă.');
      }

      if (original.reallocationOfId !== null) {
        throw new AppError(
          'CONFLICT',
          'Linia asta e deja o corecție — stornează linia originală, nu storno-ul ei.',
        );
      }

      const id = uuidv7();
      const inserted = await tx
        .insert(schema.costLines)
        .values({
          ...original,
          id,
          // Data documentului ramane a documentului stornat: corectia se refera
          // la el, nu la ziua in care si-a dat cineva seama de greseala.
          amount: Money.fromDb(original.amount).negate().toDbString(),
          // Si cantitatea se inverseaza: altfel „cate bucati am consumat" ar
          // aduna bucatile stornate peste cele reale, desi banii s-ar fi anulat.
          quantity:
            original.quantity === null
              ? null
              : Quantity.fromDb(original.quantity).negate().toDbString(),
          reallocationOfId: original.id,
          createdBy: actor.personId,
          createdAt: undefined,
          periodId: undefined,
        })
        .returning({ id: schema.costLines.id, periodId: schema.costLines.periodId });

      const row = inserted[0];
      if (row === undefined || row.periodId === null) {
        throw new AppError('VALIDATION_FAILED', 'Storno-ul nu s-a putut înregistra.');
      }

      return { costLineId: row.id, periodId: row.periodId };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/**
 * Rescrie analitica „descarcat" pe liniile date. Ramura de luna DESCHISA a
 * mutarii de finantare (§13.1).
 *
 * Trece prin `app.recharge_cost_line`, functia `security definer` din 0017:
 * `update` pe registru nu e acordat niciunui rol, deci asta e singura usa. Ea
 * cere motiv scris, il pune in audit, si lasa `used_*` si `document_date`
 * neatinse — trigger-ul de append-only le apara oricum.
 *
 * Pe o luna inchisa functia ridica `PERIOD_CLOSED`, si asta e corect: mutarea
 * trebuie sa treaca atunci prin documentul de re-alocare.
 */
export async function rechargeCostLines(
  tx: ActorTx,
  costLineIds: readonly string[],
  target: { readonly contractId: string; readonly componentId: string | null },
  reason: string,
): Promise<number> {
  for (const costLineId of costLineIds) {
    await tx.execute(sql`
      select app.recharge_cost_line(
        ${costLineId}, ${target.contractId}, ${target.componentId}, ${reason}
      )`);
  }

  return costLineIds.length;
}

/**
 * Liniile de cost ale unei unitati de lucru care se muta odata cu ea.
 *
 * Se iau doar cele din luna care se muta: costurile lunilor deja raportate raman
 * unde sunt, si pentru ele exista documentul de re-alocare. Fara filtrul asta, o
 * mutare pe septembrie ar rescrie tacut si august.
 */
export async function costLineIdsForMove(
  tx: ActorTx,
  workUnitId: string,
  fromPeriodId: string,
  fromComponentId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.costLines.id })
    .from(schema.costLines)
    .where(
      and(
        eq(schema.costLines.workUnitId, workUnitId),
        eq(schema.costLines.periodId, fromPeriodId),
        eq(schema.costLines.chargedComponentId, fromComponentId),
      ),
    );

  return rows.map((row) => row.id);
}

// ── Citiri ───────────────────────────────────────────────────────────────────

export type CostLineRow = typeof schema.costLines.$inferSelect & {
  readonly workUnitCode: string | null;
  readonly stageName: string | null;
  readonly chargedComponentName: string | null;
  readonly usedComponentName: string | null;
  readonly createdByName: string | null;
};

/**
 * Liniile de cost, filtrate si paginate.
 *
 * **Paginare cursor pe `(effect_date, id)`, niciodata `OFFSET`** (§3.5): la a
 * zecea pagina dintr-un registru de o suta de mii de linii, `OFFSET` citeste
 * toate randurile dinainte ca sa le arunce.
 */
export async function listCostLines(
  actor: Actor,
  query: CostQuery = {},
): Promise<{ rows: CostLineRow[]; nextCursor: { effectDate: string; id: string } | null }> {
  const values = costQuerySchema.parse(query);
  const limit = values.limit ?? DEFAULT_LIMIT;

  return withActor(actor, async (tx) => {
    // Un filtru absent inseamna „nu filtra pe asta". `null` vine din `''`, deci
    // e tot absenta — un `<select>` gol nu e o cerere de „unde e null".
    const set = (value: string | null | undefined): value is string =>
      value !== null && value !== undefined;

    const conditions = [];
    if (set(values.companyId)) conditions.push(eq(schema.costLines.companyId, values.companyId));
    if (set(values.periodId)) conditions.push(eq(schema.costLines.periodId, values.periodId));
    if (set(values.workUnitId)) conditions.push(eq(schema.costLines.workUnitId, values.workUnitId));
    if (set(values.stageId)) conditions.push(eq(schema.costLines.stageId, values.stageId));
    if (set(values.objectiveId))
      conditions.push(eq(schema.costLines.objectiveId, values.objectiveId));
    if (set(values.chargedComponentId))
      conditions.push(eq(schema.costLines.chargedComponentId, values.chargedComponentId));
    if (values.expenseType !== undefined)
      conditions.push(eq(schema.costLines.expenseType, values.expenseType));
    if (values.stage !== undefined) conditions.push(eq(schema.costLines.stage, values.stage));

    // Cursorul: „mai vechi decat ultima linie afisata", cu id-ul ca departajare.
    if (values.cursorEffectDate !== undefined && values.cursorId !== undefined) {
      conditions.push(
        or(
          lt(schema.costLines.effectDate, values.cursorEffectDate),
          and(
            eq(schema.costLines.effectDate, values.cursorEffectDate),
            lt(schema.costLines.id, values.cursorId),
          ),
        ),
      );
    }

    const rows = await tx
      .select({
        line: schema.costLines,
        workUnitCode: schema.workUnits.code,
        stageName: schema.workStages.name,
        chargedComponentName: sql<string | null>`(
          select cc.name from app.contract_components cc
           where cc.id = app.cost_lines.charged_component_id
        )`,
        usedComponentName: sql<string | null>`(
          select cc.name from app.contract_components cc
           where cc.id = app.cost_lines.used_component_id
        )`,
        createdByName: schema.persons.fullName,
      })
      .from(schema.costLines)
      .leftJoin(schema.workUnits, eq(schema.workUnits.id, schema.costLines.workUnitId))
      .leftJoin(schema.workStages, eq(schema.workStages.id, schema.costLines.stageId))
      .leftJoin(schema.persons, eq(schema.persons.id, schema.costLines.createdBy))
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(schema.costLines.effectDate), desc(schema.costLines.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);

    return {
      rows: page.map((row) => ({
        ...row.line,
        workUnitCode: row.workUnitCode,
        stageName: row.stageName,
        chargedComponentName: row.chargedComponentName,
        usedComponentName: row.usedComponentName,
        createdByName: row.createdByName,
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? { effectDate: last.line.effectDate, id: last.line.id }
          : null,
    };
  });
}

export interface CostBreakdownRow {
  readonly expenseType: string;
  readonly committed: Money;
  readonly received: Money;
  readonly consumed: Money;
  readonly invoiced: Money;
}

/**
 * Tab-ul Costuri al unei unitati de lucru sau al unei etape: cheltuiala desfacuta
 * pe fel si pe stadiu, dintr-o singura interogare.
 */
export async function costBreakdown(
  actor: Actor,
  scope: { readonly workUnitId?: string; readonly stageId?: string },
): Promise<CostBreakdownRow[]> {
  if (scope.workUnitId === undefined && scope.stageId === undefined) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const conditions = [];
    if (scope.workUnitId !== undefined)
      conditions.push(eq(schema.costLines.workUnitId, scope.workUnitId));
    if (scope.stageId !== undefined) conditions.push(eq(schema.costLines.stageId, scope.stageId));

    const rows = await tx
      .select({
        expenseType: schema.costLines.expenseType,
        committed: sql<string>`coalesce(sum(amount) filter (where stage = 'angajat'), 0)::text`,
        received: sql<string>`coalesce(sum(amount) filter (where stage = 'receptionat'), 0)::text`,
        consumed: sql<string>`coalesce(sum(amount) filter (where stage = 'consumat'), 0)::text`,
        invoiced: sql<string>`coalesce(sum(amount) filter (where stage = 'facturat'), 0)::text`,
      })
      .from(schema.costLines)
      .where(and(...conditions))
      .groupBy(schema.costLines.expenseType)
      .orderBy(asc(schema.costLines.expenseType));

    return rows.map((row) => ({
      expenseType: row.expenseType,
      committed: Money.fromDb(row.committed),
      received: Money.fromDb(row.received),
      consumed: Money.fromDb(row.consumed),
      invoiced: Money.fromDb(row.invoiced),
    }));
  });
}

export type ReconciliationRow = CostLineRow & {
  readonly usedContractCode: string | null;
  readonly chargedContractCode: string | null;
};

/**
 * „Bani › Reconciliere folosit vs descarcat" (§12, verificarea #15).
 *
 * Interogarea merge pe indexul partial din 0017, care contine EXACT anomaliile:
 * o linie normala, cu cele doua analitici egale, nu intra in index deloc. Daca
 * lista creste necontrolat, problema e in firma, nu in software.
 */
export async function listReconciliation(
  actor: Actor,
  options: { readonly companyIds: readonly string[]; readonly periodId?: string },
): Promise<ReconciliationRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const conditions = [
      inArray(schema.costLines.companyId, [...options.companyIds]),
      sql`app.cost_lines.used_contract_id is distinct from app.cost_lines.charged_contract_id`,
    ];
    if (options.periodId !== undefined) {
      conditions.push(eq(schema.costLines.periodId, options.periodId));
    }

    const rows = await tx
      .select({
        line: schema.costLines,
        workUnitCode: schema.workUnits.code,
        stageName: schema.workStages.name,
        createdByName: schema.persons.fullName,
        usedContractCode: sql<string | null>`(
          select c.code from app.contracts c where c.id = app.cost_lines.used_contract_id
        )`,
        chargedContractCode: sql<string | null>`(
          select c.code from app.contracts c where c.id = app.cost_lines.charged_contract_id
        )`,
        chargedComponentName: sql<string | null>`(
          select cc.name from app.contract_components cc
           where cc.id = app.cost_lines.charged_component_id
        )`,
        usedComponentName: sql<string | null>`(
          select cc.name from app.contract_components cc
           where cc.id = app.cost_lines.used_component_id
        )`,
      })
      .from(schema.costLines)
      .leftJoin(schema.workUnits, eq(schema.workUnits.id, schema.costLines.workUnitId))
      .leftJoin(schema.workStages, eq(schema.workStages.id, schema.costLines.stageId))
      .leftJoin(schema.persons, eq(schema.persons.id, schema.costLines.createdBy))
      .where(and(...conditions))
      .orderBy(desc(schema.costLines.effectDate), desc(schema.costLines.id))
      .limit(DEFAULT_LIMIT);

    return rows.map((row) => ({
      ...row.line,
      workUnitCode: row.workUnitCode,
      stageName: row.stageName,
      chargedComponentName: row.chargedComponentName,
      usedComponentName: row.usedComponentName,
      createdByName: row.createdByName,
      usedContractCode: row.usedContractCode,
      chargedContractCode: row.chargedContractCode,
    }));
  });
}

export interface ObjectiveCostYear {
  readonly year: number;
  readonly total: Money;
  /** Media pe lunile IN CARE s-a intamplat ceva, nu pe 12. */
  readonly monthlyAverage: Money;
  readonly monthsWithActivity: number;
  readonly workUnitCount: number;
}

/**
 * Istoricul unui obiectiv, pe ani (§3.4).
 *
 * Construit pe analitica **„folosit"**, si asta e tot rostul ecranului: banii se
 * plimba intre contracte, obiectivul ramane acelasi. Un istoric pe „descarcat"
 * s-ar rescrie de fiecare data cand cineva muta finantarea — adica ar raspunde
 * la alta intrebare decat cea pusa.
 *
 * Media lunara se imparte la lunile CU activitate, nu la 12: o statie atinsa in
 * doua luni din an n-a costat „media pe 12", iar cifra aia n-ar ajuta pe nimeni
 * sa compare doua obiective.
 */
export async function objectiveCostHistory(
  actor: Actor,
  objectiveId: string,
): Promise<ObjectiveCostYear[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx.execute(sql`
      select
        extract(year from effect_date)::int                  as year,
        sum(amount)::text                                    as total,
        count(distinct date_trunc('month', effect_date))::int as months,
        count(distinct work_unit_id)::int                     as work_units
        from app.cost_lines
       where objective_id = ${objectiveId}
       group by 1
       order by 1 desc`);

    return (rows.rows as { year: number; total: string; months: number; work_units: number }[]).map(
      (row) => {
        const total = Money.fromDb(row.total);
        return {
          year: row.year,
          total,
          monthlyAverage: row.months === 0 ? Money.ZERO : total.div(row.months),
          monthsWithActivity: row.months,
          workUnitCount: row.work_units,
        };
      },
    );
  });
}

export interface ObjectiveHistoryEntry {
  readonly workUnitId: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly status: string;
  /** Data la care s-a lucrat: executia fisei, sau inceputul lucrarii. */
  readonly happenedOn: string | null;
  readonly contractCode: string | null;
  readonly companyName: string;
  /** Costul acumulat pe unitate, pe analitica „folosit". */
  readonly cost: Money;
  /** `true` cand fisa e validata (inspectie sau interventie). */
  readonly validated: boolean;
}

/**
 * Ce s-a intamplat la un obiectiv — inspectii, interventii si lucrari, cu
 * costul lor (§3.5).
 *
 * **Transversal peste contracte si peste ani, pe analitica „folosit".** Aia e
 * intreaga miza a ecranului: intrebarea „ce s-a facut la stația asta" n-are
 * nimic de-a face cu cine a platit. Daca ar fi construit pe „descarcat", o
 * mutare de finantare din 2024 ar sterge din istoric o interventie care chiar a
 * avut loc.
 *
 * Costul se citeste din registru, nu de pe unitate: unitatea n-are camp de cost
 * realizat, si bine ca n-are — ar fi fost a doua sursa de adevar pentru un numar
 * care se schimba la fiecare document nou.
 */
export async function objectiveWorkHistory(
  actor: Actor,
  objectiveId: string,
  options: { readonly limit?: number } = {},
): Promise<ObjectiveHistoryEntry[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{
      work_unit_id: string;
      code: string;
      name: string;
      type: string;
      status: string;
      happened_on: string | null;
      contract_code: string | null;
      company_name: string;
      cost: string;
      validated: boolean;
    }>(sql`
      select
        wu.id                                   as work_unit_id,
        wu.code,
        wu.name,
        wu.type::text                           as type,
        wu.status::text                         as status,
        coalesce(insp.performed_on, iv.performed_on, wu.starts_on)::text as happened_on,
        c.code                                  as contract_code,
        comp.name                               as company_name,
        coalesce(
          (select sum(cl.amount) from app.cost_lines cl where cl.work_unit_id = wu.id),
          0
        )::text                                 as cost,
        (insp.validated_at is not null or iv.validated_at is not null) as validated
        from app.work_units wu
        join app.companies comp on comp.id = wu.company_id
        left join app.inspections insp on insp.work_unit_id = wu.id
        left join app.interventions iv on iv.work_unit_id = wu.id
        left join app.contract_objectives co on co.id = wu.contract_objective_id
        left join app.contracts c on c.id = co.contract_id
       where wu.objective_id = ${objectiveId}
       order by coalesce(insp.performed_on, iv.performed_on, wu.starts_on) desc nulls last,
                wu.created_at desc
       limit ${options.limit ?? 200}`);

    return rows.rows.map((row) => ({
      workUnitId: row.work_unit_id,
      code: row.code,
      name: row.name,
      type: row.type,
      status: row.status,
      happenedOn: row.happened_on,
      contractCode: row.contract_code,
      companyName: row.company_name,
      cost: Money.fromDb(row.cost),
      validated: row.validated,
    }));
  });
}

// ── Marja ────────────────────────────────────────────────────────────────────

export interface ContractMargin {
  readonly contractId: string;
  readonly periodId: string;
  /** Cat s-a promis din componentele contractului in luna asta. */
  readonly revenue: Money;
  /** Costul direct: ce s-a consumat, pe analitica „descarcat". */
  readonly directCost: Money;
  /** Regia lunii. `Money.ZERO` pe baza bruta — nu lipsa, ci zero explicit. */
  readonly overhead: Money;
  readonly margin: Money;
  /**
   * Pe ce e construita cifra. **Nu e optional**, si de-aia sta in tipul de retur:
   * regula de interfata 9 cere ca fiecare ecran cu marja sa declare baza, iar un
   * camp obligatoriu se declara singur. Doua ecrane care ar afisa doua cifre
   * diferite fara sa spuna care e care sunt mai rele decat niciun ecran.
   */
  readonly basis: 'gross' | 'net';
  /** Procentul folosit la regie, din fotografia lunii. Null pe baza bruta. */
  readonly overheadPct: string | null;
}

/**
 * Marja unui contract pe o luna, bruta sau neta.
 *
 * Neta foloseste `overhead_snapshots` — FOTOGRAFIA lunii, nu procentul curent al
 * contractului. Diferenta conteaza peste un an: procentul de regie se schimba,
 * iar marja lui martie 2026 trebuie sa ramana cea calculata cu procentul lui
 * martie 2026. Cand fotografia lipseste (luna n-a fost inca recalculata de
 * worker), regia e zero si `overheadPct` e `null` — nu inventam procentul curent,
 * pentru ca atunci cifra s-ar schimba retroactiv la fiecare modificare de contract.
 */
export async function contractMargin(
  actor: Actor,
  contractId: string,
  periodId: string,
  basis: 'gross' | 'net' = 'gross',
): Promise<ContractMargin> {
  return withActor(actor, async (tx) => {
    const totals = await tx.execute(sql`
      select
        coalesce(sum(r.allocated_revenue), 0)::text as revenue,
        coalesce(sum(r.consumed), 0)::text          as direct_cost
        from app.component_period_rollup r
        join app.contract_components cc on cc.id = r.component_id
       where cc.contract_id = ${contractId} and r.period_id = ${periodId}`);

    const row = (totals.rows[0] ?? {}) as { revenue?: string; direct_cost?: string };
    const revenue = Money.fromDb(row.revenue);
    const directCost = Money.fromDb(row.direct_cost);

    if (basis === 'gross') {
      return {
        contractId,
        periodId,
        revenue,
        directCost,
        overhead: Money.ZERO,
        margin: revenue.sub(directCost),
        basis,
        overheadPct: null,
      };
    }

    const snapshots = await tx
      .select()
      .from(schema.overheadSnapshots)
      .where(
        and(
          eq(schema.overheadSnapshots.contractId, contractId),
          eq(schema.overheadSnapshots.periodId, periodId),
        ),
      )
      .limit(1);

    const snapshot = snapshots[0];
    const overhead = Money.fromDb(snapshot?.overheadAmount);

    return {
      contractId,
      periodId,
      revenue,
      directCost,
      overhead,
      margin: revenue.sub(directCost).sub(overhead),
      basis,
      overheadPct: snapshot?.overheadPct ?? null,
    };
  });
}

/**
 * Recalculeaza fotografia de regie a unei luni. Ruleaza ca `app_service`:
 * `insert`/`update` pe `overhead_snapshots` nu se acorda biroului, tocmai ca
 * marja unei luni raportate sa nu se poata rescrie dintr-un ecran.
 */
export async function recomputeOverheadSnapshot(
  actor: Actor,
  contractId: string,
  periodId: string,
): Promise<Money> {
  return withActor(actor, async (tx) => {
    const contracts = await tx
      .select({ overheadPct: schema.contracts.overheadPct })
      .from(schema.contracts)
      .where(eq(schema.contracts.id, contractId))
      .limit(1);

    const pct = contracts[0]?.overheadPct ?? '0';

    const totals = await tx.execute(sql`
      select coalesce(sum(r.consumed), 0)::text as direct_cost
        from app.component_period_rollup r
        join app.contract_components cc on cc.id = r.component_id
       where cc.contract_id = ${contractId} and r.period_id = ${periodId}`);

    const directCost = Money.fromDb(
      (totals.rows[0] as { direct_cost?: string } | undefined)?.direct_cost,
    );
    const overhead = directCost.mul(Number(pct));

    await tx.execute(sql`
      insert into app.overhead_snapshots
        (contract_id, period_id, overhead_pct, direct_cost, overhead_amount)
      values (${contractId}, ${periodId}, ${pct}, ${directCost.toDbString()}, ${overhead.toDbString()})
      on conflict (contract_id, period_id) do update set
        overhead_pct = excluded.overhead_pct,
        direct_cost = excluded.direct_cost,
        overhead_amount = excluded.overhead_amount,
        computed_at = now()`);

    return overhead;
  });
}

export interface RollupDivergence {
  readonly componentId: string;
  readonly periodId: string;
  readonly columnName: string;
  readonly stored: Money;
  readonly expected: Money;
}

/**
 * Recalculeaza rollup-urile din registru si intoarce DOAR diferentele.
 *
 * Interogarea traieste in baza (`app.rollup_verify`), nu aici, si dinadins: un
 * test care ar verifica rollup-ul cu aceeasi formula care l-a produs n-ar
 * verifica nimic. Jobul nocturn `rollup.verify` cheama functia asta.
 */
export async function verifyRollups(actor: Actor, periodId?: string): Promise<RollupDivergence[]> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select component_id, period_id, column_name, stored, expected
        from app.rollup_verify(${periodId ?? null})`);

    return (
      result.rows as {
        component_id: string;
        period_id: string;
        column_name: string;
        stored: string;
        expected: string;
      }[]
    ).map((row) => ({
      componentId: row.component_id,
      periodId: row.period_id,
      columnName: row.column_name,
      stored: Money.fromDb(row.stored),
      expected: Money.fromDb(row.expected),
    }));
  });
}
