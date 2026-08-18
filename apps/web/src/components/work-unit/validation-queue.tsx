'use client';

import { Badge, Banner, Button, Checkbox, Input, useToast } from '@damina/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  validateInspectionAction,
  validateInterventionAction,
} from '../../app/(office)/sheet-actions';

/**
 * Validarea de birou, în masă (§3.6).
 *
 * Ecranul de sfârșit de lună al PM-ului: fișele nevalidate, cu `effect_date`
 * setată **pe lot**. Fișele nevalidate nu produc costuri și nu intră în
 * raportul lunar — de aceea listă asta e ultima oprire înainte de închidere.
 *
 * **Nu e o singură tranzacție peste tot lotul, și nu din lene.** Fiecare fișă
 * are tranzacția ei: prima intervenție fără stoc destul ar da înapoi și
 * validările care au mers, iar PM-ul ar rămâne cu un „a picat ceva" în loc de o
 * listă de motive. La fel ca la pontaje. Ce e atomic e o fișă: bonul de consum,
 * mișcarea de stoc și costul ei nu se despart niciodată.
 *
 * Seria bonului de consum e cerută o singură dată, pentru tot lotul: intervenția
 * fără materiale n-o folosește, iar cea cu materiale o folosește pe aceeași —
 * bonurile de la sfârșit de lună se numerotează în aceeași serie.
 */

export interface PendingSheet {
  readonly workUnitId: string;
  readonly code: string;
  readonly name: string;
  readonly performedOn: string;
  readonly kind: 'inspectie' | 'interventie';
}

export interface ValidationQueueProps {
  readonly sheets: readonly PendingSheet[];
  readonly consumptionSeries: readonly string[];
  readonly suggestedEffectDate: string;
  readonly canValidate: boolean;
}

export function ValidationQueue({
  sheets,
  consumptionSeries,
  suggestedEffectDate,
  canValidate,
}: ValidationQueueProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [selected, setSelected] = useState<readonly string[]>([]);
  const [effectDate, setEffectDate] = useState(suggestedEffectDate);
  const [series, setSeries] = useState(consumptionSeries[0] ?? '');
  const [running, setRunning] = useState(false);
  const [failures, setFailures] = useState<readonly string[]>([]);

  const byId = new Map(sheets.map((sheet) => [sheet.workUnitId, sheet]));

  function validate(): void {
    void (async () => {
      setRunning(true);
      setFailures([]);

      const problems: string[] = [];
      let done = 0;

      for (const id of selected) {
        const sheet = byId.get(id);
        if (sheet === undefined) {
          continue;
        }
        const result =
          sheet.kind === 'inspectie'
            ? await validateInspectionAction({ workUnitId: id, effectDate })
            : await validateInterventionAction({
                workUnitId: id,
                effectDate,
                consumptionSeries: series,
              });

        if (result.ok) {
          done += 1;
        } else {
          problems.push(`${sheet.code}: ${result.message}`);
        }
      }

      setRunning(false);
      setSelected([]);
      setFailures(problems);
      toast({
        tone: problems.length === 0 ? 'success' : 'warning',
        title: `${String(done)} fișe validate`,
        body:
          problems.length === 0
            ? `Costurile lor intră în luna datei ${effectDate}.`
            : `${String(problems.length)} n-au putut fi validate. Motivele sunt mai jos.`,
      });
      router.refresh();
    })();
  }

  if (sheets.length === 0) {
    return (
      <div className="p-5">
        <Banner
          tone="success"
          title="Nicio fișă nevalidată"
          body="Tot ce s-a executat pe firmele selectate e validat, deci a produs cost și intră în raportul lunar."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-muted">
          <strong className="text-ink">O fișă nevalidată nu produce cost</strong> și nu intră în
          raportul lunar. Luna de raportare se pune pe lot, aici, și e separată de data execuției:
          ce s-a făcut pe 31 poate fi raportat în luna următoare, dacă așa se închide.
        </p>
        <Badge tone="warning">{sheets.length} de validat</Badge>
      </div>

      {failures.length === 0 ? null : (
        <Banner
          tone="warning"
          title="Unele fișe n-au putut fi validate"
          body={failures.join(' · ')}
        />
      )}

      <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-muted">Luna de raportare</span>
          <Input
            type="date"
            value={effectDate}
            disabled={!canValidate}
            onChange={(event) => {
              setEffectDate(event.target.value);
            }}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-muted">Seria bonului de consum</span>
          <select
            className="h-9 w-full rounded border border-border bg-surface px-2 text-sm"
            value={series}
            disabled={!canValidate}
            onChange={(event) => {
              setSeries(event.target.value);
            }}
          >
            <option value="">Alege seria</option>
            {consumptionSeries.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <span className="block text-xs text-ink-subtle">
            Folosită doar de intervențiile cu materiale.
          </span>
        </label>
        <div className="flex items-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setSelected(selected.length === sheets.length ? [] : sheets.map((s) => s.workUnitId));
            }}
          >
            {selected.length === sheets.length ? 'Deselectează' : 'Selectează tot'}
          </Button>
          <Button
            variant="primary"
            onClick={validate}
            disabled={!canValidate || running || selected.length === 0}
          >
            {running ? 'Se validează…' : `Validează ${String(selected.length)}`}
          </Button>
        </div>
      </div>

      {canValidate ? null : (
        <Banner
          tone="info"
          title="Validarea e a biroului"
          body="Rolul tău poate completa fișe, dar nu le poate închide: validarea setează luna de raportare, produce cost și mișcă stocul."
        />
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {sheets.map((sheet) => (
          <li key={sheet.workUnitId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Checkbox
              label=""
              checked={selected.includes(sheet.workUnitId)}
              disabled={!canValidate}
              onChange={(event) => {
                setSelected(
                  event.target.checked
                    ? [...selected, sheet.workUnitId]
                    : selected.filter((id) => id !== sheet.workUnitId),
                );
              }}
            />
            <Badge tone={sheet.kind === 'inspectie' ? 'outline' : 'neutral'}>
              {sheet.kind === 'inspectie' ? 'Inspecție' : 'Intervenție'}
            </Badge>
            <Link
              href={`/activitate/${sheet.workUnitId}`}
              className="font-medium text-ink hover:text-brand-700"
            >
              {sheet.name}
            </Link>
            <span className="tabular-nums text-xs text-ink-muted">{sheet.code}</span>
            <span className="tabular-nums text-xs text-ink-muted">{sheet.performedOn}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
