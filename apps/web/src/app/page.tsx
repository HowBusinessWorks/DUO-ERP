import { redirect } from 'next/navigation';
import { homeFor, LOGIN_PATH } from '../lib/personas';
import { getSession } from '../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Radacina duce fiecare persona in spatiul ei (§3.7).
 *
 * In mod normal middleware-ul rezolva `/` inaintea randarii. Pagina asta ramane
 * pentru cazul in care nu o face — pe sesiunea de dezvoltare, unde middleware-ul
 * nu se amesteca deloc.
 */
export default async function RootPage() {
  const session = await getSession();
  redirect(session === null ? LOGIN_PATH : homeFor(session.persona));
}
