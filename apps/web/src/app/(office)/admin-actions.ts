'use server';

import { can } from '@damina/auth';
import { companyAccessInputSchema } from '@damina/contracts';
import { setCompanyAccess } from '@damina/services';
import { revalidatePath } from 'next/cache';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Accesul pe firme (pasul 02d).
 *
 * ── Ce NU mai e aici ────────────────────────────────────────────────────────
 *
 * Nici provizionarea contului, nici ROLURILE. Amandoua au ajuns in rute `/api`
 * pentru ca amandoua cheama Admin API-ul GoTrue, deci cheia de service (§4
 * regula 6): `/api/admin/provision`, respectiv `/api/admin/roles`.
 *
 * Rolurile au plecat la 02c′, cand verificarea #18 a cerut ca retragerea
 * accesului la preturi sa taie sesiunea pe loc. Actiunea veche a fost STEARSA,
 * nu lasata langa ruta: doua usi catre aceeasi operatie, din care una nu revoca
 * nimic, ar fi facut ca securitatea sa depinda de care din ele nimereste
 * urmatorul ecran.
 *
 * Accesul pe firme a ramas server action pentru ca schimba doar randuri
 * vizibile, nu coloane de bani: filtrarea pe firme e in RLS si se aplica la
 * urmatoarea interogare, nu asteapta un token nou.
 *
 * Setul se trimite complet, nu ca diferenta: ecranul arata casute, iar ce se
 * salveaza e starea lor. O actiune de tip „adauga firma X” ar fi cerut ca
 * ecranul sa calculeze diferenta — adica un al doilea loc care poate gresi, si
 * o cursa cand doi administratori au ecranul deschis in acelasi timp.
 *
 * Motivul scris e fix, nu cerut de la om: baza il cere la `update` si `delete`,
 * dar aici operatia e „am pus firmele pe care le vezi”, iar contextul util —
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
