import type { ReactNode } from 'react';

/** (office) — aplicația de birou, desktop. Shell-ul de navigare vine în pasul 03. */
export default function OfficeLayout({ children }: { children: ReactNode }) {
  return <div data-workspace="office">{children}</div>;
}
