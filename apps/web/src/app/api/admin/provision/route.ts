import { randomBytes } from 'node:crypto';
import { actorFor, can } from '@damina/auth';
import { provisionAccountInputSchema } from '@damina/contracts';
import { getPerson, linkAuthUser } from '@damina/services';
import { AppError } from '@damina/shared';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/provision — creeaza contul de login al unei persoane.
 *
 * ── De ce e ruta si nu server action ────────────────────────────────────────
 *
 * Regula 6 din §4 al pasului 02: `SUPABASE_SERVICE_ROLE_KEY` traieste doar in
 * worker si in rute `/api` dedicate. Tehnic, un server action ar fi tot cod de
 * server si ar fi mers la fel de bine — dar regula nu e despre unde se executa,
 * e despre unde se poate CAUTA. Cu cheia intr-un singur fisier, `grep` peste
 * `apps/web` da un raspuns complet la „cine o atinge”; cu ea intr-un server
 * action, urmatorul care are nevoie de Admin API o va importa in al doilea, si
 * al treilea, si nimeni n-o sa mai stie cate locuri sunt.
 *
 * Decizia s-a luat inainte de prima linie de cod a lui 02d (17 august 2026),
 * pentru ca era singurul conflict real dintre pas si ecranul lui.
 *
 * ── Parola ───────────────────────────────────────────────────────────────────
 *
 * Se genereaza aici, se intoarce O SINGURA DATA in raspuns si nu se scrie
 * nicaieri — nici in baza, nici in log. Refresh-ul paginii nu o mai arata
 * (verificarea #17). Persoana ramane cu `must_change_password = true`, deci
 * primul lucru pe care il face omul e sa o inlocuiasca.
 */

interface ProvisionResponse {
  readonly email: string;
  readonly password: string;
}

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || url === '' || key === undefined || key === '') {
    throw new AppError(
      'VALIDATION_FAILED',
      'Provizionarea de conturi cere SUPABASE_SERVICE_ROLE_KEY în .env.local. Cheia se ia din Supabase → Project Settings → API.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Parola temporara: 18 octeti random, base64url.
 *
 * Peste minimul de 12 caractere din politica (§3.5) cu o margine confortabila,
 * si fara caractere care se pierd cand omul o copiaza dintr-un chat.
 */
function temporaryPassword(): string {
  return `Damina-${randomBytes(18).toString('base64url')}`;
}

async function findByEmail(supabase: SupabaseClient, email: string): Promise<User | null> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error !== null) {
    // Nu e `AppError`: o eroare de retea catre GoTrue nu e o stare de business,
    // deci merita 500 si un rand in log, nu un mesaj sub camp.
    throw new Error(`Nu am putut citi lista de conturi: ${error.message}`);
  }
  return data.users.find((candidate) => candidate.email?.toLowerCase() === email) ?? null;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (session === null) {
    return NextResponse.json({ message: 'Nu ești autentificat.' }, { status: 401 });
  }

  // Guard-ul e AL DOILEA strat, ca peste tot: politicile de pe `app.persons`
  // refuza oricum scrierea. Rolul lui e sa dea un 403 citibil in loc de 42501.
  if (!can(session, 'admin.users')) {
    return NextResponse.json(
      { message: 'Rolul tău nu poate crea conturi de utilizator.' },
      { status: 403 },
    );
  }

  const parsed = provisionAccountInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: 'Cerere invalidă.' }, { status: 400 });
  }

  const actor = actorFor(session, 'provizionare cont');

  try {
    const person = await getPerson(actor, parsed.data.personId);

    if (person.email === null) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Persoana n-are adresă de email. Completeaz-o întâi în fișa ei — pe ea se face login-ul.',
      );
    }
    if (person.authUserId !== null) {
      throw new AppError('CONFLICT', 'Persoana are deja cont. Parola se schimbă prin resetare.');
    }
    if (!person.isActive) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Persoana e dezactivată. Un cont creat acum n-ar putea intra oricum în aplicație.',
      );
    }

    const supabase = serviceClient();
    const password = temporaryPassword();

    const created = await supabase.auth.admin.createUser({
      email: person.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: person.fullName },
    });

    // Un cont poate exista deja in GoTrue fara sa fie legat de nicio persoana —
    // cazul unui om sters si reintrodus. Il legam, dar NU-i schimbam parola:
    // altfel ecranul asta ar deveni o unealta de preluat conturi existente.
    const authUser = created.data.user ?? (await findByEmail(supabase, person.email));
    if (authUser === null) {
      throw new Error(`Contul nu a putut fi creat: ${created.error?.message ?? 'motiv necunoscut'}`);
    }

    await linkAuthUser(actor, person.id, authUser.id);

    if (created.data.user === null) {
      throw new AppError(
        'CONFLICT',
        `Exista deja un cont pe adresa ${person.email}; l-am legat de persoană, dar parola a rămas cea veche. Folosește „Am uitat parola” de pe ecranul de login.`,
      );
    }

    const body: ProvisionResponse = { email: person.email, password };
    // `no-store` explicit: raspunsul contine o parola in clar, o singura data.
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (AppError.is(error)) {
      const status = error.code === 'CONFLICT' ? 409 : error.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ message: error.message }, { status });
    }
    throw error;
  }
}
