'use client';

import { Money as MoneyValue } from '@damina/shared';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Input,
  Money,
  ProgressBar,
  Select,
  Textarea,
  useToast,
} from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { promoteBacklogAction, suggestBacklogFillAction } from '../../app/(office)/request-actions';

/**
 * Backlogul de propuneri — ecranul de umplere a Deltei (§3.5).
 *
 * Funcționalitatea cu cel mai bun raport efort/venit din tot pasul: Delta
 * neumplută se pierde definitiv la finalul lunii, iar aici se vede exact cât
 * mai încape și ce combinație o umple cel mai bine.
 *
 * Butonul „Umple automat" cheamă `selectBacklogToFill` pe SERVER, nu în browser:
 * `apps/web` n-are voie să importe `domain` (regula de dependențe din §3.2), iar
 * asta e și mai bine — serverul recitește liberul lunii în același apel, deci
 * combinația e optimă față de cifra de acum, nu față de una încărcată acum zece
 * minute. Totalul cumulat de sub listă rămâne în browser: e o adunare, la fiecare
 * bifă, și nu merită un drum dus-întors.
 */

export interface BacklogProposal {
  readonly id: string;
  readonly title: string;
  readonly estimatedValue: string;
  readonly objectiveName: string;
  readonly contractId: string;
  readonly contractCode: string;
  readonly sourceKind: string;
  readonly status: string;
  readonly validUntil: string | null;
}

export interface BacklogContract {
  readonly contractId: string;
  readonly contractCode: string;
  readonly componentId: string | null;
  readonly months: readonly {
    readonly periodId: string;
    readonly label: string;
    readonly free: string;
  }[];
}

export interface BacklogFillProps {
  readonly proposals: readonly BacklogProposal[];
  readonly contracts: readonly BacklogContract[];
  readonly canPromote: boolean;
  readonly blockedReason?: string;
}

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  inspectie: 'din inspecție',
  tichet: 'din tichet',
  amanata: 'amânată',
};

