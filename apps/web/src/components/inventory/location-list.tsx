'use client';

import { LOCATION_TYPES, LOCATION_TYPE_LABELS, type LocationType } from '@damina/contracts';
import { Badge, Banner, Button, Dialog, Input, Select, useToast } from '@damina/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createLocationAction } from '../../app/(office)/inventory-actions';

/**
 * Gestiunile (§3.4).
 *
 * **Regula 3 a pasului se vede prin ce LIPSEȘTE din formular**: nu există
 * „gestiune de contract", pentru că `location_type` n-are valoarea asta.
 * Contractul apare abia pe bonul de consum, ca dimensiune analitică. Ecranul
 * nu interzice nimic — n-are ce să ofere, iar verificarea #16 trece negativ
 * prin construcție.
 *
 * Tipul și titularul merg împreună, în ambele sensuri: o gestiune de echipă
 * CERE echipa, iar una de magazie o interzice. Aceeași egalitate e un `check`
 * în bază; formularul o spune doar mai devreme și în românește.
 */

export interface LocationRowView {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly type: string;
  readonly isActive: boolean;
  readonly isCustody: boolean;
  readonly teamName: string | null;
}

export interface LocationListProps {
  readonly companyId: string;
  readonly locations: readonly LocationRowView[];
  /** Doar echipele FĂRĂ gestiune: a doua gestiune pentru aceeași echipă n-ar ști care e a ei. */
  readonly teams: readonly { readonly id: string; readonly name: string }[];
  readonly canWrite: boolean;
}

/** Tipurile care cer un titular. Restul sunt locuri fizice fără proprietar. */
const HOLDER_LABEL: Readonly<Partial<Record<LocationType, string>>> = {
  echipa: 'Echipa',
  subcontractant: 'Subcontractantul',
  consignatie: 'Furnizorul',
  santier: 'Unitatea de lucru',
};

export function LocationList({ companyId, locations, teams, canWrite }: LocationListProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [form, setForm] = useState({ name: '', code: '', type: 'echipa', teamId: '' });

  const holder = HOLDER_LABEL[form.type as LocationType];
  // Doar echipa are selector aici. Șantierul, subcontractantul și consignația
  // își aleg titularul din alte liste, care sosesc odată cu modulele lor.
  const supported = form.type === 'echipa' || holder === undefined;

  function submit(): void {
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await createLocationAction({
        companyId,
        type: form.type,
        name: form.name,
        code: form.code,
        parentLocationId: '',
        teamId: form.type === 'echipa' ? form.teamId : '',
        workUnitId: '',
        subcontractorId: '',
        supplierId: '',
        isCustody: false,
      });
      setSaving(false);

      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast({ tone: 'success', title: 'Gestiunea e creată' });
      setOpen(false);
      setForm({ name: '', code: '', type: 'echipa', teamId: '' });
      router.refresh();
    })();
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-muted">
          Gestiunea e un <span className="font-medium text-ink">loc fizic</span>: magazie, șantier,
          echipă, subcontractant, unelte, utilaje, consignație. Contractul nu e o gestiune — el e o
          dimensiune pe bonul de consum, acolo unde materialul devine cheltuială.
        </p>
        {canWrite ? (
          <Button
            onClick={() => {
              setOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden /> Gestiune nouă
          </Button>
        ) : null}
      </div>

      {locations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-ink-muted">
          Nicio gestiune pe firmele selectate.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {locations.map((location) => (
            <li key={location.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="font-medium text-ink">{location.name}</span>
              <span className="tabular-nums text-xs text-ink-muted">{location.code}</span>
              <Badge tone="outline">
                {LOCATION_TYPE_LABELS[location.type as LocationType] ?? location.type}
              </Badge>
              {location.teamName === null ? null : (
                <span className="text-xs text-ink-muted">{location.teamName}</span>
              )}
              {location.isCustody ? <Badge tone="warning">În custodie</Badge> : null}
              {location.isActive ? null : <Badge tone="neutral">Inactivă</Badge>}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
        }}
        title="Gestiune nouă"
      >
        <div className="space-y-3">
          {error === undefined ? null : <Banner tone="danger" title="Nu s-a putut" body={error} />}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-muted">Tipul</span>
            <Select
              options={LOCATION_TYPES.map((type) => ({
                value: type,
                label: LOCATION_TYPE_LABELS[type],
              }))}
              value={form.type}
              onChange={(event) => {
                setForm({ ...form, type: event.target.value, teamId: '' });
              }}
            />
            <span className="block text-xs text-ink-subtle">
              Toate șapte sunt locuri fizice. „Gestiune de contract" nu e o opțiune, și nu pentru că
              e interzisă aici — nu există în listă.
            </span>
          </label>

          {form.type === 'echipa' ? (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink-muted">Echipa</span>
              <Select
                options={teams.map((team) => ({ value: team.id, label: team.name }))}
                placeholder={teams.length === 0 ? 'Toate echipele au gestiune' : 'Alege echipa'}
                value={form.teamId}
                disabled={teams.length === 0}
                onChange={(event) => {
                  setForm({ ...form, teamId: event.target.value });
                }}
              />
            </label>
          ) : null}

          {supported ? null : (
            <Banner
              tone="info"
              title={`${holder ?? 'Titularul'} se alege din modulul lui`}
              body="Tipul ăsta de gestiune cere un titular care vine cu alt modul. Până atunci, creează gestiuni de echipă și magazii."
            />
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-muted">Denumirea</span>
            <Input
              value={form.name}
              onChange={(event) => {
                setForm({ ...form, name: event.target.value });
              }}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-muted">Codul scurt</span>
            <Input
              value={form.code}
              placeholder="MC-01, EC-INST-1"
              onChange={(event) => {
                setForm({ ...form, code: event.target.value });
              }}
            />
            <span className="block text-xs text-ink-subtle">Apare pe documente. Unic pe firmă.</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Renunță
            </Button>
            <Button onClick={submit} disabled={saving || !supported}>
              {saving ? 'Se creează…' : 'Creează gestiunea'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
