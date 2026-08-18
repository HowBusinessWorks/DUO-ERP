import type {
  CreateInterventionInput,
  SaveInterventionInput,
  ValidateInterventionInput,
} from '@damina/contracts';
import {
  createInterventionInputSchema,
  saveInterventionInputSchema,
  validateInterventionInputSchema,
} from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import { computeVariance, rateCardAt, type VarianceResult } from '@damina/domain';
import { AppError, Money, Quantity, uuidv7 } from '@damina/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { recordCostTx } from './cost';
import { translateDbError } from './db-errors';
import { issueConsumptionNoteTx, unitCostKey } from './inventory';
import { raiseAlert } from './notifications';
import { createWorkUnitTx, translateWorkUnitCreationError } from './work-units';

/**
 * Fisa de interventie (pasul 09, §3.2).
 *
 * **Regula 8 a pasului traieste in `validateIntervention`**: o singura
 * tranzactie care produce bonul de consum, miscarile de stoc, liniile de cost
 * `consumat` si `manopera_proprie`, si `operation_actuals` — sau niciunul.
 * Verificarea #9 e chiar asta, privita invers: daca bonul cade, nu ramane nici
 * cost, nici miscare, iar fisa ramane nevalidata.
 *
 * Comparatia asteptat vs real nu se calculeaza aici: vine din `computeVariance`
 * (`@damina/domain`), pura si testabila fara Postgres. Serviciul ii da cifrele
 * si ii scrie raspunsul pe fisa, de unde trigger-ul din 0026 il duce in
 * `operation_actuals`.
 */

// ── Creare ───────────────────────────────────────────────────────────────────

export async function createIntervention(
  actor: Actor,
  input: CreateInterventionInput,
): Promise<{ readonly id: string; readonly code: string }> {
  const values = createInterventionInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const workUnitId = uuidv7();
      const created = await createWorkUnitTx(
        tx,
        actor,
        {
          workUnit: {
            companyId: values.companyId,
            type: 'interventie',
            name: values.name,
            objectiveId: values.objectiveId,
            contractObjectiveId: values.contractObjectiveId,
            responsiblePersonId: values.responsiblePersonId,
            executorType: 'echipa_proprie',
            executorSubcontractorId: null,
            startsOn: values.performedOn,
            endsOn: null,
            estimatedValue: null,
            costBudget: null,
          },
          series: values.series,
          allocations: [
            {
              contractId: values.fundingContractId,
              componentId: values.fundingComponentId,
              periodId: values.fundingPeriodId,
              allocatedAmount: values.fundingAmount,
              allocatedPct: null,
              reason: values.fundingReason,
            },
          ],
          assignments: [],
        },
        workUnitId,
        values.sourceRequestId === null ? {} : { sourceRequestId: values.sourceRequestId },
      );

      await tx.insert(schema.interventions).values({
        workUnitId,
        sourceRequestId: values.sourceRequestId,
        performedOn: values.performedOn,
        description: values.description,
        operationId: values.operationId,
        teamId: values.teamId,
      });

      return { id: workUnitId, code: created.code };
    });
  } catch (error) {
    return translateWorkUnitCreationError(error, values.series);
  }
}

// ── Completare pe teren ──────────────────────────────────────────────────────

/**
 * Inlocuieste materialele si orele declarate.
 *
 * Nu misca stoc si nu produce cost: pana la validare, fisa e o declaratie. De
 * aceea si `unit_cost` ramane null pe materiale — CMP-ul se ingheata la
 * validare, cu valoarea din ziua aia, nu cu cea de cand a scris omul cifra.
 */
