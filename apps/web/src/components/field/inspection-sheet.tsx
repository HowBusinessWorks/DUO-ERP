'use client';

import { CHECKLIST_ANSWER_LABELS, FINDING_OUTCOME_LABELS } from '@damina/contracts';
import { uuidv7 } from '@damina/shared';
import { Badge, Banner, Button, EmptyState, ProgressBar, Textarea, cn } from '@damina/ui';
import type { FieldAnswer, FieldChecklist, FieldWorkUnit } from '@damina/services';
import { ClipboardCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { fieldDb, hasIndexedDb } from '../../lib/field/db';
import { discardMutation, enqueueMutation } from '../../lib/field/sync';
import { PhotoCapture } from './photo-capture';
import { useSync } from './sync-provider';

/**
 * Fișa de inspecție, pe teren (§3.5, verificările #1–#7, #17, #18, #23).
 *
 * Patru lucruri o deosebesc de fișa de birou, și niciunul nu e cosmetic:
 *
 *  1. **Regula „fiecare NOK are o ieșire" se impune LOCAL** (#18). La birou,
 *     butonul ascultă de răspunsul serverului. În subsol nu există server —
 *     iar dacă regula ar fi verificată abia la sincronizare, omul ar afla că
 *     fișa e incompletă a doua zi, de la 40 de km distanță de obiectiv.
 *  2. **Ieșirea „propunere" nu există aici.** Ea cere o valoare estimată, adică
 *     lei, iar aplicația de teren nu arată bani. Nu e ascunsă la afișare: rolul
 *     `app_field` n-are nici măcar grant de citire pe coloană.
 *  3. **De aceea, o fișă care conține deja o propunere se deschide READ-ONLY.**
 *     Salvarea rescrie tot setul de răspunsuri, iar telefonul n-ar avea de unde
 *     să știe valoarea pe care ar trebui s-o trimită înapoi. Mai bine spune
 *     cinstit „se editează de la birou" decât să șteargă în tăcere.
 *  4. **„Cere poză" se verifică pe coada locală**, nu pe `photoNodeId` — care e
 *     un id de server. Punctul e acoperit dacă există o poză în coadă legată de
 *     el, indiferent dacă a apucat să urce.
 *
 * Se trimite fișa **întreagă**, ca la birou: serviciul rescrie răspunsurile
 * într-o tranzacție, cu ieșirile lor.
 */

/** Ieșirile pe care le poate alege terenul. `propunere` cere lei, deci lipsește. */
const FIELD_OUTCOMES = ['rezolvat_pe_loc', 'interventie'] as const;

type Answer = 'ok' | 'nok' | 'na' | '';

interface PointState {
  answer: Answer;
  note: string;
  outcome: (typeof FIELD_OUTCOMES)[number] | '';
  resolutionNote: string;
  /** Câte poze are punctul în coadă. Contează doar când punctul cere poză. */
  photos: number;
}

function emptyPoint(): PointState {
  return { answer: '', note: '', outcome: '', resolutionNote: '', photos: 0 };
}

function fromExisting(answer: FieldAnswer): PointState {
  return {
    answer: answer.answer as Answer,
    note: answer.note ?? '',
    outcome:
      answer.outcome === 'rezolvat_pe_loc' || answer.outcome === 'interventie'
        ? answer.outcome
        : '',
    resolutionNote: answer.resolutionNote ?? '',
    photos: 0,
  };
}

/** Ce oprește trimiterea. Se calculează local, la fiecare atingere. */
function blockersFor(
  checklist: FieldChecklist,
  state: Readonly<Record<string, PointState>>,
): { itemId: string; message: string }[] {
  const out: { itemId: string; message: string }[] = [];
  for (const item of checklist.items) {
    const point = state[item.id] ?? emptyPoint();
    if (point.answer === '') {
      continue;
    }
    if (point.answer === 'nok' && point.outcome === '') {
      out.push({ itemId: item.id, message: 'Alege ce se întâmplă cu neconformitatea.' });
    }
    if (point.answer === 'nok' && point.outcome === 'rezolvat_pe_loc' && point.resolutionNote === '') {
      out.push({ itemId: item.id, message: 'Scrie ce ai făcut pe loc.' });
    }
    if (item.requiresPhoto && point.photos === 0) {
      out.push({ itemId: item.id, message: 'Punctul ăsta cere o poză.' });
    }
  }
  return out;
}

export interface FieldInspectionSheetProps {
  readonly unit: FieldWorkUnit;
  /** Mutația din care se pornește o copie, când se duplică o fișă refuzată. */
  readonly copyOf?: string;
}

export function FieldInspectionSheet({ unit, copyOf }: FieldInspectionSheetProps) {
  const router = useRouter();
  const { refresh, syncNow } = useSync();

  const [checklist, setChecklist] = useState<FieldChecklist | null | undefined>(undefined);
  const [state, setState] = useState<Record<string, PointState>>({});
  const [lockedByProposal, setLockedByProposal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  /** Recitește din coadă câte poze are fiecare punct. */
  const countPhotos = useCallback(async () => {
    if (!hasIndexedDb()) {
      return;
    }
    const rows = await fieldDb().media.where('workUnitId').equals(unit.id).toArray();
    const byItem = new Map<string, number>();
    for (const row of rows) {
      if (row.checklistItemId === undefined) {
        continue;
      }
      byItem.set(row.checklistItemId, (byItem.get(row.checklistItemId) ?? 0) + 1);
    }
    setState((current) => {
      const next: Record<string, PointState> = {};
      for (const [itemId, point] of Object.entries(current)) {
        next[itemId] = { ...point, photos: byItem.get(itemId) ?? 0 };
      }
      return next;
    });
  }, [unit.id]);

  useEffect(() => {
    void (async () => {
      if (!hasIndexedDb() || unit.checklistId === null) {
        setChecklist(null);
        return;
      }
      const db = fieldDb();
      const found = (await db.checklists.get(unit.checklistId)) ?? null;
      setChecklist(found);
      if (found === null) {
        return;
      }

      const existing = await db.answers.where('workUnitId').equals(unit.id).toArray();
      const base: Record<string, PointState> = {};
      for (const item of found.items) {
        base[item.id] = emptyPoint();
      }
      for (const answer of existing) {
        base[answer.checklistItemId] = fromExisting(answer);
      }
      setLockedByProposal(existing.some((answer) => answer.outcome === 'propunere'));

      /*
       * Duplicarea unei fise refuzate (§3.3): starea vine din mutatia blocata,
       * nu din felie. Felia arata ce stie SERVERUL, adica exact ce a respins —
       * iar omul vrea inapoi ce a scris el.
       */
      if (copyOf !== undefined) {
        const blocked = await db.outbox.get(copyOf);
        const payload = blocked?.payload as
          | { answers?: { checklistItemId: string; answer: string; note?: string | null; finding?: { outcome?: string; resolutionNote?: string | null } }[] }
          | undefined;
        for (const answer of payload?.answers ?? []) {
          base[answer.checklistItemId] = {
            answer: answer.answer as Answer,
            note: answer.note ?? '',
            outcome:
              answer.finding?.outcome === 'rezolvat_pe_loc' ||
              answer.finding?.outcome === 'interventie'
                ? answer.finding.outcome
                : '',
            resolutionNote: answer.finding?.resolutionNote ?? '',
            photos: 0,
          };
        }
      }

      setState(base);
      await countPhotos();
    })();
  }, [copyOf, countPhotos, unit.checklistId, unit.id]);

  if (checklist === undefined) {
    return <p className="text-sm text-ink-muted">Se citește fișa de pe telefon…</p>;
  }

  if (checklist === null) {
    return (
      <EmptyState
        icon={<ClipboardCheck className="size-5" aria-hidden />}
        title="Fișa nu e pe telefon"
        body="Checklist-ul acestei inspecții n-a ajuns în felia locală. Deschide aplicația o dată cu semnal și încearcă din nou."
      />
    );
  }

  const readOnly = unit.validated || lockedByProposal;
  const blockers = blockersFor(checklist, state);
  const answered = checklist.items.filter((item) => (state[item.id]?.answer ?? '') !== '').length;

  function update(itemId: string, patch: Partial<PointState>): void {
    setTouched(true);
    setState((current) => {
      const before = current[itemId] ?? emptyPoint();
      const next = { ...before, ...patch };
      // Un punct care nu mai e NOK nu mai are ieșire. Altfel ar pleca o ieșire
      // orfană, iar serverul ar refuza fișa pentru ceva ce omul a corectat deja.
      if (next.answer !== 'nok') {
        next.outcome = '';
        next.resolutionNote = '';
      }
      return { ...current, [itemId]: next };
    });
  }

  function send(): void {
    // Legat aici: dupa gardele de mai sus, `checklist` e sigur completat, dar
    // inchiderea din `void (async …)` nu mai stie asta.
    const sheet = checklist;
    if (sheet === null || sheet === undefined) {
      return;
    }
    void (async () => {
      setSaving(true);
      try {
        const answers = sheet.items
          .map((item) => ({ item, point: state[item.id] }))
          .filter(
            (entry): entry is { item: (typeof sheet.items)[number]; point: PointState } =>
              entry.point !== undefined && entry.point.answer !== '',
          )
          .map(({ item, point }) => ({
            checklistItemId: item.id,
            answer: point.answer,
            note: point.note,
            photoNodeId: '',
            ...(point.answer === 'nok'
              ? {
                  finding: {
                    outcome: point.outcome,
                    resolutionNote: point.resolutionNote,
                    estimatedValue: '',
                    validUntil: '',
                  },
                }
              : {}),
          }));

        await enqueueMutation({
          id: uuidv7(),
          type: 'inspection.save',
          payload: { workUnitId: unit.id, answers },
          createdAt: new Date().toISOString(),
          label: `Inspecție ${unit.code} · ${unit.objectiveName}`,
          entityId: unit.id,
        });

        // Copia a plecat, deci originalul refuzat nu mai are ce astepta.
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

      {lockedByProposal ? (
        <Banner
          tone="warning"
          title="Fișa se editează de la birou"
          body="Are cel puțin o neconformitate trecută ca propunere, iar propunerile poartă o valoare estimată pe care aplicația de teren n-o vede. Ca să nu se piardă, fișa se completează de acolo."
        />
      ) : null}

      {copyOf !== undefined ? (
        <Banner
          tone="info"
          title="Copie a unei fișe refuzate"
          body="Ai în față ce ai scris tu, nu ce e la birou. Corectează motivul refuzului și trimite — pleacă drept fișă nouă, iar cea refuzată dispare din coadă."
        />
      ) : null}

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-ink">{checklist.name}</span>
          <span className="text-xs text-ink-muted">
            {String(answered)} / {String(checklist.items.length)}
          </span>
        </div>
        <ProgressBar
          className="mt-1"
          label="Puncte completate"
          value={
            checklist.items.length === 0
              ? 0
              : Math.round((answered / checklist.items.length) * 100)
          }
        />
      </div>

      <ol className="space-y-3">
        {checklist.items.map((item) => {
          const point = state[item.id] ?? emptyPoint();
          const blocker = blockers.find((entry) => entry.itemId === item.id);
          return (
            <li
              key={item.id}
              className={cn(
                'rounded-lg border bg-surface p-3',
                blocker === undefined ? 'border-border' : 'border-warning',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm text-ink">
                  {String(item.position)}. {item.text}
                </span>
                {item.isCritical ? <Badge tone="danger">critic</Badge> : null}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                {(['ok', 'nok', 'na'] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    disabled={readOnly}
                    data-testid={`answer-${choice}`}
                    aria-pressed={point.answer === choice}
                    className={cn(
                      // Un tap per punct: butoane mari, fara meniu intermediar.
                      'min-h-12 rounded-md border text-sm font-medium disabled:opacity-50',
                      point.answer === choice
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-border bg-surface text-ink-muted active:bg-surface-hover',
                    )}
                    onClick={() => {
                      update(item.id, { answer: choice });
                    }}
                  >
                    {CHECKLIST_ANSWER_LABELS[choice]}
                  </button>
                ))}
              </div>

              {point.answer === 'nok' ? (
                <div className="mt-3 space-y-2 rounded-md bg-surface-sunken p-3">
                  <p className="text-xs font-medium text-ink">
                    Ce se întâmplă cu ea? Fără asta, fișa nu pleacă.
                  </p>
                  <div className="grid gap-2">
                    {FIELD_OUTCOMES.map((outcome) => (
                      <button
                        key={outcome}
                        type="button"
                        disabled={readOnly}
                        aria-pressed={point.outcome === outcome}
                        className={cn(
                          'min-h-11 rounded-md border px-3 text-left text-sm disabled:opacity-50',
                          point.outcome === outcome
                            ? 'border-brand-600 bg-brand-50 text-ink'
                            : 'border-border bg-surface text-ink-muted active:bg-surface-hover',
                        )}
                        onClick={() => {
                          update(item.id, { outcome });
                        }}
                      >
                        {FINDING_OUTCOME_LABELS[outcome]}
                      </button>
                    ))}
                  </div>
                  {point.outcome === 'rezolvat_pe_loc' ? (
                    <Textarea
                      aria-label="Ce ai făcut pe loc"
                      placeholder="Ce ai făcut pe loc"
                      rows={2}
                      disabled={readOnly}
                      value={point.resolutionNote}
                      onChange={(event) => {
                        update(item.id, { resolutionNote: event.target.value });
                      }}
                    />
                  ) : null}
                </div>
              ) : null}

              {point.answer !== '' && !readOnly ? (
                <div className="mt-2 space-y-2">
                  <Textarea
                    aria-label="Observație"
                    placeholder="Observație"
                    rows={2}
                    value={point.note}
                    onChange={(event) => {
                      update(item.id, { note: event.target.value });
                    }}
                  />
                  <PhotoCapture
                    workUnitId={unit.id}
                    checklistItemId={item.id}
                    label={item.requiresPhoto ? 'Poză (obligatorie)' : 'Adaugă poză'}
                    onAdded={() => {
                      void countPhotos();
                    }}
                  />
                </div>
              ) : null}

              {blocker === undefined ? null : (
                <p className="mt-2 text-xs text-warning-700">{blocker.message}</p>
              )}
            </li>
          );
        })}
      </ol>

      {readOnly ? null : (
        <div className="space-y-2">
          {blockers.length > 0 && touched ? (
            <p className="text-center text-sm text-warning-700">
              {blockers.length === 1
                ? 'Un punct mai are nevoie de ceva.'
                : `${String(blockers.length)} puncte mai au nevoie de ceva.`}
            </p>
          ) : null}
          <Button
            variant="primary"
            className="min-h-12 w-full"
            data-testid="send-sheet"
            loading={saving}
            disabled={saving || answered === 0 || blockers.length > 0}
            disabledReason={
              answered === 0
                ? 'Răspunde la cel puțin un punct.'
                : blockers.length > 0
                  ? 'Rezolvă punctele marcate.'
                  : undefined
            }
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