export function BacklogFill({ proposals, contracts, canPromote, blockedReason }: BacklogFillProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [contractId, setContractId] = useState(contracts[0]?.contractId ?? '');
  const contract = contracts.find((candidate) => candidate.contractId === contractId);
  const [periodId, setPeriodId] = useState(contract?.months[0]?.periodId ?? '');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [series, setSeries] = useState('L');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [overCeiling, setOverCeiling] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [heuristic, setHeuristic] = useState(false);

  const visible = useMemo(
    () => proposals.filter((proposal) => proposal.contractId === contractId),
    [proposals, contractId],
  );

  const month = contract?.months.find((candidate) => candidate.periodId === periodId);
  const free = MoneyValue.fromDb(month?.free ?? null);
  const total = MoneyValue.sum(
    visible
      .filter((proposal) => selected.includes(proposal.id))
      .map((proposal) => MoneyValue.fromDb(proposal.estimatedValue)),
  );
  const fillPercent = free.isZero()
    ? 0
    : Math.round((total.toUnsafeNumber() / free.toUnsafeNumber()) * 100);
  const over = total.gt(free) ? total.sub(free) : null;

  function switchContract(next: string): void {
    setContractId(next);
    const target = contracts.find((candidate) => candidate.contractId === next);
    setPeriodId(target?.months[0]?.periodId ?? '');
    setSelected([]);
    setOverCeiling(undefined);
    setHeuristic(false);
  }

  function toggle(id: string): void {
    setOverCeiling(undefined);
    setSelected((current) =>
      current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id],
    );
  }

  /** Combinația care umple cel mai bine luna — knapsack, pe server. */
  function autoFill(): void {
    void (async () => {
      setError(undefined);
      setOverCeiling(undefined);
      const result = await suggestBacklogFillAction({ contractId, periodId });
      if (result.ok) {
        setSelected(result.data.selectedIds);
        setHeuristic(!result.data.exact);
      } else {
        setError(result.message);
      }
    })();
  }

  function promote(accept: boolean): void {
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await promoteBacklogAction({
        proposalIds: selected,
        series,
        contractId,
        componentId: contract?.componentId ?? '',
        periodId,
        reason,
        acceptOverCeiling: accept,
      });
      setSaving(false);

      if (result.ok) {
        toast({
          tone: 'success',
          title: `${String(result.data.workUnitIds.length)} lucrări create și finanțate.`,
        });
        setSelected([]);
        setReason('');
        setOverCeiling(undefined);
        router.refresh();
        return;
      }

      // Depășirea de plafon nu e o eroare oarbă: serviciul spune cu cât, iar
      // ecranul oferă drumul conștient înainte, nu îl închide.
      if (result.code === 'CONFLICT' && result.message.includes('plafonul')) {
        setOverCeiling(result.message);
      } else {
        setError(result.message);
      }
    })();
  }

  if (contracts.length === 0) {
    return (
      <EmptyState
        title="Nicio propunere în backlog"
        body="Backlogul se umple din constatările NOK amânate și din cererile pe care le amâni din ecranul de Decizie. De acolo se promovează, la 10 și la 20 ale lunii, în lucrările care umplu Delta."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-ink-muted">
        Delta neumplută <strong>se pierde definitiv</strong> la finalul lunii. Bifează propunerile
        până se apropie totalul de liber, sau lasă butonul de umplere automată să găsească
        combinația.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block w-64">
          <span className="mb-1 block text-sm font-medium text-ink">Contract</span>
          <Select
            options={contracts.map((candidate) => ({
              value: candidate.contractId,
              label: candidate.contractCode,
            }))}
            value={contractId}
            onChange={(event) => {
              switchContract(event.target.value);
            }}
          />
        </label>

        <label className="block w-56">
          <span className="mb-1 block text-sm font-medium text-ink">Luna de Deltă</span>
          <Select
            options={(contract?.months ?? []).map((candidate) => ({
              value: candidate.periodId,
              label: `${candidate.label} · ${MoneyValue.fromDb(candidate.free).format()} liber`,
            }))}
            placeholder={contract?.months.length === 0 ? 'nicio lună cu plafon' : undefined}
            value={periodId}
            onChange={(event) => {
              setPeriodId(event.target.value);
              setSelected([]);
              setOverCeiling(undefined);
            }}
          />
        </label>

        <Button
          onClick={autoFill}
          disabled={free.isZero() || visible.length === 0}
          disabledReason={
            free.isZero() ? 'Luna asta n-are plafon de Deltă setat, deci n-are ce umple.' : undefined
          }
        >
          Umple automat
        </Button>
      </div>

      {/* Totalul cumulat, live (verificarea #14). */}
      <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-sm text-ink-muted">
            {selected.length === 0
              ? 'Nicio propunere bifată'
              : `${String(selected.length)} ${selected.length === 1 ? 'propunere bifată' : 'propuneri bifate'}`}
          </span>
          <span className="flex items-baseline gap-2">
            <Money value={total} emphasis />
            <span className="text-sm text-ink-muted">
              din <Money value={free} /> liber
            </span>
          </span>
        </div>
        <ProgressBar
          className="mt-2"
          value={Math.min(fillPercent, 100)}
          tone={over !== null ? 'danger' : fillPercent >= 80 ? 'success' : 'brand'}
          label={`Umplere ${String(fillPercent)}%`}
        />
        {over === null ? null : (
          <p className="mt-1.5 text-sm text-danger-700">
            Peste plafon cu <Money value={over} />. Se poate promova, dar numai cu confirmare.
          </p>
        )}
        {!heuristic ? null : (
          <p className="mt-1.5 text-xs text-ink-subtle">
            Selecția automată a folosit euristica (prea multe propuneri pentru combinația exactă) —
            e o soluție bună, nu neapărat cea mai bună.
          </p>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Contractul n-are propuneri deschise"
          body="Propunerile promovate sau expirate rămân vizibile, dar nu se mai pot promova."
          size="sm"
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {visible.map((proposal) => (
            <li key={proposal.id}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-surface-hover">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(proposal.id)}
                  onChange={() => {
                    toggle(proposal.id);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{proposal.title}</span>
                    <Badge tone="neutral">
                      {SOURCE_LABELS[proposal.sourceKind] ?? proposal.sourceKind}
                    </Badge>
                    {proposal.validUntil === null ? null : (
                      <Badge tone="outline">valabilă până la {proposal.validUntil}</Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    {proposal.objectiveName}
                  </span>
                </span>
                <Money value={MoneyValue.fromDb(proposal.estimatedValue)} />
              </label>
            </li>
          ))}
        </ul>
      )}

      {blockedReason === undefined ? null : (
        <Banner tone="warning" title="Luna e închisă" body={blockedReason} />
      )}
      {error === undefined ? null : (
        <Banner tone="danger" title="Promovarea n-a mers" body={error} />
      )}
      {overCeiling === undefined ? null : (
        <Banner
          tone="warning"
          title="Promovarea depășește plafonul lunii"
          body={overCeiling}
          action={
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              onClick={() => {
                promote(true);
              }}
            >
              Promovează oricum
            </Button>
          }
        />
      )}

      {canPromote ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-28">
            <span className="mb-1 block text-sm font-medium text-ink">Serie</span>
            <Input
              value={series}
              onChange={(event) => {
                setSeries(event.target.value);
              }}
            />
          </label>
          <label className="block min-w-64 flex-1">
            <span className="mb-1 block text-sm font-medium text-ink">
              Motiv <span className="text-danger-700">*</span>
            </span>
            <Textarea
              rows={2}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              placeholder="De ce se promovează acum. Ajunge pe fiecare alocare creată."
            />
          </label>
          <Button
            variant="primary"
            loading={saving}
            disabled={
              selected.length === 0 ||
              reason.trim() === '' ||
              periodId === '' ||
              contract?.componentId === null
            }
            disabledReason={
              selected.length === 0
                ? 'Bifează cel puțin o propunere.'
                : reason.trim() === ''
                  ? 'Scrie de ce promovezi acum.'
                  : contract?.componentId === null
                    ? 'Contractul n-are componentă de Deltă.'
                    : periodId === ''
                      ? 'Alege luna de Deltă.'
                      : undefined
            }
            onClick={() => {
              promote(false);
            }}
          >
            Promovează în lucrări
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-subtle">
          Promovarea creează unități de lucru și le alocă finanțarea. Rolul tău nu o poate face.
        </p>
      )}
    </div>
  );
}
