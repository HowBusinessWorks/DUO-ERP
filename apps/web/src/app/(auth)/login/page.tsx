import { roRO } from '@damina/i18n';
import { Banner } from '@damina/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionOrReason } from '../../../lib/session';
import { SignInForm } from '../forms';

export const metadata: Metadata = { title: roRO.auth.signInTitle };
export const dynamic = 'force-dynamic';

/**
 * Ecranul de login (verificarile #12–#14).
 *
 * Cand cineva ajunge aici DESI e autentificat, inseamna ca token-ul lui e bun
 * dar sesiunea de aplicatie nu se poate construi. Sunt trei cazuri complet
 * diferite — cont nelegat, persoana dezactivata, hook neactivat in proiect — si
 * fiecare se rezolva de altcineva, in alta parte. Un singur „nu poți intra” i-ar
 * trimite pe toti la aceeasi persoana, care in doua din trei cazuri n-are ce
 * face.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const state = await getSessionOrReason();

  const rejection =
    state.session === null && state.reason !== null
      ? {
          unlinked: roRO.auth.unlinked,
          inactive: roRO.auth.inactive,
          no_claims: roRO.auth.noClaims,
          malformed: roRO.auth.malformed,
        }[state.reason]
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{roRO.auth.signInTitle}</h1>
        <p className="mt-1 text-sm text-ink-muted">{roRO.auth.signInBody}</p>
      </div>

      {rejection === null ? null : (
        <Banner tone="warning" title={rejection} dense className="rounded-md border" />
      )}

      <SignInForm next={next ?? ''} />

      <Link href="/resetare" className="text-center text-sm text-brand-700 hover:underline">
        {roRO.auth.forgot}
      </Link>
    </div>
  );
}
