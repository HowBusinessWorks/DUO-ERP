'use server';

import { can } from '@damina/auth';
import { closePeriod, reopenPeriod, startClosing } from '@damina/services';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Inchiderea si redeschiderea lunii.
 *
 * Amandoua cer **motiv scris**, si nu din politete: inchiderea ingheata cifrele
 * pe care s-a trimis raportul, iar redeschiderea le dezgheata dupa ce clientul
 * le-a vazut. Motivul ajunge in `audit.entries` prin `withActor`, iar la
 * redeschidere baza chiar refuza scrierea fara el (usa din 0005).
 *
 * Dreptul e `periods.close`, nu `financials.read`: cine vede cifrele nu inchide
 * automat luna.
 */

const periodSchema = z.object({ periodId: z.string().uuid() });

const withReasonSchema = periodSchema.extend({
  reason: z.string().trim().min(1, 'Scrie de ce închizi luna.').max(500),
});

const DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message: 'Închiderea lunii e a rolurilor de administrare și financiar. Rolul tău nu o face.',
};

async function requireClosePermission(): Promise<boolean> {
  const session = await requireSession();
  return can(session, 'periods.close');
}

/** `open → closing`. De aici încolo checklist-ul se reevaluează la fiecare deschidere. */
export async function beginPeriodClosing(raw: unknown): Promise<ActionResult<{ status: string }>> {
  if (!(await requireClosePermission())) {
    return DENIED;
  }

  const run = createAction({
    schema: periodSchema,
    run: async (actor, values) => {
      const state = await startClosing(actor, values.periodId);
      return { status: state.status };
    },
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * `closing → closed`. Serviciul reevalueaza checklist-ul si refuza daca vreun
 * rand e blocat — butonul inactiv din ecran e comoditate, regula e acolo.
 */
export async function closeAccountingPeriod(
  raw: unknown,
): Promise<ActionResult<{ status: string }>> {
  if (!(await requireClosePermission())) {
    return DENIED;
  }

  const run = createAction({
    schema: withReasonSchema,
    run: async (actor, values) => {
      const state = await closePeriod(actor, values.periodId, values.reason);
      return { status: state.status };
    },
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Redeschiderea. Ireversibila in sensul care conteaza: raportul deja trimis nu
 * se schimba pentru ca luna s-a redeschis, dar cifrele din spatele lui, da.
 */
export async function reopenAccountingPeriod(
  raw: unknown,
): Promise<ActionResult<{ status: string }>> {
  if (!(await requireClosePermission())) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Redeschiderea lunii e o acțiune de administrator. Rolul tău nu o face.',
    };
  }

  const run = createAction({
    schema: withReasonSchema.extend({
      reason: z.string().trim().min(1, 'Scrie de ce redeschizi luna.').max(500),
    }),
    run: async (actor, values) => {
      const state = await reopenPeriod(actor, values.periodId, values.reason);
      return { status: state.status };
    },
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}
