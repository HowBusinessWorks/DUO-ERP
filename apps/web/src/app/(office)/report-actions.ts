'use server';

import { canEmitReports } from '@damina/auth';
import {
  generateMonthlyReportInputSchema,
  monthlyReportActionInputSchema,
  type GenerateMonthlyReportInput,
  type MonthlyReportActionInput,
} from '@damina/contracts';
import {
  approveMonthlyReport,
  freezeMonthlyReport,
  requestMonthlyReport,
  sendMonthlyReport,
  type GenerationRequested,
} from '@damina/services';
import { revalidatePath } from 'next/cache';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Raportul lunar catre client (pasul 10, §3.6).
 *
 * Patru actiuni, in ordinea in care se apasa, si toate cu acelasi drept:
 * `reports.emit`. Raportul e hartia in baza careia clientul plateste — cine
 * poate genera poate si aproba, dar nimeni din afara listei nu poate niciuna.
 *
 * Niciun `if` de fond nu traieste aici: ordinea starilor e in `domain`
 * (`reportTransition`), iar refuzurile vin ca `AppError` din serviciu, deja
 * scrise in romana.
 */

const DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message:
    'Raportul lunar e documentul pe baza căruia clientul plătește. Rolul tău nu îl poate emite.',
};

const REPORTS_PATH = '/panou/rapoarte/lunar';

export async function generateMonthlyReportAction(
  raw: GenerateMonthlyReportInput,
): Promise<ActionResult<GenerationRequested>> {
  const session = await requireSession();
  if (!canEmitReports(session)) {
    return DENIED;
  }

  const run = createAction({
    schema: generateMonthlyReportInputSchema,
    run: (actor, _input, input) => requestMonthlyReport(actor, input as GenerateMonthlyReportInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath(REPORTS_PATH);
    revalidatePath(`${REPORTS_PATH}/${raw.contractId}`);
  }
  return result;
}

/**
 * Aprobarea, inghetul si trimiterea au acelasi corp, dar sunt trei functii
 * exportate separat: intr-un fisier `'use server'` fiecare export trebuie sa fie
 * o functie `async` scrisa ca atare — o fabrica ar produce actiuni pe care
 * bundler-ul nu le mai recunoaste ca atare.
 */
async function transition(
  raw: MonthlyReportActionInput,
  move: (actor: Parameters<typeof approveMonthlyReport>[0], reportId: string) => Promise<string>,
): Promise<ActionResult<string>> {
  const session = await requireSession();
  if (!canEmitReports(session)) {
    return DENIED;
  }

  const run = createAction({
    schema: monthlyReportActionInputSchema,
    run: (actor, input) => move(actor, input.reportId),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath(REPORTS_PATH, 'layout');
  }
  return result;
}

export async function approveMonthlyReportAction(
  raw: MonthlyReportActionInput,
): Promise<ActionResult<string>> {
  return transition(raw, approveMonthlyReport);
}

export async function freezeMonthlyReportAction(
  raw: MonthlyReportActionInput,
): Promise<ActionResult<string>> {
  return transition(raw, freezeMonthlyReport);
}

export async function sendMonthlyReportAction(
  raw: MonthlyReportActionInput,
): Promise<ActionResult<string>> {
  return transition(raw, sendMonthlyReport);
}
