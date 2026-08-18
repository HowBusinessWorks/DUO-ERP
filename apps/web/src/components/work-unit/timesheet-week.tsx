'use client';

import { Badge, Banner, Button, Checkbox, Input, Select, useToast } from '@damina/ui';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  saveTimesheetAction,
  validateTimesheetsAction,
} from '../../app/(office)/timesheet-actions';

/**
 * Activitate › Pontaj — saptamana de birou (§3.3).
 *
 * Trei lucruri sunt deliberate:
 *
 *  1. **Ziua se imparte pe mai multe unitati de lucru.** Celula din grila nu e
 *     un numar editabil: e totalul zilei, iar editarea se face pe LINII. Un
 *     câmp „8" direct în celulă ar fi cerut o a doua întrebare — pe ce anume —
 *     tocmai pentru cazul care contează, ziua împărțită.
 *  2. **Validarea nu e totul-sau-nimic între zile.** Fiecare zi are tranzacția
 *     ei; cele care nu pot fi validate se întorc listate, cu motivul. O
 *     săptămână dată înapoi din cauza unei zile fără tarif ar fi pus PM-ul să
 *     ghicească.
 *  3. **Nicio sumă în lei.** Tariful se îngheață la validare, în serviciu, din
 *     rate card-ul zilei lucrate. Ecranul arată ore — cine vrea bani îi vede în
 *     registrul de cost, unde au și analitica lor.
 */

export interface WeekLine {
  readonly id: string;
  readonly workUnitId: string;
  readonly stageId: string | null;
  readonly hours: string;
}

export interface WeekSheet {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly workDate: string;
  readonly status: string;
  readonly totalHours: string;
  readonly lines: readonly WeekLine[];
}

export interface WorkUnitOption {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly stages: readonly { readonly id: string; readonly name: string }[];
}

export interface TimesheetWeekProps {
  readonly companyId: string;
  readonly days: readonly string[];
  readonly sheets: readonly WeekSheet[];
  readonly persons: readonly { readonly id: string; readonly name: string }[];
  readonly workUnits: readonly WorkUnitOption[];
  readonly byPerson: Readonly<Record<string, string>>;
  readonly byWorkUnit: readonly { readonly label: string; readonly hours: string }[];
  readonly weekHref: (start: string) => string;
  readonly previousWeek: string;
  readonly nextWeek: string;
  readonly canWrite: boolean;
  readonly canValidate: boolean;
}

interface LineState {
  readonly key: string;
  readonly workUnitId: string;
  readonly stageId: string;
  readonly hours: string;
}

let counter = 0;
const nextKey = (): string => {
  counter += 1;
  return `n${String(counter)}`;
};

const decimal = (value: string): string => value.replace(',', '.');

const dayLabel = new Intl.DateTimeFormat('ro-RO', { weekday: 'short', day: '2-digit' });
const formatDay = (iso: string): string => dayLabel.format(new Date(`${iso}T00:00:00`));

/** Cheia unei celule din grilă: un om într-o zi. */
const cellKey = (personId: string, day: string): string => `${personId}|${day}`;

