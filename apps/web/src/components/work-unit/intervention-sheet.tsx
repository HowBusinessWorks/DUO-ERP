'use client';

import { t } from '@damina/i18n';
import { Badge, Banner, Button, Input, Select, Textarea, useToast } from '@damina/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  saveInterventionAction,
  validateInterventionAction,
} from '../../app/(office)/sheet-actions';

/**
 * Fisa de interventie (§3.2, verificarile #8, #9, #10, #23 si #24).
 *
 * **O componenta, trei sectiuni** — Fisa, Materiale, Ore — pentru ca salvarea
 * inlocuieste fisa INTREAGA: `saveIntervention` sterge si rescrie liniile
 * intr-o tranzactie. Daca tab-ul Materiale ar trimite doar materialele, prima
 * salvare de acolo ar sterge orele scrise pe celalalt tab. Asa, fiecare
 * sectiune arata partea ei si trimite tot.
 *
 * Doua lucruri se citesc de la server si nu se recalculeaza aici:
 *
 *  - **Costul.** `unit_cost` ramane null pana la validare, dinadins: CMP-ul se
 *    ingheata atunci, cu valoarea din gestiune, nu cu una pe care ar putea-o
 *    trimite telefonul. Ecranul nu arata bani decat dupa.
 *  - **Comparatia asteptat vs real.** Vine din `computeVariance`, calculata la
 *    validare si scrisa pe fisa. O a doua formula in browser ar fi prima care
 *    se abate.
 *
 * `withMoney=false` nu ascunde doar cifrele: rolului de teren nici nu i se cer
 * coloanele de bani, iar catalogul de operatiuni ii vine fara costul estimat
 * (0027). Un camp de lei aici ar fi exact scaparea cautata de verificarea #23.
 */

export interface MaterialLine {
  readonly id: string;
  readonly productId: string;
  readonly productLabel: string;
  readonly quantity: string;
  readonly uom: string;
  readonly locationId: string;
  /** Deja sir, si null cand rolul n-are dreptul la bani. */
  readonly unitCost: string | null;
}

export interface HourLine {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly hours: string;
  readonly workDate: string;
}

export interface StockOption {
  readonly productId: string;
  readonly label: string;
  readonly uom: string;
  readonly available: string;
}

export interface InterventionVariance {
  readonly expectedCost: string | null;
  readonly realCost: string;
  readonly variancePct: string | null;
  readonly flagged: boolean;
}

export interface InterventionSheetProps {
  readonly section: 'fisa' | 'materiale' | 'ore';
  readonly workUnitId: string;
  readonly performedOn: string;
  readonly effectDate: string | null;
  readonly validated: boolean;
  readonly description: string | null;
  readonly declaredHours: string | null;
  readonly operationId: string | null;
  readonly teamId: string | null;
  readonly consumptionNoteNumber: string | null;
  readonly materials: readonly MaterialLine[];
  readonly hours: readonly HourLine[];
  readonly variance: InterventionVariance | null;
  /** Gestiunea echipei. Gol = echipa n-are gestiune, deci materialele nu se pot scrie. */
  readonly locationId: string;
  readonly locationName: string | null;
  readonly stock: readonly StockOption[];
  readonly operations: readonly { readonly id: string; readonly label: string }[];
  readonly teams: readonly { readonly id: string; readonly name: string }[];
  readonly persons: readonly { readonly id: string; readonly name: string }[];
  readonly consumptionSeries: readonly string[];
  readonly canWrite: boolean;
  readonly canValidateSheet: boolean;
  readonly withMoney: boolean;
  /** Luna de raportare propusa: ziua de azi, nu data executiei (regula 2). */
  readonly suggestedEffectDate: string;
}

interface MaterialState {
  readonly key: string;
  readonly productId: string;
  readonly quantity: string;
}

interface HourState {
  readonly key: string;
  readonly personId: string;
  readonly hours: string;
  readonly workDate: string;
}

let counter = 0;
const nextKey = (): string => {
  counter += 1;
  return `n${String(counter)}`;
};

const decimal = (value: string): string => value.replace(',', '.');

