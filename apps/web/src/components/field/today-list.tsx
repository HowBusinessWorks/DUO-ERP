'use client';

import type { FieldWorkUnit } from '@damina/services';
import { Badge, EmptyState } from '@damina/ui';
import { AlertTriangle, Camera, ClipboardCheck, Hammer, ListChecks, Wrench } from 'lucide-react';
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

/**
 * Randurile de sub lista: ce mai e de facut, in cifre.
 *
 * Sunt in ecranul `Azi` fiindca acolo se uita omul dimineata, si sunt scrise ca
 * PROPOZITII, nu ca insigne: „4 de sincronizat" langa un clopotel nu spune daca
 * e ceva de facut sau doar de asteptat. Aici, fiecare rand spune si ce e, si
 * daca cere ceva de la om.
 *
 * Nu apare niciun rand cu zero. Un tablou de bord plin de zerouri se citeste o
 * saptamana si pe urma nu se mai citeste deloc.
 */
function ContextRows({
  pending,
  photos,
  blocked,
  unstarted,
}: {
  readonly pending: number;
  readonly photos: number;
  readonly blocked: number;
  readonly unstarted: number;
}) {
  const rows: {
    key: string;
    icon: typeof ListChecks;
    text: string;
    href?: string;
    alert?: boolean;
  }[] = [];

  if (unstarted > 0) {
    rows.push({
      key: 'unstarted',
      icon: ListChecks,
      text: unstarted === 1 ? 'O fișă neîncepută' : `${String(unstarted)} fișe neîncepute`,
    });
  }
  if (pending > 0) {
    rows.push({
      key: 'pending',
      icon: ClipboardCheck,
      text: pending === 1 ? 'O fișă așteaptă semnal' : `${String(pending)} fișe așteaptă semnal`,
    });
  }
  if (photos > 0) {
    rows.push({
      key: 'media',
      icon: Camera,
      text: photos === 1 ? 'O poză de trimis' : `${String(photos)} poze de trimis`,
      href: '/field/poze',
    });
  }
  if (blocked > 0) {
    rows.push({
      key: 'blocked',
      icon: AlertTriangle,
      text:
        blocked === 1
          ? 'O fișă refuzată — cere-ți atenția'
          : `${String(blocked)} fișe refuzate — cer atenția ta`,
      href: '/field/conflicte',
      alert: true,
    });
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-1 pt-1">
      {rows.map((row) => {
        const body = (
          <>
            <row.icon
              className={row.alert === true ? 'size-4 text-warning-700' : 'size-4 text-ink-subtle'}
              aria-hidden
            />
            <span className={row.alert === true ? 'text-warning-700' : 'text-ink-muted'}>
              {row.text}
            </span>
          </>
        );
        return (
          <li key={row.key}>
            {row.href === undefined ? (
              <span className="flex min-h-9 items-center gap-2 px-1 text-sm">{body}</span>
            ) : (
              <Link
                href={row.href}
                className="flex min-h-11 items-center gap-2 rounded-md px-1 text-sm active:bg-surface-hover"
              >
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface TodayListProps {
  /** Arata doar un tip de unitate. Fara el, tot ce am azi. */
  readonly only?: FieldWorkUnit['type'];
}

export function TodayList({ only }: TodayListProps = {}) {
  const { lastPulledAt, online, data, media, blocked } = useSync();
  const [units, setUnits] = useState<readonly FieldWorkUnit[] | null>(null);

  useEffect(() => {
    void (async () => {
      if (!hasIndexedDb()) {
        setUnits([]);
        return;
      }
      const rows = await fieldDb().workUnits.toArray();
      setUnits(
        rows
          .filter((row) => only === undefined || row.type === only)
          .sort((a, b) => (a.startsOn ?? '9999').localeCompare(b.startsOn ?? '9999')),
      );
    })();
    // Se recitește după fiecare sincronizare: `lastPulledAt` se schimbă atunci.
  }, [lastPulledAt, only]);

  if (units === null) {
    return <p className="text-sm text-ink-muted">Se citește de pe telefon…</p>;
  }

  const unstarted = units.filter((unit) => !unit.validated && unit.performedOn === null).length;

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
    <div className="space-y-2">
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

      <ContextRows pending={data} photos={media} blocked={blocked} unstarted={unstarted} />
    </div>
  );
}
