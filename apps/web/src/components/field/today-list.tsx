'use client';

import type { FieldWorkUnit } from '@damina/services';
import { Badge, EmptyState } from '@damina/ui';
import { ClipboardCheck, Hammer, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fieldDb, hasIndexedDb } from '../../lib/field/db';
import { useSync } from './sync-provider';

/**
 * Ecranul `Azi` — **o listă de ce am eu azi, nu un meniu** (§3.5).
 *
 * Citește din IndexedDB, nu de pe server. Ăsta e testul întregii arhitecturi:
 * cu rețeaua închisă de tot, ecranul se încarcă din felia locală. Dacă ar fi
 * fost randat pe server „cu fallback offline", fallback-ul ar fi fost calea
 * rar folosită — adică prima care se strică fără să observe nimeni.
 *
 * Ordinea e a zilei, nu alfabetică: ce e de făcut acum stă sus.
 */

const ICONS = {
  inspectie: ClipboardCheck,
  interventie: Wrench,
  lucrare: Hammer,
} as const;

const LABELS: Readonly<Record<string, string>> = {
  inspectie: 'Inspecție',
  interventie: 'Intervenție',
  lucrare: 'Lucrare',
};

export function TodayList() {
  const { lastPulledAt, online } = useSync();
  const [units, setUnits] = useState<readonly FieldWorkUnit[] | null>(null);

  useEffect(() => {
    void (async () => {
      if (!hasIndexedDb()) {
        setUnits([]);
        return;
      }
      const rows = await fieldDb().workUnits.toArray();
      setUnits(
        [...rows].sort((a, b) => (a.startsOn ?? '9999').localeCompare(b.startsOn ?? '9999')),
      );
    })();
    // Se recitește după fiecare sincronizare: `lastPulledAt` se schimbă atunci.
  }, [lastPulledAt]);

  if (units === null) {
    return <p className="text-sm text-ink-muted">Se citește de pe telefon…</p>;
  }

  if (units.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardCheck className="size-5" aria-hidden />}
        title="Nimic pe ziua de azi"
        body={
          online
            ? 'Când primești o inspecție sau o intervenție, apare aici. Merge și fără semnal — se trimite singură când prinzi rețea.'
            : 'Nu ai nimic salvat pe telefon. Deschide aplicația o dată cu semnal, și de atunci merge și fără.'
        }
      />
    );
  }

  return (
    <ul className="space-y-2">
      {units.map((unit) => {
        const Icon = ICONS[unit.type as keyof typeof ICONS] ?? Hammer;
        return (
          <li key={unit.id}>
            <Link
              href={`/field/${unit.id}`}
              className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 active:bg-surface-hover"
            >
              <Icon className="size-5 shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{unit.name}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {unit.objectiveName} · {unit.code}
                </span>
              </span>
              {unit.validated ? (
                <Badge tone="success">gata</Badge>
              ) : (
                <Badge tone="outline">{LABELS[unit.type] ?? unit.type}</Badge>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
