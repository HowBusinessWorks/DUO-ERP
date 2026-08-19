'use client';

import type {
  FieldInterventionSheet as FieldSheet,
  FieldPerson,
  FieldStockLine,
  FieldWorkUnit,
} from '@damina/services';
import { uuidv7 } from '@damina/shared';
import { Badge, Banner, Button, EmptyState, Input, Select, Textarea } from '@damina/ui';
import { PackageX, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fieldDb, hasIndexedDb } from '../../lib/field/db';
import { discardMutation, enqueueMutation } from '../../lib/field/sync';
import { PhotoCapture } from './photo-capture';
import { useSync } from './sync-provider';

/**
 * Fișa de intervenție, pe teren (§3.5).
 *
 * Trei decizii care nu se văd din cod:
 *
 *  1. **Materialele vin doar din gestiunea echipei.** Felia aduce stoc numai
 *     din gestiunile de tip `echipa`; magazia centrală n-are ce căuta pe
 *     telefonul unui om care consumă din lada lui. Dacă unitatea n-are echipă,
 *     nu se poate consuma de aici — se spune, nu se ascunde.
 *  2. **Cantitatea se compară cu disponibilul, local.** Nu ca să înlocuiască
 *     verificarea serverului — ea rămâne singura care contează — ci ca omul să
 *     n-o afle a doua zi. Stocul din felie e vechi de un pull; de aceea mesajul
 *     e „nu mai e atât în gestiune", nu „e imposibil".
 *  3. **Pozele au fază.** „Înainte" și „După" sunt foldere separate în arbore,
 *     iar la o intervenție dovada e perechea, nu poza.
 *
 * Ca la inspecție, se trimite fișa **întreagă**: serviciul rescrie materialele
 * și orele într-o tranzacție.
 */

interface MaterialRow {
  readonly key: string;
  productId: string;
  quantity: string;
}

interface HourRow {
  readonly key: string;
  personId: string;
  hours: string;
  workDate: string;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export interface FieldInterventionSheetProps {
  readonly unit: FieldWorkUnit;
  readonly copyOf?: string;
}

export function FieldInterventionSheet({ unit, copyOf }: FieldInterventionSheetProps) {
  const router = useRouter();
  const { refresh, syncNow } = useSync();

  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState<FieldSheet | null>(null);
  const [stock, setStock] = useState<readonly FieldStockLine[]>([]);
  const [people, setPeople] = useState<readonly FieldPerson[]>([]);
  const [description, setDescription] = useState('');
  const [declaredHours, setDeclaredHours] = useState('');
  const [materials, setMaterials] = useState<readonly MaterialRow[]>([]);
  const [hours, setHours] = useState<readonly HourRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!hasIndexedDb()) {
        setLoaded(true);
        return;
      }
      const db = fieldDb();
      const [found, stockRows, peopleRows] = await Promise.all([
        db.interventionSheets.get(unit.id),
        unit.locationId === ''
          ? Promise.resolve([])
          : db.stock.where('locationId').equals(unit.locationId).toArray(),
        db.people.toArray(),
      ]);

      setSheet(found ?? null);
      setStock(stockRows);
      setPeople(peopleRows);

      const source =
        copyOf === undefined
          ? null
          : (((await db.outbox.get(copyOf))?.payload as
              | {
                  description?: string | null;
                  declaredHours?: string | null;
                  materials?: { productId: string; quantity: string }[];
                  hours?: { personId: string; hours: string; workDate: string }[];
                }
              | undefined) ?? null);

      if (source !== null) {
        // Copia porneste din ce a scris OMUL, nu din ce stie serverul.
        setDescription(source.description ?? '');
        setDeclaredHours(source.declaredHours ?? '');
        setMaterials((source.materials ?? []).map((row) => ({ key: uuidv7(), ...row })));
        setHours((source.hours ?? []).map((row) => ({ key: uuidv7(), ...row })));
      } else if (found !== undefined) {
        setDescription(found.description ?? '');
        setDeclaredHours(found.declaredHours ?? '');
        setMaterials(
          found.materials.map((row) => ({
            key: uuidv7(),
            productId: row.productId,
            quantity: row.quantity,
          })),
        );
        setHours(
          found.hours.map((row) => ({
            key: uuidv7(),
            personId: row.personId,
            hours: row.hours,
            workDate: row.workDate,
          })),
        );
      }

