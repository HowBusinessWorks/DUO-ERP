import type { ReactNode } from 'react';

/** (auth) — login, resetare de parolă, provizionare de cont. Se implementează în pasul 02. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div data-workspace="auth">{children}</div>;
}
