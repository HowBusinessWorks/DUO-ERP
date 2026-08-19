'use client';

import { Badge, Banner, Button, EmptyState } from '@damina/ui';
import { CheckCircle2, CopyPlus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { OutboxRow } from '../../lib/field/db';
import { blockedMutations, discardMutation, retryQueue } from '../../lib/field/sync';
import { useSync } from './sync-provider';

/**
 * Ecranul de conflicte (pasul 10, §3.3).
 *
 * **Obligatoriu și proiectat**, nu improvizat — inclusiv starea goală, care e
 * cea pe care o vede omul în 99% din zile.
 *
 * O mutație ajunge aici doar când serverul a respins-o pentru un motiv de
 * **business**: luna s-a închis între timp, stocul nu ajunge, fișa a fost
 * validată la birou. Erorile de rețea nu ajung niciodată aici — ele se reiau
 * singure, iar dacă ar apărea pe ecranul ăsta ar învăța omul să-l ignore.
 *
 * Sunt trei acțiuni, și niciuna nu se numește „încearcă din nou":
 *
 *  - **Renunță** — mutația iese din coadă. Serverul ține minte răspunsul după
 *    `id`, deci retrimiterea acelorași date ar da același răspuns. N-ar fi o
 *    reîncercare, ar fi aceeași respingere cu alt buton.
 *  - **Deblochează coada** — restul mutațiilor își reiau drumul. Se apasă după
 *    ce ce le oprea a fost rezolvat sau abandonat.
 *  - **Duplică drept fișă nouă** (§3.3) — deschide fișa cu ce a scris OMUL, nu
 *    cu ce știe serverul. Asta e distincția care o face utilă: felia arată
 *    exact starea care a produs refuzul, iar omul vrea înapoi munca lui, ca s-o
 *    corecteze. La trimitere pleacă o mutație cu `id` nou, iar cea refuzată e
 *    ștearsă — deci nu rămâne niciodată o pereche care să se calce.
 *
 * Butonul apare doar la mutațiile care au un ecran în spate. `entityId` e pus de
 * ecranul care a creat mutația: ecranul ăsta n-are de ce să știe forma fiecărui
 * tip de payload ca să caute un id în el.
 */
export function ConflictList() {
  const { refresh, syncNow } = useSync();
  const [rows, setRows] = useState<readonly OutboxRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setRows(await blockedMutations());
    setLoading(false);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return <p className="p-4 text-sm text-ink-muted">Se citește coada…</p>;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="size-5" aria-hidden />}
        title="Niciun conflict"
        body="Coada merge. Aici ajung doar fișele pe care serverul le-a refuzat dintr-un motiv de fond — luna închisă, stoc insuficient, fișă validată între timp. Ce ține de semnal se rezolvă singur."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Banner
        tone="warning"
        title="Coada e oprită"
        body="Mutațiile de după cea oprită n-au fost încercate — nu se sare peste ele, pentru că pot depinde de ea. Rezolvă prima din listă și deblochează."
      />

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border border-warning bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-ink">{row.label}</span>
              <Badge tone="warning">{row.errorCode ?? 'refuzată'}</Badge>
            </div>

            <p className="mt-2 text-sm text-ink-muted">
              {row.errorMessage ?? 'Serverul a refuzat fișa, fără să spună de ce.'}
            </p>

            <p className="mt-1 text-xs text-ink-subtle">
              Scrisă pe telefon la {new Date(row.createdAt).toLocaleString('ro-RO')}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {row.entityId === undefined ? null : (
                <Link
                  href={`/field/${row.entityId}?copiaza=${row.id}`}
                  className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-ink active:bg-surface-hover"
                >
                  <CopyPlus className="size-4" aria-hidden /> Duplică drept fișă nouă
                </Link>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  void (async () => {
                    await discardMutation(row.id);
                    await reload();
                  })();
                }}
              >
                <Trash2 className="size-4" aria-hidden /> Renunță la ea
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-ink">
          După ce ai rezolvat cauza — sau ai renunțat la fișă — deblochează coada.
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Retrimiterea acelorași date dă același răspuns: serverul ține minte fiecare fișă după
          numărul ei. „Duplică" e reîncercarea adevărată — pleacă o fișă nouă, cu ce ai scris tu.
        </p>
        <Button
          className="mt-3"
          onClick={() => {
            void (async () => {
              await retryQueue();
              await reload();
              await syncNow();
            })();
          }}
        >
          Deblochează coada
        </Button>
      </div>
    </div>
  );
}
