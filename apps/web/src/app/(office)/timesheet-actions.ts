'use server';

import { canValidateSheets, canWriteSheets } from '@damina/auth';
import {
  saveTimesheetInputSchema,
  subcontractorAttendanceInputSchema,
  validateTimesheetsInputSchema,
  type SaveTimesheetInput,
  type SubcontractorAttendanceInput,
  type ValidateTimesheetsInput,
} from '@damina/contracts';
import {
  declareSubcontractorAttendance,
  saveTimesheet,
  validateTimesheets,
} from '@damina/services';
import { revalidatePath } from 'next/cache';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Pontajul (pasul 09, §3.3).
 *
 * Sta separat de `sheet-actions.ts` desi imparte drepturile cu el, pentru ca e
 * scris pe alta unitate de lucru: fisa se salveaza pe UNITATE, pontajul pe
 * (om, zi). Un singur fisier ar fi sugerat ca „salveaza fisa" si „salveaza
 * ziua" sunt aceeasi operatie cu alt nume.
 *
 * Validarea in masa e a biroului si NU e totul-sau-nimic intre zile: fiecare zi
 * are tranzactia ei, iar cele care nu pot fi validate se intorc listate. O
 * saptamana intreaga data inapoi din cauza unei zile fara tarif ar fi lasat
 * omul sa ghiceasca. In interiorul unei zile, insa, orele si costul lor nu se
 * despart niciodata.
 */

const WRITE_DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message: 'Rolul tău nu poate scrie pontaje.',
};

export async function saveTimesheetAction(
  raw: unknown,
): Promise<ActionResult<{ readonly id: string; readonly totalHours: string }>> {
  const session = await requireSession();
  if (!canWriteSheets(session)) {
    return WRITE_DENIED;
  }

  const run = createAction({
    schema: saveTimesheetInputSchema,
    run: async (actor, _values, rawInput) => {
      const saved = await saveTimesheet(actor, rawInput as SaveTimesheetInput);
      return { id: saved.id, totalHours: saved.totalHours.toDbString() };
    },
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Validarea saptamanii. Rezultatul spune si cate au picat, si de ce —
 * ecranul le arata, nu le ascunde intr-un „au fost validate 37 de pontaje".
 */
export async function validateTimesheetsAction(raw: unknown): Promise<
  ActionResult<{
    readonly validated: number;
    readonly costLines: number;
    readonly failures: readonly string[];
  }>
> {
  const session = await requireSession();
  if (!canValidateSheets(session)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message:
        'Validarea îngheață tariful și produce costuri. E a biroului — pontajele completate se trimit mai departe.',
    };
  }

  const run = createAction({
    schema: validateTimesheetsInputSchema,
    run: (actor, _values, rawInput) =>
      validateTimesheets(actor, rawInput as ValidateTimesheetsInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Prezenta subcontractantului: **instrument de control, nu de plata**.
 *
 * Nu produce nicio linie de cost, si nici n-are unde — tabela n-are tarif.
 * Subcontractantul se plateste pe situatie de lucrari; cifra asta e cea cu care
 * se confrunta ea.
 */
export async function declareAttendanceAction(
  raw: unknown,
): Promise<ActionResult<{ readonly id: string }>> {
  const session = await requireSession();
  if (!canWriteSheets(session)) {
    return WRITE_DENIED;
  }

  const run = createAction({
    schema: subcontractorAttendanceInputSchema,
    run: (actor, _values, rawInput) =>
      declareSubcontractorAttendance(actor, rawInput as SubcontractorAttendanceInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}
