import type {
  CloseWorkUnitInput,
  CreateWorkUnitInput,
  FundingAllocationInput,
  MoveFundingInputDto,
  PromoteWorkUnitInput,
  ReorderStagesInput,
  WorkStageInput,
  WorkUnitFormInput,
} from '@damina/contracts';
import {
  closeWorkUnitInputSchema,
  createWorkUnitInputSchema,
  fundingAllocationInputSchema,
  moveFundingInputSchema,
  promoteWorkUnitInputSchema,
  reorderStagesInputSchema,
  workStageInputSchema,
  workUnitFormSchema,
} from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import {
  canPromote,
  describeFundingMove,
  physicalProgress,
  planFundingMove,
  stageScheduleIsCoherent,
  type FundingMovePlan,
  type PeriodStatus,
  type PhysicalProgress,
  type PromotableWorkUnit,
  type PromotionCheck,
  type StageScheduleCheck,
} from '@damina/domain';
import { AppError, Money, uuidv7 } from '@damina/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { costLineIdsForMove, rechargeCostLines } from './cost';
import { SQLSTATE, sqlstate, translateDbError } from './db-errors';

/**
 * Unitatea de lucru: creare, promovare, finantare, etape, inchidere.
 *
 * **Fiecare use-case e o tranzactie, si o tranzactie e o unitate atomica.** O
 * unitate de lucru fara finantarea ei nu e o unitate pe jumatate creata, e o
 * cifra care lipseste din raportul lunii — de aceea codul din serie, alocarile si
 * asignarile intra sau nu intra impreuna.
 *
 * Ce NU face modulul asta, dinadins: nu decide. Mecanica mutarii de finantare vine
 * din `@damina/domain` (`planFundingMove`), iar regulile de integritate vin din
 * triggere. Serviciul leaga cele doua si traduce erorile in propozitii.
 */

const DEFAULT_LIMIT = 200;

/** Seria implicita a documentelor de re-alocare, per firma. */
const REALLOCATION_SERIES = 'NRA';

const like = (query: string): string => `%${query.replace(/([%_\\])/g, '\\$1')}%`;

// ── Citiri ───────────────────────────────────────────────────────────────────

export type WorkUnitRow = typeof schema.workUnits.$inferSelect & {
  readonly companyName: string;
  readonly objectiveCode: string;
  readonly objectiveName: string;
  readonly responsibleName: string | null;
  readonly subcontractorName: string | null;
  /** Cate alocari ACTIVE are. Trei inseamna „Delta ×3 luni". */
  readonly allocationCount: number;
  /** Suma alocarilor active exprimate in bani. */
  readonly allocatedTotal: Money;
  /** Componentele din care se plateste, ca text scurt pentru lista. */
  readonly fundingLabel: string | null;
  /**
   * Cat s-a consumat efectiv. **Mereu zero pana la pasul 06** — registrul de cost
   * nu exista inca. Coloana si eticheta sunt corecte de acum, ca ecranul sa nu se
   * rearanjeze cand apar cifrele.
   */
  readonly consumed: Money;
};

/*
 * Coloanele exterioare se scriu CALIFICAT in subinterogari — `app.work_units.id`,
 * nu `${schema.workUnits.id}`. Capcana e documentata pe larg in `contracts.ts`:
 * drizzle randeaza coloana interpolata fara prefix de tabela, iar in interiorul
 * subinterogarii `"id"` se leaga de tabela de acolo. Rezultatul ar fi zero, fara
 * nicio eroare.
 */
const workUnitSelection = {
  workUnit: schema.workUnits,
  companyName: schema.companies.name,
  objectiveCode: schema.objectives.code,
  objectiveName: schema.objectives.name,
  responsibleName: schema.persons.fullName,
  subcontractorName: schema.subcontractors.name,
  allocationCount: sql<string>`(
    select count(*)::text from app.funding_allocations fa
     where fa.work_unit_id = app.work_units.id and fa.status = 'active'
  )`,
  allocatedTotal: sql<string>`(
    select coalesce(sum(fa.allocated_amount), 0)::text from app.funding_allocations fa
     where fa.work_unit_id = app.work_units.id and fa.status = 'active'
  )`,
  fundingLabel: sql<string | null>`(
    select string_agg(distinct cc.name, ', ') from app.funding_allocations fa
      join app.contract_components cc on cc.id = fa.component_id
     where fa.work_unit_id = app.work_units.id and fa.status = 'active'
  )`,
};

type WorkUnitSelectionRow = {
  workUnit: typeof schema.workUnits.$inferSelect;
  companyName: string;
  objectiveCode: string;
  objectiveName: string;
  responsibleName: string | null;
  subcontractorName: string | null;
  allocationCount: string;
  allocatedTotal: string;
  fundingLabel: string | null;
};

const toWorkUnitRow = (row: WorkUnitSelectionRow): WorkUnitRow => ({
  ...row.workUnit,
  companyName: row.companyName,
  objectiveCode: row.objectiveCode,
  objectiveName: row.objectiveName,
  responsibleName: row.responsibleName,
  subcontractorName: row.subcontractorName,
  allocationCount: Number(row.allocationCount),
  allocatedTotal: Money.fromDb(row.allocatedTotal),
  fundingLabel: row.fundingLabel,
  consumed: Money.ZERO,
});

type WorkUnitStatus = (typeof schema.workUnits.$inferSelect)['status'];
type WorkUnitType = (typeof schema.workUnits.$inferSelect)['type'];

export interface ListWorkUnitsOptions {
  /** Firmele selectate in shell. Lista goala nu inseamna „toate”, ci „niciuna”. */
  readonly companyIds: readonly string[];
  readonly types?: readonly WorkUnitType[];
  readonly statuses?: readonly WorkUnitStatus[];
  readonly objectiveId?: string;
  readonly responsiblePersonId?: string;
  readonly executorType?: 'echipa_proprie' | 'subcontractant';
  /** Filtreaza pe contractul care PLATESTE, prin alocarile active. */
  readonly contractId?: string;
  readonly componentId?: string;
  readonly periodId?: string;
  readonly query?: string;
  readonly limit?: number;
}

