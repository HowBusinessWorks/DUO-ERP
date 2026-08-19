import type {
  CreateRequestInput,
  DecideRoutingInput,
  PromoteBacklogInput,
  RequestEstimateLineInput,
  TriageRequestInput,
} from '@damina/contracts';
import {
  createRequestInputSchema,
  decideRoutingInputSchema,
  promoteBacklogInputSchema,
  requestEstimateLineInputSchema,
  triageRequestInputSchema,
} from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import {
  estimateFromCatalog,
  isCommercialOpportunity,
  routeRequest,
  selectBacklogToFill,
  type RoutingProposal,
} from '@damina/domain';
import { AppError, Money, uuidv7 } from '@damina/shared';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
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

  try {
    return await withActor(actor, async (tx) => createRequestTx(tx, actor, values));
  } catch (error) {
    return translateDbError(error);
  }
}

/**
 * Crearea cererii pe o tranzactie DEJA deschisa.
 *
 * Exista din acelasi motiv ca `createWorkUnitTx`: iesirea „creează intervenție"
 * a unui punct NOK (pasul 09) scrie constatarea SI cererea nascuta din ea in
 * aceeasi tranzactie. Un `withActor` in plus ar lua alta conexiune din pool si
 * fisa ar putea ramane salvata cu o constatare care arata spre o cerere care nu
 * s-a scris.
 */
