'use client';

import type { FieldStage, FieldWorkUnit } from '@damina/services';
import { uuidv7 } from '@damina/shared';
import { Button, EmptyState, Select, Textarea } from '@damina/ui';
import { BookText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fieldDb, hasIndexedDb } from '../../lib/field/db';
import { enqueueMutation } from '../../lib/field/sync';
import { PhotoCapture } from './photo-capture';
import { useSync } from './sync-provider';

/**
 * `Jurnal de șantier` — a treia acțiune de sub ＋ (§3.5).
 *
 * **Același buget ca la `Necesar material`: două tapuri sunt deja cheltuite**
 * (＋ și acțiunea), deci ecranul are voie la unul singur, cel de Trimite. De
 * aici, tot ce e mai jos:
 *
 *  - **unitatea vine precompletată** cu prima din felie, iar **data e azi** —
 *    cazul obișnuit e că omul consemnează seara ce a făcut în ziua aia;
 *  - **etapa e opțională și pornește goală.** Un `select` obligatoriu ar fi
 *    costat un tap la fiecare consemnare, pentru o informație care lipsește
 *    oricum la intervenții. Apare doar dacă unitatea aleasă chiar are etape;
 *  - **poza nu e obligatorie.** Când există, pleacă prin coada `media`, în
 *    folderul unității — nu se leagă de intrarea de jurnal, fiindcă o a doua
 *    legătură ar fi însemnat două adevăruri despre același fișier.
 *
 * Consemnarea **se adaugă**, nu rescrie: nu există „editează". O corectură se
 * scrie ca intrare nouă, cu data ei. Un jurnal care se poate rescrie nu mai e o
 * consemnare, ci o părere de acum despre ce a fost atunci.
 */
export function JournalEntry() {
  const router = useRouter();
  const { refresh, syncNow, lastPulledAt } = useSync();

  const [units, setUnits] = useState<readonly FieldWorkUnit[] | null>(null);
  const [stages, setStages] = useState<readonly FieldStage[]>([]);
  const [unitId, setUnitId] = useState('');
  const [stageId, setStageId] = useState('');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!hasIndexedDb()) {
        setUnits([]);
        return;
      }
      const [rows, stageRows] = await Promise.all([
        fieldDb().workUnits.toArray(),
        fieldDb().stages.toArray(),
      ]);
      const sorted = [...rows].sort((a, b) =>
        (a.startsOn ?? '9999').localeCompare(b.startsOn ?? '9999'),
      );
      setUnits(sorted);
      setStages(stageRows);
      setUnitId((current) => (current === '' ? (sorted[0]?.id ?? '') : current));
    })();
  }, [lastPulledAt]);

  if (units === null) {
    return <p className="text-sm text-ink-muted">Se citește de pe telefon…</p>;
  }

  if (units.length === 0) {
    return (
      <EmptyState
        icon={<BookText className="size-5" aria-hidden />}
        title="N-ai nicio lucrare pe telefon"
        body="Consemnarea se leagă de o unitate de lucru, ca să se știe la ce șantier e. Deschide aplicația o dată cu semnal ca să-ți iei lucrările."
      />
    );
  }

  const unit = units.find((row) => row.id === unitId);
  const unitStages = stages.filter((stage) => stage.workUnitId === unitId);

  function send(): void {
    if (unit === undefined) {
      return;
    }
    void (async () => {
      setSaving(true);
      try {
        await enqueueMutation({
          id: uuidv7(),
          type: 'journal.append',
          payload: {
            workUnitId: unit.id,
            stageId: unitStages.some((stage) => stage.id === stageId) ? stageId : '',
            // Data de pe telefon, nu de pe server: în subsol serverul nu există,
            // iar ce contează e ziua în care s-a întâmplat, nu cea în care ajunge.
            entryDate: new Date().toISOString().slice(0, 10),
            text,
          },
          createdAt: new Date().toISOString(),
          label: `Jurnal · ${unit.code}`,
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
          setStageId('');
        }}
      />

      {unitStages.length > 0 ? (
        <Select
          aria-label="Etapa"
          value={stageId}
          options={[
            { value: '', label: 'Fără etapă' },
            ...unitStages.map((stage) => ({ value: stage.id, label: stage.name })),
          ]}
          onChange={(event) => {
            setStageId(event.target.value);
          }}
        />
      ) : null}

      <Textarea
        aria-label="Ce s-a întâmplat azi"
        placeholder="Ce s-a întâmplat azi? Ex: turnat radier zona 2, oprit 2 ore de ploaie"
        rows={6}
        autoFocus
        data-testid="journal-text"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />

      <div className="flex items-center gap-3">
        <PhotoCapture
          workUnitId={unitId}
          label="Adaugă poză"
          onAdded={() => {
            setPhotos((current) => current + 1);
          }}
        />
        {photos > 0 ? <span className="text-sm text-ink-muted">{photos} în coadă</span> : null}
      </div>

      <Button
        variant="primary"
        className="min-h-12 w-full"
        data-testid="send-journal"
        loading={saving}
        disabled={saving || text.trim() === '' || unit === undefined}
        disabledReason={text.trim() === '' ? 'Scrie ce s-a întâmplat.' : undefined}
        onClick={send}
      >
        Trimite în jurnal
      </Button>

      <p className="text-center text-xs text-ink-subtle">
        Se adaugă la jurnalul lucrării. Merge și fără semnal — pleacă singură când prinzi.
      </p>
    </div>
  );
}