export function TimesheetWeek({
  companyId,
  days,
  sheets,
  persons,
  workUnits,
  byPerson,
  byWorkUnit,
  weekHref,
  previousWeek,
  nextWeek,
  canWrite,
  canValidate,
}: TimesheetWeekProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState<{ personId: string; day: string } | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<readonly string[]>([]);

  const byCell = new Map(sheets.map((sheet) => [cellKey(sheet.personId, sheet.workDate), sheet]));
  const unitById = new Map(workUnits.map((unit) => [unit.id, unit]));

  // Oamenii cu pontaj în săptămână, plus restul — ca să se poată deschide o zi
  // pentru cineva care n-a pontat încă.
  const rows = persons.filter(
    (person) =>
      sheets.some((sheet) => sheet.personId === person.id) ||
      open?.personId === person.id ||
      persons.length <= 40,
  );

  function openCell(personId: string, day: string): void {
    const sheet = byCell.get(cellKey(personId, day));
    setOpen({ personId, day });
    setError(undefined);
    setLines(
      (sheet?.lines ?? []).map((line) => ({
        key: line.id,
        workUnitId: line.workUnitId,
        stageId: line.stageId ?? '',
        hours: line.hours,
      })),
    );
  }

  function save(): void {
    if (open === null) {
      return;
    }
    const day = open;
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await saveTimesheetAction({
        companyId,
        personId: day.personId,
        workDate: day.day,
        lines: lines
          .filter((line) => line.workUnitId !== '' && line.hours !== '')
          .map((line) => ({
            workUnitId: line.workUnitId,
            stageId: line.stageId,
            hours: decimal(line.hours),
          })),
      });
      setSaving(false);

      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast({ tone: 'success', title: `Ziua e salvată: ${result.data.totalHours} ore` });
      setOpen(null);
      router.refresh();
    })();
  }

  function validate(): void {
    void (async () => {
      setError(undefined);
      setReport([]);
      setValidating(true);
      const result = await validateTimesheetsAction({ timesheetIds: selected, effectDate: '' });
      setValidating(false);

      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSelected([]);
      setReport(result.data.failures);
      toast({
        tone: result.data.failures.length === 0 ? 'success' : 'warning',
        title: `${String(result.data.validated)} pontaje validate`,
        body:
          result.data.failures.length === 0
            ? `${String(result.data.costLines)} linii de cost, cu tariful zilei lucrate.`
            : `${String(result.data.failures.length)} n-au putut fi validate. Motivele sunt mai jos.`,
      });
      router.refresh();
    })();
  }

  const validatable = sheets.filter((sheet) => sheet.status !== 'validated');
  const totalHours = sheets.reduce((sum, sheet) => sum + Number(sheet.totalHours), 0);

  return (
    <div className="space-y-4 p-5">
      {/* ── Săptămâna ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => router.push(weekHref(previousWeek))}>
            <ChevronLeft className="size-4" aria-hidden /> Săptămâna trecută
          </Button>
          <Button variant="secondary" onClick={() => router.push(weekHref(nextWeek))}>
            Săptămâna viitoare <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
        <p className="text-sm text-ink-muted">
          {days[0]} → {days[days.length - 1]} ·{' '}
          <span className="font-medium text-ink">{totalHours.toFixed(2)} ore</span> pontate
        </p>
      </div>

      {error === undefined ? null : <Banner tone="danger" title="Nu s-a putut" body={error} />}

      {report.length === 0 ? null : (
        <Banner
          tone="warning"
          title="Unele pontaje n-au putut fi validate"
          body={report.join(' · ')}
        />
      )}

      {/* ── Grila om × zi ─────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-subtle">
              <th className="px-3 py-2 text-left font-medium text-ink-muted">Om</th>
              {days.map((day) => (
                <th key={day} className="px-2 py-2 text-center font-medium text-ink-muted">
                  {formatDay(day)}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium text-ink-muted">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((person) => (
              <tr key={person.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-medium text-ink">{person.name}</td>
                {days.map((day) => {
                  const sheet = byCell.get(cellKey(person.id, day));
                  const isOpen = open?.personId === person.id && open.day === day;
                  return (
                    <td key={day} className="px-1 py-1 text-center">
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => {
                          openCell(person.id, day);
                        }}
                        className={`w-full rounded px-2 py-1 tabular-nums ${
                          isOpen
                            ? 'bg-brand-subtle text-ink'
                            : sheet === undefined
                              ? 'text-ink-subtle hover:bg-surface-subtle'
                              : sheet.status === 'validated'
                                ? 'bg-success-subtle text-ink'
                                : 'bg-surface-subtle text-ink hover:bg-brand-subtle'
                        }`}
                      >
                        {sheet === undefined ? '—' : sheet.totalHours}
                      </button>
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">
                  {byPerson[person.id] ?? '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={days.length + 2} className="px-3 py-8 text-center text-ink-muted">
                  Nimeni n-a pontat în săptămâna asta.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* ── Editorul unei zile ────────────────────────────────────────────── */}
      {open === null ? null : (
        <DayEditor
          personName={persons.find((p) => p.id === open.personId)?.name ?? ''}
          day={open.day}
          lines={lines}
          workUnits={workUnits}
          unitById={unitById}
          locked={byCell.get(cellKey(open.personId, open.day))?.status === 'validated'}
          saving={saving}
          onChange={(next) => {
            setLines(next);
            setError(undefined);
          }}
          onSave={save}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}

      {/* ── Validarea în masă ─────────────────────────────────────────────── */}
      {canValidate && validatable.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Validarea săptămânii</p>
              <p className="mt-1 text-xs text-ink-muted">
                Îngheață tariful zilei lucrate pe fiecare linie și scrie costul în registru. De
                acolo, o schimbare de tarif nu mai atinge ce s-a raportat.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setSelected(
                  selected.length === validatable.length ? [] : validatable.map((s) => s.id),
                );
              }}
            >
              {selected.length === validatable.length ? 'Deselectează tot' : 'Selectează tot'}
            </Button>
          </div>

          <ul className="space-y-1">
            {validatable.map((sheet) => (
              <li key={sheet.id} className="text-sm">
                <Checkbox
                  label={`${sheet.personName} · ${sheet.workDate} · ${sheet.totalHours} ore`}
                  checked={selected.includes(sheet.id)}
                  onChange={(event) => {
                    setSelected(
                      event.target.checked
                        ? [...selected, sheet.id]
                        : selected.filter((id) => id !== sheet.id),
                    );
                  }}
                />
              </li>
            ))}
          </ul>

          <Button variant="primary" onClick={validate} disabled={validating || selected.length === 0}>
            {validating
              ? 'Se validează…'
              : `Validează ${String(selected.length)} ${selected.length === 1 ? 'pontaj' : 'pontaje'}`}
          </Button>
        </div>
      ) : null}

      {/* ── Totalul pe unitate de lucru ───────────────────────────────────── */}
      {byWorkUnit.length === 0 ? null : (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="mb-2 text-sm font-medium text-ink">Ore pe unitate de lucru</p>
          <ul className="space-y-1 text-sm">
            {byWorkUnit.map((entry) => (
              <li key={entry.label} className="flex justify-between gap-4">
                <span className="text-ink">{entry.label}</span>
                <span className="tabular-nums text-ink-muted">{entry.hours}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Editorul unei zile ───────────────────────────────────────────────────────

function DayEditor({
  personName,
  day,
  lines,
  workUnits,
  unitById,
  locked,
  saving,
  onChange,
  onSave,
  onClose,
}: {
  readonly personName: string;
  readonly day: string;
  readonly lines: readonly LineState[];
  readonly workUnits: readonly WorkUnitOption[];
  readonly unitById: ReadonlyMap<string, WorkUnitOption>;
  readonly locked: boolean;
  readonly saving: boolean;
  readonly onChange: (lines: LineState[]) => void;
  readonly onSave: () => void;
  readonly onClose: () => void;
}) {
  const total = lines.reduce((sum, line) => sum + (Number(decimal(line.hours)) || 0), 0);

  return (
    <div className="space-y-3 rounded-lg border border-brand bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink">
          {personName} · {day}
        </p>
        <p className="text-xs text-ink-muted">
          <span className={total > 24 ? 'font-medium text-danger' : 'tabular-nums text-ink'}>
            {total.toFixed(2)}
          </span>{' '}
          ore în zi{total > 24 ? ' — peste maximul de 24' : ''}
        </p>
      </div>

      {locked ? (
        <Banner
          tone="success"
          title="Ziua e validată"
          body="Tariful e înghețat, costul e în registru. O zi validată nu se mai schimbă — corecția se face prin storno, în registrul de cost."
        />
      ) : null}

      {lines.length === 0 ? (
        <p className="rounded border border-dashed border-border px-4 py-4 text-center text-sm text-ink-muted">
          Nicio linie. Ziua se împarte pe unitățile de lucru pe care s-a lucrat.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line, index) => {
            const unit = unitById.get(line.workUnitId);
            // Doar lucrarile au etape, si atunci etapa e OBLIGATORIE (trigger 0026).
            const needsStage = unit?.type === 'lucrare';

            return (
              <li
                key={line.key}
                className="grid gap-2 rounded border border-border p-2 sm:grid-cols-[1fr_1fr_7rem_auto]"
              >
                <Select
                  options={workUnits.map((entry) => ({ value: entry.id, label: entry.label }))}
                  placeholder="Alege unitatea"
                  value={line.workUnitId}
                  disabled={locked}
                  onChange={(event) => {
                    onChange(
                      lines.map((current, at) =>
                        at === index
                          ? { ...current, workUnitId: event.target.value, stageId: '' }
                          : current,
                      ),
                    );
                  }}
                />
                {needsStage ? (
                  <Select
                    options={(unit?.stages ?? []).map((stage) => ({
                      value: stage.id,
                      label: stage.name,
                    }))}
                    placeholder="Alege etapa"
                    value={line.stageId}
                    disabled={locked}
                    onChange={(event) => {
                      onChange(
                        lines.map((current, at) =>
                          at === index ? { ...current, stageId: event.target.value } : current,
                        ),
                      );
                    }}
                  />
                ) : (
                  <span className="self-center text-xs text-ink-subtle">
                    {line.workUnitId === '' ? '' : 'Fără etapă — doar lucrările au etape.'}
                  </span>
                )}
                <Input
                  inputMode="decimal"
                  suffix="ore"
                  value={line.hours}
                  disabled={locked}
                  onChange={(event) => {
                    onChange(
                      lines.map((current, at) =>
                        at === index ? { ...current, hours: event.target.value } : current,
                      ),
                    );
                  }}
                />
                {locked ? null : (
                  <Button
                    variant="ghost"
                    aria-label="Șterge linia"
                    onClick={() => {
                      onChange(lines.filter((_, at) => at !== index));
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {locked ? null : (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                onChange([...lines, { key: nextKey(), workUnitId: '', stageId: '', hours: '' }]);
              }}
            >
              <Plus className="size-4" aria-hidden /> Adaugă linie
            </Button>
            <Button onClick={onSave} disabled={saving}>
              {saving ? 'Se salvează…' : 'Salvează ziua'}
            </Button>
          </>
        )}
        <Button variant="ghost" onClick={onClose}>
          Închide
        </Button>
      </div>
    </div>
  );
}

/** Eticheta de stare a unei zile, pentru listele scurte. */
export function TimesheetStatusBadge({ status }: { readonly status: string }) {
  return status === 'validated' ? (
    <Badge tone="success">Validat</Badge>
  ) : (
    <Badge tone="neutral">De validat</Badge>
  );
}
