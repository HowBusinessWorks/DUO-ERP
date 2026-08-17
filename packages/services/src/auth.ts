import { type Actor, withActor } from '@damina/db';
import { sql } from 'drizzle-orm';

/**
 * Ce ramane de facut in baza dupa ce GoTrue a schimbat parola.
 *
 * Schimbarea propriu-zisa e treaba lui Supabase Auth — parolele nu trec
 * niciodata prin baza noastra. Ce trece e consecinta ei: flagul
 * `must_change_password`, care tine omul blocat pe ecranul de schimbare.
 *
 * Se cheama prin `app.clear_must_change_password()` (migrarea 0013), care
 * schimba exact o coloana pe randul apelantului. Serviciul nu face `update`
 * direct pentru ca politicile din 0011 nu i-ar da voie — si nici n-ar trebui:
 * un rol care poate scrie in propria fisa de persoana poate incerca si alte
 * coloane decat cea din formular.
 */
export async function clearMustChangePassword(actor: Actor): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.execute(sql`select app.clear_must_change_password()`);
  });
}
