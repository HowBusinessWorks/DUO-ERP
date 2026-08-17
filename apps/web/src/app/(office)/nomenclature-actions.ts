'use server';

import {
  clientInputSchema,
  contractInputSchema,
  objectiveInputSchema,
  personInputSchema,
  productInputSchema,
  qualificationInputSchema,
  rateCardInputSchema,
  subcontractorInputSchema,
  supplierInputSchema,
  workUnitFormSchema,
} from '@damina/contracts';
import { can, canEditNomenclature, canSeeFinancials } from '@damina/auth';
import {
  createClient,
  createPerson,
  updatePerson,
  createContract,
  createObjective,
  createProduct,
  createQualification,
  createWorkUnitFromForm,
  createRateCard,
  createSubcontractor,
  createSupplier,
  updateClient,
  updateContract,
  updateObjective,
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
  /** Motivul scris pentru UPDATE. Baza il cere; ecranul il declara aici. */
  readonly updateReason?: string;
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
  // Contractul poarta valoare, indexare si prag de Delta — deci dreptul e cel
  // financiar, nu cel de nomenclator. Un PM fara drept financiar deschide
  // contractul si nu-i vede coloanele comerciale (izolarea e pe coloana, in
  // baza); aici i se refuza si scrierea, inainte sa ajunga la ea.
  contracte: {
    schema: contractInputSchema,
    create: createContract as Writer['create'],
    update: updateContract as NonNullable<Writer['update']>,
    canWrite: canSeeFinancials,
    updateReason: 'modificare contract',
  },
  // Persoanele nu sunt nomenclator: ele decid cine intra in aplicatie. Dreptul e
  // `admin.users`, nu cel de nomenclator — un devizist poate adauga un produs,
  // dar nu si un om caruia sa i se dea apoi cont.
  administrare: {
    schema: personInputSchema,
    create: createPerson as Writer['create'],
    update: updatePerson as NonNullable<Writer['update']>,
    canWrite: (session) => can(session, 'admin.users'),
    updateReason: 'modificare persoana',
  },
  /*
   * Activitatea: inspectii, interventii, lucrari.
   *
   * `create` merge prin `createWorkUnitFromForm`, care compune formularul plat in
   * use-case-ul complet — o singura tranzactie cu cod din serie si finantare. Nu
   * exista `update`: codul se aloca o data, iar finantarea se MUTA, cu motiv
   * scris, din ecranul ei. Un `update` de aici ar fi a doua usa spre aceleasi
   * coloane, fara motiv si fara mecanica de luna inchisa.
   */
  activitate: {
    schema: workUnitFormSchema,
    create: createWorkUnitFromForm as Writer['create'],
    canWrite: canSeeFinancials,
  },
  // Obiectivele NU au `company_id`: sunt nomenclator comun celor 5 firme.
  obiective: {
    schema: objectiveInputSchema,
    create: createObjective as Writer['create'],
    update: updateObjective as NonNullable<Writer['update']>,
    canWrite: canEditNomenclature,
    updateReason: 'modificare obiectiv',
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
      message: 'Rolul tău nu poate modifica înregistrările din acest modul.',
    };
  }

  const run = createAction({
    schema: writer.schema,
    reason: id === null ? undefined : (writer.updateReason ?? 'editare nomenclator'),
    // Serviciile primesc valoarea BRUTA, nu cea deja transformata: ele o
    // parseaza cu aceeasi schema, iar o valoare trecuta o data prin transformari
    // (`'' → null`) nu mai trece a doua oara.
    run: async (actor, _values, rawInput) => {
      if (id === null) {
        return writer.create(actor, rawInput as never);
      }
      if (writer.update === undefined) {
        throw new AppError('FORBIDDEN', 'Înregistrările din acest modul nu se modifică.');
      }
      return writer.update(actor, id, rawInput as never);
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
