import { roRO } from '@damina/i18n';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LOGIN_PATH } from '../../../lib/personas';
import { getSession } from '../../../lib/session';
import { ChangePasswordForm } from '../forms';

export const metadata: Metadata = { title: roRO.auth.changeTitle };
export const dynamic = 'force-dynamic';

/**
 * Prima parola, si schimbarea ei ulterioara (verificarea #15).
 *
 * Ecranul cere sesiune — se ajunge aici fie fortat de middleware dupa un login
 * cu parola temporara, fie prin linkul de resetare, care creeaza si el o
 * sesiune. Fara sesiune n-ar avea pe cine sa schimbe.
 */
export default async function ChangePasswordPage() {
  const session = await getSession();
  if (session === null) {
    redirect(LOGIN_PATH);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{roRO.auth.changeTitle}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {session.mustChangePassword ? roRO.auth.changeBodyForced : roRO.auth.changeBody}
        </p>
      </div>

      <ChangePasswordForm />
    </div>
  );
}
