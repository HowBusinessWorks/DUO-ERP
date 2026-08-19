'use client';

import type { FieldStage, FieldWorkUnit } from '@damina/services';
import { uuidv7 } from '@damina/shared';
import { Button, EmptyState, Input, Select } from '@damina/ui';
import { CalendarX, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fieldDb, hasIndexedDb } from '../../lib/field/db';
import { enqueueMutation } from '../../lib/field/sync';
import { useSync } from './sync-provider';

/**
 * `Pontaj` — ziua mea, împărțită pe unități de lucru (§3.5).
 *
 * La birou, pontajul e o grilă om × zi, pentru că acolo se pontează echipa. Pe
 * teren e invers: **un singur om, o singură zi, mai multe unități.** Ăsta e
 * cazul real — dimineața la o intervenție, după-amiaza la o lucrare — și e chiar
 * motivul pentru care pontajul de teren există separat de cel de birou.
 *
 * `personId` vine din sesiune, nu din felie: un ecran care ar ghici omul din
 * primul rând de `people` ar ponta pe altcineva în ziua în care echipa se
 * schimbă.
 *
 * Salvarea e **idempotentă pe cheia naturală** (om, zi) în serviciu, deci o
 * retrimitere nu dublează ziua. Asta e și motivul pentru care pontajul e
 * singurul tip de mutație la care reexecutarea după uitarea jurnalului nu doare
 * — vezi `docs/field-sync.md`.
 */

interface LineRow {
  readonly key: string;
  workUnitId: string;
  stageId: string;
  hours: string;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export function TimesheetDay() {
  const router = useRouter();
  const { personId, refresh, syncNow, lastPulledAt } = useSync();

  const [units, setUnits] = useState<readonly FieldWorkUnit[] | null>(null);
  const [stages, setStages] = useState<readonly FieldStage[]>([]);
  const [workDate, setWorkDate] = useState(today);
  const [lines, setLines] = useState<readonly LineRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!hasIndexedDb()) {
        setUnits([]);
        return;
      }
      const db = fieldDb();
      const [unitRows, stageRows] = await Promise.all([
        db.workUnits.toArray(),
        db.stages.toArray(),
      ]);
      const sorted = [...unitRows].sort((a, b) =>
        (a.startsOn ?? '9999').localeCompare(b.startsOn ?? '9999'),
      );
      setUnits(sorted);
      setStages(stageRows);
      // O linie gata pusa, pe unitatea de azi: ziua obisnuita e o singura UL.
      setLines((current) =>
        current.length > 0
          ? current
          : [{ key: uuidv7(), workUnitId: sorted[0]?.id ?? '', stageId: '', hours: '8' }],
      );
    })();
  }, [lastPulledAt]);

  if (units === null) {
    return <p className="text-sm text-ink-muted">Se citește de pe telefon…</p>;
  }

  if (units.length === 0) {
    return (
      <EmptyState
        icon={<CalendarX className="size-5" aria-hidden />}
        title="N-ai pe ce ponta"
        body="Pontajul se leagă de unitățile pe care ești repartizat. Deschide aplicația o dată cu semnal ca să ți le iei."
      />
    );
  }

  const total = lines.reduce((sum, line) => sum + (Number(line.hours) || 0), 0);
  const companyId = units.find((row) => row.id === lines[0]?.workUnitId)?.companyId ?? '';

  const problems: string[] = [];
  if (lines.length === 0) {
    problems.push('Adaugă cel puțin o linie.');
  }
  for (const line of lines) {
    if (line.workUnitId === '' || line.hours === '' || Number(line.hours) <= 0) {
      problems.push('Fiecare linie are nevoie de o unitate și de ore.');
      break;
    }
  }
  // Pragul e o avertizare, nu un blocaj: zilele de 14 ore exista, iar ecranul
  // n-are de unde sti daca e o greseala de tastare sau o avarie de noapte.
  const longDay = total > 12;

  function send(): void {
    void (async () => {
      setSaving(true);
      try {
        await enqueueMutation({
          id: uuidv7(),
          type: 'timesheet.save',
          payload: {
            companyId,
            personId,
            workDate,
            lines: lines.map((line) => ({
              workUnitId: line.workUnitId,
              stageId: line.stageId,
              hours: line.hours,
            })),
          },
          createdAt: new Date().toISOString(),
          label: `Pontaj ${workDate} · ${String(total)} h`,
          entityId: lines[0]?.workUnitId ?? '',
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
      <Input
        aria-label="Ziua"
        type="date"
        className="min-h-12"
        value={workDate}
        onChange={(event) => {
          setWorkDate(event.target.value);
        }}
      />

      {lines.map((line) => (
        <div key={line.key} className="space-y-2 rounded-lg border border-border p-3">
          <Select
            aria-label="Unitatea de lucru"
            value={line.workUnitId}
            options={units.map((row) => ({
              value: row.id,
              label: `${row.code} · ${row.objectiveName}`,
            }))}
            onChange={(event) => {
              setLines((current) =>
                current.map((entry) =>
                  entry.key === line.key
                    ? { ...entry, workUnitId: event.target.value, stageId: '' }
                    : entry,
                ),
              );
            }}
          />

          {stages.some((stage) => stage.workUnitId === line.workUnitId) ? (
            <Select
              aria-label="Etapa"
              value={line.stageId}
              placeholder="Fără etapă"
              options={stages
                .filter((stage) => stage.workUnitId === line.workUnitId)
                .map((stage) => ({ value: stage.id, label: stage.name }))}
              onChange={(event) => {
                setLines((current) =>
                  current.map((entry) =>
                    entry.key === line.key ? { ...entry, stageId: event.target.value } : entry,
                  ),
                );
              }}
            />
          ) : null}

          <div className="flex gap-2">
            <Input
              aria-label="Ore"
              placeholder="Ore"
              inputMode="decimal"
              className="min-h-12"
              value={line.hours}
              onChange={(event) => {
                setLines((current) =>
                  current.map((entry) =>
                    entry.key === line.key ? { ...entry, hours: event.target.value } : entry,
                  ),
                );
              }}
            />
            <Button
              variant="ghost"
              aria-label="Șterge linia"
              disabled={lines.length === 1}
              onClick={() => {
                setLines((current) => current.filter((entry) => entry.key !== line.key));
              }}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      ))}

      <Button
        variant="secondary"
        className="min-h-12 w-full"
        onClick={() => {
          setLines((current) => [
            ...current,
            { key: uuidv7(), workUnitId: units[0]?.id ?? '', stageId: '', hours: '' },
          ]);
        }}
      >
        <Plus className="size-4" aria-hidden /> Încă o unitate
      </Button>

      <p className="text-center text-sm text-ink">
        Total: <strong>{String(total)}</strong> ore
      </p>
      {longDay ? (
        <p className="text-center text-xs text-warning-700">
          Peste 12 ore într-o zi. Dacă e corect, trimite — dacă nu, verifică orele.
        </p>
      ) : null}

      <Button
        variant="primary"
        className="min-h-12 w-full"
        data-testid="send-timesheet"
        loading={saving}
        disabled={saving || problems.length > 0}
        disabledReason={problems[0]}
        onClick={send}
      >
        Trimite pontajul
      </Button>

      <p className="text-center text-xs text-ink-subtle">
        Ziua se rescrie întreagă la fiecare trimitere — poți corecta și mâine.
      </p>
    </div>
  );
}