export async function createRequestTx(
  tx: ActorTx,
  actor: Actor,
  values: ReturnType<typeof createRequestInputSchema.parse>,
): Promise<{ readonly id: string }> {
  const id = uuidv7();

  /*
   * Insert scris de mana, si nu prin drizzle, dintr-un motiv care s-a mai platit
   * de trei ori in proiect: **drizzle numeste TOATE coloanele**, punand `default`
   * pe cele nedate. Un `grant insert (coloane)` care exclude `estimated_value` —
   * si asta e exact grantul terenului — n-ar putea fi satisfacut niciodata,
   * oricat de goala ar fi valoarea.
   *
   * Asa, coloana de bani apare in `insert` **doar cand chiar se scrie ceva in
   * ea**. Un actor care n-are voie sa scrie bani si nici nu incearca trece; unul
   * care incearca primeste 42501, adica exact refuzul corect, din grant, nu
   * dintr-o verificare paralela care se poate uita.
   */
  const withEstimate = values.estimatedValue !== null;

  await tx.execute(sql`
    insert into app.requests
      (id, company_id, type, source, objective_id, contract_id, contract_objective_id,
       title, description, sla_due_at, created_by${withEstimate ? sql`, estimated_value` : sql``})
    values (
      ${id}, ${values.companyId}, ${values.type}::app.request_type,
      ${values.source}::app.request_source, ${values.objectiveId}, ${values.contractId},
      ${values.contractObjectiveId}, ${values.title}, ${values.description ?? null},
      ${values.slaDueAt}, ${actor.personId}${withEstimate ? sql`, ${values.estimatedValue}` : sql``}
    )`);

  return { id };
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
      const operations =
        values.length === 0
          ? []
          : await tx
              .select()
              .from(schema.operationCatalog)
              .where(
                and(
                  inArray(
                    schema.operationCatalog.id,
                    values.map((v) => v.operationId),
                  ),
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
        return {
          operationId: v.operationId,
          quantity: v.quantity,
          estimatedLabor,
          estimatedMaterial,
        };
      });

      await tx
        .delete(schema.requestEstimateLines)
        .where(eq(schema.requestEstimateLines.requestId, requestId));
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
        await tx
          .update(schema.requests)
          .set({ status: 'in_backlog' })
          .where(eq(schema.requests.id, values.requestId));
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

        await tx
          .update(schema.requests)
          .set({ status: 'decisa' })
          .where(eq(schema.requests.id, values.requestId));
      }

      // `target_periods` sunt DATE calendaristice (prima zi a lunii), nu
      // id-urile perioadelor — se rezolva printr-un lookup pe `app.periods`.
      let targetPeriods: string[] | null = null;
      if (values.creation !== undefined && values.creation.allocations.length > 0) {
        const periodRows = await tx
          .select({ id: schema.periods.id, year: schema.periods.year, month: schema.periods.month })
          .from(schema.periods)
          .where(
            inArray(
              schema.periods.id,
              values.creation.allocations.map((a) => a.periodId),
            ),
          );
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
async function freeRoom(tx: ActorTx, componentId: string, periodId: string): Promise<Money | null> {
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

/**
 * Use-case-ul cronului zilnic de expirare (§3.6). Deschide tranzactia in jurul
 * lui `expireBacklogProposals`, ca worker-ul sa nu stie nimic despre `ActorTx`.
 *
 * `asOf` e parametru, nu `now()` in SQL: asa se poate rula si pentru o zi
 * anume, iar testul nu depinde de ceasul masinii.
 */
export async function runBacklogExpiry(actor: Actor, asOf?: string): Promise<number> {
  const on = asOf ?? new Date().toISOString().slice(0, 10);
  return withActor(actor, (tx) => expireBacklogProposals(tx, on));
}

// ── Citiri: ce alimenteaza ecranele pasului 08b ──────────────────────────────

/**
 * Randul de lista al unei cereri.
 *
 * Numele obiectivului si codul contractului vin din `join`, nu dintr-o a doua
 * interogare per rand: inbox-ul are ca tinta 30 de secunde pe cerere, iar o
 * lista care face N+1 interogari le consuma inainte sa apuce omul sa citeasca.
 */
export interface RequestRow {
  readonly id: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly type: string;
  readonly source: string;
  readonly status: string;
  readonly title: string;
  readonly description: string | null;
  readonly estimatedValue: string | null;
  readonly objectiveId: string | null;
  readonly objectiveName: string | null;
  readonly contractId: string | null;
  readonly contractCode: string | null;
  readonly slaDueAt: Date | null;
  readonly createdAt: Date;
}

export interface ListRequestsOptions {
  readonly companyIds: readonly string[];
  /** Implicit toate. Inbox-ul cere `['neprocesata']`. */
  readonly statuses?: readonly string[];
  readonly query?: string;
  readonly limit?: number;
}

const REQUEST_LIST_LIMIT = 200;

function likePattern(query: string): string {
  return `%${query.replace(/([%_\\])/g, '\\$1')}%`;
}

const requestColumns = {
  id: schema.requests.id,
  companyId: schema.requests.companyId,
  companyName: schema.companies.name,
  type: schema.requests.type,
  source: schema.requests.source,
  status: schema.requests.status,
  title: schema.requests.title,
  description: schema.requests.description,
  estimatedValue: schema.requests.estimatedValue,
  objectiveId: schema.requests.objectiveId,
  objectiveName: schema.objectives.name,
  contractId: schema.requests.contractId,
  contractCode: schema.contracts.code,
  slaDueAt: schema.requests.slaDueAt,
  createdAt: schema.requests.createdAt,
};

export async function listRequests(
  actor: Actor,
  options: ListRequestsOptions,
): Promise<RequestRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const conditions = [inArray(schema.requests.companyId, [...options.companyIds])];
    if (options.statuses !== undefined && options.statuses.length > 0) {
      conditions.push(inArray(schema.requests.status, [...options.statuses] as never[]));
    }
    if (options.query !== undefined && options.query !== '') {
      const pattern = likePattern(options.query);
      const match = or(
        ilike(schema.requests.title, pattern),
        ilike(schema.requests.description, pattern),
      );
      if (match !== undefined) {
        conditions.push(match);
      }
    }

    return tx
      .select(requestColumns)
      .from(schema.requests)
      .innerJoin(schema.companies, eq(schema.requests.companyId, schema.companies.id))
      .leftJoin(schema.objectives, eq(schema.requests.objectiveId, schema.objectives.id))
      .leftJoin(schema.contracts, eq(schema.requests.contractId, schema.contracts.id))
      .where(and(...conditions))
      .orderBy(desc(schema.requests.createdAt))
      .limit(options.limit ?? REQUEST_LIST_LIMIT);
  });
}