/**
 * Vederea unificata (§3.4): o singura lista peste toate cele trei tipuri.
 *
 * Filtrele pe contract, componenta si luna trec prin `funding_allocations`, nu
 * prin coloane de pe unitate — pentru ca acolo traieste finantarea. Un filtru pe
 * `work_units.contract_id` n-ar avea ce sa citeasca, si e chiar semnul c-a
 * incercat cineva sa mute finantarea inapoi pe entitate.
 */
export async function listWorkUnits(
  actor: Actor,
  options: ListWorkUnitsOptions,
): Promise<WorkUnitRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }
  const { limit = DEFAULT_LIMIT } = options;

  return withActor(actor, async (tx) => {
    const conditions = [inArray(schema.workUnits.companyId, [...options.companyIds])];

    if (options.types !== undefined && options.types.length > 0) {
      conditions.push(inArray(schema.workUnits.type, [...options.types]));
    }
    if (options.statuses !== undefined && options.statuses.length > 0) {
      conditions.push(inArray(schema.workUnits.status, [...options.statuses]));
    }
    if (options.objectiveId !== undefined) {
      conditions.push(eq(schema.workUnits.objectiveId, options.objectiveId));
    }
    if (options.responsiblePersonId !== undefined) {
      conditions.push(eq(schema.workUnits.responsiblePersonId, options.responsiblePersonId));
    }
    if (options.executorType !== undefined) {
      conditions.push(eq(schema.workUnits.executorType, options.executorType));
    }
    if (options.query !== undefined && options.query.trim() !== '') {
      const pattern = like(options.query.trim());
      conditions.push(
        sql`(app.work_units.code ilike ${pattern} or app.work_units.name ilike ${pattern})`,
      );
    }

    // Filtrele de finantare: `exists`, nu `join` — un join ar dubla randul unei
    // lucrari finantate din trei luni, si lista ar arata-o de trei ori.
    if (options.contractId !== undefined) {
      conditions.push(sql`exists (
        select 1 from app.funding_allocations fa
         where fa.work_unit_id = app.work_units.id and fa.status = 'active'
           and fa.contract_id = ${options.contractId}
      )`);
    }
    if (options.componentId !== undefined) {
      conditions.push(sql`exists (
        select 1 from app.funding_allocations fa
         where fa.work_unit_id = app.work_units.id and fa.status = 'active'
           and fa.component_id = ${options.componentId}
      )`);
    }
    if (options.periodId !== undefined) {
      conditions.push(sql`exists (
        select 1 from app.funding_allocations fa
         where fa.work_unit_id = app.work_units.id and fa.status = 'active'
           and fa.period_id = ${options.periodId}
      )`);
    }

    const rows = await tx
      .select(workUnitSelection)
      .from(schema.workUnits)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.workUnits.companyId))
      .innerJoin(schema.objectives, eq(schema.objectives.id, schema.workUnits.objectiveId))
      .leftJoin(schema.persons, eq(schema.persons.id, schema.workUnits.responsiblePersonId))
      .leftJoin(
        schema.subcontractors,
        eq(schema.subcontractors.id, schema.workUnits.executorSubcontractorId),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.workUnits.createdAt))
      .limit(limit);

    return rows.map(toWorkUnitRow);
  });
}

export async function getWorkUnit(actor: Actor, id: string): Promise<WorkUnitRow> {
  const row = await withActor(actor, async (tx) => {
    const [found] = await tx
      .select(workUnitSelection)
      .from(schema.workUnits)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.workUnits.companyId))
      .innerJoin(schema.objectives, eq(schema.objectives.id, schema.workUnits.objectiveId))
      .leftJoin(schema.persons, eq(schema.persons.id, schema.workUnits.responsiblePersonId))
      .leftJoin(
        schema.subcontractors,
        eq(schema.subcontractors.id, schema.workUnits.executorSubcontractorId),
      )
      .where(eq(schema.workUnits.id, id))
      .limit(1);
    return found;
  });

  if (row === undefined) {
    throw AppError.notFound('Unitatea de lucru', id);
  }
  return toWorkUnitRow(row);
}

export type AllocationRow = typeof schema.fundingAllocations.$inferSelect & {
  readonly contractCode: string;
  readonly componentName: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly periodStatus: PeriodStatus;
  readonly createdByName: string | null;
};

/**
 * Alocarile unei unitati, ISTORICUL COMPLET — si cele supersedate.
 *
 * Ecranul are nevoie de amandoua: alocarile active spun de unde se plateste, iar
 * cele supersedate spun de unde se platea si cine a decis sa nu mai fie asa. A
 * doua intrebare e cea care se pune la sedinta de luna.
 */
export async function listAllocations(
  actor: Actor,
  workUnitId: string,
): Promise<AllocationRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        allocation: schema.fundingAllocations,
        contractCode: schema.contracts.code,
        componentName: schema.contractComponents.name,
        periodYear: schema.periods.year,
        periodMonth: schema.periods.month,
        periodStatus: schema.periods.status,
        createdByName: schema.persons.fullName,
      })
      .from(schema.fundingAllocations)
      .innerJoin(schema.contracts, eq(schema.contracts.id, schema.fundingAllocations.contractId))
      .innerJoin(
        schema.contractComponents,
        eq(schema.contractComponents.id, schema.fundingAllocations.componentId),
      )
      .innerJoin(schema.periods, eq(schema.periods.id, schema.fundingAllocations.periodId))
      .leftJoin(schema.persons, eq(schema.persons.id, schema.fundingAllocations.createdBy))
      .where(eq(schema.fundingAllocations.workUnitId, workUnitId))
      .orderBy(desc(schema.fundingAllocations.createdAt));

    return rows.map((row) => ({
      ...row.allocation,
      contractCode: row.contractCode,
      componentName: row.componentName,
      periodYear: row.periodYear,
      periodMonth: row.periodMonth,
      periodStatus: row.periodStatus,
      createdByName: row.createdByName,
    }));
  });
}

export type StageRow = typeof schema.workStages.$inferSelect;

export async function listStages(actor: Actor, workUnitId: string): Promise<StageRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.workStages)
      .where(eq(schema.workStages.workUnitId, workUnitId))
      .orderBy(asc(schema.workStages.position)),
  );
}

