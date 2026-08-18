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
import { allocateCode, createWorkUnitTx, translateWorkUnitCreationError } from './work-units';
import { translateDbError } from './db-errors';

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

/** Starile din care o cerere mai poate fi evaluata sau decisa. */
const OPEN_STATUSES: readonly string[] = ['neprocesata', 'in_evaluare'];

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

// ── Cererea, sub lock ────────────────────────────────────────────────────────

interface LockedRequest {
  readonly id: string;
  readonly companyId: string;
  readonly status: string;
}

/**
 * Citeste cererea cu `for update` si verifica faptul ca mai e deschisa.
 *
 * `for update` nu e paranoia: si evaluarea, si decizia sunt „citeste starea,
 * apoi scrie in functie de ea". Fara lock, doua decizii concurente citesc
 * amandoua `in_evaluare`, trec amandoua verificarea si creeaza doua unitati de
 * lucru pe aceeasi cerere — adica acelasi plafon se cheltuie de doua ori.
 *
 * Lipsa randului e 404, nu „0 randuri actualizate, tacut": prin RLS, o cerere
 * de la alta firma arata exact ca una inexistenta, iar amandoua trebuie sa
 * opreasca operatiunea, nu s-o lase sa raporteze succes fara sa fi scris nimic.
 */
async function lockOpenRequest(
  tx: ActorTx,
  requestId: string,
  verb: string,
): Promise<LockedRequest> {
  const [request] = await tx
    .select({
      id: schema.requests.id,
      companyId: schema.requests.companyId,
      status: schema.requests.status,
    })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .for('update');

  if (request === undefined) {
    throw new AppError('NOT_FOUND', 'Cerere inexistentă.');
  }
  if (!OPEN_STATUSES.includes(request.status)) {
    throw new AppError('CONFLICT', `Cererea nu mai poate fi ${verb}.`, { status: request.status });
  }
  return request;
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
      await lockOpenRequest(tx, requestId, 'evaluată');

      /*
       * `is_active` e parte din conditie, nu un filtru de afisare: o operatiune
       * scoasa din catalog are tariful vechi, iar o evaluare facuta pe ea ar
       * intra in decizia de rutare cu o cifra pe care firma n-o mai practica.
       */
      const operations = values.length === 0
        ? []
        : await tx
            .select()
            .from(schema.operationCatalog)
            .where(
              and(
                inArray(schema.operationCatalog.id, values.map((v) => v.operationId)),
                eq(schema.operationCatalog.isActive, true),
              ),
            );

      const byId = new Map(operations.map((o) => [o.id, o]));
      const rows = values.map((v) => {
        const op = byId.get(v.operationId);
        if (op === undefined) {
          throw new AppError('NOT_FOUND', 'Operațiune inexistentă sau dezactivată în catalog.');
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
      const request = await lockOpenRequest(tx, values.requestId, 'decisă');

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

        /*
         * Firma unitatii TREBUIE sa fie firma cererii. Altfel lantul
         * cerere → UL → alocare traverseaza doua firme, iar RLS-ul — scopat pe
         * firma — vede fiecare capat de la alta firma si niciunul intreg. Si
         * plafonul consumat ar fi al firmei gresite.
         */
        if (values.creation.workUnit.companyId !== request.companyId) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Unitatea de lucru trebuie creată la firma cererii.',
          );
        }

        /*
         * Un SINGUR drum de creare de unitate: `createWorkUnitTx`, pe tranzactia
         * de aici. Reimplementarea insert-urilor pierde regulile lui — prima
         * data a pierdut exact „o interventie cere cel putin o alocare", deci o
         * interventie decisa din rutare putea ramane fara finantare.
         */
        const newWorkUnitId = uuidv7();
        workUnitId = newWorkUnitId;
        await createWorkUnitTx(tx, actor, values.creation, newWorkUnitId, {
          sourceRequestId: values.requestId,
        });

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
    // Aceleasi mesaje ca la crearea directa de unitate — un singur drum de
    // creare inseamna si un singur set de erori.
    return translateWorkUnitCreationError(error, values.creation?.series ?? '');
  }
}

// ── Backlog ──────────────────────────────────────────────────────────────────

/**
 * Cat mai incape in (componenta, luna): plafonul minus ce s-a promis deja prin
 * alocari active.
 *
 * Se compara cu `allocated_revenue` din rollup, nu cu consumul din registru:
 * promovarea scrie o ALOCARE, iar alocarea ocupa plafonul din clipa in care e
 * scrisa, cu mult inainte sa existe vreo cheltuiala. Delta are plafon de venit,
 * restul componentelor plafon de cost; `null` inseamna „nu s-a setat plafon pe
 * luna asta", si atunci nu exista cifra fata de care sa avertizezi.
 */
