import { roRO } from '@damina/i18n';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * Inter, variabila, gazduita local de `next/font` — fara cerere catre Google la
 * randare. O singura familie pentru tot: intr-un ERP, contrastul se face din
 * greutate si spatiere, nu din a doua fonta.
 */
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: { default: roRO.common.appNameLong, template: `%s · ${roRO.common.appName}` },
  description: 'ERP intern Damina',
};

export const viewport: Viewport = {
  themeColor: '#0f3d47',
  width: 'device-width',
  initialScale: 1,
};

/** Cele patru spatii de lucru isi pun propriul shell in route group-ul lor. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ro" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
