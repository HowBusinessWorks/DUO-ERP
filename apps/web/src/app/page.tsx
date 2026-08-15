import { redirect } from 'next/navigation';

/**
 * Radacina duce in Panou.
 *
 * Cand pasul 02c aduce autentificarea reala, aici se decide spatiul de lucru
 * dupa persona: birou → `/panou`, teren → `/field`, portaluri → `/portal/*`.
 * Nu exista o ruta care sa serveasca doua persone (§7.1).
 */
export default function RootPage() {
  redirect('/panou');
}
