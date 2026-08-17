import { roRO } from '@damina/i18n';
import { Banner } from '@damina/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetForm } from '../forms';

export const metadata: Metadata = { title: roRO.auth.resetTitle };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ trimis?: string }>;
}) {
  const { trimis } = await searchParams;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{roRO.auth.resetTitle}</h1>
        <p className="mt-1 text-sm text-ink-muted">{roRO.auth.resetBody}</p>
      </div>

      {trimis === '1' ? (
        <Banner tone="success" title={roRO.auth.resetSent} dense className="rounded-md border" />
      ) : (
        <ResetForm />
      )}

      <Link href="/login" className="text-center text-sm text-brand-700 hover:underline">
        {roRO.auth.backToSignIn}
      </Link>
    </div>
  );
}