export async function getRequest(actor: Actor, id: string): Promise<RequestRow> {
  const [row] = await withActor(actor, async (tx) =>
    tx
      .select(requestColumns)
      .from(schema.requests)
      .innerJoin(schema.companies, eq(schema.requests.companyId, schema.companies.id))
      .leftJoin(schema.objectives, eq(schema.requests.objectiveId, schema.objectives.id))
      .leftJoin(schema.contracts, eq(schema.requests.contractId, schema.contracts.id))
      .where(eq(schema.requests.id, id)),
  );

  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Cerere inexistentă.');
  }
  return row;
}

/** Emailul original, cand cererea a intrat prin inbox. `null` la cele manuale. */
export interface RequestEmailRow {
  readonly messageId: string;
  readonly fromAddress: string;
  readonly toAddress: string | null;
  readonly subject: string | null;
  readonly receivedAt: Date;
  readonly bodyText: string | null;
  readonly rawNodeId: string | null;
}

export async function getRequestEmail(
  actor: Actor,
  requestId: string,
): Promise<RequestEmailRow | null> {
  const [row] = await withActor(actor, async (tx) =>
    tx
      .select({
        messageId: schema.requestEmails.messageId,
        fromAddress: schema.requestEmails.fromAddress,
        toAddress: schema.requestEmails.toAddress,
        subject: schema.requestEmails.subject,
        receivedAt: schema.requestEmails.receivedAt,
        bodyText: schema.requestEmails.bodyText,
        rawNodeId: schema.requestEmails.rawNodeId,
      })
      .from(schema.requestEmails)
      .where(eq(schema.requestEmails.requestId, requestId))
      .limit(1),
  );
  return row ?? null;
}

export interface EstimateLineRow {
  readonly id: string;
  readonly operationId: string;
  readonly operationCode: string;
  readonly operationName: string;
  readonly quantity: string;
  readonly estimatedLabor: string;
  readonly estimatedMaterial: string;
}

export async function listEstimateLines(
  actor: Actor,
  requestId: string,
): Promise<EstimateLineRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: schema.requestEstimateLines.id,
        operationId: schema.requestEstimateLines.operationId,
        operationCode: schema.operationCatalog.code,
        operationName: schema.operationCatalog.name,
        quantity: schema.requestEstimateLines.quantity,
        estimatedLabor: schema.requestEstimateLines.estimatedLabor,
        estimatedMaterial: schema.requestEstimateLines.estimatedMaterial,
      })
      .from(schema.requestEstimateLines)
      .innerJoin(
        schema.operationCatalog,
        eq(schema.requestEstimateLines.operationId, schema.operationCatalog.id),
      )
      .where(eq(schema.requestEstimateLines.requestId, requestId))
      .orderBy(asc(schema.operationCatalog.code)),
  );
}

// ── Trierea din inbox ────────────────────────────────────────────────────────

/**
 * Trierea unei cereri: completeaza obiectivul, contractul, tipul si valoarea,
 * si o trece in `in_evaluare` (§3.5, „ținta e 30 de secunde per email").
 *
 * Nu schimba firma si nu schimba sursa — nici macar nu le primeste. O cerere
 * intrata pe cutia firmei A nu devine a firmei B pentru ca cineva a apasat
 * gresit intr-un `select`, iar sursa e un fapt istoric, nu o optiune.
 */
export async function triageRequest(
  actor: Actor,
  input: TriageRequestInput,
): Promise<{ readonly id: string }> {
  const values = triageRequestInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const request = await lockOpenRequest(tx, values.requestId, 'triată');

      if (values.contractId !== null) {
        const [contract] = await tx
          .select({ companyId: schema.contracts.companyId })
          .from(schema.contracts)
          .where(eq(schema.contracts.id, values.contractId));
        if (contract === undefined) {
          throw new AppError('NOT_FOUND', 'Contract inexistent.');
        }
        if (contract.companyId !== request.companyId) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Contractul e la altă firmă decât cererea. Cererea rămâne la firma pe care a intrat.',
          );
        }
      }

      await tx
        .update(schema.requests)
        .set({
          type: values.type,
          objectiveId: values.objectiveId,
          contractId: values.contractId,
          contractObjectiveId: values.contractObjectiveId,
          title: values.title,
          description: values.description ?? null,
          estimatedValue: values.estimatedValue,
          status: 'in_evaluare',
        })
        .where(eq(schema.requests.id, values.requestId));

      return { id: values.requestId };
    });
  } catch (error) {
    if (AppError.is(error)) {
      throw error;
    }
    return translateDbError(error);
  }
}