export type StageWithWorkUnitRow = StageRow & {
  readonly workUnitCode: string;
  readonly workUnitName: string;
  readonly workUnitStatus: string;
  readonly companyId: string;
  readonly objectiveName: string;
};

/**
 * Etapele tuturor lucrarilor active de pe firmele selectate.
 *
 * Serveste doua ecrane cu o singura interogare: **Gantt-ul general** (§3.4 —
 * toate lucrarile pe o axa de timp, cu etapele lor) si lista de etape. Doua
 * interogari ar fi insemnat doua paginari si doua feluri de a numara — iar cele
 * doua ecrane arata aceleasi randuri, deci trebuie sa arate acelasi numar.
 */
export async function listStagesForCompanies(
  actor: Actor,
  options: {
    readonly companyIds: readonly string[];
    /** Lucrarile inchise si anulate se scot implicit: graficul e despre ce urmeaza. */
    readonly includeClosed?: boolean;
    readonly limit?: number;
  },
): Promise<StageWithWorkUnitRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const conditions = [
      inArray(schema.workUnits.companyId, [...options.companyIds]),
      eq(schema.workUnits.type, 'lucrare'),
    ];
    if (options.includeClosed !== true) {
      conditions.push(sql`app.work_units.status not in ('inchisa', 'anulata')`);
    }

    const rows = await tx
      .select({
        stage: schema.workStages,
        workUnitCode: schema.workUnits.code,
        workUnitName: schema.workUnits.name,
        workUnitStatus: schema.workUnits.status,
        companyId: schema.workUnits.companyId,
        objectiveName: schema.objectives.name,
      })
      .from(schema.workStages)
      .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.workStages.workUnitId))
      .innerJoin(schema.objectives, eq(schema.objectives.id, schema.workUnits.objectiveId))
      .where(and(...conditions))
      .orderBy(
        asc(schema.workUnits.code),
        asc(schema.workStages.position),
      )
      .limit(options.limit ?? DEFAULT_LIMIT * 5);

    return rows.map((row) => ({
      ...row.stage,
      workUnitCode: row.workUnitCode,
      workUnitName: row.workUnitName,
      workUnitStatus: row.workUnitStatus,
      companyId: row.companyId,
      objectiveName: row.objectiveName,
    }));
  });
}

/** O etapa, cu lucrarea careia apartine. Pentru pagina proprie a etapei (#11). */
export async function getStage(actor: Actor, id: string): Promise<StageWithWorkUnitRow | null> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        stage: schema.workStages,
        workUnitCode: schema.workUnits.code,
        workUnitName: schema.workUnits.name,
        workUnitStatus: schema.workUnits.status,
        companyId: schema.workUnits.companyId,
        objectiveName: schema.objectives.name,
      })
      .from(schema.workStages)
      .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.workStages.workUnitId))
      .innerJoin(schema.objectives, eq(schema.objectives.id, schema.workUnits.objectiveId))
      .where(eq(schema.workStages.id, id))
      .limit(1);

    if (row === undefined) {
      return null;
    }
    return {
      ...row.stage,
      workUnitCode: row.workUnitCode,
      workUnitName: row.workUnitName,
      workUnitStatus: row.workUnitStatus,
      companyId: row.companyId,
      objectiveName: row.objectiveName,
    };
  });
}

export type AssignmentRow = typeof schema.workUnitAssignments.$inferSelect & {
  readonly personName: string;
};

export async function listAssignments(
  actor: Actor,
  workUnitId: string,
): Promise<AssignmentRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({ assignment: schema.workUnitAssignments, personName: schema.persons.fullName })
      .from(schema.workUnitAssignments)
      .innerJoin(schema.persons, eq(schema.persons.id, schema.workUnitAssignments.personId))
      .where(eq(schema.workUnitAssignments.workUnitId, workUnitId))
      .orderBy(asc(schema.workUnitAssignments.validFrom));

    return rows.map((row) => ({ ...row.assignment, personName: row.personName }));
  });
}

/**
 * Progresul fizic si coerenta graficului, dintr-o singura citire.
 *
 * Amandoua vin din `@damina/domain`, care nu stie de Postgres. Serviciul doar
 * traduce randurile in forma pe care o cere domeniul.
 */
export async function getStageOverview(
  actor: Actor,
  workUnitId: string,
): Promise<{ readonly progress: PhysicalProgress; readonly schedule: StageScheduleCheck }> {
  const stages = await listStages(actor, workUnitId);
  const shaped = stages.map((stage) => ({
    position: stage.position,
    plannedStart: stage.plannedStart,
    plannedEnd: stage.plannedEnd,
    actualStart: stage.actualStart,
    actualEnd: stage.actualEnd,
    pctOfWork: stage.pctOfWork === null ? null : Number(stage.pctOfWork),
  }));

  return { progress: physicalProgress(shaped), schedule: stageScheduleIsCoherent(shaped) };
}

// ── Creare ───────────────────────────────────────────────────────────────────

/**
 * Codul din serie. Tipul unitatii ESTE numele tipului de document, de la 05a
 * incoace: `lucrare`, `interventie`, `inspectie` sunt valori in
 * `app.numbered_document_type`.
 */
export async function allocateCode(
  tx: ActorTx,
  companyId: string,
  type: string,
  series: string,
): Promise<string> {
  const result = await tx.execute<{ code: string }>(
    sql`select app.allocate_document_number(
          ${companyId}, ${type}::app.numbered_document_type, ${series}
        ) as code`,
  );
  const code = result.rows[0]?.code;
  if (code === undefined) {
    throw new AppError('NOT_FOUND', `Seria ${series} nu e definită la firma asta.`);
  }
  return code;
}

/**
 * Creeaza unitatea, codul, finantarea si asignarile — **o singura tranzactie**.
 *
 * Ordinea nu e intamplatoare: codul se cere cat mai TARZIU posibil, ca lock-ul de
 * pe randul de serie sa fie tinut cat mai putin. Alocarea de finantare vine dupa
 * unitate pentru ca trigger-ul ei citeste firma de pe unitate.
 *
 * Verificarea #16 a pasului trece pe aici: o luna inchisa nu opreste unitatea, ci
 * ALOCAREA — iar cum totul e o tranzactie, nu ramane nimic.
 */
