import type { ReactNode } from 'react';

/**
 * (portal) — subcontractanți și clienți. Rute izolate: subcontractantul A nu
 * vede nimic de la B, impus prin RLS pe fiecare tabelă atinsă de portal.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div data-workspace="portal">{children}</div>;
}
