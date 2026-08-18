'use server';

import { canWriteInventory } from '@damina/auth';
import { createLocationInputSchema, type CreateLocationInput } from '@damina/contracts';
import { consumptionAnalyticsFor, createConsumptionNote, createLocation } from '@damina/services';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Gestiuni si bonuri de consum (pasul 09, §3.4).
 *
 * Verificarea #16 trece pe aici si trece **negativ**: nu exista drum prin care
 * sa iasa o „gestiune de contract", fiindca `type` e un enum de sapte valori
 * fizice si niciuna nu e asta. Formularul n-o interzice — n-are ce sa ofere.
 */

const DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message: 'Rolul tău nu creează gestiuni și nu emite bonuri de consum.',
};

export async function createLocationAction(
  raw: unknown,
): Promise<ActionResult<{ readonly id: string }>> {
  const session = await requireSession();
  if (!canWriteInventory(session)) {
    return DENIED;
  }

  const run = createAction({
    schema: createLocationInputSchema,
    run: (actor, _values, rawInput) => createLocation(actor, rawInput as CreateLocationInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Bonul manual, din gestiunea echipei.
 *
 * Formularul NU cere contractul, componenta si obiectivul, desi bonul le poarta:
 * ele se deduc din finantarea activa a unitatii de lucru, exact ca la validarea
 * unei interventii. Un camp „din ce contract se scade" pe ecran ar fi fost a
 * doua sursa de adevar pentru cine plateste — si prima care se abate la prima
 * mutare de bani.
 */
const manualNoteSchema = z.object({
  series: z.string().trim().min(1, 'Alege seria bonului.'),
  locationId: z.string().uuid(),
  workUnitId: z.string().uuid('Alege unitatea de lucru — de la ea vine analitica.'),
  stageId: z.string().uuid().or(z.literal('')),
  documentDate: z.string().trim().min(1, 'Pune data bonului.'),
  effectDate: z.string().trim().min(1, 'Pune luna de raportare.'),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        lotId: z.string().uuid().or(z.literal('')),
        quantity: z.string().trim().min(1),
      }),
    )
    .min(1, 'Bonul are nevoie de cel puțin o linie.'),
});

export async function issueConsumptionNoteAction(
  raw: unknown,
): Promise<ActionResult<{ readonly number: string; readonly total: string }>> {
  const session = await requireSession();
  if (!canWriteInventory(session)) {
    return DENIED;
  }

  const run = createAction({
    schema: manualNoteSchema,
    run: async (actor, values) => {
      const analytics = await consumptionAnalyticsFor(actor, values.workUnitId);
      const note = await createConsumptionNote(actor, {
        companyId: analytics.companyId,
        series: values.series,
        locationId: values.locationId,
        workUnitId: values.workUnitId,
        stageId: values.stageId,
        contractId: analytics.contractId,
        componentId: analytics.componentId,
        objectiveId: analytics.objectiveId,
        documentDate: values.documentDate,
        effectDate: values.effectDate,
        lines: values.lines,
      });
      return { number: note.number, total: note.total.toDbString() };
    },
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}