      setLoaded(true);
    })();
  }, [copyOf, unit.id, unit.locationId]);

  if (!loaded) {
    return <p className="text-sm text-ink-muted">Se citește fișa de pe telefon…</p>;
  }

  const readOnly = unit.validated;
  const byProduct = new Map(stock.map((line) => [line.productId, line]));

  /** Ce oprește trimiterea, verificat local ca omul să afle acum, nu mâine. */
  const problems: string[] = [];
  for (const row of materials) {
    const line = row.productId === '' ? undefined : byProduct.get(row.productId);
    if (line === undefined) {
      problems.push('Alege produsul pentru fiecare linie de material.');
      continue;
    }
    if (row.quantity === '' || Number(row.quantity) <= 0) {
      problems.push(`Scrie cantitatea pentru ${line.productName}.`);
      continue;
    }
    if (Number(row.quantity) > Number(line.available)) {
      problems.push(
        `Nu mai e atât ${line.productName} în gestiune: ${line.available} ${line.uom}.`,
      );
    }
  }
  for (const row of hours) {
    if (row.personId === '' || row.hours === '' || Number(row.hours) <= 0) {
      problems.push('Fiecare linie de ore are nevoie de om și de ore.');
      break;
    }
  }

  function send(): void {
    void (async () => {
      setSaving(true);
      try {
        await enqueueMutation({
          id: uuidv7(),
          type: 'intervention.save',
          payload: {
            workUnitId: unit.id,
            description,
            operationId: sheet?.operationId ?? '',
            teamId: sheet?.teamId ?? '',
            declaredHours,
            materials: materials.map((row) => ({
              productId: row.productId,
              lotId: '',
              quantity: row.quantity,
              locationId: unit.locationId,
            })),
            hours: hours.map((row) => ({
              personId: row.personId,
              hours: row.hours,
              workDate: row.workDate,
            })),
          },
          createdAt: new Date().toISOString(),
          label: `Intervenție ${unit.code} · ${unit.objectiveName}`,
          entityId: unit.id,
        });

        if (copyOf !== undefined) {
          await discardMutation(copyOf);
        }

        await refresh();
        void syncNow();
        router.push('/field');
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <div className="space-y-4">
      {unit.validated ? (
        <Banner
          tone="info"
          title="Fișa e validată"
          body="A fost închisă la birou. Ce vezi e ce s-a trimis; modificările se fac de acolo."
        />
      ) : null}

      {copyOf !== undefined ? (
        <Banner
          tone="info"
          title="Copie a unei fișe refuzate"
          body="Ai în față ce ai scris tu, nu ce e la birou. Corectează motivul refuzului și trimite — pleacă drept fișă nouă, iar cea refuzată dispare din coadă."
        />
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-ink">Ce s-a făcut</h2>
        <Textarea
          aria-label="Descrierea intervenției"
          placeholder="Ce s-a constatat și ce s-a făcut"
          rows={3}
          disabled={readOnly}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Materiale</h2>
          {unit.locationId === '' ? null : (
            <Badge tone="outline">{stock[0]?.locationName ?? 'gestiunea echipei'}</Badge>
          )}
        </div>

        {unit.locationId === '' ? (
          <EmptyState
            icon={<PackageX className="size-5" aria-hidden />}
            title="Intervenția n-are gestiune de echipă"
            body="Materialele se scad dintr-o gestiune, iar unitatea asta n-are echipă cu gestiune activă. Cere-i biroului să o lege, apoi reia fișa."
          />
        ) : (
          <>
            {materials.map((row) => {
              const line = byProduct.get(row.productId);
              return (
                <div key={row.key} className="space-y-2 rounded-lg border border-border p-3">
                  <Select
                    aria-label="Produs"
                    disabled={readOnly}
                    value={row.productId}
                    placeholder="Alege produsul"
                    options={stock.map((entry) => ({
                      value: entry.productId,
                      label: `${entry.productName} · ${entry.available} ${entry.uom}`,
                    }))}
                    onChange={(event) => {
                      setMaterials((current) =>
                        current.map((entry) =>
                          entry.key === row.key
                            ? { ...entry, productId: event.target.value }
                            : entry,
                        ),
                      );
                    }}
                  />
                  <div className="flex gap-2">
                    <Input
                      aria-label="Cantitate"
                      placeholder="Cantitate"
                      inputMode="decimal"
                      className="min-h-12"
                      disabled={readOnly}
                      value={row.quantity}
                      onChange={(event) => {
                        setMaterials((current) =>
                          current.map((entry) =>
                            entry.key === row.key
                              ? { ...entry, quantity: event.target.value }
                              : entry,
                          ),
                        );
                      }}
                    />
                    <span className="self-center text-sm text-ink-muted">{line?.uom ?? ''}</span>
                    <Button
                      variant="ghost"
                      aria-label="Șterge linia"
                      disabled={readOnly}
                      onClick={() => {
                        setMaterials((current) => current.filter((entry) => entry.key !== row.key));
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              );
            })}

            {readOnly ? null : (
              <Button
                variant="secondary"
                className="min-h-12 w-full"
                disabled={stock.length === 0}
                disabledReason={
                  stock.length === 0
                    ? 'Gestiunea echipei e goală în felia de pe telefon.'
                    : undefined
                }
                onClick={() => {
                  setMaterials((current) => [
                    ...current,
                    { key: uuidv7(), productId: '', quantity: '' },
                  ]);
                }}
              >
                <Plus className="size-4" aria-hidden /> Adaugă material
              </Button>
            )}
          </>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-ink">Ore</h2>
        {hours.map((row) => (
          <div key={row.key} className="space-y-2 rounded-lg border border-border p-3">
            <Select
              aria-label="Persoană"
              disabled={readOnly}
              value={row.personId}
              placeholder="Cine a lucrat"
              options={people.map((person) => ({ value: person.id, label: person.fullName }))}
              onChange={(event) => {
                setHours((current) =>
                  current.map((entry) =>
                    entry.key === row.key ? { ...entry, personId: event.target.value } : entry,
                  ),
                );
              }}
            />
            <div className="flex gap-2">
              <Input
                aria-label="Ore"
                placeholder="Ore"
                inputMode="decimal"
                className="min-h-12"
                disabled={readOnly}
                value={row.hours}
                onChange={(event) => {
                  setHours((current) =>
                    current.map((entry) =>
                      entry.key === row.key ? { ...entry, hours: event.target.value } : entry,
                    ),
                  );
                }}
              />
              <Input
                aria-label="Ziua"
                type="date"
                className="min-h-12"
                disabled={readOnly}
                value={row.workDate}
                onChange={(event) => {
                  setHours((current) =>
                    current.map((entry) =>
                      entry.key === row.key ? { ...entry, workDate: event.target.value } : entry,
                    ),
                  );
                }}
              />
              <Button
                variant="ghost"
                aria-label="Șterge linia"
                disabled={readOnly}
                onClick={() => {
                  setHours((current) => current.filter((entry) => entry.key !== row.key));
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}

        {readOnly ? null : (
          <Button
            variant="secondary"
            className="min-h-12 w-full"
            onClick={() => {
              setHours((current) => [
                ...current,
                { key: uuidv7(), personId: '', hours: '', workDate: today() },
              ]);
            }}
          >
            <Plus className="size-4" aria-hidden /> Adaugă ore
          </Button>
        )}
      </section>

      {readOnly ? null : (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-ink">Poze</h2>
          <PhotoCapture workUnitId={unit.id} phase="inainte" label="Poză înainte" />
          <PhotoCapture workUnitId={unit.id} phase="dupa" label="Poză după" />
        </section>
      )}

      {readOnly ? null : (
        <div className="space-y-2">
          {problems.length > 0 ? (
            <p className="text-center text-sm text-warning-700">{problems[0]}</p>
          ) : null}
          <Button
            variant="primary"
            className="min-h-12 w-full"
            data-testid="send-sheet"
            loading={saving}
            disabled={saving || problems.length > 0}
            disabledReason={problems[0]}
            onClick={send}
          >
            Trimite fișa
          </Button>
          <p className="text-center text-xs text-ink-subtle">
            Merge și fără semnal — intră în coadă și pleacă singură.
          </p>
        </div>
      )}
    </div>
  );
}