export function InterventionSheet({
  section,
  workUnitId,
  performedOn,
  effectDate,
  validated,
  description,
  declaredHours,
  operationId,
  teamId,
  consumptionNoteNumber,
  materials,
  hours,
  variance,
  locationId,
  locationName,
  stock,
  operations,
  teams,
  persons,
  consumptionSeries,
  canWrite,
  canValidateSheet,
  withMoney,
  suggestedEffectDate,
}: InterventionSheetProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [header, setHeader] = useState({
    description: description ?? '',
    declaredHours: declaredHours ?? '',
    operationId: operationId ?? '',
    teamId: teamId ?? '',
  });
  const [materialLines, setMaterialLines] = useState<MaterialState[]>(() =>
    materials.map((line) => ({
      key: line.id,
      productId: line.productId,
      quantity: line.quantity,
    })),
  );
  const [hourLines, setHourLines] = useState<HourState[]>(() =>
    hours.map((line) => ({
      key: line.id,
      personId: line.personId,
      hours: line.hours,
      workDate: line.workDate,
    })),
  );

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [effectDateInput, setEffectDateInput] = useState(effectDate ?? suggestedEffectDate);
  const [series, setSeries] = useState(consumptionSeries[0] ?? '');
  const [error, setError] = useState<string | undefined>(undefined);

  const editable = canWrite && !validated;

  function touch(): void {
    setDirty(true);
    setError(undefined);
  }

  /** Fisa intreaga, de pe oricare dintre cele trei sectiuni. */
  function payload(): Record<string, unknown> {
    return {
      workUnitId,
      description: header.description,
      operationId: header.operationId,
      teamId: header.teamId,
      declaredHours: decimal(header.declaredHours),
      materials: materialLines
        .filter((line) => line.productId !== '' && line.quantity !== '')
        .map((line) => ({
          productId: line.productId,
          lotId: '',
          quantity: decimal(line.quantity),
          locationId,
        })),
      hours: hourLines
        .filter((line) => line.personId !== '' && line.hours !== '' && line.workDate !== '')
        .map((line) => ({
          personId: line.personId,
          hours: decimal(line.hours),
          workDate: line.workDate,
        })),
    };
  }

  function save(): void {
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await saveInterventionAction(payload());
      setSaving(false);

      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast({ tone: 'success', title: t('form.saved') });
      setDirty(false);
      router.refresh();
    })();
  }

  function validate(): void {
    void (async () => {
      setError(undefined);
      setValidating(true);
      const result = await validateInterventionAction({
        workUnitId,
        effectDate: effectDateInput,
        consumptionSeries: series,
      });
      setValidating(false);

      if (!result.ok) {
        setError(result.message);
        return;
      }
      const note = result.data.consumptionNoteNumber;
      toast({
        tone: result.data.flagged ? 'warning' : 'success',
        title: 'Fișa e validată',
        body:
          note === null
            ? 'Orele au intrat în registrul de cost.'
            : `Bonul de consum ${note} e emis, stocul a scăzut, costul e în registru.`,
      });
      router.refresh();
    })();
  }

  const validateBlockedReason = ((): string | undefined => {
    if (!canValidateSheet) {
      return 'Validarea emite bonul de consum, mișcă stocul și produce cost. E a biroului — completează fișa și trimite-o mai departe.';
    }
    if (dirty) {
      return 'Salvează întâi modificările — validarea se uită la ce e scris în bază, nu pe ecran.';
    }
    if (materialLines.length > 0 && series === '') {
      return 'Alege seria bonului de consum. Fără ea materialele n-au pe ce ieși din gestiune.';
    }
    return undefined;
  })();

  const saveBar =
    !editable || section === 'fisa' ? null : (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <p className="text-xs text-ink-muted">
          Se salvează fișa întreagă: și materialele, și orele, și antetul.
        </p>
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? 'Se salvează…' : 'Salvează'}
        </Button>
      </div>
    );

  return (
    <div className="space-y-5">
      {error === undefined ? null : (
        <Banner tone="danger" title="Nu s-a putut salva" body={error} />
      )}

      {validated ? (
        <Banner
          tone="success"
          title="Fișa e închisă"
          body={
            consumptionNoteNumber === null
              ? 'O fișă validată nu se mai completează. Orele ei sunt deja în registrul de cost.'
              : `O fișă validată nu se mai completează. Materialele au ieșit din gestiune cu bonul ${consumptionNoteNumber}.`
          }
        />
      ) : null}

      {section === 'fisa' ? (
        <FisaSection
          performedOn={performedOn}
          effectDate={effectDate}
          validated={validated}
          editable={editable}
          header={header}
          operations={operations}
          teams={teams}
          variance={variance}
          withMoney={withMoney}
          materialCount={materialLines.length}
          hourCount={hourLines.length}
          consumptionSeries={consumptionSeries}
          series={series}
          effectDateInput={effectDateInput}
          validating={validating}
          saving={saving}
          dirty={dirty}
          validateBlockedReason={validateBlockedReason}
          onHeader={(patch) => {
            setHeader((current) => ({ ...current, ...patch }));
            touch();
          }}
          onSeries={setSeries}
          onEffectDate={setEffectDateInput}
          onSave={save}
          onValidate={validate}
        />
      ) : null}

      {section === 'materiale' ? (
        <MaterialsSection
          editable={editable}
          locationId={locationId}
          locationName={locationName}
          stock={stock}
          lines={materialLines}
          saved={materials}
          withMoney={withMoney}
          onChange={(lines) => {
            setMaterialLines(lines);
            touch();
          }}
        />
      ) : null}

      {section === 'ore' ? (
        <HoursSection
          editable={editable}
          persons={persons}
          lines={hourLines}
          performedOn={performedOn}
          declaredHours={header.declaredHours}
          onChange={(lines) => {
            setHourLines(lines);
            touch();
          }}
        />
      ) : null}

      {saveBar}
    </div>
  );
}

