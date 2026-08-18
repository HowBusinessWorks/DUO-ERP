import type {
  CreateRequestInput,
  DecideRoutingInput,
  PromoteBacklogInput,
  RequestEstimateLineInput,
} from '@damina/contracts';
import {
  createRequestInputSchema,
  decideRoutingInputSchema,
  promoteBacklogInputSchema,
  requestEstimateLineInputSchema,
} from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import { estimateFromCatalog } from '@damina/domain';
import { AppError, Money, uuidv7 } from '@damina/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { allocateCode } from './work-units';
import { SQLSTATE, sqlstate, translateDbError } from './db-errors';

/**
 * Cererile, evaluarea, decizia de rutare si backlogul (pasul 08).
 *
 * Aceleasi doua reguli ca la unitatile de lucru (`work-units.ts`), aplicate
 * cererii:
 *
 *   1. **Fiecare use-case e o tranzactie.** `decideRouting` scrie decizia SI —
 *      atomic — unitatea, finantarea si legatura inapoi (regula 2 din pas). O
 *      cerere „decisa" fara UL nu exista niciodata, nici pe jumatate.
 *   2. **Nu decide.** `routeRequest`/`estimateFromCatalog`/`selectBacklogToFill`
 *      vin din `@damina/domain`; serviciul doar le leaga de baza si traduce
 *      erorile.
 */

// ── Creare ───────────────────────────────────────────────────────────────────

