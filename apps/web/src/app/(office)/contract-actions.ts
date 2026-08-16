'use server';

import { canSeeFinancials } from '@damina/auth';
import {
  contractObjectiveInputSchema,
  costCeilingInputSchema,
  revenueCeilingInputSchema,
  type ContractObjectiveInput,
  type CostCeilingInput,
  type RevenueCeilingInput,
} from '@damina/contracts';
import {
  linkObjective,
  setCostCeiling,
  setInspectionProfile,
  setRevenueCeiling,
  unlinkObjective,
} from '@damina/services';
import { AppError } from '@damina/shared';
import { revalidatePath } from 'next/cache';
import { createAction, type ActionResult } from '../../lib/action';
import { requireActor, requireSession } from '../../lib/session';

/**
 * Scrierile de pe ecranul de contract.
 *
 * Sunt separate de `nomenclature-actions` pentru un motiv care nu e de
 * organizare: **fiecare dintre ele cere un motiv scris**. Un plafon, o legatura
 * inchisa si un profil schimbat mut a bani intre luni si intre contracte; cine
 * le atinge trebuie sa poata fi intrebat peste sase luni de ce a facut-o.
 *
 * Motivul nu e decor: ajunge in `audit.entries` prin `withActor`, iar baza
 * refuza `UPDATE`-ul fara el (decizia din 02a).
 */

const FINANCIAL_DENIED = {
  ok: false as const,
  code: 'FORBIDDEN',
  message: 'Plafoanele conțin valori comerciale. Rolul tău nu le poate modifica.',
};

/**
 * Plafon de COST — mentenanta, lucrari, individual.
 *
 * Doua actiuni, nu una cu un `kind`. Regula 1 a pasului spune ca cele trei
 * numere nu se amesteca niciodata, si asta incepe de la punctul in care intra in
 * sistem: nu exista niciun apel prin care sa ajunga un plafon de cost pe Delta.
 */
export async function saveCostCeiling(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!canSeeFinancials(session)) {
    return FINANCIAL_DENIED;
  }

  const run = createAction({
    schema: costCeilingInputSchema,
    // `setCostCeiling` isi parseaza singur intrarea si isi pune singur motivul
    // pe actor, din `reason` — de aceea primeste valoarea bruta, nu cea deja
    // transformata de schema.
    run: (actor, _values, rawInput) => setCostCeiling(actor, rawInput as CostCeilingInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/** Plafon de VENIT — doar Delta. Se umple; ce ramane neumplut se pierde. */
export async function saveRevenueCeiling(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!canSeeFinancials(session)) {
    return FINANCIAL_DENIED;
  }

  const run = createAction({
    schema: revenueCeilingInputSchema,
    run: (actor, _values, rawInput) => setRevenueCeiling(actor, rawInput as RevenueCeilingInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/** Leaga un obiectiv de contract. Suprapunerea pe acelasi contract e refuzata. */
export async function saveObjectiveLink(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const run = createAction({
    schema: contractObjectiveInputSchema,
    run: (actor, _values, rawInput) => linkObjective(actor, rawInput as ContractObjectiveInput),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}

/**
 * Scoate obiectivul din contract, la o data, cu motiv.
 *
 * Nu se sterge randul: istoricul obiectivului trebuie sa arate ca a fost acolo,
 * chiar si dupa ce finantarea s-a mutat. Se inchide intervalul.
 */
export async function closeObjectiveLink(
  linkId: string,
  validTo: string,
  reason: string,
): Promise<ActionResult<{ id: string }>> {
  return guarded(reason, 'Scoaterea unui obiectiv din contract cere un motiv scris.', async () =>
    unlinkObjective(await requireActor(reason), linkId, validTo, reason),
  );
}

/** Schimba profilul de inspectie AL LEGATURII, nu al obiectivului (regula 3). */
export async function changeInspectionProfile(
  linkId: string,
  profileId: string | null,
  reason: string,
): Promise<ActionResult<{ id: string }>> {
  return guarded(reason, 'Schimbarea profilului de inspecție cere un motiv scris.', async () =>
    setInspectionProfile(await requireActor(reason), linkId, profileId, reason),
  );
}

/**
 * Invelisul mutatiilor care nu au schema Zod proprie (argumente, nu formular).
 *
 * Verifica motivul inainte de a atinge baza, ca omul sa afle din formular, nu
 * din eroarea triggerului — dar baza ramane cea care decide, nu ecranul.
 */
async function guarded(
  reason: string,
  missingReasonMessage: string,
  run: () => Promise<{ id: string }>,
): Promise<ActionResult<{ id: string }>> {
  if (reason.trim() === '') {
    return { ok: false, code: 'VALIDATION_FAILED', message: missingReasonMessage };
  }
  try {
    const data = await run();
    revalidatePath('/', 'layout');
    return { ok: true, data };
  } catch (error) {
    if (AppError.is(error)) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}
