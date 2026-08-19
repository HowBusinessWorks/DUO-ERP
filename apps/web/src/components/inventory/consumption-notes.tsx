'use client';

import { Badge, Banner, Button, Dialog, Input, Select, useToast } from '@damina/ui';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { issueConsumptionNoteAction } from '../../app/(office)/inventory-actions';

/**
 * Bonurile de consum (§3.4).
 *
 * Bonul e documentul care **transformă un material în cheltuială**. Iese pe
 * două drumuri, și amândouă trec prin aceeași tranzacție din serviciu: automat,
 * la validarea unei intervenții, sau manual de aici, din gestiunea echipei.
 *
 * Formularul NU cere contractul și componenta, deși bonul le poartă: ele vin
 * din finanțarea activă a unității de lucru, aceeași sursă pe care o citește
 * validarea intervenției. Un câmp „din ce contract se scade" pe ecran ar fi
 * fost a doua sursă de adevăr pentru cine plătește.
 */

export interface NoteRow {
  readonly id: string;
  readonly number: string;
  readonly locationName: string;
  readonly documentDate: string;
  readonly effectDate: string | null;
  readonly status: string;
  readonly workUnitId: string | null;
}

export interface StockPick {
  readonly locationId: string;
  readonly productId: string;
  readonly label: string;
  readonly uom: string;
  readonly available: string;
}

export interface ConsumptionNotesProps {
  readonly notes: readonly NoteRow[];
  readonly canWrite: boolean;
  readonly locations: readonly { readonly id: string; readonly name: string }[];
  readonly workUnits: readonly {
    readonly id: string;
    readonly label: string;
    readonly type: string;
    readonly stages: readonly { readonly id: string; readonly name: string }[];
  }[];
  readonly stock: readonly StockPick[];
  readonly series: readonly string[];
  readonly today: string;
}

interface LineState {
  readonly key: string;
  readonly productId: string;
  readonly quantity: string;
}

let counter = 0;
const nextKey = (): string => {
  counter += 1;
  return `n${String(counter)}`;
};

