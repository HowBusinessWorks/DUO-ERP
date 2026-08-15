import { Badge } from '@damina/ui';
import { CloudOff, Home, Menu, Camera, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

/**
 * `(field)` — aplicatia de teren. Doar scheletul, in pasul 03.
 *
 * Nu e aplicatia de birou cu preturile ascunse: e o aplicatie SEPARATA, cu rute
 * separate, care nu contine niciodata coloana de pret (I6, §21.8). Decupajul nu
 * s-a putut face din permisiuni — asta e concluzia din teren, iar shell-ul
 * separat e traducerea ei.
 *
 * Ce ramane pentru pasul 10: sincronizarea offline propriu-zisa. Bannerul de
 * mai jos exista de acum, ca sa nu se schimbe layoutul cand soseste.
 */
export default function FieldLayout({ children }: { children: ReactNode }) {
  return (
    <div data-shell="field" className="flex min-h-dvh flex-col bg-canvas">
      {/* Banner de sincronizare. Gol acum; in pasul 10 arata cate mutatii
          asteapta sa plece si cand a fost ultima sincronizare. */}
      <div className="flex items-center gap-2 bg-brand-900 px-4 py-2 text-brand-100">
        <CloudOff className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-sm">Totul e sincronizat</span>
        <Badge tone="outline" className="border-brand-700 text-brand-200">
          offline-first
        </Badge>
      </div>

      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <button type="button" aria-label="Meniu" className="text-ink-muted">
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <span className="text-lg font-semibold">Teren</span>
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
  );
}
