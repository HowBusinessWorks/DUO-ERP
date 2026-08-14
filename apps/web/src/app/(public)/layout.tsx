import type { ReactNode } from 'react';

/** (public) — acces prin link tokenizat, fără cont. Semnarea PV-urilor, faza 4. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div data-workspace="public">{children}</div>;
}