export async function createRequest(
  actor: Actor,
  input: CreateRequestInput,
): Promise<{ readonly id: string }> {
  const values = createRequestInputSchema.parse(input);
  const id = uuidv7();

  try {
    return await withActor(actor, async (tx) => {
      await tx.insert(schema.requests).values({
        id,
        companyId: values.companyId,
        type: values.type,
        source: values.source,
        objectiveId: values.objectiveId,
        contractId: values.contractId,
        contractObjectiveId: values.contractObjectiveId,
        title: values.title,
        description: values.description ?? null,
        estimatedValue: values.estimatedValue,
        slaDueAt: values.slaDueAt === null ? null : new Date(values.slaDueAt),
        createdBy: actor.personId,
      });
      return { id };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

// ── Evaluare ─────────────────────────────────────────────────────────────────

/**
 * Inlocuieste liniile de evaluare ale cererii si recalculeaza valoarea
 * estimata din catalog (verificarea #5). O singura tranzactie: liniile vechi
 * si cifra de pe cerere nu raman niciodata nesincronizate.
 */
export async function evaluateRequest(
  actor: Actor,
  requestId: string,
  lines: readonly RequestEstimateLineInput[],
): Promise<{ readonly estimatedValue: Money }> {
  const values = lines.map((l) => requestEstimateLineInputSchema.parse(l));

  try {
    return await withActor(actor, async (tx) => {
      const operations = values.length === 0
        ? []
        : await tx
            .select()
            .from(schema.operationCatalog)
            .where(inArray(schema.operationCatalog.id, values.map((v) => v.operationId)));

      const byId = new Map(operations.map((o) => [o.id, o]));
      const rows = values.map((v) => {
        const op = byId.get(v.operationId);
        if (op === undefined) {
          throw new AppError('NOT_FOUND', 'Operațiune inexistentă în catalog.');
        }
        const quantity = Number(v.quantity);
        const estimatedLabor = Money.fromDb(op.estimatedLabor).mul(quantity);
        const estimatedMaterial = Money.fromDb(op.estimatedMaterial).mul(quantity);
        return { operationId: v.operationId, quantity: v.quantity, estimatedLabor, estimatedMaterial };
      });

      await tx.delete(schema.requestEstimateLines).where(eq(schema.requestEstimateLines.requestId, requestId));
      if (rows.length > 0) {
        await tx.insert(schema.requestEstimateLines).values(
          rows.map((r) => ({
            id: uuidv7(),
            requestId,
            operationId: r.operationId,
            quantity: r.quantity,
            estimatedLabor: r.estimatedLabor.toDbString(),
            estimatedMaterial: r.estimatedMaterial.toDbString(),
          })),
        );
      }

      const { total } = estimateFromCatalog(
        rows.map((r) => ({
          quantity: 1, // deja inmultite mai sus cu cantitatea reala
          operation: { estimatedLabor: r.estimatedLabor, estimatedMaterial: r.estimatedMaterial },
        })),
      );

      await tx
        .update(schema.requests)
        .set({ estimatedValue: total.toDbString(), status: 'in_evaluare' })
        .where(eq(schema.requests.id, requestId));

      return { estimatedValue: total };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

// ── Decizia de rutare ────────────────────────────────────────────────────────

/**
 * Decide rutarea unei cereri. Regula 2 din pas, in cod: unitatea de lucru,
 * finantarea si legatura inapoi la cerere se scriu in ACEEASI tranzactie ca
 * decizia — daca oricare pas eșueaza, nu ramane nimic (verificarea #11).
 *
 * `input.creation`/`input.backlog` sunt deja perechea exclusiva impusa de
 * `decideRoutingInputSchema`.
 */
export async function decideRouting(
  actor: Actor,
  input: DecideRoutingInput,
): Promise<{ readonly workUnitId: string | null; readonly backlogProposalId: string | null }> {
  const values = decideRoutingInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const [request] = await tx
        .select()
        .from(schema.requests)
        .where(eq(schema.requests.id, values.requestId));
      if (request === undefined) {
        throw new AppError('NOT_FOUND', 'Cerere inexistentă.');
      }

      let workUnitId: string | null = null;
      let backlogProposalId: string | null = null;

      if (values.choice === 'amanata_backlog') {
        if (values.backlog === undefined) {
          throw new AppError('VALIDATION_FAILED', 'Lipsesc datele propunerii de backlog.');
        }
        backlogProposalId = uuidv7();
        await tx.insert(schema.backlogProposals).values({
          id: backlogProposalId,
          requestId: values.requestId,
          objectiveId: values.backlog.objectiveId,
          contractId: values.backlog.contractId,
          title: values.backlog.title,
          estimatedValue: values.backlog.estimatedValue,
          sourceKind: 'amanata',
          validUntil: values.backlog.validUntil,
        });
        await tx.update(schema.requests).set({ status: 'in_backlog' }).where(eq(schema.requests.id, values.requestId));
      } else {
        if (values.creation === undefined) {
          throw new AppError('VALIDATION_FAILED', 'Lipsesc datele unității de lucru.');
        }
        const newWorkUnitId = uuidv7();
        workUnitId = newWorkUnitId;
        const code = await allocateCode(
          tx,
          values.creation.workUnit.companyId,
          values.creation.workUnit.type,
          values.creation.series,
        );

        await tx.insert(schema.workUnits).values({
          id: newWorkUnitId,
          code,
          ...values.creation.workUnit,
          sourceRequestId: values.requestId,
        });

        for (const allocation of values.creation.allocations) {
          await tx.insert(schema.fundingAllocations).values({
            id: uuidv7(),
            workUnitId: newWorkUnitId,
            contractId: allocation.contractId,
            componentId: allocation.componentId,
            periodId: allocation.periodId,
            allocatedAmount: allocation.allocatedAmount,
            allocatedPct: allocation.allocatedPct,
            reason: allocation.reason,
            createdBy: actor.personId,
          });
        }

        if (values.creation.assignments.length > 0) {
          await tx.insert(schema.workUnitAssignments).values(
            values.creation.assignments.map((a) => ({
              id: uuidv7(),
              workUnitId: newWorkUnitId,
              personId: a.personId,
              role: a.role,
              validFrom: a.validFrom,
              validTo: a.validTo,
            })),
          );
        }

        await tx.update(schema.requests).set({ status: 'decisa' }).where(eq(schema.requests.id, values.requestId));
      }

      // `target_periods` sunt DATE calendaristice (prima zi a lunii), nu
      // id-urile perioadelor — se rezolva printr-un lookup pe `app.periods`.
      let targetPeriods: string[] | null = null;
      if (values.creation !== undefined && values.creation.allocations.length > 0) {
        const periodRows = await tx
          .select({ id: schema.periods.id, year: schema.periods.year, month: schema.periods.month })
          .from(schema.periods)
          .where(inArray(schema.periods.id, values.creation.allocations.map((a) => a.periodId)));
        const byId = new Map(periodRows.map((p) => [p.id, p]));
        targetPeriods = values.creation.allocations.map((a) => {
          const p = byId.get(a.periodId);
          if (p === undefined) {
            throw new AppError('NOT_FOUND', 'Luna aleasă pentru finanțare nu există.');
          }
          return `${p.year}-${String(p.month).padStart(2, '0')}-01`;
        });
      }

      await tx.insert(schema.requestDecisions).values({
        id: uuidv7(),
        requestId: values.requestId,
        choice: values.choice,
        systemProposal: values.systemProposal,
        targetContractId: values.creation?.allocations[0]?.contractId ?? null,
        targetComponentId: values.creation?.allocations[0]?.componentId ?? null,
        targetPeriods,
        createdWorkUnitId: workUnitId,
        reason: values.reason,
        decidedBy: actor.personId,
      });

      return { workUnitId, backlogProposalId };
    });
  } catch (error) {
    if (sqlstate(error) === SQLSTATE.EXCLUSION_VIOLATION) {
      throw new AppError('CONFLICT', 'Persoana are deja același rol pe unitatea asta, în perioada aleasă.');
    }
    return translateDbError(error);
  }
}

// ── Backlog ──────────────────────────────────────────────────────────────────

/**
 * Promoveaza propuneri de backlog in unitati de lucru finantate din Delta —
 * toate intr-o singura tranzactie (verificarea #15). Fiecare UL primeste
 * finantare 100% din (contract, componenta, luna) date, si cererea de origine
 * a propunerii trece in `decisa`.
 */
export async function promoteBacklog(
  actor: Actor,
  input: PromoteBacklogInput,
): Promise<{ readonly workUnitIds: readonly string[] }> {
  const values = promoteBacklogInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const proposals = await tx
        .select()
        .from(schema.backlogProposals)
        .where(
          and(
            inArray(schema.backlogProposals.id, values.proposalIds),
            eq(schema.backlogProposals.status, 'open'),
          ),
        );

      if (proposals.length !== values.proposalIds.length) {
        throw new AppError('CONFLICT', 'Una sau mai multe propuneri nu mai sunt deschise.');
      }

      const [contract] = await tx
        .select({ companyId: schema.contracts.companyId })
        .from(schema.contracts)
        .where(eq(schema.contracts.id, values.contractId));
      if (contract === undefined) {
        throw new AppError('NOT_FOUND', 'Contract inexistent.');
      }

      const workUnitIds: string[] = [];
      for (const proposal of proposals) {
        const workUnitId = uuidv7();
        const code = await allocateCode(tx, contract.companyId, 'lucrare', values.series);

        await tx.insert(schema.workUnits).values({
          id: workUnitId,
          code,
          companyId: contract.companyId,
          type: 'lucrare',
          name: proposal.title,
          objectiveId: proposal.objectiveId,
          sourceRequestId: proposal.requestId,
        });

        await tx.insert(schema.fundingAllocations).values({
          id: uuidv7(),
          workUnitId,
          contractId: values.contractId,
          componentId: values.componentId,
          periodId: values.periodId,
          allocatedAmount: proposal.estimatedValue,
          reason: values.reason,
          createdBy: actor.personId,
        });

        await tx
          .update(schema.backlogProposals)
          .set({ status: 'promoted', promotedWorkUnitId: workUnitId })
          .where(eq(schema.backlogProposals.id, proposal.id));

        await tx
          .update(schema.requests)
          .set({ status: 'decisa' })
          .where(eq(schema.requests.id, proposal.requestId));

        workUnitIds.push(workUnitId);
      }

      return { workUnitIds };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/** Propunerile expirate (`valid_until` trecut) — cheamata de cron, pe worker. */
export async function expireBacklogProposals(tx: ActorTx, asOf: string): Promise<number> {
  const result = await tx.execute(
    sql`update app.backlog_proposals
           set status = 'expired'
         where status = 'open' and valid_until is not null and valid_until < ${asOf}`,
  );
  return result.rowCount ?? 0;
}