export async function saveIntervention(
  actor: Actor,
  input: SaveInterventionInput,
): Promise<{ readonly materials: number; readonly hours: number }> {
  const values = saveInterventionInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const sheet = await lockOpenIntervention(tx, values.workUnitId);

      await tx
        .update(schema.interventions)
        .set({
          description: values.description,
          operationId: values.operationId,
          teamId: values.teamId,
          declaredHours: values.declaredHours,
        })
        .where(eq(schema.interventions.workUnitId, sheet.workUnitId));

      await tx
        .delete(schema.interventionMaterials)
        .where(eq(schema.interventionMaterials.workUnitId, values.workUnitId));
      await tx
        .delete(schema.interventionHours)
        .where(eq(schema.interventionHours.workUnitId, values.workUnitId));

      for (const material of values.materials) {
        await tx.insert(schema.interventionMaterials).values({
          id: uuidv7(),
          workUnitId: values.workUnitId,
          productId: material.productId,
          lotId: material.lotId,
          quantity: material.quantity,
          locationId: material.locationId,
        });
      }

      for (const hour of values.hours) {
        await tx.insert(schema.interventionHours).values({
          id: uuidv7(),
          workUnitId: values.workUnitId,
          personId: hour.personId,
          hours: hour.hours,
          workDate: hour.workDate,
        });
      }

      return { materials: values.materials.length, hours: values.hours.length };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

interface OpenIntervention {
  readonly workUnitId: string;
  readonly companyId: string;
  readonly objectiveId: string;
  readonly performedOn: string;
  readonly operationId: string | null;
  readonly teamId: string | null;
  readonly name: string;
}

/**
 * Citeste fisa cu `for update` si verifica faptul ca nu e deja validata.
 *
 * `for update`, ca la `lockOpenRequest`: si completarea, si validarea sunt
 * „citeste starea, apoi scrie in functie de ea". Fara lock, doua validari
 * concurente ar emite doua bonuri de consum pentru aceleasi materiale — adica
 * acelasi stoc consumat de doua ori.
 */
async function lockOpenIntervention(
  tx: ActorTx,
  workUnitId: string,
): Promise<OpenIntervention> {
  /*
   * Lock-ul si join-ul stau in DOUA interogari, nu intr-una: Postgres refuza
   * `for update` pe o interogare cu join calificat pe schema („FOR UPDATE must
   * specify unqualified relation names"), iar `for update` fara `of` ar bloca
   * si randul din `work_units` — pe care nu-l scriem aici.
   */
  const [row] = await tx
    .select({
      workUnitId: schema.interventions.workUnitId,
      validatedAt: schema.interventions.validatedAt,
      performedOn: schema.interventions.performedOn,
      operationId: schema.interventions.operationId,
      teamId: schema.interventions.teamId,
    })
    .from(schema.interventions)
    .where(eq(schema.interventions.workUnitId, workUnitId))
    .for('update')
    .limit(1);

  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Fișa de intervenție nu există sau nu e vizibilă.');
  }
  if (row.validatedAt !== null) {
    throw new AppError('CONFLICT', 'Fișa e validată — nu se mai modifică.');
  }

  const [unit] = await tx
    .select({
      companyId: schema.workUnits.companyId,
      objectiveId: schema.workUnits.objectiveId,
      name: schema.workUnits.name,
    })
    .from(schema.workUnits)
    .where(eq(schema.workUnits.id, workUnitId))
    .limit(1);

  if (unit === undefined) {
    throw new AppError('NOT_FOUND', 'Unitatea de lucru a fișei nu există sau nu e vizibilă.');
  }
  return { ...row, ...unit };
}

// ── Validare ─────────────────────────────────────────────────────────────────

export interface ValidateInterventionResult {
  readonly consumptionNoteNumber: string | null;
  readonly materialCost: Money;
  readonly laborCost: Money;
  readonly realCost: Money;
  readonly expectedCost: Money | null;
  readonly variancePct: string | null;
  readonly flagged: boolean;
}

