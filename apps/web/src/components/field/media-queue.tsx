'use client';

import { Badge, Banner, Button, EmptyState, ProgressBar } from '@damina/ui';
import { Camera, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { MediaRow } from '../../lib/field/db';
import { discardMedia, pendingMedia, retryMedia, uploadPending } from '../../lib/field/media';
import { useSync } from './sync-provider';

/**
 * Coada de poze, văzută de om.
 *
 * Motivul pentru care ecranul ăsta există separat de cel de conflicte: pozele
 * și fișele cad din motive diferite și se rezolvă diferit. O fișă respinsă
 * oprește coada și cere o decizie de fond. O poză căzută nu oprește nimic —
 * doar stă, până când e semnal sau până când omul renunță la ea.
 *
 * **Miniatura se face local**, dintr-un `blob:` URL, nu de pe server: poza n-a
 * ajuns încă nicăieri. Fără ea, „3 poze în așteptare" e un număr; cu ea, omul
 * vede că a fotografiat de două ori aceeași conductă.
 */

/** Ce arata bara cand poza inca n-a inceput sa urce. */
const NOT_STARTED = 0;

function Thumbnail({ row }: { readonly row: MediaRow }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(row.blob);
    setUrl(objectUrl);
    // Fara revoke, o zi de teren tine sute de MB agatati in tab.
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [row.blob]);

  return (
    <span className="size-14 shrink-0 overflow-hidden rounded-md border border-border bg-canvas">
      {url === null ? null : (
        // Poza locala, nu una de pe server: `next/image` n-are ce optimiza aici.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      )}
    </span>
  );
}

export function MediaQueue() {
  const { refresh, online } = useSync();
  const [rows, setRows] = useState<readonly MediaRow[] | null>(null);
  const [live, setLive] = useState<Readonly<Record<string, number>>>({});
  const [working, setWorking] = useState(false);

  const reload = useCallback(async () => {
    setRows(await pendingMedia());
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const drain = useCallback(async () => {
    setWorking(true);
    try {
      await uploadPending((id, sent) => {
        setLive((current) => ({ ...current, [id]: sent }));
      });
    } finally {
      setWorking(false);
      setLive({});
      await reload();
    }
  }, [reload]);

  if (rows === null) {
    return <p className="text-sm text-ink-muted">Se citește coada…</p>;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Camera className="size-5" aria-hidden />}
        title="Nicio poză în așteptare"
        body="Pozele făcute pe teren stau aici până prinzi semnal, apoi pleacă singure. Când lista e goală, tot ce ai fotografiat e la birou."
      />
    );
  }

  const failed = rows.filter((row) => row.status === 'failed');

  return (
    <div className="space-y-4">
      {failed.length > 0 ? (
        <Banner
          tone="warning"
          title={
            failed.length === 1
              ? 'O poză n-a putut fi urcată'
              : `${String(failed.length)} poze n-au putut fi urcate`
          }
          body="Nu e semnalul: serverul le-a refuzat. Citește motivul de sub fiecare, rezolvă-l și trimite-le din nou. Restul cozii n-a fost oprită de ele."
        />
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => {
          const sent = live[row.id] ?? row.uploadedParts ?? NOT_STARTED;
          return (
            <li key={row.id} className="flex gap-3 rounded-lg border border-border bg-surface p-3">
              <Thumbnail row={row} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm text-ink-muted">
                    {new Date(row.createdAt).toLocaleString('ro-RO')}
                  </span>
                  {row.status === 'failed' ? (
                    <Badge tone="warning">refuzată</Badge>
                  ) : row.status === 'uploading' ? (
                    <Badge tone="outline">se urcă</Badge>
                  ) : (
                    <Badge tone="outline">așteaptă</Badge>
                  )}
                </div>

                {row.lat === undefined ? (
                  <p className="mt-0.5 text-xs text-ink-subtle">Fără coordonate — n-a prins GPS.</p>
                ) : (
                  <p className="mt-0.5 text-xs text-ink-subtle">
                    {row.lat.toFixed(5)}, {row.lng?.toFixed(5)} · ±{Math.round(row.accuracy ?? 0)} m
                  </p>
                )}

                {sent > 0 && row.status !== 'failed' ? (
                  <ProgressBar
                    className="mt-2"
                    label="Se urcă poza"
                    value={Math.min(100, Math.round((sent / row.blob.size) * 100))}
                  />
                ) : null}

                {row.status === 'failed' ? (
                  <>
                    <p className="mt-1 text-sm text-ink">{row.errorMessage}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void (async () => {
                            await retryMedia(row.id);
                            await reload();
                          })();
                        }}
                      >
                        <RefreshCw className="size-4" aria-hidden /> Trimite din nou
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void (async () => {
                            // Ireversibil, si obiectivul e la 40 de km.
                            if (!window.confirm('Ștergi poza? Nu se mai poate face a doua oară.')) {
                              return;
                            }
                            await discardMedia(row.id);
                            await reload();
                          })();
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden /> Șterge poza
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Button
        className="min-h-12 w-full"
        disabled={working || !online}
        onClick={() => {
          void drain();
        }}
      >
        {working ? 'Se urcă…' : online ? 'Trimite acum' : 'Fără semnal — pleacă singure'}
      </Button>
    </div>
  );
}
