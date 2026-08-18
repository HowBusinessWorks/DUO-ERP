'use client';

import { t } from '@damina/i18n';
import { Banner, Button, Input, Select, useToast } from '@damina/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { saveOperationMaterials } from '../../app/(office)/request-actions';

/**
 * Materialele tipice ale unei operațiuni, editate ca listă întreagă.
 *
 * Cantitativ, nu valoric: prețurile de referință per produs vin cu
 * aprovizionarea (faza 3), iar o sumă calculată dintr-un preț inventat ar arăta
 * la fel de sigură ca una reală. Materialul estimat rămâne o cifră scrisă pe
 * operațiune; lista de aici spune din ce e făcută.
 */

export interface MaterialLine {
  readonly productId: string;
  readonly quantity: string;
}

export interface OperationMaterialsProps {
  readonly operationId: string;
  readonly initialLines: readonly MaterialLine[];
  readonly products: readonly { readonly value: string; readonly label: string }[];
  readonly canEdit: boolean;
}

export function OperationMaterials({
  operationId,
  initialLines,
  products,
  canEdit,
}: OperationMaterialsProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [lines, setLines] = useState<MaterialLine[]>([...initialLines]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  function save(): void {
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await saveOperationMaterials({ operationId, lines });
      setSaving(false);
      if (result.ok) {
        toast({ tone: 'success', title: t('form.saved') });
        router.refresh();
      } else {
        setError(result.message);
      }
    })();
  }

  return (
    <div className="space-y-3">
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-ink-muted">
          Nicio linie de material. O operațiune fără materiale tipice e o operațiune de manoperă
          curată — ceea ce e o informație, nu o lipsă.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line, position) => (
            <li
              key={`${line.productId}-${String(position)}`}
              className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
            >
              <label className="block min-w-64 flex-1">
                <span className="mb-1 block text-sm font-medium text-ink">Produs</span>
                <Select
                  options={products}
                  value={line.productId}
                  disabled={!canEdit}
                  onChange={(event) => {
                    const next = event.target.value;
                    setLines((current) =>
                      current.map((entry, index) =>
                        index === position ? { ...entry, productId: next } : entry,
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
          ))}
        </ul>
      )}

      {error === undefined ? null : (
        <Banner tone="danger" title="Lista n-a putut fi salvată" body={error} />
      )}

      {canEdit ? (
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setLines((current) => [
                ...current,
                { productId: products[0]?.value ?? '', quantity: '1' },
              ]);
            }}
          >
            Adaugă material
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Salvează lista
          </Button>
        </div>
      ) : null}
    </div>
  );
}
