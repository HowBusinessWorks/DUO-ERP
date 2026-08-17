import { actorFor, can, grantsCapability, requireMfa } from '@damina/auth';
import { officeRolesInputSchema } from '@damina/contracts';
import { getPerson, revokeSessions, setOfficeRoles } from '@damina/services';
import { AppError } from '@damina/shared';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { getSession } from '../../../../lib/session';
import { statusForError } from '../service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/roles — salveaza rolurile de birou ale unei persoane si, cand
 * e cazul, ii inchide sesiunile pe loc.
 *
 * ── De ce nu mai e server action ────────────────────────────────────────────
 *
 * La 02d, salvarea rolurilor era un server action, si comentariul de langa el
 * spunea deschis ce lipseste: „pentru omul VIZAT, schimbarea se vede abia la
 * urmatorul refresh de token”. Verificarea #18 cere exact contrariul:
 * retragerea accesului la preturi taie sesiunea imediat.
 *
 * Cand s-a luat decizia, motivul mutarii era ca taierea cere Admin API, deci
 * cheia de service, deci o ruta (§4 regula 6). S-a dovedit ca Admin API-ul nu
 * poate deconecta pe cineva dupa id — vezi `revokeSessions` din servicii si
 * migrarea 0015 — asa ca ruta nu mai e o necesitate tehnica. A RAMAS pentru ca
 * e o singura usa: aici se calculeaza ce drept s-a pierdut si aici se taie
 * sesiunea, intr-un singur loc pe care il poti citi cap-coada.
 *
 * Actiunea veche a fost STEARSA, nu lasata langa. Doua usi catre aceeasi
 * operatie, din care una nu revoca nimic, ar fi insemnat ca securitatea
 * depinde de care din ele nimereste urmatorul ecran.
 *
 * ── Ce declanseaza revocarea ────────────────────────────────────────────────
 *
 * Nu orice schimbare de roluri, ci PIERDEREA unui drept care da acces la bani.
 * Cine primeste roluri in plus poate astepta linistit refresh-ul de token: un
 * drept care apare cu intarziere e o neplacere, unul care dispare cu intarziere
 * e o scurgere.
 *
 * Intrebarea „vedea preturi?” se pune matricei din `@damina/auth`, de doua ori
 * — o data pe rolurile vechi, o data pe cele noi. Daca ar fi fost o lista de
 * roluri scrisa aici, ar fi ramas in urma la prima schimbare a matricei.
 */

/** Dreptul a carui pierdere taie sesiunea. §3.5: „retragerea accesului la preturi”. */
const GUARDED = 'financials.read' as const;

interface RolesResponse {
  readonly id: string;
  /** Cate sesiuni s-au inchis. `0` = n-avea niciuna, sau n-a fost cazul. */
  readonly revoked: number;
  /**
   * Ce sa mai spuna ecranul, pe langa „salvat”.
   *
   * Il scrie ruta, nu componenta: doar aici se stie daca s-a revocat ceva si de
   * ce. O componenta generica de casute n-are de unde afla, si nici n-ar trebui
   * sa ghiceasca.
   */
  readonly notice?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (session === null) {
    return NextResponse.json({ message: 'Nu ești autentificat.' }, { status: 401 });
  }
  if (!can(session, 'admin.users')) {
    return NextResponse.json(
      { message: 'Rolul tău nu administrează utilizatori și drepturi.' },
      { status: 403 },
    );
  }

  const parsed = officeRolesInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: 'Cerere invalidă.' }, { status: 400 });
  }

  const actor = actorFor(session, 'modificare roluri de birou');

  try {
    // Poarta celui de-al doilea factor: middleware-ul nu redirecteaza `/api`
    // (un `fetch` n-are ce face cu un redirect spre HTML), deci se aplica aici.
    requireMfa(session);

    const before = await getPerson(actor, parsed.data.personId);
    const sawPrices = grantsCapability(before.persona, before.officeRoles, GUARDED);

    await setOfficeRoles(actor, parsed.data);

    const seesPrices = grantsCapability(before.persona, parsed.data.roles, GUARDED);
    const revoked = sawPrices && !seesPrices ? await revokeSessions(actor, before.id) : 0;

    // Rolurile schimba ce module apar in sidebar si ce tab-uri exista, deci
    // invalidarea e pe tot layout-ul.
    revalidatePath('/', 'layout');

    const body: RolesResponse = {
      id: before.id,
      revoked,
      ...(revoked > 0
        ? {
            notice: `${before.fullName} a pierdut accesul la valori, așa că i-am închis ${revoked === 1 ? 'sesiunea' : `cele ${revoked} sesiuni`}. Următoarea lui cerere cere login din nou.`,
          }
        : {}),
    };
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (AppError.is(error)) {
      return NextResponse.json({ message: error.message }, { status: statusForError(error.code) });
    }
    throw error;
  }
}