// ── Sectiunea „Fisa" ─────────────────────────────────────────────────────────

function FisaSection({
  performedOn,
  effectDate,
  validated,
  editable,
  header,
  operations,
  teams,
  variance,
  withMoney,
  materialCount,
  hourCount,
  consumptionSeries,
  series,
  effectDateInput,
  validating,
  saving,
  dirty,
  validateBlockedReason,
  onHeader,
  onSeries,
  onEffectDate,
  onSave,
  onValidate,
}: {
  readonly performedOn: string;
  readonly effectDate: string | null;
  readonly validated: boolean;
  readonly editable: boolean;
  readonly header: {
    readonly description: string;
    readonly declaredHours: string;
    readonly operationId: string;
    readonly teamId: string;
  };
  readonly operations: readonly { readonly id: string; readonly label: string }[];
  readonly teams: readonly { readonly id: string; readonly name: string }[];
  readonly variance: InterventionVariance | null;
  readonly withMoney: boolean;
  readonly materialCount: number;
  readonly hourCount: number;
  readonly consumptionSeries: readonly string[];
  readonly series: string;
  readonly effectDateInput: string;
  readonly validating: boolean;
  readonly saving: boolean;
  readonly dirty: boolean;
  readonly validateBlockedReason: string | undefined;
  readonly onHeader: (
    patch: Partial<{
      description: string;
      declaredHours: string;
      operationId: string;
      teamId: string;
    }>,
  ) => void;
  readonly onSeries: (value: string) => void;
  readonly onEffectDate: (value: string) => void;
  readonly onSave: () => void;
  readonly onValidate: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-3">
        <div>
          <p className="text-sm font-medium text-ink">Executată pe {performedOn}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {materialCount === 0 ? 'Fără materiale' : `${String(materialCount)} materiale`} ·{' '}
            {hourCount === 0 ? 'fără ore' : `${String(hourCount)} linii de ore`}
            {effectDate === null ? '' : ` · raportată în luna datei ${effectDate}`}
          </p>
        </div>
        {validated ? <Badge tone="success">Validată</Badge> : null}
      </div>

      {variance === null ? null : <VarianceBar variance={variance} withMoney={withMoney} />}

      <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-muted">Operațiunea din catalog</span>
          <Select
            options={operations.map((operation) => ({
              value: operation.id,
              label: operation.label,
            }))}
            placeholder="Fără operațiune"
            value={header.operationId}
            disabled={!editable}
            onChange={(event) => {
              onHeader({ operationId: event.target.value });
            }}
          />
          <span className="block text-xs text-ink-subtle">
            Din ea vine „așteptatul" cu care se compară costul real.
          </span>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-muted">Echipa</span>
          <Select
            options={teams.map((team) => ({ value: team.id, label: team.name }))}
            placeholder="Fără echipă"
            value={header.teamId}
            disabled={!editable}
            onChange={(event) => {
              onHeader({ teamId: event.target.value });
            }}
          />
          <span className="block text-xs text-ink-subtle">Materialele ies din gestiunea ei.</span>
        </label>

        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-muted">Ore declarate</span>
          <Input
            inputMode="decimal"
            suffix="ore"
            value={header.declaredHours}
            disabled={!editable}
            onChange={(event) => {
              onHeader({ declaredHours: event.target.value });
            }}
          />
          <span className="block text-xs text-ink-subtle">
            Cât a durat, spus de om. Costul se face din liniile de ore, nu de aici.
          </span>
        </label>

        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-ink-muted">Ce s-a făcut</span>
          <Textarea
            value={header.description}
            disabled={!editable}
            rows={4}
            onChange={(event) => {
              onHeader({ description: event.target.value });
            }}
          />
        </label>

        {editable ? (
          <div className="sm:col-span-2">
            <Button onClick={onSave} disabled={saving || !dirty}>
              {saving ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        ) : null}
      </div>

      {validated ? null : (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-medium text-ink">Validarea</p>
          <p className="text-xs text-ink-muted">
            Într-o singură tranzacție: bonul de consum, mișcările de stoc, liniile de cost și
            comparația așteptat vs real. Sau niciuna.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-muted">Luna de raportare</span>
              <Input
                type="date"
                value={effectDateInput}
                disabled={!canValidateInput(validateBlockedReason)}
                onChange={(event) => {
                  onEffectDate(event.target.value);
                }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-ink-muted">Seria bonului de consum</span>
              <Select
                options={consumptionSeries.map((value) => ({ value, label: value }))}
                placeholder="Alege seria"
                value={series}
                disabled={!canValidateInput(validateBlockedReason)}
                onChange={(event) => {
                  onSeries(event.target.value);
                }}
              />
            </label>
          </div>
          {validateBlockedReason === undefined ? null : (
            <p className="text-xs text-ink-muted">{validateBlockedReason}</p>
          )}
          <Button
            variant="primary"
            onClick={onValidate}
            disabled={validating || validateBlockedReason !== undefined}
          >
            {validating ? 'Se validează…' : 'Validează fișa'}
          </Button>
        </div>
      )}
    </>
  );
}

/** Campurile validarii n-au rost editate de cine oricum n-o poate apasa. */
const canValidateInput = (blockedReason: string | undefined): boolean =>
  blockedReason === undefined || blockedReason.startsWith('Salvează');

// ── Comparatia asteptat vs real ──────────────────────────────────────────────

function VarianceBar({
  variance,
  withMoney,
}: {
  readonly variance: InterventionVariance;
  readonly withMoney: boolean;
}) {
  if (!withMoney) {
    return null;
  }

  const percent =
    variance.variancePct === null
      ? null
      : `${Number(variance.variancePct) > 0 ? '+' : ''}${(Number(variance.variancePct) * 100).toFixed(1)}%`;

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        variance.flagged ? 'border-warning bg-warning-subtle' : 'border-border bg-surface'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-xs font-medium text-ink-muted">Cost real</span>
        <span className="text-sm font-medium text-ink">{variance.realCost} lei</span>
        <span className="text-xs font-medium text-ink-muted">Estimat</span>
        <span className="text-sm text-ink">
          {variance.expectedCost === null ? '—' : `${variance.expectedCost} lei`}
        </span>
        {percent === null ? null : (
          <Badge tone={variance.flagged ? 'warning' : 'neutral'}>{percent}</Badge>
        )}
      </div>
      {variance.flagged ? (
        <p className="mt-2 text-xs text-ink-muted">
          Abaterea trece pragul. PM-ul a primit o alertă cu fișa asta.
        </p>
      ) : null}
      {variance.expectedCost === null ? (
        <p className="mt-2 text-xs text-ink-muted">
          Fișa n-are operațiune din catalog, deci n-are cu ce se compara.
        </p>
      ) : null}
    </div>
  );
}

// ── Sectiunea „Materiale" ────────────────────────────────────────────────────

function MaterialsSection({
  editable,
  locationId,
  locationName,
  stock,
  lines,
  saved,
  withMoney,
  onChange,
}: {
  readonly editable: boolean;
  readonly locationId: string;
  readonly locationName: string | null;
  readonly stock: readonly StockOption[];
  readonly lines: readonly MaterialState[];
  readonly saved: readonly MaterialLine[];
  readonly withMoney: boolean;
  readonly onChange: (lines: MaterialState[]) => void;
}) {
  const costById = new Map(saved.map((line) => [line.productId, line.unitCost]));
  const stockById = new Map(stock.map((option) => [option.productId, option]));

  if (locationId === '') {
    return (
      <Banner
        tone="warning"
        title="Echipa n-are gestiune"
        body="Materialele ies dintr-o gestiune, iar echipa aleasă pe fișă n-are una. Alege altă echipă pe tab-ul Fișă, sau cere-i biroului o gestiune pentru ea."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Ies din <span className="font-medium text-ink">{locationName ?? 'gestiunea echipei'}</span>.
        Costul lor se îngheață la validare, cu prețul mediu din ziua aia — de asta coloana de lei e
        goală până atunci.
      </p>

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
          Niciun material. O intervenție fără materiale e în regulă — se validează doar cu ore.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line, index) => {
            const option = stockById.get(line.productId);
            const cost = costById.get(line.productId) ?? null;

            return (
              <li
                key={line.key}
                className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[1fr_9rem_auto]"
              >
                <Select
                  options={stock.map((entry) => ({
                    value: entry.productId,
                    label: `${entry.label} · ${entry.available} ${entry.uom} disponibil`,
                  }))}
                  placeholder="Alege produsul"
                  value={line.productId}
                  disabled={!editable}
                  onChange={(event) => {
                    onChange(
                      lines.map((current, at) =>
                        at === index ? { ...current, productId: event.target.value } : current,
                      ),
                    );
                  }}
                />
                <Input
                  inputMode="decimal"
                  suffix={option?.uom ?? ''}
                  value={line.quantity}
                  disabled={!editable}
                  onChange={(event) => {
                    onChange(
                      lines.map((current, at) =>
                        at === index ? { ...current, quantity: event.target.value } : current,
                      ),
                    );
                  }}
                />
                <div className="flex items-center gap-3">
                  {withMoney && cost !== null ? (
                    <span className="text-xs text-ink-muted">
                      {cost} lei/{option?.uom ?? 'u.m.'}
                    </span>
                  ) : null}
                  {editable ? (
                    <Button
                      variant="ghost"
                      aria-label="Șterge linia"
                      onClick={() => {
                        onChange(lines.filter((_, at) => at !== index));
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editable ? (
        <Button
          variant="secondary"
          onClick={() => {
            onChange([...lines, { key: nextKey(), productId: '', quantity: '' }]);
          }}
        >
          <Plus className="size-4" aria-hidden /> Adaugă material
        </Button>
      ) : null}
    </div>
  );
}

// ── Sectiunea „Ore" ──────────────────────────────────────────────────────────

function HoursSection({
  editable,
  persons,
  lines,
  performedOn,
  declaredHours,
  onChange,
}: {
  readonly editable: boolean;
  readonly persons: readonly { readonly id: string; readonly name: string }[];
  readonly lines: readonly HourState[];
  readonly performedOn: string;
  readonly declaredHours: string;
  readonly onChange: (lines: HourState[]) => void;
}) {
  const total = lines.reduce((sum, line) => sum + (Number(decimal(line.hours)) || 0), 0);
  const declared = Number(decimal(declaredHours));
  const mismatch =
    declaredHours !== '' && !Number.isNaN(declared) && Math.abs(total - declared) > 0.01;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Fiecare linie e o persoană într-o zi. Tariful se ia din ziua lucrată, nu din cel de azi — de
        asta data contează chiar și când toate orele sunt din aceeași zi.
      </p>

      {mismatch ? (
        <Banner
          tone="info"
          title="Orele pontate diferă de cele declarate"
          body={`Pe fișă scrie ${declaredHours} ore, iar liniile însumează ${String(total)}. Nu e o eroare — costul se face din linii — dar merită o privire.`}
        />
      ) : null}

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
          Nicio linie de ore.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line, index) => (
            <li
              key={line.key}
              className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[1fr_9rem_9rem_auto]"
            >
              <Select
                options={persons.map((person) => ({ value: person.id, label: person.name }))}
                placeholder="Alege persoana"
                value={line.personId}
                disabled={!editable}
                onChange={(event) => {
                  onChange(
                    lines.map((current, at) =>
                      at === index ? { ...current, personId: event.target.value } : current,
                    ),
                  );
                }}
              />
              <Input
                inputMode="decimal"
                suffix="ore"
                value={line.hours}
                disabled={!editable}
                onChange={(event) => {
                  onChange(
                    lines.map((current, at) =>
                      at === index ? { ...current, hours: event.target.value } : current,
                    ),
                  );
                }}
              />
              <Input
                type="date"
                value={line.workDate}
                disabled={!editable}
                onChange={(event) => {
                  onChange(
                    lines.map((current, at) =>
                      at === index ? { ...current, workDate: event.target.value } : current,
                    ),
                  );
                }}
              />
              {editable ? (
                <Button
                  variant="ghost"
                  aria-label="Șterge linia"
                  onClick={() => {
                    onChange(lines.filter((_, at) => at !== index));
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <Button
          variant="secondary"
          onClick={() => {
            onChange([
              ...lines,
              { key: nextKey(), personId: '', hours: '', workDate: performedOn },
            ]);
          }}
        >
          <Plus className="size-4" aria-hidden /> Adaugă linie de ore
        </Button>
      ) : null}
    </div>
  );
}