async function freeRoom(
  tx: ActorTx,
  componentId: string,
  periodId: string,
): Promise<Money | null> {
  const [ceiling] = await tx
    .select({
      costCeiling: schema.componentCeilings.costCeiling,
      revenueCeiling: schema.componentCeilings.revenueCeiling,
    })
    .from(schema.componentCeilings)
    .where(
      and(
        eq(schema.componentCeilings.componentId, componentId),
        eq(schema.componentCeilings.periodId, periodId),
      ),
    );

  const raw = ceiling?.revenueCeiling ?? ceiling?.costCeiling ?? null;
  if (raw === null) {
    return null;
  }

  const [rollup] = await tx
    .select({ allocatedRevenue: schema.componentPeriodRollup.allocatedRevenue })
    .from(schema.componentPeriodRollup)
    .where(
      and(
        eq(schema.componentPeriodRollup.componentId, componentId),
        eq(schema.componentPeriodRollup.periodId, periodId),
      ),
    );

  return Money.fromDb(raw).sub(Money.fromDb(rollup?.allocatedRevenue));
}

/**
 * Promoveaza propuneri de backlog in unitati de lucru finantate din Delta —
 * toate intr-o singura tranzactie (verificarea #15). Fiecare UL primeste
 * finantare 100% din (contract, componenta, luna) date, si cererea de origine
 * a propunerii trece in `decisa`.
 *
 * Verificarea #16: depasirea de plafon da AVERTISMENT cu suma, nu blocaj tacut.
 * Fara `acceptOverCeiling` promovarea cade cu `CONFLICT` si spune cu cat s-ar
 * depasi; cu el, trece — pentru ca uneori depasirea e decizia corecta, dar
 * trebuie sa fie o decizie, nu un accident.
 */
export async function promoteBacklog(
  actor: Actor,
  input: PromoteBacklogInput,
): Promise<{ readonly workUnitIds: readonly string[] }> {
  const values = promoteBacklogInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      /*
       * `for update`: doua promovari concurente ale aceleiasi propuneri ar citi
       * amandoua `open` si ar crea doua unitati finantate din acelasi plafon.
       * Lock-ul le serializeaza; `where status = 'open'` de la update le prinde
       * daca prima a apucat deja sa treaca.
       *
       * Filtrul pe contract nu e redundant: fara el se promoveaza propunerile
       * contractului A din plafonul contractului B, iar rollup-ul lui B arata
       * consum pe o lucrare pe care nimeni de la B n-a cerut-o.
       */
      const proposals = await tx
        .select()
        .from(schema.backlogProposals)
        .where(
          and(
            inArray(schema.backlogProposals.id, values.proposalIds),
            eq(schema.backlogProposals.status, 'open'),
            eq(schema.backlogProposals.contractId, values.contractId),
          ),
        )
        .for('update');

      if (proposals.length !== values.proposalIds.length) {
        throw new AppError(
          'CONFLICT',
          'Una sau mai multe propuneri nu mai sunt deschise sau nu sunt ale contractului ales.',
        );
      }

      const [contract] = await tx
        .select({ companyId: schema.contracts.companyId })
        .from(schema.contracts)
        .where(eq(schema.contracts.id, values.contractId));
      if (contract === undefined) {
        throw new AppError('NOT_FOUND', 'Contract inexistent.');
      }

      const [component] = await tx
        .select({ contractId: schema.contractComponents.contractId })
        .from(schema.contractComponents)
        .where(eq(schema.contractComponents.id, values.componentId));
      if (component === undefined || component.contractId !== values.contractId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Componenta aleasă nu aparține contractului din care se plătește.',
        );
      }

      const total = Money.sum(proposals.map((p) => Money.fromDb(p.estimatedValue)));
      const free = await freeRoom(tx, values.componentId, values.periodId);
      if (free !== null && total.gt(free) && !values.acceptOverCeiling) {
        const over = total.sub(free);
        throw new AppError(
          'CONFLICT',
          `Promovarea depășește plafonul lunii cu ${over.format()} ` +
            `(${total.format()} de promovat, ${free.format()} liber). ` +
            'Confirmă explicit depășirea dacă asta vrei.',
          { total: total.toDbString(), free: free.toDbString(), over: over.toDbString() },
        );
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
          // Valoarea propunerii ramane si pe unitate, nu doar pe alocare: fara
          // ea, o alocare in PROCENT adaugata mai tarziu n-ar avea din ce sa se
          // calculeze, si ar contribui cu zero la plafon.
          estimatedValue: proposal.estimatedValue,
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

        const promoted = await tx
          .update(schema.backlogProposals)
          .set({ status: 'promoted', promotedWorkUnitId: workUnitId })
          .where(
            and(
              eq(schema.backlogProposals.id, proposal.id),
              eq(schema.backlogProposals.status, 'open'),
            ),
          )
          .returning({ id: schema.backlogProposals.id });
        if (promoted.length !== 1) {
          throw new AppError('CONFLICT', 'Propunerea a fost promovată între timp de altcineva.');
        }

        await tx
          .update(schema.requests)
          .set({ status: 'decisa' })
          .where(eq(schema.requests.id, proposal.requestId));

        workUnitIds.push(workUnitId);
      }

      return { workUnitIds };
    });
  } catch (error) {
    return translateWorkUnitCreationError(error, values.series);
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