// ── Contextul ecranului de Decizie ───────────────────────────────────────────

/** O luna de Delta, cu liberul ei si eticheta pe care o vede omul. */
export interface DeltaMonth {
  readonly periodId: string;
  readonly year: number;
  readonly month: number;
  readonly label: string;
  readonly free: Money;
}

export interface RoutingContext {
  readonly contractId: string | null;
  readonly contractCode: string | null;
  /** Componentele contractului, ca ecranul sa stie unde poate pune lucrarea. */
  readonly components: readonly {
    readonly id: string;
    readonly type: string;
    readonly name: string;
  }[];
  readonly deltaMonths: readonly DeltaMonth[];
  readonly lucrariCeilingFree: Money | null;
  /** Lunile deschise ale firmei, pentru alocarile care nu sunt pe Delta. */
  readonly openPeriods: readonly {
    readonly id: string;
    readonly year: number;
    readonly month: number;
  }[];
}

const MONTH_NAMES = [
  'ianuarie',
  'februarie',
  'martie',
  'aprilie',
  'mai',
  'iunie',
  'iulie',
  'august',
  'septembrie',
  'octombrie',
  'noiembrie',
  'decembrie',
];

/** `august 2026` — eticheta lunii, asa cum o citeste omul pe ecranul de decizie. */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? String(month)} ${String(year)}`;
}

/**
 * Tot ce trebuie ecranului de Decizie ca sa cheme `routeRequest` — citit intr-o
 * singura tranzactie, LIVE (§3.5: cifra „Delta liber" nu se cache-uieste
 * niciodata).
 *
 * „Liber" inseamna acelasi lucru ca la promovarea din backlog: plafonul lunii
 * minus `component_period_rollup.allocated_revenue`, adica minus cat s-a promis
 * deja prin alocari de finantare. Daca ecranul ar folosi alta definitie decat
 * cea pe care o impune `promoteBacklog`, ar promite loc pe care serviciul il
 * refuza — si atunci omul ar invata sa nu creada ecranul.
 */
export async function routingContext(
  actor: Actor,
  requestId: string,
  months = 3,
): Promise<RoutingContext> {
  return withActor(actor, async (tx) => {
    const [request] = await tx
      .select({
        companyId: schema.requests.companyId,
        contractId: schema.requests.contractId,
      })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId));

    if (request === undefined) {
      throw new AppError('NOT_FOUND', 'Cerere inexistentă.');
    }

    const openPeriods = await tx
      .select({
        id: schema.periods.id,
        year: schema.periods.year,
        month: schema.periods.month,
      })
      .from(schema.periods)
      .where(
        and(eq(schema.periods.companyId, request.companyId), eq(schema.periods.status, 'open')),
      )
      .orderBy(asc(schema.periods.year), asc(schema.periods.month));

    if (request.contractId === null) {
      return {
        contractId: null,
        contractCode: null,
        components: [],
        deltaMonths: [],
        lucrariCeilingFree: null,
        openPeriods,
      };
    }

    const [contract] = await tx
      .select({ code: schema.contracts.code })
      .from(schema.contracts)
      .where(eq(schema.contracts.id, request.contractId));

    const components = await tx
      .select({
        id: schema.contractComponents.id,
        type: schema.contractComponents.type,
        name: schema.contractComponents.name,
      })
      .from(schema.contractComponents)
      .where(eq(schema.contractComponents.contractId, request.contractId));

    const delta = components.find((component) => component.type === 'delta');
    const lucrari = components.find((component) => component.type === 'lucrari');

    const deltaMonths: DeltaMonth[] = [];
    if (delta !== undefined) {
      for (const period of openPeriods.slice(0, months)) {
        const free = await freeRoom(tx, delta.id, period.id);
        if (free === null) {
          // Fara plafon setat pe luna aia, Delta nu ofera loc: nu e „infinit",
          // e „nedefinit", si o luna nedefinita n-are ce cauta in propunere.
          continue;
        }
        deltaMonths.push({
          periodId: period.id,
          year: period.year,
          month: period.month,
          label: monthLabel(period.year, period.month),
          free,
        });
      }
    }

    const firstPeriod = openPeriods[0];
    const lucrariCeilingFree =
      lucrari === undefined || firstPeriod === undefined
        ? null
        : await freeRoom(tx, lucrari.id, firstPeriod.id);

    return {
      contractId: request.contractId,
      contractCode: contract?.code ?? null,
      components,
      deltaMonths,
      lucrariCeilingFree,
      openPeriods,
    };
  });
}

// ── Jurnalul de decizii ──────────────────────────────────────────────────────

export interface RoutingDecisionRow {
  readonly id: string;
  readonly requestId: string;
  readonly requestTitle: string;
  readonly companyId: string;
  readonly choice: string;
  readonly systemProposal: string;
  readonly reason: string;
  readonly decidedByName: string;
  readonly decidedAt: Date;
  readonly createdWorkUnitId: string | null;
  readonly createdWorkUnitCode: string | null;
  readonly estimatedValue: string | null;
  readonly targetPeriods: string[] | null;
}

export interface DecisionJournal {
  readonly rows: readonly RoutingDecisionRow[];
  readonly total: number;
  readonly diverged: number;
  /** Cat la suta din decizii au schimbat propunerea sistemului (verificarea #17). */
  readonly divergencePercent: number;
}

const decisionColumns = {
  id: schema.requestDecisions.id,
  requestId: schema.requestDecisions.requestId,
  requestTitle: schema.requests.title,
  companyId: schema.requests.companyId,
  choice: schema.requestDecisions.choice,
  systemProposal: schema.requestDecisions.systemProposal,
  reason: schema.requestDecisions.reason,
  decidedByName: schema.persons.fullName,
  decidedAt: schema.requestDecisions.decidedAt,
  createdWorkUnitId: schema.requestDecisions.createdWorkUnitId,
  createdWorkUnitCode: schema.workUnits.code,
  estimatedValue: schema.requests.estimatedValue,
  targetPeriods: schema.requestDecisions.targetPeriods,
};

/**
 * Jurnalul de decizii, cu indicatorul de divergenta.
 *
 * Divergenta e masura pe care planul o cere explicit: daca omul schimba
 * propunerea in 60% din cazuri, `routeRequest` e gresita si trebuie ajustata —
 * si asta se poate afla doar pentru ca se salveaza AMANDOUA, nu doar rezultatul.
 */
export async function listRoutingDecisions(
  actor: Actor,
  options: { readonly companyIds: readonly string[]; readonly limit?: number },
): Promise<DecisionJournal> {
  if (options.companyIds.length === 0) {
    return { rows: [], total: 0, diverged: 0, divergencePercent: 0 };
  }

  const rows = await withActor(actor, async (tx) =>
    tx
      .select(decisionColumns)
      .from(schema.requestDecisions)
      .innerJoin(schema.requests, eq(schema.requestDecisions.requestId, schema.requests.id))
      .innerJoin(schema.persons, eq(schema.requestDecisions.decidedBy, schema.persons.id))
      .leftJoin(
        schema.workUnits,
        eq(schema.requestDecisions.createdWorkUnitId, schema.workUnits.id),
      )
      .where(inArray(schema.requests.companyId, [...options.companyIds]))
      .orderBy(desc(schema.requestDecisions.decidedAt))
      .limit(options.limit ?? REQUEST_LIST_LIMIT),
  );

  const diverged = rows.filter((row) => row.choice !== row.systemProposal).length;
  return {
    rows,
    total: rows.length,
    diverged,
    divergencePercent: rows.length === 0 ? 0 : Math.round((diverged / rows.length) * 1000) / 10,
  };
}

/** Deciziile unei singure cereri — tab-ul `Decizie` al paginii de cerere. */
export async function listDecisionsForRequest(
  actor: Actor,
  requestId: string,
): Promise<RoutingDecisionRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select(decisionColumns)
      .from(schema.requestDecisions)
      .innerJoin(schema.requests, eq(schema.requestDecisions.requestId, schema.requests.id))
      .innerJoin(schema.persons, eq(schema.requestDecisions.decidedBy, schema.persons.id))
      .leftJoin(
        schema.workUnits,
        eq(schema.requestDecisions.createdWorkUnitId, schema.workUnits.id),
      )
      .where(eq(schema.requestDecisions.requestId, requestId))
      .orderBy(desc(schema.requestDecisions.decidedAt)),
  );
}

// ── Backlogul ────────────────────────────────────────────────────────────────

export interface BacklogRow {
  readonly id: string;
  readonly requestId: string;
  readonly contractId: string;
  readonly contractCode: string;
  readonly companyId: string;
  readonly objectiveId: string;
  readonly objectiveName: string;
  readonly title: string;
  readonly estimatedValue: string;
  readonly sourceKind: string;
  readonly status: string;
  readonly validUntil: string | null;
  readonly promotedWorkUnitId: string | null;
  readonly createdAt: Date;
}

export interface ListBacklogOptions {
  readonly companyIds: readonly string[];
  readonly contractId?: string;
  /** Implicit doar `open`: expirate si promovate raman vizibile prin filtru (#19). */
  readonly statuses?: readonly string[];
}

export async function listBacklogProposals(
  actor: Actor,
  options: ListBacklogOptions,
): Promise<BacklogRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }

  return withActor(actor, async (tx) => {
    const conditions = [
      inArray(schema.contracts.companyId, [...options.companyIds]),
      inArray(schema.backlogProposals.status, [...(options.statuses ?? ['open'])]),
    ];
    if (options.contractId !== undefined) {
      conditions.push(eq(schema.backlogProposals.contractId, options.contractId));
    }

    return tx
      .select({
        id: schema.backlogProposals.id,
        requestId: schema.backlogProposals.requestId,
        contractId: schema.backlogProposals.contractId,
        contractCode: schema.contracts.code,
        companyId: schema.contracts.companyId,
        objectiveId: schema.backlogProposals.objectiveId,
        objectiveName: schema.objectives.name,
        title: schema.backlogProposals.title,
        estimatedValue: schema.backlogProposals.estimatedValue,
        sourceKind: schema.backlogProposals.sourceKind,
        status: schema.backlogProposals.status,
        validUntil: schema.backlogProposals.validUntil,
        promotedWorkUnitId: schema.backlogProposals.promotedWorkUnitId,
        createdAt: schema.backlogProposals.createdAt,
      })
      .from(schema.backlogProposals)
      .innerJoin(schema.contracts, eq(schema.backlogProposals.contractId, schema.contracts.id))
      .innerJoin(schema.objectives, eq(schema.backlogProposals.objectiveId, schema.objectives.id))
      .where(and(...conditions))
      .orderBy(desc(schema.backlogProposals.estimatedValue));
  });
}

/**
 * Liberul Deltei unui contract pe lunile deschise — ecranul de umplere.
 *
 * Aceeasi definitie de „liber" ca la `routingContext` si ca la `promoteBacklog`.
 */
export async function deltaFreeForContract(
  actor: Actor,
  contractId: string,
  months = 3,
): Promise<{ readonly componentId: string | null; readonly months: readonly DeltaMonth[] }> {
  return withActor(actor, async (tx) => {
    const [contract] = await tx
      .select({ companyId: schema.contracts.companyId })
      .from(schema.contracts)
      .where(eq(schema.contracts.id, contractId));
    if (contract === undefined) {
      throw new AppError('NOT_FOUND', 'Contract inexistent.');
    }

    const [delta] = await tx
      .select({ id: schema.contractComponents.id })
      .from(schema.contractComponents)
      .where(
        and(
          eq(schema.contractComponents.contractId, contractId),
          eq(schema.contractComponents.type, 'delta'),
        ),
      );
    if (delta === undefined) {
      return { componentId: null, months: [] };
    }

    const periods = await tx
      .select({
        id: schema.periods.id,
        year: schema.periods.year,
        month: schema.periods.month,
      })
      .from(schema.periods)
      .where(
        and(eq(schema.periods.companyId, contract.companyId), eq(schema.periods.status, 'open')),
      )
      .orderBy(asc(schema.periods.year), asc(schema.periods.month))
      .limit(months);

    const rows: DeltaMonth[] = [];
    for (const period of periods) {
      const free = await freeRoom(tx, delta.id, period.id);
      if (free === null) {
        continue;
      }
      rows.push({
        periodId: period.id,
        year: period.year,
        month: period.month,
        label: monthLabel(period.year, period.month),
        free,
      });
    }

    return { componentId: delta.id, months: rows };
  });
}

// ── Propunerea de rutare si umplerea backlogului, pentru ecrane ──────────────

/**
 * Contextul cererii + propunerea sistemului, intr-un singur apel.
 *
 * Exista aici, nu in ecran, din cauza regulii de dependente: `apps/web` importa
 * `services`, iar `services` importa `domain` — niciodata direct. Nu e
 * birocratie: asa singurul loc care cheama `routeRequest` e cel care citeste si
 * cifrele pe care se bazeaza, deci propunerea si liberul afisat langa ea nu pot
 * proveni din doua citiri diferite.
 */
export async function proposeRouting(
  actor: Actor,
  requestId: string,
  months = 3,
): Promise<{ readonly context: RoutingContext; readonly routing: RoutingProposal }> {
  const request = await getRequest(actor, requestId);
  const context = await routingContext(actor, requestId, months);

  const routing = routeRequest({
    value: Money.fromDb(request.estimatedValue),
    ceilings: {
      deltaFreeByPeriod: context.deltaMonths.map((month) => ({
        periodId: month.periodId,
        free: month.free,
      })),
      lucrariCeilingFree: context.lucrariCeilingFree,
      isCommercialOpportunity: isCommercialOpportunity(request.type),
    },
  });

  return { context, routing };
}

/**
 * Combinatia de propuneri care umple cel mai bine luna de Delta.
 *
 * Ecranul trimite doar contractul si luna: cifrele — propunerile deschise si
 * liberul lunii — se citesc AICI, in aceeasi tranzactie logica. Daca ecranul ar
 * trimite si liberul, ar putea trimite unul vechi, iar selectia „optima" ar fi
 * optima fata de o cifra care nu mai e adevarata.
 */
export async function suggestBacklogFill(
  actor: Actor,
  input: { readonly contractId: string; readonly periodId: string },
): Promise<{
  readonly selectedIds: readonly string[];
  readonly total: Money;
  readonly free: Money;
  readonly fillPercent: number;
  readonly exact: boolean;
}> {
  // Propunerile se citesc pe contract, nu pe firme: RLS decide oricum ce randuri
  // sunt vizibile, iar contractul e deja al unei singure firme.
  const proposals = await withActor(actor, async (tx) =>
    tx
      .select({
        id: schema.backlogProposals.id,
        estimatedValue: schema.backlogProposals.estimatedValue,
      })
      .from(schema.backlogProposals)
      .where(
        and(
          eq(schema.backlogProposals.contractId, input.contractId),
          eq(schema.backlogProposals.status, 'open'),
        ),
      ),
  );
  const delta = await deltaFreeForContract(actor, input.contractId, 12);

  const free = delta.months.find((month) => month.periodId === input.periodId)?.free ?? Money.ZERO;
  const selection = selectBacklogToFill(
    proposals.map((proposal) => ({
      id: proposal.id,
      estimatedValue: Money.fromDb(proposal.estimatedValue),
    })),
    free,
  );

  return {
    selectedIds: selection.selectedIds,
    total: selection.total,
    free,
    fillPercent: selection.fillPercent,
    exact: selection.exact,
  };
}