export async function createWorkUnit(
  actor: Actor,
  input: CreateWorkUnitInput,
  id?: string,
): Promise<{ readonly id: string; readonly code: string }> {
  const values = createWorkUnitInputSchema.parse(input);
  const workUnitId = id ?? uuidv7();

  /*
   * Interventia cere finantare de la primul rand; inspectia si lucrarea, nu.
   *
   * Nu e o inconsecventa: o interventie e o cheltuiala care se face acum, deci
   * cineva trebuie s-o fi aprobat de undeva. O inspectie e o verificare pe
   * checklist, iar o lucrare incepe ca draft, inainte de deviz — amandoua capata
   * finantare mai tarziu, prin `allocateFunding`.
   */
  if (values.workUnit.type === 'interventie' && values.allocations.length === 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      'O intervenție are nevoie de cel puțin o alocare de finanțare.',
    );
  }

  try {
    return await withActor(actor, async (tx) => {
      const code = await allocateCode(
        tx,
        values.workUnit.companyId,
        values.workUnit.type,
        values.series,
      );

      await tx.insert(schema.workUnits).values({ id: workUnitId, code, ...values.workUnit });

      for (const allocation of values.allocations) {
        await tx.insert(schema.fundingAllocations).values({
          id: uuidv7(),
          workUnitId,
          contractId: allocation.contractId,
          componentId: allocation.componentId,
          periodId: allocation.periodId,
          allocatedAmount: allocation.allocatedAmount,
          allocatedPct: allocation.allocatedPct,
          reason: allocation.reason,
          createdBy: actor.personId,
        });
      }

      if (values.assignments.length > 0) {
        await tx.insert(schema.workUnitAssignments).values(
          values.assignments.map((assignment) => ({
            id: uuidv7(),
            workUnitId,
            personId: assignment.personId,
            role: assignment.role,
            validFrom: assignment.validFrom,
            validTo: assignment.validTo,
          })),
        );
      }

      return { id: workUnitId, code };
    });
  } catch (error) {
    if (sqlstate(error) === SQLSTATE.EXCLUSION_VIOLATION) {
      throw new AppError(
        'CONFLICT',
        'Persoana are deja același rol pe unitatea asta, în perioada aleasă.',
      );
    }
    /*
     * Codul e unic pe (firma, cod), dar contorul de serie e per (firma, TIP,
     * serie). Doua tipuri configurate cu acelasi text de serie produc deci
     * amandoua `X-000001`, si al doilea cade — descoperit la primul CI.
     *
     * Mesajul spune cauza, nu simptomul: „cod duplicat" l-ar trimite pe om sa
     * caute unitatea care are deja codul, iar ea e de alt tip si arata nevinovata.
     */
    if (sqlstate(error) === SQLSTATE.UNIQUE_VIOLATION) {
      throw new AppError(
        'CONFLICT',
        `Seria „${values.series}" e folosită și de alt tip de unitate la firma asta, ` +
          'deci codurile se suprapun. Dă-i fiecărui tip seria lui.',
      );
    }
    return translateDbError(error);
  }
}

/**
 * Crearea din ECRAN, cu formularul plat.
 *
 * Un adaptor, nu un al doilea use-case: compune `CreateWorkUnitInput` si cheama
 * `createWorkUnit`. Toate regulile — codul din serie, tranzactia unica, luna
 * inchisa, autorizatia SSM — sunt tot acolo. Daca ar fi doua drumuri de creare,
 * al doilea ar fi cel care uita o regula.
 */
export async function createWorkUnitFromForm(
  actor: Actor,
  input: WorkUnitFormInput,
): Promise<{ readonly id: string; readonly code: string }> {
  const values = workUnitFormSchema.parse(input);

  const funded =
    values.fundingContractId !== null &&
    values.fundingComponentId !== null &&
    values.fundingPeriodId !== null;

  return createWorkUnit(actor, {
    workUnit: {
      companyId: values.companyId,
      type: values.type,
      name: values.name,
      objectiveId: values.objectiveId,
      contractObjectiveId: '',
      responsiblePersonId: values.responsiblePersonId ?? '',
      executorType: values.executorType,
      executorSubcontractorId: values.executorSubcontractorId ?? '',
      startsOn: values.startsOn ?? '',
      endsOn: values.endsOn ?? '',
      estimatedValue: values.estimatedValue ?? '',
      costBudget: values.costBudget ?? '',
    },
    allocations: funded
      ? [
          {
            contractId: values.fundingContractId as string,
            componentId: values.fundingComponentId as string,
            periodId: values.fundingPeriodId as string,
            allocatedAmount: values.fundingAmount ?? '',
            allocatedPct: '',
            reason: 'finanțare stabilită la deschiderea unității',
          },
        ]
      : [],
    assignments: [],
    series: values.series,
  });
}

// ── Promovare ────────────────────────────────────────────────────────────────

/**
 * Interventie → lucrare. **Acelasi rand, acelasi id, acelasi cod.**
 *
 * Nu se copiaza nimic si nu se muta nimic: se schimba tipul si se adauga
 * structura de lucrare. `promoted_from_id` ramane null — el e pentru scindare,
 * cazul rar in care o parte se desprinde ca lucrare separata.
 *
 * Conditiile vin din `canPromote`, functie pura. Serviciul nu le repeta.
 */
