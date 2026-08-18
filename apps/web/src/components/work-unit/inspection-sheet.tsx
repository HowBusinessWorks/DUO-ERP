'use client';

import {
  CHECKLIST_ANSWER_LABELS,
  CHECKLIST_ANSWERS,
  FINDING_OUTCOME_LABELS,
  FINDING_OUTCOMES,
} from '@damina/contracts';
import { t } from '@damina/i18n';
import {
  Badge,
  Banner,
  Button,
  DateInput,
  Input,
  ProgressBar,
  Select,
  Textarea,
  useToast,
} from '@damina/ui';
import { Camera, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { saveInspectionAction, validateInspectionAction } from '../../app/(office)/sheet-actions';

/**
 * Fisa de inspectie (§3.5, verificarile #1–#7 si #23).
 *
 * Trei lucruri sunt deliberate aici:
 *
 *  1. **Butonul Validează asculta de `check`-ul VENIT DE LA SERVER.** Regula
 *     „fiecare NOK are iesire" traieste intr-un trigger si e oglindita o singura
 *     data, in `@damina/domain`. Ecranul nu o scrie a treia oara: cat timp
 *     exista modificari nesalvate, validarea e oprita cu motivul „salveaza
 *     intai" — asa raspunsul de pe ecran e mereu despre ce E in baza.
 *  2. **Se trimite fisa INTREAGA la salvare**, nu punctul modificat. Serviciul
 *     rescrie raspunsurile intr-o tranzactie, cu iesirile lor.
 *  3. **Fara bani cand rolul nu-i vede.** `withMoney=false` nu ascunde doar
 *     cifra: scoate si iesirea „propunere", care CERE o valoare estimata. Un
 *     camp de lei pe ecranul unui om din teren ar fi exact scaparea pe care o
 *     cauta verificarea #23.
 */

export interface SheetPhoto {
  readonly id: string;
  readonly name: string;
}

export interface SheetPoint {
  readonly itemId: string;
  readonly position: number;
  readonly text: string;
  readonly requiresPhoto: boolean;
  readonly isCritical: boolean;
  readonly answer: 'ok' | 'nok' | 'na' | null;
  readonly note: string | null;
  readonly photoNodeId: string | null;
  readonly outcome: 'rezolvat_pe_loc' | 'interventie' | 'propunere' | null;
  readonly resolutionNote: string | null;
  /** Deja sir: `Money` nu trece granita server→client. */
  readonly estimatedValue: string | null;
  readonly createdRequestId: string | null;
  readonly backlogProposalId: string | null;
}

export interface SheetBlocker {
  readonly itemId: string;
  readonly message: string;
}

export interface InspectionSheetProps {
  readonly workUnitId: string;
  readonly checklistName: string;
  readonly checklistVersion: number;
  readonly performedOn: string;
  readonly effectDate: string | null;
  readonly validated: boolean;
  readonly points: readonly SheetPoint[];
  readonly answered: number;
  readonly total: number;
  readonly canValidate: boolean;
  readonly blockers: readonly SheetBlocker[];
  readonly photos: readonly SheetPhoto[];
  readonly photosHref: string;
  readonly canWrite: boolean;
  readonly canValidateSheet: boolean;
  readonly withMoney: boolean;
  /** Luna de raportare propusa: ziua de azi, nu data executiei (regula 2). */
  readonly suggestedEffectDate: string;
}

interface PointState {
  readonly answer: '' | 'ok' | 'nok' | 'na';
  readonly note: string;
  readonly photoNodeId: string;
  readonly outcome: '' | 'rezolvat_pe_loc' | 'interventie' | 'propunere';
  readonly resolutionNote: string;
  readonly estimatedValue: string;
  readonly validUntil: string;
}

const ANSWER_TONES: Readonly<Record<string, 'success' | 'danger' | 'neutral'>> = {
  ok: 'success',
  nok: 'danger',
  na: 'neutral',
};

function initialState(point: SheetPoint): PointState {
  return {
    answer: point.answer ?? '',
    note: point.note ?? '',
    photoNodeId: point.photoNodeId ?? '',
    outcome: point.outcome ?? '',
    resolutionNote: point.resolutionNote ?? '',
    estimatedValue: point.estimatedValue ?? '',
    validUntil: '',
  };
}

export function InspectionSheet({
  workUnitId,
  checklistName,
  checklistVersion,
  performedOn,
  effectDate,
  validated,
  points,
  answered,
  total,
  canValidate,
  blockers,
  photos,
  photosHref,
  canWrite,
  canValidateSheet,
  withMoney,
  suggestedEffectDate,
}: InspectionSheetProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [state, setState] = useState<Record<string, PointState>>(() =>
    Object.fromEntries(points.map((point) => [point.itemId, initialState(point)])),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [effectDateInput, setEffectDateInput] = useState(effectDate ?? suggestedEffectDate);
  const [error, setError] = useState<string | undefined>(undefined);

  const editable = canWrite && !validated;
  const blockerByItem = new Map(blockers.map((blocker) => [blocker.itemId, blocker.message]));

  function update(itemId: string, patch: Partial<PointState>): void {
    setState((current) => {
      const before = current[itemId];
      if (before === undefined) {
        return current;
      }
      return { ...current, [itemId]: { ...before, ...patch } };
    });
    setDirty(true);
    setError(undefined);
  }

  /** Punctele cu raspuns devin `answers`; cele fara raman necompletate. */
  function payload(): Record<string, unknown> {
    const answers = points
      .map((point) => ({ point, value: state[point.itemId] }))
      .filter(
        (entry): entry is { point: SheetPoint; value: PointState } =>
          entry.value !== undefined && entry.value.answer !== '',
      )
      .map(({ point, value }) => ({
        checklistItemId: point.itemId,
        answer: value.answer,
        note: value.note,
        photoNodeId: value.photoNodeId,
        ...(value.answer === 'nok'
          ? {
              finding: {
                outcome: value.outcome,
                resolutionNote: value.resolutionNote,
                estimatedValue: value.estimatedValue,
                validUntil: value.validUntil,
              },
            }
          : {}),
      }));

    return { workUnitId, answers };
  }

  function save(): void {
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await saveInspectionAction(payload());
      setSaving(false);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      const born = result.data.createdRequestIds.length + result.data.createdProposalIds.length;
      toast({
        tone: 'success',
        title: t('form.saved'),
        ...(born === 0
          ? {}
          : {
              body:
                born === 1
                  ? 'Constatarea a născut un document nou. Îl vezi în Constatări.'
                  : `Constatările au născut ${String(born)} documente. Le vezi în Constatări.`,
            }),
      });
      setDirty(false);
      router.refresh();
    })();
  }

  function validate(): void {
    void (async () => {
      setError(undefined);
      setValidating(true);
      const result = await validateInspectionAction({ workUnitId, effectDate: effectDateInput });
      setValidating(false);

      if (result.ok) {
        toast({
          tone: 'success',
          title: 'Fișa e validată',
          body: `Costurile ei intră în luna datei ${result.data.effectDate}.`,
        });
        router.refresh();
      } else {
        setError(result.message);
      }
    })();
  }

  const validateBlockedReason = ((): string | undefined => {
    if (!canValidateSheet) {
      return 'Validarea produce costuri și e a biroului. Completează fișa și trimite-o mai departe.';
    }
    if (dirty) {
      return 'Salvează întâi modificările — validarea se uită la ce e scris în bază, nu pe ecran.';
    }
    if (!canValidate) {
      return 'Fișa are puncte care o blochează. Sunt marcate mai jos, în ordinea din listă.';
    }
    return undefined;
  })();

  return (
    <div className="space-y-5">
      {/* ── Antetul fisei ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3">
        <div>
          <p className="text-sm font-medium text-ink">
            {checklistName} <span className="text-ink-subtle">· versiunea {checklistVersion}</span>
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Executată pe {performedOn}
            {effectDate === null ? '' : ` · raportată în luna datei ${effectDate}`}
          </p>
        </div>
        <div className="min-w-48 flex-1">
          <ProgressBar
            label="Puncte completate"
            tone="brand"
            value={total === 0 ? 0 : Math.round((answered / total) * 100)}
            detail={`${String(answered)} din ${String(total)}`}
          />
        </div>
        {validated ? <Badge tone="success">Validată</Badge> : null}
      </div>

      {validated ? (
        <Banner
          tone="success"
          title="Fișa e închisă"
          body="O fișă validată nu se mai completează. Ce s-a constatat trăiește mai departe în cererile și propunerile din tab-ul Constatări."
        />
      ) : null}

      {/* ── Punctele ──────────────────────────────────────────────────────── */}
      <ol className="space-y-3">
        {points.map((point) => {
          const value = state[point.itemId] ?? initialState(point);
          const blocked = blockerByItem.get(point.itemId);

          return (
            <li
              key={point.itemId}
              className={`rounded-lg border bg-surface p-4 ${
                blocked === undefined ? 'border-border' : 'border-danger'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm font-medium text-ink">
                  <span className="mr-2 text-ink-subtle">{point.position}.</span>
                  {point.text}
                </p>
                <span className="flex flex-wrap items-center gap-2">
                  {point.isCritical ? <Badge tone="danger">Critic</Badge> : null}
                  {point.requiresPhoto ? (
                    <Badge tone="outline">
                      <Camera className="mr-1 inline size-3" aria-hidden="true" />
                      Poză obligatorie
                    </Badge>
                  ) : null}
                  {value.answer === '' ? null : (
                    <Badge tone={ANSWER_TONES[value.answer] ?? 'neutral'}>
                      {CHECKLIST_ANSWER_LABELS[value.answer]}
                    </Badge>
                  )}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="block w-40">
                  <span className="mb-1 block text-xs font-medium text-ink-muted">Răspuns</span>
                  <Select
                    placeholder="—"
                    options={CHECKLIST_ANSWERS.map((answer) => ({
                      value: answer,
                      label: CHECKLIST_ANSWER_LABELS[answer],
                    }))}
                    value={value.answer}
                    disabled={!editable}
                    onChange={(event) => {
                      const next = event.target.value as PointState['answer'];
                      update(point.itemId, {
                        answer: next,
                        ...(next === 'nok' ? {} : { outcome: '' as const }),
                      });
                    }}
                  />
                </label>

                <label className="block min-w-64 flex-1">
                  <span className="mb-1 block text-xs font-medium text-ink-muted">Observație</span>
                  <Input
                    value={value.note}
                    disabled={!editable}
                    placeholder="Ce s-a văzut la fața locului"
                    onChange={(event) => {
                      update(point.itemId, { note: event.target.value });
                    }}
                  />
                </label>

                <label className="block w-56">
                  <span className="mb-1 block text-xs font-medium text-ink-muted">
                    Poză{point.requiresPhoto ? ' (obligatorie)' : ''}
                  </span>
                  <Select
                    placeholder={photos.length === 0 ? 'Nicio poză încărcată' : 'Fără poză'}
                    options={photos.map((photo) => ({ value: photo.id, label: photo.name }))}
                    value={value.photoNodeId}
                    disabled={!editable || photos.length === 0}
                    onChange={(event) => {
                      update(point.itemId, { photoNodeId: event.target.value });
                    }}
                  />
                </label>
              </div>

              {/* ── Iesirea obligatorie a unui NOK ──────────────────────────── */}
              {value.answer === 'nok' ? (
                <div className="mt-3 space-y-3 rounded-lg border border-dashed border-border bg-surface-sunken p-3">
                  <p className="text-xs text-ink-muted">
                    Un punct NOK nu se închide fără ieșire: ori s-a rezolvat pe loc, ori naște o
                    cerere, ori intră în backlog ca propunere.
                  </p>

                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block w-56">
                      <span className="mb-1 block text-xs font-medium text-ink-muted">Ieșire</span>
                      <Select
                        placeholder="Alege ieșirea"
                        options={FINDING_OUTCOMES.filter(
                          (outcome) => withMoney || outcome !== 'propunere',
                        ).map((outcome) => ({
                          value: outcome,
                          label: FINDING_OUTCOME_LABELS[outcome],
                        }))}
                        value={value.outcome}
                        disabled={!editable}
                        onChange={(event) => {
                          update(point.itemId, {
                            outcome: event.target.value as PointState['outcome'],
                          });
                        }}
                      />
                    </label>

                    {value.outcome === 'propunere' && withMoney ? (
                      <>
                        <label className="block w-36">
                          <span className="mb-1 block text-xs font-medium text-ink-muted">
                            Valoare estimată
                          </span>
                          <Input
                            inputMode="decimal"
                            value={value.estimatedValue}
                            disabled={!editable}
                            placeholder="1800"
                            onChange={(event) => {
                              update(point.itemId, { estimatedValue: event.target.value });
                            }}
                          />
                        </label>
                        <label className="block w-44">
                          <span className="mb-1 block text-xs font-medium text-ink-muted">
                            Valabilă până la
                          </span>
                          <DateInput
                            value={value.validUntil}
                            disabled={!editable}
                            onChange={(event) => {
                              update(point.itemId, { validUntil: event.target.value });
                            }}
                          />
                        </label>
                      </>
                    ) : null}
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-muted">
                      {value.outcome === 'rezolvat_pe_loc'
                        ? 'Ce s-a făcut pe loc'
                        : 'Descrierea constatării'}
                    </span>
                    <Textarea
                      rows={2}
                      value={value.resolutionNote}
                      disabled={!editable}
                      onChange={(event) => {
                        update(point.itemId, { resolutionNote: event.target.value });
                      }}
                    />
                  </label>

                  {point.createdRequestId === null ? null : (
                    <Link
                      href={`/cereri/${point.createdRequestId}`}
                      className="inline-flex items-center gap-1 text-sm text-brand underline"
                    >
                      Cererea născută din constatare
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </Link>
                  )}
                  {point.backlogProposalId === null ? null : (
                    <Link
                      href="/cereri?view=backlog"
                      className="ml-4 inline-flex items-center gap-1 text-sm text-brand underline"
                    >
                      Propunerea din backlog
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              ) : null}

              {blocked === undefined ? null : <p className="mt-3 text-sm text-danger">{blocked}</p>}
            </li>
          );
        })}
      </ol>

      {photos.length === 0 && points.some((point) => point.requiresPhoto) ? (
        <Banner
          tone="warning"
          title="Nicio poză încărcată pe unitate"
          body="Punctele cu poză obligatorie nu se pot completa până nu urcă pozele. Se încarcă din tab-ul Poze, și tot de acolo se aleg aici."
        />
      ) : null}

      {error === undefined ? null : <Banner tone="danger" title="N-a mers" body={error} />}

      {/* ── Salvarea si validarea ─────────────────────────────────────────── */}
      {validated ? null : (
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3">
          {canWrite ? (
            <Button variant="primary" loading={saving} onClick={save}>
              Salvează fișa
            </Button>
          ) : (
            <p className="text-sm text-ink-subtle">Rolul tău nu poate completa fișe.</p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-44">
              <span className="mb-1 block text-xs font-medium text-ink-muted">
                Luna de raportare
              </span>
              <DateInput
                value={effectDateInput}
                disabled={!canValidateSheet}
                onChange={(event) => {
                  setEffectDateInput(event.target.value);
                }}
              />
            </label>
            <Button
              loading={validating}
              disabled={validateBlockedReason !== undefined}
              onClick={validate}
            >
              Validează fișa
            </Button>
          </div>

          <p className="w-full text-xs text-ink-muted">
            {validateBlockedReason ??
              `Validarea închide fișa și îi fixează luna de raportare. Data executării rămâne ${performedOn}.`}
          </p>
        </div>
      )}

      <p className="text-xs text-ink-subtle">
        Pozele se încarcă în{' '}
        <Link href={photosHref} className="text-brand underline">
          tab-ul Poze
        </Link>{' '}
        și se aleg de aici. Fiecare poză își păstrează ora și locul culese la fața locului.
      </p>
    </div>
  );
}
