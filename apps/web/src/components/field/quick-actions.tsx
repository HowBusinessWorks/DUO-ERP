'use client';

import { BookText, Plus, Truck, Wrench, X, PackagePlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

/**
 * Butonul ＋ și cele patru acțiuni frecvente (§3.5).
 *
 * De ce patru și de ce astea: sunt lucrurile pe care un șef de șantier le face
 * de mai multe ori pe zi, din picioare. Restul se deschid dintr-o unitate de
 * lucru, pentru că au nevoie de context.
 *
 * **Costă două tapuri până la ecran**, iar ținta totală e trei (§0). Asta lasă
 * exact un tap ecranului care urmează — de aceea ecranele de sub ＋ trebuie să
 * se deschidă cu tot ce se poate ghici deja completat, nu cu un formular gol.
 * Nu e o observație de stil: la 7 tapuri, omul dă telefon la magazie și
 * trasabilitatea rămâne goală.
 *
 * Meniul se închide la orice atingere în afară, la `Escape` și la navigare.
 * Un meniu care rămâne deschis peste ecranul următor e un tap în plus, plătit
 * de fiecare dată.
 */

const ACTIONS = [
  { href: '/field/necesar', label: 'Necesar material', icon: PackagePlus },
  { href: '/field/interventie', label: 'Fișă de intervenție', icon: Wrench },
  { href: '/field/jurnal', label: 'Adaugă în jurnal', icon: BookText },
  { href: '/field/utilaje', label: 'Solicită utilaj', icon: Truck },
] as const;

export function QuickActions() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Închide meniul"
          className="fixed inset-0 z-40 bg-ink/30"
          onClick={() => {
            setOpen(false);
          }}
        />
      ) : null}

      <div className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2">
        {open
          ? ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                data-testid="quick-action"
                className="flex min-h-12 items-center gap-3 rounded-full border border-border bg-surface pl-4 pr-5 text-sm font-medium text-ink shadow-lg active:bg-surface-hover"
                onClick={() => {
                  setOpen(false);
                }}
              >
                <action.icon className="size-5 text-ink-muted" aria-hidden />
                {action.label}
              </Link>
            ))
          : null}

        <button
          type="button"
          data-testid="quick-actions-toggle"
          aria-expanded={open}
          aria-label={open ? 'Închide acțiunile' : 'Acțiuni rapide'}
          // 56 px: tinta de atingere cu manusi de lucru, nu cu degetul gol.
          className="flex size-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg active:bg-brand-800"
          onClick={() => {
            setOpen((current) => !current);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        >
          {open ? <X className="size-6" aria-hidden /> : <Plus className="size-6" aria-hidden />}
        </button>
      </div>
    </>
  );
}