export async function promoteToLucrare(
  actor: Actor,
  input: PromoteWorkUnitInput,
): Promise<{ readonly id: string }> {
  const values = promoteWorkUnitInputSchema.parse(input);
  const current = await getWorkUnit(actor, values.workUnitId);

  const check = canPromote({ type: current.type, status: current.status });
  if (!check.allowed) {
    throw new AppError('CONFLICT', promotionBlockerMessage(check.blockers), {
      blockers: [...check.blockers],
    });
  }

  try {
    // Motivul intra in audit prin actor, nu prin coloana: `work_units` nu are
    // `reason`, iar trigger-ul de jurnal citeste `app.action_reason`.
    return await withActor({ ...actor, reason: values.reason }, async (tx) => {
      const [row] = await tx
        .update(schema.workUnits)
        .set({ type: 'lucrare' })
        .where(eq(schema.workUnits.id, values.workUnitId))
        .returning({ id: schema.workUnits.id });
      if (row === undefined) {
        throw AppError.notFound('Unitatea de lucru', values.workUnitId);
      }
      return row;
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/**
 * Verificarea de promovare, pentru ECRAN.
 *
 * `apps/web` nu are voie sa importe `domain` — regula de boundaries, verificata in
 * CI. Iar ecranul are nevoie de acelasi raspuns pe care il da serviciul, altfel ar
 * arata butonul „Promoveaza" pe o unitate care apoi refuza.
 *
 * Deci nu e o duplicare: e usa prin care ecranul ajunge la ACEEASI functie pura.
 */
export function promotionCheckFor(workUnit: PromotableWorkUnit): PromotionCheck {
  return canPromote(workUnit);
}

// Tipurile trec granita, functiile nu: ecranul are nevoie de forma raspunsului.
export type { PromotableWorkUnit, PromotionCheck } from '@damina/domain';

function promotionBlockerMessage(blockers: readonly string[]): string {
  if (blockers.includes('already_lucrare')) {
    return 'Unitatea e deja lucrare.';
  }
  if (blockers.includes('not_promotable_type')) {
    return 'O inspecție nu devine lucrare — constatarea ei intră în pâlnia de cereri.';
  }
  return 'Unitatea e finalizată, închisă sau anulată — nu se mai promovează.';
}

// ── Finantare ────────────────────────────────────────────────────────────────

export async function allocateFunding(
  actor: Actor,
  workUnitId: string,
  input: FundingAllocationInput,
): Promise<{ readonly id: string }> {
  const values = fundingAllocationInputSchema.parse(input);
  const allocationId = uuidv7();

  try {
    return await withActor(actor, async (tx) => {
      await tx.insert(schema.fundingAllocations).values({
        id: allocationId,
        workUnitId,
        contractId: values.contractId,
        componentId: values.componentId,
        periodId: values.periodId,
        allocatedAmount: values.allocatedAmount,
        allocatedPct: values.allocatedPct,
        reason: values.reason,
        createdBy: actor.personId,
      });
      return { id: allocationId };
    });
  } catch (error) {
    if (sqlstate(error) === SQLSTATE.UNIQUE_VIOLATION) {
      throw new AppError(
        'CONFLICT',
        'Există deja o alocare activă pe componenta și luna asta. Mută-o, nu o dubla.',
      );
    }
    return translateDbError(error);
  }
}

export interface FundingMoveTarget {
  readonly contractId: string;
  readonly componentId: string;
  readonly periodId: string;
}

export interface FundingMovePreview {
  readonly kind: FundingMovePlan['kind'];
  readonly periodIsClosed: boolean;
  /** Cat se muta. Costurile deja inregistrate urmeaza unitatea de lucru. */
  readonly amount: Money;
  readonly fromComponentName: string;
  readonly fromPeriodLabel: string;
  /** Luna in care s-ar emite documentul, cand se emite. */
  readonly currentPeriodLabel: string | null;
}

const periodLabel = (year: number, month: number): string =>
  `${String(month).padStart(2, '0')}/${String(year)}`;

interface AllocationContext {
  readonly allocation: typeof schema.fundingAllocations.$inferSelect;
  readonly companyId: string;
  readonly fromComponentName: string;
  readonly fromPeriodStatus: PeriodStatus;
  readonly fromPeriodYear: number;
  readonly fromPeriodMonth: number;
}

async function loadAllocationContext(
  tx: ActorTx,
  allocationId: string,
): Promise<AllocationContext> {
  const [row] = await tx
    .select({
      allocation: schema.fundingAllocations,
      companyId: schema.workUnits.companyId,
      componentName: schema.contractComponents.name,
      periodStatus: schema.periods.status,
      periodYear: schema.periods.year,
      periodMonth: schema.periods.month,
    })
    .from(schema.fundingAllocations)
    .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.fundingAllocations.workUnitId))
    .innerJoin(
      schema.contractComponents,
      eq(schema.contractComponents.id, schema.fundingAllocations.componentId),
    )
    .innerJoin(schema.periods, eq(schema.periods.id, schema.fundingAllocations.periodId))
    .where(eq(schema.fundingAllocations.id, allocationId))
    .limit(1);

  if (row === undefined) {
    throw AppError.notFound('Alocarea de finanțare', allocationId);
  }
  if (row.allocation.status !== 'active') {
    throw new AppError('CONFLICT', 'Alocarea a fost deja înlocuită — mută-o pe cea activă.');
  }

  return {
    allocation: row.allocation,
    companyId: row.companyId,
    fromComponentName: row.componentName,
    fromPeriodStatus: row.periodStatus,
    fromPeriodYear: row.periodYear,
    fromPeriodMonth: row.periodMonth,
  };
}

/** Luna curenta a firmei. `null` daca nu e deschisa — apelantul spune ce lipseste. */
async function findCurrentPeriod(
  tx: ActorTx,
  companyId: string,
  today: Date,
): Promise<{ readonly id: string; readonly year: number; readonly month: number } | null> {
  const [row] = await tx
    .select({ id: schema.periods.id, year: schema.periods.year, month: schema.periods.month })
    .from(schema.periods)
    .where(
      and(
        eq(schema.periods.companyId, companyId),
        eq(schema.periods.year, today.getUTCFullYear()),
        eq(schema.periods.month, today.getUTCMonth() + 1),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Ce anunta ecranul INAINTE de confirmare (§3.4).
 *
 * Aceeasi sursa de adevar ca executia: `describeFundingMove` si `planFundingMove`
 * citesc amandoua starea lunii. Daca ecranul ar calcula singur, ar putea promite
 * o mecanica si tranzactia ar face cealalta.
 */
export async function previewFundingMove(
  actor: Actor,
  allocationId: string,
  today: Date = new Date(),
): Promise<FundingMovePreview> {
  return withActor(actor, async (tx) => {
    const context = await loadAllocationContext(tx, allocationId);
    const current = await findCurrentPeriod(tx, context.companyId, today);
    const described = describeFundingMove(context.fromPeriodStatus);

    return {
      kind: described.kind,
      periodIsClosed: described.periodIsClosed,
      amount: Money.fromDb(context.allocation.allocatedAmount),
      fromComponentName: context.fromComponentName,
      fromPeriodLabel: periodLabel(context.fromPeriodYear, context.fromPeriodMonth),
      currentPeriodLabel:
        current === null ? null : periodLabel(current.year, current.month),
    };
  });
}

export interface MoveFundingResult {
  readonly kind: FundingMovePlan['kind'];
  /** Alocarea noua, activa, pe componenta si luna alese. */
  readonly newAllocationId: string;
  /** Alocarea veche, supersedata — `null` pe ramura lunii inchise. */
  readonly supersededAllocationId: string | null;
  /** Documentul de re-alocare, doar pe ramura lunii inchise. */
  readonly reallocationDocumentId: string | null;
  readonly reallocationNumber: string | null;
  /**
   * Cate linii de cost si-au schimbat analitica „descarcat". Zero pe ramura lunii
   * inchise, unde liniile raman dinadins acolo unde sunt.
   */
  readonly rechargedCostLines: number;
}

/**
 * Mutarea finantarii (§13.1). Doua mecanici, decise DOAR de starea lunii.
 *
 * **Luna deschisa:** alocarea veche se supersedeaza, apare una noua. Analitica
 * „descarcat" de pe liniile de cost se rescrie — dar liniile apar la pasul 06,
 * deci acum lista lor e goala si planul o spune cinstit.
 *
 * **Luna inchisa:** alocarea veche **nu se atinge**. Nu e o scutire, e chiar
 * regula: o luna raportata nu se rescrie, iar `guard_closed_period` ar refuza
 * oricum `update`-ul. Se emite un document de re-alocare in luna CURENTA, cu
 * ambele miscari vizibile, si se deschide alocarea noua pe luna tinta.
 *
 * Ce nu se schimba pe nicio ramura: data documentului, obiectivul si analitica
 * „folosit". Istoricul obiectivului ramane intact — verificarea #8.
 */
export async function moveFunding(
  actor: Actor,
  input: MoveFundingInputDto,
  today: Date = new Date(),
): Promise<MoveFundingResult> {
  const values = moveFundingInputSchema.parse(input);

  try {
    return await withActor({ ...actor, reason: values.reason }, async (tx) => {
      const context = await loadAllocationContext(tx, values.allocationId);

      if (context.allocation.workUnitId !== values.workUnitId) {
        throw new AppError('VALIDATION_FAILED', 'Alocarea nu e a unității de lucru trimise.');
      }

      const current = await findCurrentPeriod(tx, context.companyId, today);
      if (current === null) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Luna curentă nu e deschisă la firma asta — deschide-o înainte de mutare.',
        );
      }

      /*
       * Costurile urmeaza unitatea de lucru (§13.1). Se iau doar liniile din luna
       * si componenta din care se muta — cele din lunile deja raportate raman
       * unde sunt, si pentru ele exista documentul de re-alocare.
       *
       * Pe ramura lunii inchise lista nu se foloseste: `planFundingMove` o ignora,
       * si asa trebuie. O calculam oricum, pentru ca e aceeasi intrebare.
       */
      const costLineIds = await costLineIdsForMove(
        tx,
        values.workUnitId,
        context.allocation.periodId,
        context.allocation.componentId,
      );

      const plan = planFundingMove({
        workUnitId: values.workUnitId,
        from: {
          contractId: context.allocation.contractId,
          componentId: context.allocation.componentId,
          periodId: context.allocation.periodId,
        },
        to: {
          contractId: values.toContractId,
          componentId: values.toComponentId,
          periodId: values.toPeriodId,
        },
        fromPeriodStatus: context.fromPeriodStatus,
        currentPeriodId: current.id,
        amount: Money.fromDb(context.allocation.allocatedAmount),
        costLineIds,
        reason: values.reason,
      });

      const newAllocationId = uuidv7();
      await tx.insert(schema.fundingAllocations).values({
        id: newAllocationId,
        workUnitId: values.workUnitId,
        contractId: values.toContractId,
        componentId: values.toComponentId,
        periodId: values.toPeriodId,
        allocatedAmount: context.allocation.allocatedAmount,
        allocatedPct: context.allocation.allocatedPct,
        reason: values.reason,
        createdBy: actor.personId,
      });

      if (plan.kind === 'rewrite-charged-analytics') {
        await tx
          .update(schema.fundingAllocations)
          .set({ status: 'superseded', supersededBy: newAllocationId })
          .where(eq(schema.fundingAllocations.id, values.allocationId));

        /*
         * Si liniile de cost, in ACEEASI tranzactie: daca supersedarea trece si
         * rescrierea cade, unitatea ar fi finantata dintr-o parte si consumata
         * din alta — exact starea pe care raportul de reconciliere o cauta.
         *
         * `used_*` ramane neatins: rescrierea schimba doar cine plateste.
         * Rollup-urile ambelor componente se misca prin trigger.
         */
        await rechargeCostLines(
          tx,
          plan.costLineIds,
          { contractId: plan.target.contractId, componentId: plan.target.componentId },
          values.reason,
        );

        return {
          kind: plan.kind,
          newAllocationId,
          supersededAllocationId: values.allocationId,
          reallocationDocumentId: null,
          reallocationNumber: null,
          rechargedCostLines: plan.costLineIds.length,
        };
      }

      const documentId = uuidv7();
      const number = await allocateCode(
        tx,
        context.companyId,
        'nota_realocare',
        REALLOCATION_SERIES,
      );
      await tx.insert(schema.reallocationDocuments).values({
        id: documentId,
        companyId: context.companyId,
        number,
        periodId: current.id,
        workUnitId: values.workUnitId,
        fromContractId: plan.from.contractId,
        fromComponentId: plan.from.componentId,
        fromPeriodId: plan.from.periodId,
        toContractId: plan.to.contractId,
        toComponentId: plan.to.componentId,
        toPeriodId: plan.to.periodId,
        amount: Money.fromDb(context.allocation.allocatedAmount).toDbString(),
        reason: values.reason,
        createdBy: actor.personId,
      });

      return {
        kind: plan.kind,
        newAllocationId,
        supersededAllocationId: null,
        reallocationDocumentId: documentId,
        reallocationNumber: number,
        // Luna raportata nu se rescrie: liniile raman datate in luna lor, iar
        // miscarea se vede in documentul de mai sus. Ambele capete vizibile.
        rechargedCostLines: 0,
      };
    });
  } catch (error) {
    if (sqlstate(error) === SQLSTATE.UNIQUE_VIOLATION) {
      throw new AppError(
        'CONFLICT',
        'Există deja o alocare activă pe componenta și luna alese ca destinație.',
      );
    }
    return translateDbError(error);
  }
}

export type ReallocationDocumentRow = typeof schema.reallocationDocuments.$inferSelect & {
  readonly workUnitCode: string;
  readonly workUnitName: string;
  readonly fromComponentName: string;
  readonly toComponentName: string;
  readonly createdByName: string | null;
};

/**
 * „Bani › Re-alocarile lunii" (§3.4). Lista obligatorie.
 *
 * Daca lista e lunga in fiecare luna, decizia initiala de rutare se ia prost —
 * si asta e o problema de proces, pe care ecranul trebuie s-o faca vizibila. De
 * aceea nu are filtru implicit care s-o scurteze.
 */
export async function listReallocationDocuments(
  actor: Actor,
  options: { readonly companyIds: readonly string[]; readonly periodId?: string },
): Promise<ReallocationDocumentRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const conditions = [
      inArray(schema.reallocationDocuments.companyId, [...options.companyIds]),
    ];
    if (options.periodId !== undefined) {
      conditions.push(eq(schema.reallocationDocuments.periodId, options.periodId));
    }

    const rows = await tx
      .select({
        document: schema.reallocationDocuments,
        workUnitCode: schema.workUnits.code,
        workUnitName: schema.workUnits.name,
        fromComponentName: schema.contractComponents.name,
        // Componenta-destinatie vine prin subinterogare, nu prin al doilea join:
        // aceeasi tabela de doua ori in acelasi `from` ar cere un alias, iar un
        // alias uitat leaga ambele coloane la primul join — si atunci „de la" si
        // „la" ar arata acelasi nume, ceea ce face lista inutila fara sa cada.
        toComponentName: sql<string>`(
          select cc.name from app.contract_components cc
           where cc.id = app.reallocation_documents.to_component_id
        )`,
        createdByName: schema.persons.fullName,
      })
      .from(schema.reallocationDocuments)
      .innerJoin(
        schema.workUnits,
        eq(schema.workUnits.id, schema.reallocationDocuments.workUnitId),
      )
      .innerJoin(
        schema.contractComponents,
        eq(schema.contractComponents.id, schema.reallocationDocuments.fromComponentId),
      )
      .leftJoin(schema.persons, eq(schema.persons.id, schema.reallocationDocuments.createdBy))
      .where(and(...conditions))
      .orderBy(desc(schema.reallocationDocuments.createdAt));

    return rows.map((row) => ({
      ...row.document,
      workUnitCode: row.workUnitCode,
      workUnitName: row.workUnitName,
      fromComponentName: row.fromComponentName,
      toComponentName: row.toComponentName,
      createdByName: row.createdByName,
    }));
  });
}

