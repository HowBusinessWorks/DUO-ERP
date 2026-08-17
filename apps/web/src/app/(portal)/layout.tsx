import type { ReactNode } from 'react';
import { requireWorkspace } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * `(portal)` — subcontractanti si clienti, cu navigatie proprie.
 *
 * Rute izolate: subcontractantul A nu vede nimic de la B, impus prin RLS pe
 * fiecare tabela atinsa de portal — nu prin ce randam sau nu aici.
 *
 * Layout-ul lasa sa treaca ambele persone de portal, pentru ca le serveste pe
 * amandoua. Separarea dintre ele — `/portal/subcontractor` vs `/portal/client`
 * — o face `canEnter`, in middleware si in paginile de dedesubt.
 */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  await requireWorkspace('subcontractor', 'client');

  return (
    <div data-shell="portal" className="min-h-dvh bg-canvas">
      <header className="flex h-12 items-center border-b border-border bg-surface px-5">
        <span className="text-lg font-semibold text-ink">Damina</span>
      </header>
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </div>
  );
}
