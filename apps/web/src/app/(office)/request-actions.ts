'use server';

import { canDecideRouting, canEditNomenclature, canTriageRequests } from '@damina/auth';
import {
  decideRoutingInputSchema,
  evaluateRequestInputSchema,
  operationMaterialsInputSchema,
  promoteBacklogInputSchema,
  triageRequestInputSchema,
  type DecideRoutingInput,
  type OperationMaterialsInput,
  type PromoteBacklogInput,
  type TriageRequestInput,
} from '@damina/contracts';
import {
  decideRouting,
  evaluateRequest,
  promoteBacklog,
  setOperationMaterials,
  suggestBacklogFill,
  triageRequest,
} from '@damina/services';
import { uuidSchema } from '@damina/contracts';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Scrierile modulului Cereri (pasul 08b).
 *
 * Doua drepturi, nu unul: **trierea** completeaza o cerere, **decizia** creeaza
 * o unitate de lucru si ii aloca bani. Al doilea e de greutatea lui
 * `contracts.write`, si de aceea nu se poate ajunge la el prin primul.
 *
 * Niciuna din actiunile de aici nu decide nimic: `routeRequest` propune in
 * `@damina/domain`, iar plafoanele si atomicitatea sunt impuse in `services`.
 * Ce se face aici e traducerea erorii si invalidarea cache-ului.
 */

const TRIAGE_DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message: 'Rolul tău nu poate tria cereri.',
};

const DECIDE_DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message:
    'Decizia de rutare creează unitatea de lucru și îi alocă finanțarea. Rolul tău nu o poate lua.',
};

/** Trierea din inbox: completează cererea și o trece în `in_evaluare`. */
export async function triageRequestAction(
  raw: unknown,
): Promise<ActionResult<{ readonly id: string }>> {
  const session = await requireSession();
  if (!canTriageRequests(session)) {
    return TRIAGE_DENIED;
  }

  const run = createAction({
    schema: triageRequestInputSchema,
    run: (actor, _values, rawInput) => triageRequest(actor, rawInput as TriageRequestInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Evaluarea: liniile din catalog înlocuiesc valoarea estimată a cererii.
 *
 * Se trimite lista ÎNTREAGĂ, nu diferențe: `evaluateRequest` șterge și rescrie
 * într-o tranzacție, ca liniile și cifra de pe cerere să nu rămână niciodată
 * nesincronizate. O acțiune „adaugă o linie" ar fi făcut exact asta posibil.
 */
export async function evaluateRequestAction(
  raw: unknown,
): Promise<ActionResult<{ readonly estimatedValue: string }>> {
  const session = await requireSession();
  if (!canTriageRequests(session)) {
    return TRIAGE_DENIED;
  }

  const run = createAction({
    schema: evaluateRequestInputSchema,
    run: async (actor, values) => {
      const result = await evaluateRequest(actor, values.requestId, values.lines);
      return { estimatedValue: result.estimatedValue.toDbString() };
    },
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Decizia de rutare — cea mai importantă scriere din pas.
 *
 * `systemProposal` vine din formular pentru că el a fost calculat pe server, la
 * randare, din cifre live; nu se recalculează aici. Dacă între randare și
 * apăsare s-a schimbat liberul Deltei, cine pierde e alocarea, nu jurnalul:
 * `decideRouting` citește cererea cu `for update` și refuză a doua decizie.
 */
export async function decideRoutingAction(
  raw: unknown,
): Promise<
  ActionResult<{ readonly workUnitId: string | null; readonly backlogProposalId: string | null }>
> {
  const session = await requireSession();
  if (!canDecideRouting(session)) {
    return DECIDE_DENIED;
  }

  const run = createAction({
    schema: decideRoutingInputSchema,
    run: (actor, _values, rawInput) => decideRouting(actor, rawInput as DecideRoutingInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Promovarea din backlog. Depășirea de plafon NU e blocaj tăcut: fără
 * `acceptOverCeiling` serviciul cade cu `CONFLICT` și spune cu cât se depășește,
 * iar ecranul re-trimite cu confirmarea explicită a omului (verificarea #16).
 */
export async function promoteBacklogAction(
  raw: unknown,
): Promise<ActionResult<{ readonly workUnitIds: readonly string[] }>> {
  const session = await requireSession();
  if (!canDecideRouting(session)) {
    return DECIDE_DENIED;
  }

  const run = createAction({
    schema: promoteBacklogInputSchema,
    run: (actor, _values, rawInput) => promoteBacklog(actor, rawInput as PromoteBacklogInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Combinația de propuneri care umple cel mai bine luna de Deltă.
 *
 * Citește, nu scrie — dar trece prin `createAction` ca oricare alta, ca să aibă
 * aceeași traducere de erori. Liberul lunii se recitește pe server: o combinație
 * calculată față de o cifră veche ar fi optimă față de nimic.
 */
export async function suggestBacklogFillAction(raw: unknown): Promise<
  ActionResult<{
    readonly selectedIds: readonly string[];
    readonly total: string;
    readonly free: string;
    readonly fillPercent: number;
    readonly exact: boolean;
  }>
> {
  const run = createAction({
    schema: z.object({ contractId: uuidSchema, periodId: uuidSchema }),
    run: async (actor, values) => {
      const result = await suggestBacklogFill(actor, values);
      return {
        selectedIds: result.selectedIds,
        total: result.total.toDbString(),
        free: result.free.toDbString(),
        fillPercent: result.fillPercent,
        exact: result.exact,
      };
    },
  });

  return run(raw);
}

/** Lista de materiale tipice a unei operațiuni, înlocuită dintr-o bucată. */
export async function saveOperationMaterials(
  raw: unknown,
): Promise<ActionResult<{ readonly id: string; readonly lines: number }>> {
  const session = await requireSession();
  if (!canEditNomenclature(session)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Rolul tău nu poate modifica catalogul de operațiuni.',
    };
  }

  const run = createAction({
    schema: operationMaterialsInputSchema,
    run: (actor, _values, rawInput) =>
      setOperationMaterials(actor, rawInput as OperationMaterialsInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}