// ── Etape ────────────────────────────────────────────────────────────────────

export async function createStage(
  actor: Actor,
  input: WorkStageInput,
): Promise<{ readonly id: string }> {
  const values = workStageInputSchema.parse(input);
  const stageId = uuidv7();

  try {
    return await withActor(actor, async (tx) => {
      // Pozitia se calculeaza in tranzactie, nu in ecran: doua etape adaugate in
      // paralel ar primi altfel acelasi numar, iar unicul ar respinge a doua.
      const [last] = await tx
        .select({ position: schema.workStages.position })
        .from(schema.workStages)
        .where(eq(schema.workStages.workUnitId, values.workUnitId))
        .orderBy(desc(schema.workStages.position))
        .limit(1);

      await tx.insert(schema.workStages).values({
        id: stageId,
        workUnitId: values.workUnitId,
        position: (last?.position ?? 0) + 1,
        name: values.name,
        plannedStart: values.plannedStart,
        plannedEnd: values.plannedEnd,
        materialBudget: values.materialBudget,
        laborBudget: values.laborBudget,
        pctOfWork: values.pctOfWork,
      });

      return { id: stageId };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/**
 * Rescrie pozitiile 1..n, in ordinea trimisa.
 *
 * **Doi pasi, cu un decalaj peste maximul existent.** Unicul
 * `(work_unit_id, position)` se verifica la fiecare rand, nu la finalul
 * tranzactiei, deci o permutare scrisa direct s-ar lovi de o pozitie inca
 * ocupata: „mut etapa 3 pe locul 1" cade cat timp locul 1 mai e al altcuiva.
 *
 * Primul pas le duce pe toate deasupra maximului, unde nu se pot ciocni cu
 * nimic; al doilea le aduce la locul lor. Decalajul e POZITIV dinadins:
 * `check`-ul `work_stages_position_positive` refuza si valorile temporare, nu
 * doar pe cele finale — prima versiune a functiei folosea negative si a picat
 * exact acolo, la primul CI.
 */
export async function reorderStages(
  actor: Actor,
  input: ReorderStagesInput,
): Promise<{ readonly count: number }> {
  const values = reorderStagesInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const existing = await tx
        .select({ id: schema.workStages.id, position: schema.workStages.position })
        .from(schema.workStages)
        .where(eq(schema.workStages.workUnitId, values.workUnitId));

      const known = new Set(existing.map((row) => row.id));
      if (values.stageIds.length !== known.size || values.stageIds.some((id) => !known.has(id))) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Reordonarea trebuie să trimită exact etapele unității, o singură dată fiecare.',
        );
      }

      const offset = Math.max(...existing.map((row) => row.position), 0);
      // `position` e `smallint`. Decalajul plus numarul de etape trebuie sa
      // incapa, altfel pasul intai ar cadea pe depasire — cu un mesaj din care
      // nimeni n-ar ghici ca a fost o reordonare.
      if (offset + values.stageIds.length > 32767) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Prea multe etape pentru reordonare. Renumerotează-le de la 1 înainte.',
        );
      }

      for (const [index, stageId] of values.stageIds.entries()) {
        await tx
          .update(schema.workStages)
          .set({ position: offset + index + 1 })
          .where(eq(schema.workStages.id, stageId));
      }
      for (const [index, stageId] of values.stageIds.entries()) {
        await tx
          .update(schema.workStages)
          .set({ position: index + 1 })
          .where(eq(schema.workStages.id, stageId));
      }

      return { count: values.stageIds.length };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

// ── Inchidere ────────────────────────────────────────────────────────────────

export type ClosingItemState = 'ok' | 'blocking' | 'pending_module';

export interface ClosingChecklistItem {
  readonly code: string;
  readonly label: string;
  readonly state: ClosingItemState;
  /** Ce trebuie facut, cand nu e in regula. */
  readonly detail: string;
  /** Unde se rezolva. `null` la randurile care asteapta un modul viitor. */
  readonly href: string | null;
}

export interface ClosingChecklist {
  readonly canClose: boolean;
  readonly items: readonly ClosingChecklistItem[];
}

/**
 * Checklist-ul de inchidere (§3.4). **Blocant, nu informativ.**
 *
 * Randurile care depind de module viitoare apar dezactivate, cu explicatie — nu
 * lipsesc. Un checklist care ascunde ce nu se poate face inca lasa impresia ca
 * inchiderea e completa, si aia e cea mai scumpa impresie gresita din tot pasul.
 */
export async function getClosingChecklist(
  actor: Actor,
  workUnitId: string,
): Promise<ClosingChecklist> {
  const unit = await getWorkUnit(actor, workUnitId);
  const stages = await listStages(actor, workUnitId);

  const items: ClosingChecklistItem[] = [];
  const base = `/activitate/${workUnitId}`;

  if (unit.status === 'inchisa') {
    items.push({
      code: 'already_closed',
      label: 'Unitatea e deja închisă',
      state: 'blocking',
      detail: 'O unitate închisă nu se închide a doua oară.',
      href: base,
    });
  }

  if (unit.status === 'anulata') {
    items.push({
      code: 'cancelled',
      label: 'Unitatea e anulată',
      state: 'blocking',
      detail: 'O unitate anulată nu se închide — nu s-a executat.',
      href: base,
    });
  }

  const funded = unit.allocationCount > 0;
  items.push({
    code: 'funding',
    label: 'Finanțare alocată',
    state: funded || unit.type === 'inspectie' ? 'ok' : 'blocking',
    detail: funded
      ? `${String(unit.allocationCount)} alocare(i) activă(e).`
      : 'Nicio alocare activă: costurile n-ar avea de unde să se plătească.',
    href: `${base}?view=finantare`,
  });

  items.push({
    code: 'end_date',
    label: 'Dată de finalizare',
    state: unit.endsOn === null ? 'blocking' : 'ok',
    detail:
      unit.endsOn === null
        ? 'Fără dată de finalizare, unitatea nu poate intra în raportul lunii.'
        : `Finalizată pe ${unit.endsOn}.`,
    href: base,
  });

  if (unit.type === 'lucrare') {
    const unfinished = stages.filter((stage) => stage.actualEnd === null);
    items.push({
      code: 'stages',
      label: 'Etape încheiate',
      state: stages.length === 0 || unfinished.length === 0 ? 'ok' : 'blocking',
      detail:
        unfinished.length === 0
          ? `${String(stages.length)} etapă(e) încheiată(e).`
          : `${String(unfinished.length)} etapă(e) fără dată de încheiere.`,
      href: `${base}?view=etape`,
    });
  }

  // Randurile care asteapta module viitoare. Nu blocheaza, dar se vad.
  items.push(
    {
      code: 'material_return',
      label: 'Retur la magazie',
      state: 'pending_module',
      detail: 'Se verifică din pasul 06, când există registrul de cost.',
      href: null,
    },
    {
      code: 'pv_receptie',
      label: 'Proces-verbal de recepție',
      state: 'pending_module',
      detail: 'Documentele de recepție vin în faza 2.',
      href: null,
    },
    {
      code: 'situatie_lucrari',
      label: 'Situație de lucrări acceptată',
      state: 'pending_module',
      detail: 'Situațiile de lucrări vin în faza 2.',
      href: null,
    },
  );

  return { canClose: items.every((item) => item.state !== 'blocking'), items };
}

/**
 * Inchide unitatea. Refuza cand checklist-ul are randuri blocante.
 *
 * Verificarea se face din nou aici, nu doar in ecran: butonul dezactivat e o
 * curtoazie, nu o garantie — un `fetch` scris de mana ocoleste orice buton.
 */
export async function closeWorkUnit(
  actor: Actor,
  input: CloseWorkUnitInput,
): Promise<{ readonly id: string }> {
  const values = closeWorkUnitInputSchema.parse(input);
  const checklist = await getClosingChecklist(actor, values.workUnitId);

  if (!checklist.canClose) {
    const blocking = checklist.items.filter((item) => item.state === 'blocking');
    throw new AppError(
      'CONFLICT',
      `Nu se poate închide: ${blocking.map((item) => item.label.toLowerCase()).join(', ')}.`,
      { blockers: blocking.map((item) => item.code) },
    );
  }

  try {
    return await withActor({ ...actor, reason: values.reason }, async (tx) => {
      const [row] = await tx
        .update(schema.workUnits)
        .set({ status: 'inchisa', closedAt: new Date(), closedBy: actor.personId })
        .where(eq(schema.workUnits.id, values.workUnitId))
        .returning({ id: schema.workUnits.id });
      if (row === undefined) {
        throw AppError.notFound('Unitatea de lucru', values.workUnitId);
      }
      return row;
    });
  } catch (error) {
    return translateDbError(error);
  }
}
