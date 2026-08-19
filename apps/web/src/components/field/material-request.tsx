'use client';

import type { FieldWorkUnit } from '@damina/services';
import { uuidv7 } from '@damina/shared';
import { Button, EmptyState, Select, Textarea } from '@damina/ui';
import { PackageX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fieldDb, hasIndexedDb } from '../../lib/field/db';
import { enqueueMutation } from '../../lib/field/sync';
import { useSync } from './sync-provider';

/**
 * `Necesar material` — cea mai scumpă cerință de UX din tot proiectul (§0).
 *
 * **Trei tapuri, și două sunt deja cheltuite** înainte ca ecranul să se
 * deschidă: unul pe ＋, unul pe alegerea acțiunii. Rămâne exact unul, cel de
 * Trimite. De aici vin toate deciziile de mai jos:
 *
 *  - **unitatea de lucru vine precompletată** cu prima din felie, cea de azi.
 *    Schimbarea ei costă un tap, dar e cazul rar; cazul obișnuit e că omul e pe
 *    un singur șantier;
 *  - **nu există niciun câmp obligatoriu în afară de text.** Fără cantitate
 *    separată, fără unitate de măsură, fără categorie — toate ar fi fost
 *    corecte și toate ar fi costat câte un tap. Ce trebuie se scrie în clar, iar
 *    biroul triază oricum cererea;
 *  - **tastarea nu e un tap.** Regula numără atingeri separate, nu caractere.
 *
 * Dacă cineva adaugă mâine un pas de confirmare, testul din
 * `e2e/field/tap-budget.spec.ts` cade. Ăsta e singurul mod în care o cerință de
 * UX rămâne adevărată după șase luni de features: la 7 tapuri, șeful de șantier
 * dă telefon la magazie și toată trasabilitatea rămâne goală.
 */
export function MaterialRequest() {
  const router = useRouter();
  const { refresh, syncNow, lastPulledAt } = useSync();

  const [units, setUnits] = useState<readonly FieldWorkUnit[] | null>(null);
  const [unitId, setUnitId] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!hasIndexedDb()) {
        setUnits([]);
        return;
      }
      const rows = await fieldDb().workUnits.toArray();
      const sorted = [...rows].sort((a, b) =>
        (a.startsOn ?? '9999').localeCompare(b.startsOn ?? '9999'),
      );
      setUnits(sorted);
      // Precompletata, nu goala: un `select` fara valoare costa un tap in plus.
      setUnitId((current) => (current === '' ? (sorted[0]?.id ?? '') : current));
    })();
  }, [lastPulledAt]);

  if (units === null) {
    return <p className="text-sm text-ink-muted">Se citește de pe telefon…</p>;
  }

  if (units.length === 0) {
    return (
      <EmptyState
        icon={<PackageX className="size-5" aria-hidden />}
        title="N-ai nicio lucrare pe telefon"
        body="Cererea de material se leagă de o unitate de lucru, ca biroul să știe unde ajunge. Deschide aplicația o dată cu semnal ca să-ți iei lucrările."
      />
    );
  }

  const unit = units.find((row) => row.id === unitId);

  function send(): void {
    if (unit === undefined) {
      return;
    }
    void (async () => {
      setSaving(true);
      try {
        // Titlul e prima linie, restul intra in descriere: cererea se vede in
        // coada biroului ca un rand, si randul ala trebuie sa spuna ce trebuie.
        const [firstLine = '', ...rest] = text.split('\n');
        await enqueueMutation({
          id: uuidv7(),
          type: 'material.request',
          payload: {
            companyId: unit.companyId,
            type: 'solicitare',
            source: 'manual',
            objectiveId: unit.objectiveId,
            contractId: '',
            contractObjectiveId: '',
            title: firstLine.slice(0, 300),
            description: [`Cerut de pe teren pentru ${unit.code} — ${unit.name}.`, ...rest]
              .join('\n')
              .trim(),
            estimatedValue: '',
            slaDueAt: '',
          },
          createdAt: new Date().toISOString(),
          label: `Necesar material · ${unit.code}`,
          entityId: unit.id,
        });
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
      <Select
        aria-label="Pentru ce lucrare"
        value={unitId}
        options={units.map((row) => ({
          value: row.id,
          label: `${row.code} · ${row.objectiveName}`,
        }))}
        onChange={(event) => {
          setUnitId(event.target.value);
        }}
      />

      <Textarea
        aria-label="Ce îți trebuie"
        placeholder="Ce îți trebuie? Ex: 20 m țeavă PEHD 63, 4 coliere"
        rows={5}
        autoFocus
        data-testid="material-text"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />

      <Button
        variant="primary"
        className="min-h-12 w-full"
        data-testid="send-request"
        loading={saving}
        disabled={saving || text.trim() === '' || unit === undefined}
        disabledReason={text.trim() === '' ? 'Scrie ce îți trebuie.' : undefined}
        onClick={send}
      >
        Trimite cererea
      </Button>

      <p className="text-center text-xs text-ink-subtle">
        Ajunge în coada biroului. Merge și fără semnal — pleacă singură când prinzi.
      </p>
    </div>
  );
}
