import { requiresMfa } from '@damina/auth';
import { roRO } from '@damina/i18n';
import { Banner } from '@damina/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { homeFor, LOGIN_PATH } from '../../../lib/personas';
import { getSession } from '../../../lib/session';
import { mfaState } from '../mfa';
import { MfaChallengeForm, MfaEnrollForm } from '../mfa-forms';

export const metadata: Metadata = { title: roRO.mfa.title };
export const dynamic = 'force-dynamic';

/**
 * Verificarea in doi pasi (§3.5, verificarea #16).
 *
 * Ecranul serveste doua momente diferite, si stie singur in care e:
 *
 *   - PRIMUL login al unui `admin` sau `financiar`, cand nu are inca niciun
 *     factor: ii arata codul QR si il pune sa-l confirme. Nu se poate sari
 *     peste — middleware-ul il aduce inapoi aici din orice ruta;
 *   - fiecare login ulterior, cand are factor confirmat dar sesiunea e `aal1`:
 *     ii cere doar codul.
 *
 * Diferenta n-o poate spune token-ul — el stie doar `aal1`/`aal2`, adica daca
 * s-a dovedit ACUM, nu daca are cu ce. Se afla de la GoTrue, si se afla aici,
 * o singura data pe deschidere de ecran, nu in middleware, care ruleaza la
 * fiecare cerere.
 *
 * Cine nu e obligat poate ajunge totusi pe ruta, scriind-o de mana. Nu-l
 * refuzam: al doilea factor e binevenit de la oricine, iar un `pm` care si-l
 * pune singur nu e o problema de rezolvat.
 */
export default async function TwoStepPage() {
  const session = await getSession();
  if (session === null) {
    redirect(LOGIN_PATH);
  }

  // Si-a dovedit deja factorul in sesiunea asta: n-are ce cauta pe un ecran de
  // verificare. Il ducem la lucru, nu il punem sa confirme inca o data.
  if (session.aal === 'aal2') {
    redirect(homeFor(session.persona));
  }

  const state = await mfaState();
  const mandatory = requiresMfa(session);

  if (state.kind === 'failed') {
    return (
      <div className="flex flex-col gap-5">
        <Header />
        <Banner tone="danger" title={roRO.mfa.enrollFailed} dense className="rounded-md border" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Header />

      <p className="text-sm text-ink-muted">
        {state.kind === 'enroll'
          ? mandatory
            ? roRO.mfa.enrollBody
            : // Cine nu e obligat merita alt ton: n-a fost trimis aici, a venit.
              'Poți lega o aplicație de autentificare de contul tău. Rolul tău n-o cere, dar o parolă singură e o parolă singură.'
          : roRO.mfa.challengeBody}
      </p>

      {state.kind === 'enroll' ? (
        <MfaEnrollForm factorId={state.factorId} qrCode={state.qrCode} secret={state.secret} />
      ) : (
        <MfaChallengeForm factorId={state.factorId} />
      )}
    </div>
  );
}

function Header() {
  return <h1 className="text-xl font-semibold text-ink">{roRO.mfa.title}</h1>;
}