export function ConsumptionNotes({
  notes,
  canWrite,
  locations,
  workUnits,
  stock,
  series,
  today,
}: ConsumptionNotesProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [form, setForm] = useState({
    series: series[0] ?? '',
    locationId: '',
    workUnitId: '',
    stageId: '',
    documentDate: today,
    effectDate: today,
  });
  const [lines, setLines] = useState<LineState[]>([]);

  // Se consumă doar ce există ÎN gestiunea aleasă. Un selector peste tot stocul
  // firmei ar fi oferit produse pe care bonul nu le poate scoate de acolo.
  const available = stock.filter((entry) => entry.locationId === form.locationId);
  const unit = workUnits.find((candidate) => candidate.id === form.workUnitId);
  const needsStage = unit?.type === 'lucrare';

  function submit(): void {
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await issueConsumptionNoteAction({
        ...form,
        lines: lines
          .filter((line) => line.productId !== '' && line.quantity !== '')
          .map((line) => ({
            productId: line.productId,
            lotId: '',
            quantity: line.quantity.replace(',', '.'),
          })),
      });
      setSaving(false);

      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast({
        tone: 'success',
        title: `Bonul ${result.data.number} e emis`,
        body: `${result.data.total} lei au intrat în registrul de cost, iar soldul gestiunii a scăzut.`,
      });
      setOpen(false);
      setLines([]);
      router.refresh();
    })();
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-muted">
          Bonul scoate materialul din gestiune la{' '}
          <span className="font-medium text-ink">CMP-ul zilei</span> și scrie costul în registru,
          într-o singură tranzacție. Cel emis de o intervenție validată apare tot aici.
        </p>
        {canWrite ? (
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden /> Bon manual
          </Button>
        ) : null}
      </div>

      {notes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-ink-muted">
          Niciun bon de consum pe firmele selectate.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {notes.map((note) => (
            <li key={note.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="font-medium tabular-nums text-ink">{note.number}</span>
              <span className="text-ink-muted">{note.locationName}</span>
              <span className="tabular-nums text-ink-muted">{note.documentDate}</span>
              {note.effectDate === null ? null : (
                <span className="text-xs text-ink-subtle">luna {note.effectDate}</span>
              )}
              {note.status === 'consumat' ? (
                <Badge tone="success">Consumat</Badge>
              ) : note.status === 'anulat' ? (
                <Badge tone="danger">Anulat</Badge>
              ) : (
                <Badge tone="neutral">Ciornă</Badge>
              )}
              {note.workUnitId === null ? null : (
                <Link
                  href={`/activitate/${note.workUnitId}`}
                  className="text-xs text-brand underline-offset-2 hover:underline"
                >
                  Unitatea de lucru
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
        }}
        title="Bon de consum manual"
        description="Analitica vine din unitatea de lucru: contractul și componenta se citesc din finanțarea ei activă."
        size="lg"
      >
        <div className="space-y-3">
          {error === undefined ? null : <Banner tone="danger" title="Nu s-a putut" body={error} />}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-muted">Gestiunea</span>
              <Select
                options={locations.map((location) => ({
                  value: location.id,
                  label: location.name,
                }))}
                placeholder="Alege gestiunea"
                value={form.locationId}
                onChange={(event) => {
                  setForm({ ...form, locationId: event.target.value });
                  setLines([]);
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-muted">Seria</span>
              <Select
                options={series.map((value) => ({ value, label: value }))}
                placeholder="Alege seria"
                value={form.series}
                onChange={(event) => {
                  setForm({ ...form, series: event.target.value });
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-muted">Unitatea de lucru</span>
              <Select
                options={workUnits.map((entry) => ({ value: entry.id, label: entry.label }))}
                placeholder="Alege unitatea"
                value={form.workUnitId}
                onChange={(event) => {
                  setForm({ ...form, workUnitId: event.target.value, stageId: '' });
                }}
              />
              <span className="block text-xs text-ink-subtle">
                De la ea vin contractul, componenta și obiectivul.
              </span>
            </label>

            {needsStage ? (
              <label className="space-y-1">
                <span className="text-xs font-medium text-ink-muted">Etapa</span>
                <Select
                  options={(unit?.stages ?? []).map((stage) => ({
                    value: stage.id,
                    label: stage.name,
                  }))}
                  placeholder="Fără etapă"
                  value={form.stageId}
                  onChange={(event) => {
                    setForm({ ...form, stageId: event.target.value });
                  }}
                />
              </label>
            ) : (
              <span />
            )}

            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-muted">Data bonului</span>
              <Input
                type="date"
                value={form.documentDate}
                onChange={(event) => {
                  setForm({ ...form, documentDate: event.target.value });
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-muted">Luna de raportare</span>
              <Input
                type="date"
                value={form.effectDate}
                onChange={(event) => {
                  setForm({ ...form, effectDate: event.target.value });
                }}
              />
              <span className="block text-xs text-ink-subtle">
                Separată de data bonului, ca la orice document care produce cost.
              </span>
            </label>
          </div>

          {/* ── Liniile ─────────────────────────────────────────────────── */}
          {form.locationId === '' ? (
            <p className="rounded border border-dashed border-border px-4 py-4 text-center text-sm text-ink-muted">
              Alege întâi gestiunea — se consumă doar ce există în ea.
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((line, index) => {
                const pick = available.find((entry) => entry.productId === line.productId);
                return (
                  <div key={line.key} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                    <Select
                      options={available.map((entry) => ({
                        value: entry.productId,
                        label: `${entry.label} · ${entry.available} ${entry.uom}`,
                      }))}
                      placeholder="Alege produsul"
                      value={line.productId}
                      onChange={(event) => {
                        setLines(
                          lines.map((current, at) =>
                            at === index ? { ...current, productId: event.target.value } : current,
                          ),
                        );
                      }}
                    />
                    <Input
                      inputMode="decimal"
                      suffix={pick?.uom ?? ''}
                      value={line.quantity}
                      onChange={(event) => {
                        setLines(
                          lines.map((current, at) =>
                            at === index ? { ...current, quantity: event.target.value } : current,
                          ),
                        );
                      }}
                    />
                    <Button
                      variant="ghost"
                      aria-label="Șterge linia"
                      onClick={() => {
                        setLines(lines.filter((_, at) => at !== index));
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                );
              })}

              <Button
                variant="secondary"
                onClick={() => {
                  setLines([...lines, { key: nextKey(), productId: '', quantity: '' }]);
                }}
              >
                <Plus className="size-4" aria-hidden /> Adaugă linie
              </Button>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Renunță
            </Button>
            <Button onClick={submit} disabled={saving || lines.length === 0}>
              {saving ? 'Se emite…' : 'Emite bonul'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
