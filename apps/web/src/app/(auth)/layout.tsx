import { roRO } from '@damina/i18n';
import type { ReactNode } from 'react';

/**
 * `(auth)` — login, resetare de parola, prima parola.
 *
 * Nu are shell: niciunul din cele patru spatii de lucru nu s-a ales inca. Un
 * sidebar pe ecranul de login ar arata module pe care omul poate ca nici nu le
 * are.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-workspace="auth"
      className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10"
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-2xl font-semibold tracking-tight text-brand-900">
            {roRO.common.appName}
          </p>
          <p className="text-sm text-ink-muted">{roRO.common.appNameLong}</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
