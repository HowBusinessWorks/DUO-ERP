import type { ReactNode } from 'react';

/** (field) — aplicația de teren, PWA offline-first. Se construiește în pasul 10. */
export default function FieldLayout({ children }: { children: ReactNode }) {
  return <div data-workspace="field">{children}</div>;
}
