'use server';

import { can } from '@damina/auth';
import { companyAccessInputSchema, officeRolesInputSchema } from '@damina/contracts';
import { setCompanyAccess, setOfficeRoles } from '@damina/services';
import { revalidatePath } from 'next/cache';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Rolurile si accesul pe firme (pasul 02d).
 *
 * Provizionarea contului NU e aici — ea cere cheia de service si traieste in
 * `/api/admin/provision`, singurul fisier din `apps/web` care o atinge.
 *
 * Ambele actiuni trimit SETUL complet, nu o diferenta: ecranul arata casute, iar
 * ce se salveaza e starea lor. O actiune de tip „adauga rolul X” ar fi cerut ca
 * ecranul sa calculeze diferenta — adica un al doilea loc care poate gresi, si
 * o cursa cand doi administratori au ecranul deschis in acelasi timp.
 *
 * Motivul scris e fix, nu cerut de la om: baza il cere la `update` si `delete`,
 * dar aici operatia e „am pus rolurile pe care le vezi”, iar contextul util —
 * cine, cand, ce a fost inainte — e deja in jurnal. Un camp de motiv la fiecare
 * bifa ar fi produs o mie de randuri cu „actualizare”.
 */

async function guard(): Promise<ActionResult<never> | null> {
  const session = await requireSession();
  if (!can(session, 'admin.users')) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Rolul tău nu administrează utilizatori și drepturi.',
    };
  }
  return null;
}

export async function saveOfficeRoles(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied !== null) {
    return denied;
  }

  const run = createAction({
    schema: officeRolesInputSchema,
    reason: 'modificare roluri de birou',
    run: async (actor, _values, rawInput) => setOfficeRoles(actor, rawInput as never),
  });

  const result = await run(raw);
  if (result.ok) {
    // Rolurile schimba ce module apar in sidebar si ce tab-uri exista, deci
    // invalidarea e pe tot layout-ul. Pentru omul VIZAT insa, schimbarea se
    // vede abia la urmatorul refresh de token — claim-urile sunt in JWT.
    revalidatePath('/', 'layout');
  }
  return result;
}

export async function saveCompanyAccess(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied !== null) {
    return denied;
  }

  const run = createAction({
    schema: companyAccessInputSchema,
    reason: 'modificare acces pe firme',
    run: async (actor, _values, rawInput) => setCompanyAccess(actor, rawInput as never),
  });

  const result = await run(raw);
  if (result.ok) {
    revalidatePath('/', 'layout');
  }
  return result;
}
