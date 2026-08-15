'use server';

import {
  clientInputSchema,
  productInputSchema,
  qualificationInputSchema,
  rateCardInputSchema,
  subcontractorInputSchema,
  supplierInputSchema,
} from '@damina/contracts';
import { canEditNomenclature, canSeeFinancials } from '@damina/auth';
import {
  createClient,
  createProduct,
  createQualification,
  createRateCard,
  createSubcontractor,
  createSupplier,
  updateClient,
  updateProduct,
  updateSubcontractor,
  updateSupplier,
} from '@damina/services';
import { AppError } from '@damina/shared';
import type { Actor } from '@damina/auth';
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * O singura server action pentru toate nomenclatoarele.
 *
 * Nu sase actiuni aproape identice: modulul e un parametru, exact ca in
 * registry. Cand pasul 04 adauga contractele, se adauga o linie in `WRITERS`,
 * nu un fisier nou de actiuni.
 *
 * Schema Zod folosita aici e ACEEASI pe care o foloseste formularul in browser.
 * Verificarea din browser exista ca sa raspunda instant; asta de aici e cea care
 * conteaza, pentru ca e singura pe care omul nu o poate ocoli.
 */

interface Writer {
  readonly schema: z.ZodType;
  create(actor: Actor, values: never): Promise<{ id: string }>;
  update?(actor: Actor, id: string, values: never): Promise<{ id: string }>;
  /** Cine are dreptul sa scrie. Tarifele poarta salarii, deci sunt separate. */
  canWrite: typeof canEditNomenclature;
}

const WRITERS: Readonly<Record<string, Writer>> = {
  produse: {
    schema: productInputSchema,
    create: createProduct as Writer['create'],
    update: updateProduct as NonNullable<Writer['update']>,
    canWrite: canEditNomenclature,
  },
  furnizori: {
    schema: supplierInputSchema,
    create: createSupplier as Writer['create'],
    update: updateSupplier as NonNullable<Writer['update']>,
    canWrite: canEditNomenclature,
  },
  clienti: {
    schema: clientInputSchema,
    create: createClient as Writer['create'],
    update: updateClient as NonNullable<Writer['update']>,
    canWrite: canEditNomenclature,
  },
  subcontractanti: {
    schema: subcontractorInputSchema,
    create: createSubcontractor as Writer['create'],
    update: updateSubcontractor as NonNullable<Writer['update']>,
    canWrite: canEditNomenclature,
  },
  calificari: {
    schema: qualificationInputSchema,
    create: createQualification as Writer['create'],
    canWrite: canEditNomenclature,
  },
  // Tarifele nu au `update`, intentionat: un UPDATE ar rescrie retroactiv costul
  // orelor deja pontate, inclusiv al celor din luni inchise.
  tarife: {
    schema: rateCardInputSchema,
    create: createRateCard as Writer['create'],
    canWrite: canSeeFinancials,
  },
};

export async function saveRecord(
  module: string,
  id: string | null,
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  const writer = WRITERS[module];
  if (writer === undefined) {
    return { ok: false, code: 'NOT_FOUND', message: 'Nomenclatorul nu există.' };
  }

  const session = await requireSession();
  if (!writer.canWrite(session)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Rolul tău nu poate modifica acest nomenclator.',
    };
  }

  const run = createAction({
    schema: writer.schema,
    reason: id === null ? undefined : 'editare nomenclator',
    run: async (actor, values) => {
      if (id === null) {
        return writer.create(actor, values as never);
      }
      if (writer.update === undefined) {
        throw new AppError('FORBIDDEN', 'Înregistrările din acest nomenclator nu se modifică.');
      }
      return writer.update(actor, id, values as never);
    },
  });

  const result = await run(raw);
  if (result.ok) {
    // Nomenclatoarele sunt citite din sidebar, din cautare si din listele altor
    // module, deci invalidarea e pe tot layout-ul, nu doar pe pagina curenta.
    revalidatePath('/', 'layout');
  }
  return result;
}
