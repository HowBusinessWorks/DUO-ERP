import { roRO } from '@damina/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: roRO.common.appName,
  description: 'ERP intern Damina',
};

/**
 * Layout-ul radacina. Cele patru spatii de lucru isi pun propriul layout in
 * route group-ul lor — shell-ul de navigare vine in pasul 03.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ro">
      <body>{children}</body>
    </html>
  );
}
