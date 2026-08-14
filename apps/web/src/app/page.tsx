import { roRO } from '@damina/i18n';
import Link from 'next/link';

const WORKSPACES = [
  { href: '/auth', label: roRO.workspace.auth },
  { href: '/office', label: roRO.workspace.office },
  { href: '/field', label: roRO.workspace.field },
  { href: '/portal/subcontractor', label: roRO.workspace.portalSubcontractor },
  { href: '/portal/client', label: roRO.workspace.portalClient },
] as const;

export default function HomePage() {
  return (
    <main>
      <h1>{roRO.common.appName}</h1>
      <p>
        Pasul 01 — fundația. Nu există încă niciun ecran de business; fiecare spațiu de lucru
        randează doar propriul layout.
      </p>
      <ul>
        {WORKSPACES.map((w) => (
          <li key={w.href}>
            <Link href={w.href}>{w.label}</Link>
          </li>
        ))}
      </ul>
      <p>
        Stare tehnică: <Link href="/api/health">/api/health</Link>
      </p>
    </main>
  );
}
