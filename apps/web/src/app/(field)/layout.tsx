import { Home, Menu, Camera, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConflictBadge } from '../../components/field/conflict-badge';
import { RegisterServiceWorker } from '../../components/field/register-sw';
import { SyncBanner } from '../../components/field/sync-banner';
import { SyncProvider } from '../../components/field/sync-provider';
import { UserMenu } from '../../components/shell/user-menu';
import { requireWorkspace } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Manifestul se leaga DOAR de aici, nu din layout-ul radacina: `scope` e
 * `/field`, iar aplicatia de birou n-are ce cauta instalata ca PWA. Ea arata
 * bani si stari care se schimba sub tine.
 */
export const metadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Teren', statusBarStyle: 'black-translucent' as const },
};

/**
 * `(field)` — aplicatia de teren. Doar scheletul, in pasul 03.
 *
 * Nu e aplicatia de birou cu preturile ascunse: e o aplicatie SEPARATA, cu rute
 * separate, care nu contine niciodata coloana de pret (I6, §21.8). Decupajul nu
 * s-a putut face din permisiuni — asta e concluzia din teren, iar shell-ul
 * separat e traducerea ei.
 *
 * De la 10b incoace, shell-ul e invelit in `SyncProvider`: banda de sus arata
 * starea reala a cozii, numarand SEPARAT fisele si pozele. Un singur numar ar fi
 * fost mai scurt si ar fi mintit exact in momentul in care conteaza — cand omul
 * vede „4 de sincronizat" si sunt doar poze.
 */
export default async function FieldLayout({ children }: { children: ReactNode }) {
  const session = await requireWorkspace('field');

  return (
    <SyncProvider>
      <div data-shell="field" className="flex min-h-dvh flex-col bg-canvas">
        <RegisterServiceWorker />
        <SyncBanner />

        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
          <button type="button" aria-label="Meniu" className="text-ink-muted">
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <span className="text-lg font-semibold">Teren</span>
          <span className="ml-auto flex items-center gap-2">
            <ConflictBadge />
            <span className="max-w-32 truncate text-sm text-ink-muted">{session.fullName}</span>
            <UserMenu session={session} compact />
          </span>
        </header>

        <main className="flex-1 p-4">{children}</main>

        {/* Tinta de tapuri pe teren e 3 (§30.12): navigatia principala sta la
            degetul mare, nu intr-un meniu care se deschide. */}
        <nav
          aria-label="Navigare teren"
          className="sticky bottom-0 grid grid-cols-3 border-t border-border bg-surface"
        >
          {[
            { href: '/field', label: 'Azi', icon: Home },
            { href: '/field/inspectii', label: 'Inspecții', icon: ClipboardCheck },
            { href: '/field/poze', label: 'Poze', icon: Camera },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-14 flex-col items-center justify-center gap-1 text-xs text-ink-muted active:bg-surface-hover"
            >
              <item.icon className="size-5" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </SyncProvider>
  );
}
