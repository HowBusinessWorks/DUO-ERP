'use server';

import { canValidateSheets, canWriteSheets } from '@damina/auth';
import {
  createInspectionInputSchema,
  saveInspectionInputSchema,
  saveInterventionInputSchema,
  validateInspectionInputSchema,
  validateInterventionInputSchema,
  type CreateInspectionInput,
  type SaveInspectionInput,
  type SaveInterventionInput,
  type ValidateInspectionInput,
  type ValidateInterventionInput,
} from '@damina/contracts';
import {
  createInspection,
  saveInspection,
  saveIntervention,
  validateInspection,
  validateIntervention,
} from '@damina/services';
import { revalidatePath } from 'next/cache';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Scrierile fiselor de lucru (pasul 09b).
 *
 * Doua drepturi, nu unul, si diferenta dintre ele e diferenta dintre a scrie si
 * a plati: `sheets.write` completeaza fisa — o poate avea si terenul —, iar
 * `sheets.validate` o inchide, seteaza luna de raportare si, la interventie,
 * produce cost si misca stoc. De aceea a doua nu se poate ajunge prin prima.
 *
 * Nicio regula de fond nu traieste aici. „Fiecare NOK are iesire" e un trigger
 * din 0026; ecranul o anticipeaza cu `check`-ul intors de `getInspectionSheet`,
 * iar daca cele doua se despart vreodata, baza castiga si fisa nu se valideaza.
 */

const WRITE_DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message: 'Rolul tău nu poate completa fișe de lucru.',
};

const VALIDATE_DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message:
    'Validarea setează luna de raportare și produce costuri. Rolul tău nu o poate face — ' +
    'fișa se trimite la birou completată.',
};

/**
 * Deschiderea unei inspectii.
 *
 * `checklistId` nu e o alegere libera: serviciul verifica ca fisa aleasa e din
 * profilul legaturii contract–obiectiv. Ecranul ofera doar ce a primit din
 * `checklistsForContractObjective`, deci lista si verificarea citesc aceeasi
 * sursa.
 */
export async function createInspectionAction(
  raw: unknown,
): Promise<ActionResult<{ readonly id: string; readonly code: string }>> {
  const session = await requireSession();
  if (!canWriteSheets(session)) {
    return WRITE_DENIED;
  }

  const run = createAction({
    schema: createInspectionInputSchema,
    run: async (actor, _values, rawInput) => {
      const created = await createInspection(actor, rawInput as CreateInspectionInput);
      return { id: created.id, code: created.code };
    },
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Salvarea raspunsurilor. Se trimite fisa INTREAGA, nu punctul modificat.
 *
 * `saveInspection` sterge si rescrie raspunsurile intr-o tranzactie, cu
 * constatarile lor; o actiune „salveaza punctul 7" ar fi lasat fisa si iesirile
 * ei nesincronizate exact in secunda in care cade reteaua pe teren.
 */
export async function saveInspectionAction(raw: unknown): Promise<
  ActionResult<{
    readonly createdRequestIds: readonly string[];
    readonly createdProposalIds: readonly string[];
  }>
> {
  const session = await requireSession();
  if (!canWriteSheets(session)) {
    return WRITE_DENIED;
  }

  const run = createAction({
    schema: saveInspectionInputSchema,
    run: (actor, _values, rawInput) => saveInspection(actor, rawInput as SaveInspectionInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/** Validarea de birou: aici — si numai aici — se seteaza `effect_date`. */
export async function validateInspectionAction(
  raw: unknown,
): Promise<ActionResult<{ readonly effectDate: string }>> {
  const session = await requireSession();
  if (!canValidateSheets(session)) {
    return VALIDATE_DENIED;
  }

  const run = createAction({
    schema: validateInspectionInputSchema,
    run: (actor, _values, rawInput) =>
      validateInspection(actor, rawInput as ValidateInspectionInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

// ── Interventia ──────────────────────────────────────────────────────────────

/**
 * Completarea fisei de interventie: materiale, ore, descriere.
 *
 * Se trimite fisa INTREAGA, ca la inspectie, si din acelasi motiv: serviciul
 * sterge si rescrie liniile intr-o tranzactie. De aceea si ecranul e o singura
 * componenta cu trei sectiuni — tab-ul Materiale si tab-ul Ore trimit amandoua
 * tot ce e pe fisa, nu doar partea lor. O actiune „salveaza doar materialele"
 * ar fi sters orele omului care era pe celalalt tab.
 */
export async function saveInterventionAction(
  raw: unknown,
): Promise<ActionResult<{ readonly materials: number; readonly hours: number }>> {
  const session = await requireSession();
  if (!canWriteSheets(session)) {
    return WRITE_DENIED;
  }

  const run = createAction({
    schema: saveInterventionInputSchema,
    run: (actor, _values, rawInput) => saveIntervention(actor, rawInput as SaveInterventionInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Validarea de birou. Aici se intampla tot ce costa bani, intr-o tranzactie:
 * bonul de consum, miscarile de stoc, liniile de cost si `operation_actuals`.
 *
 * Rezultatul se intoarce ca text, nu ca `Money`: valorile nu trec granita
 * server→client ca obiecte.
 */
export async function validateInterventionAction(raw: unknown): Promise<
  ActionResult<{
    readonly consumptionNoteNumber: string | null;
    readonly realCost: string;
    readonly variancePct: string | null;
    readonly flagged: boolean;
  }>
> {
  const session = await requireSession();
  if (!canValidateSheets(session)) {
    return VALIDATE_DENIED;
  }

  const run = createAction({
    schema: validateInterventionInputSchema,
    run: async (actor, _values, rawInput) => {
      const result = await validateIntervention(actor, rawInput as ValidateInterventionInput);
      return {
        consumptionNoteNumber: result.consumptionNoteNumber,
        realCost: result.realCost.toDbString(),
        variancePct: result.variancePct,
        flagged: result.flagged,
      };
    },
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}
