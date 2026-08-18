'use client';

import { t } from '@damina/i18n';
import { Money as MoneyValue } from '@damina/shared';
import { Banner, Button, EmptyState, Input, Money, Select, useToast } from '@damina/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { evaluateRequestAction } from '../../app/(office)/request-actions';

/**
 * Tab-ul Evaluare (§3.5, verificarea #5).
 *
 * Valoarea estimată nu se tastează: se calculează din catalog, operațiune ×
 * cantitate. Cifra de sub tabel e SUMA rândurilor de deasupra ei — aceleași
 * înmulțiri, adunate. Nu cheamă `estimateFromCatalog` din `@damina/domain`
 * pentru că `apps/web` n-are voie să importe `domain` (regula de dependențe din
 * §3.2); cifra care ajunge în bază e cea calculată de `evaluateRequest`, cu
 * funcția din domain, iar ecranul o primește înapoi după salvare.
 *
 * Se trimite lista întreagă, nu diferențe: liniile și valoarea de pe cerere se
 * rescriu împreună, într-o tranzacție.
 */

export interface CatalogOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly estimatedLabor: string;
  readonly estimatedMaterial: string;
}

export interface EvaluationLine {
  readonly operationId: string;
  readonly quantity: string;
}

export interface EvaluationEditorProps {
  readonly requestId: string;
  readonly initialLines: readonly EvaluationLine[];
  readonly operations: readonly CatalogOption[];
  readonly canEdit: boolean;
  readonly editBlockedReason?: string;
}

export function EvaluationEditor({
  requestId,
  initialLines,
  operations,
  canEdit,
  editBlockedReason,
}: EvaluationEditorProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [lines, setLines] = useState<EvaluationLine[]>([...initialLines]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const byId = new Map(operations.map((operation) => [operation.id, operation]));

  const priced = lines
    .map((line) => ({ line, operation: byId.get(line.operationId) }))
    .filter((entry): entry is { line: EvaluationLine; operation: CatalogOption } =>
      entry.operation !== undefined,
    );

  const quantities = priced.map((entry) => Number(entry.line.quantity.replace(',', '.')) || 0);
  const estimate = {
    labor: MoneyValue.sum(
      priced.map((entry, index) =>
        MoneyValue.fromDb(entry.operation.estimatedLabor).mul(quantities[index] ?? 0),
      ),
    ),
    material: MoneyValue.sum(
      priced.map((entry, index) =>
        MoneyValue.fromDb(entry.operation.estimatedMaterial).mul(quantities[index] ?? 0),
      ),
    ),
  };
  const estimateTotal = estimate.labor.add(estimate.material);

  function save(): void {
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await evaluateRequestAction({ requestId, lines });
      setSaving(false);
      if (result.ok) {
        toast({ tone: 'success', title: t('form.saved') });
        router.refresh();
      } else {
        setError(result.message);
      }
    })();
  }

  if (operations.length === 0) {
    return (
      <EmptyState
        title="Catalogul de operațiuni e gol"
        body="Evaluarea se face din catalog: operațiune × cantitate → normă de timp × tarif + materiale. Fără catalog, valoarea estimată ar fi părerea celui care o scrie, iar pragul de rutare ar depinde de cine a tastat cifra."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-ink-muted">
        Valoarea estimată a cererii se <strong>calculează</strong> din liniile de mai jos, cu
        manopera derivată din tariful curent al calificării. Salvarea rescrie și cifra de pe cerere.
      </p>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-ink-muted">
          Nicio linie. Adaugă prima operațiune.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line, position) => {
            const operation = byId.get(line.operationId);
            const unit =
              operation === undefined
                ? MoneyValue.ZERO
                : MoneyValue.fromDb(operation.estimatedLabor).add(
                    MoneyValue.fromDb(operation.estimatedMaterial),
                  );
            const quantity = Number(line.quantity.replace(',', '.')) || 0;

            return (
              <li
                key={`${line.operationId}-${String(position)}`}
                className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
              >
                <label className="block min-w-64 flex-1">
                  <span className="mb-1 block text-sm font-medium text-ink">Operațiune</span>
                  <Select
                    options={operations.map((candidate) => ({
                      value: candidate.id,
                      label: `${candidate.code} · ${candidate.name}`,
                    }))}
                    value={line.operationId}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const next = event.target.value;
                      setLines((current) =>
                        current.map((entry, index) =>
                          index === position ? { ...entry, operationId: next } : entry,
                        ),
                      );
                    }}
                  />
                </label>

                <label className="block w-28">
                  <span className="mb-1 block text-sm font-medium text-ink">Cantitate</span>
                  <Input
                    inputMode="decimal"
                    value={line.quantity}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const next = event.target.value;
                      setLines((current) =>
                        current.map((entry, index) =>
                          index === position ? { ...entry, quantity: next } : entry,
                        ),
                      );
                    }}
                  />
                </label>

                <span className="pb-2">
                  <Money value={unit.mul(quantity)} />
                  <span className="ml-2 text-xs text-ink-subtle">
                    {unit.format()} / unitate
                  </span>
                </span>

                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="size-4" aria-hidden="true" />}
                    onClick={() => {
                      setLines((current) => current.filter((_, index) => index !== position));
                    }}
                  >
                    Șterge
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3">
        <span className="text-sm text-ink-muted">
          Manoperă <Money value={estimate.labor} /> + material{' '}
          <Money value={estimate.material} />
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-sm text-ink-muted">Valoare estimată</span>
          <Money value={estimateTotal} emphasis />
        </span>
      </div>

      {error === undefined ? null : (
        <Banner tone="danger" title="Evaluarea n-a mers" body={error} />
      )}

      {canEdit ? (
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setLines((current) => [
                ...current,
                { operationId: operations[0]?.id ?? '', quantity: '1' },
              ]);
            }}
          >
            Adaugă operațiune
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Salvează evaluarea
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-subtle">
          {editBlockedReason ?? 'Rolul tău nu poate evalua cereri.'}
        </p>
      )}
    </div>
  );
}
