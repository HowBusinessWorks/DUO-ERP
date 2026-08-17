import { actorFor, can, requireMfa } from '@damina/auth';
import { accountActionInputSchema } from '@damina/contracts';
import { getPerson, revokeSessions } from '@damina/services';
import { AppError } from '@damina/shared';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/session';
import { resetMfaFactors, serviceClient, statusForError } from '../service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/account — operatiile pe contul de login al altcuiva.
 *
 * Doua actiuni, amandoua pentru zile proaste:
 *
 *   `revoke`     — il scoate afara acum, din toate sesiunile. Concediat, plecat,
 *                  laptop pierdut. Revocarea automata de la retragerea
 *                  accesului la preturi (#18) traieste in `/api/admin/roles`;
 *                  asta e maneta pe care o tragi cand motivul nu e un rol.
 *
 *   `mfa-reset`  — ii sterge factorii TOTP, pentru cand si-a schimbat telefonul
 *                  si nu mai poate intra deloc. Sterge SI sesiunile: un factor
 *                  scos in timp ce omul are o sesiune `aal2` deschisa i-ar
 *                  lasa-o valida pana la expirare, adica exact ce nu vrei cand
 *                  motivul resetarii e un telefon pierdut.
 *
 * `mfa-reset` chema Admin API-ul GoTrue, deci cheia de service, deci o ruta (§4
 * regula 6). `revoke` n-ar mai avea nevoie de ea — sesiunile se inchid din baza,
 * prin `app.revoke_sessions` (0015) — dar sta aici pentru ca e aceeasi operatie
 * vazuta din alt unghi: „scoate-l afara”. Doua usi pentru asta ar fi doua locuri
 * de citit cand cineva intreaba ce s-a intamplat.
 *
 * Ce NU face ruta: nu se poate aplica siesi. Un administrator care isi reseteaza
 * propriul factor ar ocoli tocmai obligatia pe care i-o impune rolul — ar fi o
 * usa din dos catre `aal1`, deschisa de cel care trebuia sa o pazeasca.
 */

interface AccountResponse {
  readonly id: string;
  /** Cate sesiuni s-au inchis. `0` cand nu avea niciuna deschisa. */
  readonly revoked: number;
  /** Cati factori s-au sters. `0` la `revoke`, si la un cont fara TOTP. */
  readonly factorsRemoved: number;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (session === null) {
    return NextResponse.json({ message: 'Nu ești autentificat.' }, { status: 401 });
  }
  if (!can(session, 'admin.users')) {
    return NextResponse.json(
      { message: 'Rolul tău nu administrează conturi de utilizator.' },
      { status: 403 },
    );
  }

  const parsed = accountActionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: 'Cerere invalidă.' }, { status: 400 });
  }

  const { personId, action } = parsed.data;
  const actor = actorFor(
    session,
    action === 'revoke' ? 'închidere de sesiuni' : 'resetare verificare în doi pași',
  );

  try {
    // Poarta celui de-al doilea factor: middleware-ul nu redirecteaza `/api`
    // (un `fetch` n-are ce face cu un redirect spre HTML), deci se aplica aici.
    requireMfa(session);

    if (personId === session.personId) {
      throw AppError.forbidden(
        action === 'revoke'
          ? 'Pe tine te scoate afară butonul „Ieși din cont”, nu ecranul de administrare.'
          : 'Nu-ți poți reseta singur verificarea în doi pași. Cere-i altui administrator.',
      );
    }

    const person = await getPerson(actor, personId);
    if (person.authUserId === null) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Persoana n-are cont de login, deci n-are nici sesiuni, nici verificare în doi pași.',
      );
    }

    /*
     * Ordinea: intai factorii, apoi sesiunile.
     *
     * Invers, omul ar putea fi scos afara si sa se logheze din nou, cu factorul
     * inca intreg, exact in fereastra dintre cele doua apeluri — si ar rezulta o
     * sesiune noua cu un factor pe care tocmai il stergem.
     */
    const factorsRemoved =
      action === 'mfa-reset' ? await resetMfaFactors(serviceClient(), person.authUserId) : 0;
    const revoked = await revokeSessions(actor, person.id);

    revalidatePath('/', 'layout');

    const body: AccountResponse = { id: person.id, revoked, factorsRemoved };
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (AppError.is(error)) {
      return NextResponse.json({ message: error.message }, { status: statusForError(error.code) });
    }
    throw error;
  }
}