/**
 * Validarea: **o tranzactie, toate efectele sau niciunul** (regula 8).
 *
 * Ordinea pasilor e cea din §3.2, si fiecare depinde de precedentul:
 *
 *   1. `effect_date` — luna de raportare, separata de data fisei (regula 2);
 *   2. materialele → bon de consum → miscari de stoc → cost `consumat`;
 *   3. orele → cost `manopera_proprie`, cu tariful valabil la data lucrata;
 *   4. comparatia asteptat vs real, scrisa pe fisa (de unde trigger-ul o duce
 *      in `operation_actuals`);
 *   5. daca abaterea trece pragul — alerta pentru PM, DUPA commit.
 *
 * Alerta e singurul lucru care se intampla in afara tranzactiei, si dinadins: e
 * scrisa de `app_service`, pe conexiunea ei, iar o alerta despre o validare care
 * pana la urma n-a avut loc ar fi mai rea decat lipsa ei.
 */
export async function validateIntervention(
  actor: Actor,
  input: ValidateInterventionInput,
): Promise<ValidateInterventionResult> {
  const values = validateInterventionInputSchema.parse(input);

  let alert: { companyId: string; workUnitId: string; name: string; pct: string } | null = null;

  const result = await withActor(actor, async (tx) => {
    const sheet = await lockOpenIntervention(tx, values.workUnitId);

    // Analitica „descarcat" vine din finantarea unitatii, nu dintr-un camp al
    // fisei: finantarea e sursa de adevar (regula 1 a pasului 05), iar o a doua
    // copie pe fisa ar putea sa se desincronizeze la prima mutare de bani.
    const [funding] = await tx
      .select({
        contractId: schema.fundingAllocations.contractId,
        componentId: schema.fundingAllocations.componentId,
      })
      .from(schema.fundingAllocations)
      .where(
        and(
          eq(schema.fundingAllocations.workUnitId, values.workUnitId),
          eq(schema.fundingAllocations.status, 'active'),
        ),
      )
      .orderBy(asc(schema.fundingAllocations.createdAt))
      .limit(1);

    if (funding === undefined) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Intervenția nu are finanțare activă — nu se știe cine plătește.',
      );
    }

    // ── 2. Materialele ───────────────────────────────────────────────────────
    const materials = await tx
      .select()
      .from(schema.interventionMaterials)
      .where(eq(schema.interventionMaterials.workUnitId, values.workUnitId))
      .orderBy(asc(schema.interventionMaterials.createdAt));

    let noteNumber: string | null = null;
    const consumed: { quantity: Quantity; unitCost: Money }[] = [];

    if (materials.length > 0) {
      /*
       * Toate materialele unei fise ies din ACEEASI gestiune — cea a echipei.
       * Doua gestiuni pe aceeasi fisa ar cere doua bonuri, iar bonul e
       * documentul care leaga consumul de gestiune. Cand va fi nevoie
       * (subcontractant + magazie pe aceeasi lucrare), aici se grupeaza pe
       * `locationId` si se emit mai multe bonuri — in aceeasi tranzactie.
       */
      const locationIds = new Set(materials.map((m) => m.locationId));
      if (locationIds.size > 1) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Materialele unei fișe ies dintr-o singură gestiune. Împarte-le pe fișe separate.',
        );
      }
      const locationId = materials[0]?.locationId as string;

      const note = await issueConsumptionNoteTx(tx, actor, {
        companyId: sheet.companyId,
        series: values.consumptionSeries,
        locationId,
        workUnitId: values.workUnitId,
        stageId: null,
        contractId: funding.contractId,
        componentId: funding.componentId,
        objectiveId: sheet.objectiveId,
        documentDate: sheet.performedOn,
        effectDate: values.effectDate,
        lines: materials.map((m) => ({
          productId: m.productId,
          lotId: m.lotId,
          quantity: m.quantity,
        })),
      });
      noteNumber = note.number;

      for (const material of materials) {
        const unitCost = note.unitCosts.get(unitCostKey(material.productId, material.lotId));
        consumed.push({
          quantity: Quantity.fromDb(material.quantity),
          unitCost: unitCost ?? Money.ZERO,
        });
        await tx
          .update(schema.interventionMaterials)
          .set({
            unitCost: (unitCost ?? Money.ZERO).toDbString(),
            consumptionNoteId: note.id,
          })
          .where(eq(schema.interventionMaterials.id, material.id));
      }
    }

    // ── 3. Orele ─────────────────────────────────────────────────────────────
    const hours = await tx
      .select({
        id: schema.interventionHours.id,
        personId: schema.interventionHours.personId,
        hours: schema.interventionHours.hours,
        workDate: schema.interventionHours.workDate,
        qualificationId: schema.persons.qualificationId,
      })
      .from(schema.interventionHours)
      .innerJoin(schema.persons, eq(schema.persons.id, schema.interventionHours.personId))
      .where(eq(schema.interventionHours.workUnitId, values.workUnitId))
      .orderBy(asc(schema.interventionHours.workDate));

    const rateCards = await loadRateCards(
      tx,
      hours.map((h) => h.qualificationId).filter((q): q is string => q !== null),
    );

    const labor: { hours: Quantity; hourlyCost: Money }[] = [];

    for (const hour of hours) {
      if (hour.qualificationId === null) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Cineva din fișă nu are calificare, deci nu i se poate calcula ora.',
        );
      }
      // Tariful zilei lucrate, nu cel curent — verificarea #14.
      const card = rateCardAt(rateCards, hour.qualificationId, hour.workDate);
      if (card === null) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Nu există tarif valabil la ${hour.workDate} pentru calificarea celui pontat.`,
        );
      }

      const quantity = Quantity.fromDb(hour.hours);
      labor.push({ hours: quantity, hourlyCost: card.hourlyCost });

      await recordCostTx(tx, actor, {
        companyId: sheet.companyId,
        documentDate: hour.workDate,
        effectDate: values.effectDate,
        usedContractId: funding.contractId,
        usedComponentId: funding.componentId,
        objectiveId: sheet.objectiveId,
        workUnitId: values.workUnitId,
        stageId: null,
        chargedContractId: null,
        chargedComponentId: null,
        expenseType: 'manopera_proprie',
        productId: null,
        qualificationId: hour.qualificationId,
        quantity: quantity.toDbString(),
        uom: 'oră',
        amount: card.hourlyCost.mul(quantity.toDbString()).toDbString(),
        stage: 'consumat',
        documentType: 'fisa_interventie',
        documentId: values.workUnitId,
        documentLineId: hour.id,
        supplierId: null,
        subcontractorId: null,
      });
    }

    // ── 4. Asteptat vs real ──────────────────────────────────────────────────
    const expected = await expectedCostOf(tx, sheet.operationId);
    const variance = computeVariance({ expected, materials: consumed, labor });

    await tx
      .update(schema.interventions)
      .set({
        effectDate: values.effectDate,
        validatedAt: new Date(),
        validatedBy: actor.personId,
        expectedCost: variance.expectedCost?.toDbString() ?? null,
        realCost: variance.realCost.toDbString(),
        variancePct: variance.variancePct,
      })
      .where(eq(schema.interventions.workUnitId, values.workUnitId));

    await tx
      .update(schema.workUnits)
      .set({ status: 'finalizata' })
      .where(eq(schema.workUnits.id, values.workUnitId));

    if (variance.flagged && variance.variancePct !== null) {
      alert = {
        companyId: sheet.companyId,
        workUnitId: values.workUnitId,
        name: sheet.name,
        pct: variance.variancePct,
      };
    }

    return { noteNumber, variance };
  }).catch((error: unknown) => translateDbError(error));

  // ── 5. Alerta, dupa commit ─────────────────────────────────────────────────
  if (alert !== null) {
    const flagged: { companyId: string; workUnitId: string; name: string; pct: string } = alert;
    const percent = (Number(flagged.pct) * 100).toFixed(1);
    await raiseAlert('interventions.validate', {
      companyId: flagged.companyId,
      scopeType: 'work_unit',
      scopeId: flagged.workUnitId,
      kind: 'abatere_consum',
      severity: 'warning',
      title: `${flagged.name}: cost real ${Number(flagged.pct) > 0 ? '+' : ''}${percent}% față de estimat`,
      href: `/activitate/${flagged.workUnitId}`,
      payload: { variancePct: flagged.pct },
    });
  }

  return {
    consumptionNoteNumber: result.noteNumber,
    materialCost: result.variance.materialCost,
    laborCost: result.variance.laborCost,
    realCost: result.variance.realCost,
    expectedCost: result.variance.expectedCost,
    variancePct: result.variance.variancePct,
    flagged: result.variance.flagged,
  };
}

/** Tarifele calificarilor implicate, toate versiunile: alegerea o face domeniul. */
async function loadRateCards(
  tx: ActorTx,
  qualificationIds: readonly string[],
): Promise<
  { id: string; qualificationId: string; validFrom: string; validTo: string | null; hourlyCost: Money }[]
> {
  if (qualificationIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      id: schema.rateCards.id,
      qualificationId: schema.rateCards.qualificationId,
      validFrom: schema.rateCards.validFrom,
      validTo: schema.rateCards.validTo,
      hourlyCost: schema.rateCards.hourlyCost,
    })
    .from(schema.rateCards)
    .where(inArray(schema.rateCards.qualificationId, [...new Set(qualificationIds)]));

  return rows.map((row) => ({ ...row, hourlyCost: Money.fromDb(row.hourlyCost) }));
}

/** Costul estimat al operatiunii din catalog. `null` = fisa n-are operatiune. */
async function expectedCostOf(tx: ActorTx, operationId: string | null): Promise<Money | null> {
  if (operationId === null) {
    return null;
  }
  const [row] = await tx
    .select({
      labor: schema.operationCatalog.estimatedLabor,
      material: schema.operationCatalog.estimatedMaterial,
    })
    .from(schema.operationCatalog)
    .where(eq(schema.operationCatalog.id, operationId))
    .limit(1);

  if (row === undefined) {
    return null;
  }
  return Money.fromDb(row.labor).add(Money.fromDb(row.material));
}

// ── Citire ───────────────────────────────────────────────────────────────────

export interface InterventionSheet {
  readonly workUnitId: string;
  readonly performedOn: string;
  readonly effectDate: string | null;
  readonly description: string | null;
  readonly declaredHours: Quantity | null;
  readonly operationId: string | null;
  readonly operationCode: string | null;
  readonly teamId: string | null;
  readonly validatedAt: Date | null;
  /** `null` pentru cine n-are dreptul la bani — coloanele nici nu sunt cerute. */
  readonly variance: Pick<
    VarianceResult,
    'expectedCost' | 'realCost' | 'variancePct' | 'flagged'
  > | null;
}

export async function getInterventionSheet(
  actor: Actor,
  workUnitId: string,
  options: { readonly withMoney?: boolean } = {},
): Promise<InterventionSheet> {
  const withMoney = options.withMoney ?? true;

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        workUnitId: schema.interventions.workUnitId,
        performedOn: schema.interventions.performedOn,
        effectDate: schema.interventions.effectDate,
        description: schema.interventions.description,
        declaredHours: schema.interventions.declaredHours,
        operationId: schema.interventions.operationId,
        operationCode: schema.operationCatalog.code,
        teamId: schema.interventions.teamId,
        validatedAt: schema.interventions.validatedAt,
        expectedCost: withMoney ? schema.interventions.expectedCost : sql<null>`null`,
        realCost: withMoney ? schema.interventions.realCost : sql<null>`null`,
        variancePct: withMoney ? schema.interventions.variancePct : sql<null>`null`,
      })
      .from(schema.interventions)
      .leftJoin(
        schema.operationCatalog,
        eq(schema.operationCatalog.id, schema.interventions.operationId),
      )
      .where(eq(schema.interventions.workUnitId, workUnitId))
      .limit(1);

    if (row === undefined) {
      throw new AppError('NOT_FOUND', 'Fișa de intervenție nu există sau nu e vizibilă.');
    }

    return {
      workUnitId: row.workUnitId,
      performedOn: row.performedOn,
      effectDate: row.effectDate,
      description: row.description,
      declaredHours: row.declaredHours === null ? null : Quantity.fromDb(row.declaredHours),
      operationId: row.operationId,
      operationCode: row.operationCode,
      teamId: row.teamId,
      validatedAt: row.validatedAt,
      variance:
        !withMoney || row.realCost === null
          ? null
          : {
              expectedCost: row.expectedCost === null ? null : Money.fromDb(row.expectedCost),
              realCost: Money.fromDb(row.realCost),
              variancePct: row.variancePct,
              flagged: row.variancePct !== null && Math.abs(Number(row.variancePct)) > 0.15,
            },
    };
  });
}

export type InterventionMaterialRow = {
  readonly id: string;
  readonly productId: string;
  readonly productCode: string;
  readonly productName: string;
  readonly uom: string;
  readonly lotId: string | null;
  readonly quantity: Quantity;
  readonly locationId: string;
  readonly locationName: string;
  readonly consumptionNoteId: string | null;
  readonly unitCost: Money | null;
};

export async function listInterventionMaterials(
  actor: Actor,
  workUnitId: string,
  options: { readonly withMoney?: boolean } = {},
): Promise<InterventionMaterialRow[]> {
  const withMoney = options.withMoney ?? true;

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.interventionMaterials.id,
        productId: schema.interventionMaterials.productId,
        productCode: schema.products.code,
        productName: schema.products.name,
        uom: schema.products.uom,
        lotId: schema.interventionMaterials.lotId,
        quantity: schema.interventionMaterials.quantity,
        locationId: schema.interventionMaterials.locationId,
        locationName: schema.locations.name,
        consumptionNoteId: schema.interventionMaterials.consumptionNoteId,
        unitCost: withMoney ? schema.interventionMaterials.unitCost : sql<null>`null`,
      })
      .from(schema.interventionMaterials)
      .innerJoin(schema.products, eq(schema.products.id, schema.interventionMaterials.productId))
      .innerJoin(schema.locations, eq(schema.locations.id, schema.interventionMaterials.locationId))
      .where(eq(schema.interventionMaterials.workUnitId, workUnitId))
      .orderBy(asc(schema.products.name));

    return rows.map((row) => ({
      ...row,
      quantity: Quantity.fromDb(row.quantity),
      unitCost: row.unitCost === null ? null : Money.fromDb(row.unitCost),
    }));
  });
}

export interface InterventionHourRow {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly hours: Quantity;
  readonly workDate: string;
}

export async function listInterventionHours(
  actor: Actor,
  workUnitId: string,
): Promise<InterventionHourRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.interventionHours.id,
        personId: schema.interventionHours.personId,
        personName: schema.persons.fullName,
        hours: schema.interventionHours.hours,
        workDate: schema.interventionHours.workDate,
      })
      .from(schema.interventionHours)
      .innerJoin(schema.persons, eq(schema.persons.id, schema.interventionHours.personId))
      .where(eq(schema.interventionHours.workUnitId, workUnitId))
      .orderBy(asc(schema.interventionHours.workDate));

    return rows.map((row) => ({ ...row, hours: Quantity.fromDb(row.hours) }));
  });
}

/** Fisele nevalidate ale lunii — ecranul de validare in masa (§3.6). */
export async function listUnvalidatedInterventions(
  actor: Actor,
  companyIds: readonly string[],
): Promise<
  {
    readonly workUnitId: string;
    readonly code: string;
    readonly name: string;
    readonly performedOn: string;
  }[]
> {
  if (companyIds.length === 0) {
    return [];
  }
  return withActor(actor, async (tx) =>
    tx
      .select({
        workUnitId: schema.interventions.workUnitId,
        code: schema.workUnits.code,
        name: schema.workUnits.name,
        performedOn: schema.interventions.performedOn,
      })
      .from(schema.interventions)
      .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.interventions.workUnitId))
      .where(
        and(
          inArray(schema.workUnits.companyId, [...companyIds]),
          sql`${schema.interventions.validatedAt} is null`,
        ),
      )
      .orderBy(asc(schema.interventions.performedOn)),
  );
}
