'use server';

import { canSeeFinancials } from '@damina/auth';
import {
  closeWorkUnitInputSchema,
  moveFundingInputSchema,
  promoteWorkUnitInputSchema,
  reorderStagesInputSchema,
  workStageInputSchema,
  type CloseWorkUnitInput,
  type MoveFundingInputDto,
  type PromoteWorkUnitInput,
  type ReorderStagesInput,
  type WorkStageInput,
} from '@damina/contracts';
import {
  closeWorkUnit,
  createStage,
  moveFunding,
  promoteToLucrare,
  reorderStages,
} from '@damina/services';
import { revalidatePath } from 'next/cache';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Scrierile de pe ecranele de activitate.
 *
 * Trei din cele cinci cer **motiv scris**, si nu din politete: promovarea schimba
 * tipul unei unitati deja pornite, mutarea finantarii schimba cine plateste, iar
 * inchiderea blocheaza costuri noi. Toate trei se explica peste sase luni sau nu
 * se explica niciodata.
 *
 * Motivul nu e decor: ajunge in `audit.entries` prin `withActor`, iar la alocari
 * baza chiar refuza `UPDATE`-ul fara el.
 */

const FINANCIAL_DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message: 'Mutarea finanțării atinge valori comerciale. Rolul tău nu o poate face.',
};

/**
 * Promovarea unei intervenții în lucrare.
 *
 * Nu creeaza nimic: acelasi rand, acelasi id, acelasi cod. Conditiile le
 * verifica `canPromote` din domain, iar serviciul refuza cu mesaj daca nu-s
 * indeplinite — ecranul nu le repeta, ca sa nu existe doua paremi despre cand se
 * poate promova.
 */
export async function promoteWorkUnit(
  raw: unknown,
): Promise<ActionResult<{ readonly id: string }>> {
  const run = createAction({
    schema: promoteWorkUnitInputSchema,
    run: (actor, _values, rawInput) => promoteToLucrare(actor, rawInput as PromoteWorkUnitInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Mutarea finantarii. Cele doua mecanici sunt decise de starea lunii, in domain.
 *
 * Ecranul ANUNTA mecanica inainte de confirmare, din `previewFundingMove`, care
 * citeste aceeasi sursa. Aici nu se mai decide nimic — se executa.
 */
export async function moveWorkUnitFunding(raw: unknown): Promise<
  ActionResult<{
    readonly kind: string;
    readonly reallocationNumber: string | null;
  }>
> {
  const session = await requireSession();
  if (!canSeeFinancials(session)) {
    return FINANCIAL_DENIED;
  }

  const run = createAction({
    schema: moveFundingInputSchema,
    run: async (actor, _values, rawInput) => {
      const result = await moveFunding(actor, rawInput as MoveFundingInputDto);
      return { kind: result.kind, reallocationNumber: result.reallocationNumber };
    },
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/** Inchiderea. Refuzata cand checklist-ul are randuri blocante. */
export async function closeWorkUnitAction(
  raw: unknown,
): Promise<ActionResult<{ readonly id: string }>> {
  const run = createAction({
    schema: closeWorkUnitInputSchema,
    run: (actor, _values, rawInput) => closeWorkUnit(actor, rawInput as CloseWorkUnitInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Etapa noua. Pozitia se calculeaza in tranzactie, nu se trimite din formular:
 * doua etape adaugate in paralel ar primi altfel acelasi numar.
 */
export async function createWorkUnitStage(
  raw: unknown,
): Promise<ActionResult<{ readonly id: string }>> {
  const run = createAction({
    schema: workStageInputSchema,
    run: (actor, _values, rawInput) => createStage(actor, rawInput as WorkStageInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/** Reordonarea etapelor. Pozitiile se rescriu 1..n, in ordinea trimisa. */
export async function reorderWorkUnitStages(
  raw: unknown,
): Promise<ActionResult<{ readonly count: number }>> {
  const run = createAction({
    schema: reorderStagesInputSchema,
    run: (actor, _values, rawInput) => reorderStages(actor, rawInput as ReorderStagesInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}
