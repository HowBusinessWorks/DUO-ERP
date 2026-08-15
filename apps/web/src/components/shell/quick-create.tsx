'use client';

import { t } from '@damina/i18n';
import { Button } from '@damina/ui';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export interface QuickCreateItem {
  readonly label: string;
  readonly href: string;
  readonly hint?: string;
}

/**
 * Butonul ＋ din bara de sus (§5.5).
 *
 * Maximum sase intrari, si NU inlocuieste crearea din context (I4). Butonul
 * „Comandă material” traieste in lucrare, unde exista nevoia; asta de aici e
 * scurtatura pentru cazurile care chiar incep de nicaieri — o cerere venita
 * prin telefon, un produs nou, un obiectiv nou.
 */
export function QuickCreate({ items }: { items: readonly QuickCreateItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="primary"
        size="md"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="true"
        icon={<Plus className="size-4" aria-hidden="true" />}
      >
        {t('topbar.quickCreate')}
      </Button>

      {open ? (
        <ul className="absolute top-full right-0 z-40 mt-1.5 w-64 rounded-lg border border-border bg-surface p-1.5 shadow-lg">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => {
                  setOpen(false);
                }}
                className="block rounded px-2 py-1.5 hover:bg-surface-hover"
              >
                <span className="block text-base font-medium text-ink">{item.label}</span>
                {item.hint === undefined ? null : (
                  <span className="block text-sm text-ink-muted">{item.hint}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
