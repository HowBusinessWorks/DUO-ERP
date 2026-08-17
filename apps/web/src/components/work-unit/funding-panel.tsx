import type { AllocationRow } from '@damina/services';
import { Money as MoneyValue } from '@damina/shared';
import { Badge, EmptyState, Money } from '@damina/ui';
import type { ReactNode } from 'react';

/**
 * Finantarea unei unitati de lucru — regula de aur 1, facuta vizibila.
 *
 * Panoul arata TOATE alocarile, nu doar cele active: cele supersedate spun de
 * unde se platea si cine a decis sa nu mai fie asa. A doua intrebare e cea care
 * se pune la sedinta de luna, iar un ecran care ar arata doar prezentul ar lasa-o
 * fara raspuns.
 */

const MONTHS = [
  'ian.',
  'feb.',
  'mar.',
  'apr.',
  'mai',
  'iun.',
  'iul.',
  'aug.',
  'sep.',
  'oct.',
  'nov.',
  'dec.',
] as const;

export const monthLabel = (year: number, month: number): string =>
  `${MONTHS[month - 1] ?? String(month)} ${String(year)}`;

/**
 * Eticheta scurta a finantarii: „Delta ×3 luni”.
 *
 * Forma cu inmultire e din §3.4 si nu e cosmetica: ea e singurul loc din lista in
 * care se vede ca finantarea unei lucrari poate fi tăiată pe mai multe luni. „Delta”
 * simplu ar fi lasat impresia unei singure alocari.
 */
export function fundingSummary(rows: readonly AllocationRow[]): string | null {
  const active = rows.filter((row) => row.status === 'active');
  if (active.length === 0) {
    return null;
  }

  const byComponent = new Map<string, number>();
  for (const row of active) {
    byComponent.set(row.componentName, (byComponent.get(row.componentName) ?? 0) + 1);
  }

  return [...byComponent]
    .map(([name, count]) => (count > 1 ? `${name} ×${String(count)} luni` : name))
    .join(' + ');
}

export function FundingPanel({
  allocations,
  actions,
}: {
  readonly allocations: readonly AllocationRow[];
  /** Butonul de mutare, randat de apelant: el stie ce optiuni are firma. */
  actions?(allocation: AllocationRow): ReactNode;
}) {
  if (allocations.length === 0) {
    return (
      <EmptyState
        title="Nicio alocare de finanțare"
        body="Finanțarea nu e un câmp pe unitatea de lucru — e un rând pe fiecare componentă și lună din care se plătește. Fără măcar una, costurile n-ar avea de unde să fie plătite."
        size="sm"
      />
    );
  }

  const active = allocations.filter((row) => row.status === 'active');
  const superseded = allocations.filter((row) => row.status !== 'active');
  const total = MoneyValue.sum(
    active.map((row) => MoneyValue.fromDb(row.allocatedAmount)),
  );

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Finanțare activă</h3>
          <p className="text-sm text-ink-muted">
            {fundingSummary(allocations) ?? '—'} · total{' '}
            <Money value={total} className="font-semibold" />
          </p>
        </div>

        <ul className="space-y-2">
          {active.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {row.componentName}
                  <span className="text-ink-muted"> · contract {row.contractCode}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <span>{monthLabel(row.periodYear, row.periodMonth)}</span>
                  {row.periodStatus === 'open' ? null : (
                    <Badge tone="warning">
                      {row.periodStatus === 'closed' ? 'lună închisă' : 'în închidere'}
                    </Badge>
                  )}
                  <span className="truncate" title={row.reason}>
                    {row.reason}
                  </span>
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span data-numeric className="text-sm font-semibold tabular-nums text-ink">
                  {row.allocatedAmount === null ? (
                    `${(Number(row.allocatedPct) * 100).toFixed(2)}%`
                  ) : (
                    <Money value={MoneyValue.fromDb(row.allocatedAmount)} />
                  )}
                </span>
                {actions?.(row)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {superseded.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">
            Istoric
            <span className="ml-1.5 font-normal text-ink-muted">
              ({String(superseded.length)} alocări înlocuite)
            </span>
          </h3>
          <p className="mb-2 max-w-prose text-xs text-ink-subtle">
            Alocările nu se rescriu, se supersedează. Rândurile de aici au fost adevărate la vremea
            lor și rămân explicația cifrelor deja raportate.
          </p>
          <ul className="space-y-1.5">
            {superseded.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-ink-muted">
                  <span className="line-through">{row.componentName}</span> ·{' '}
                  {monthLabel(row.periodYear, row.periodMonth)} ·{' '}
                  <span title={row.reason}>{row.reason}</span>
                </span>
                <span data-numeric className="shrink-0 tabular-nums text-ink-muted">
                  {row.allocatedAmount === null ? (
                    `${(Number(row.allocatedPct) * 100).toFixed(2)}%`
                  ) : (
                    <Money value={MoneyValue.fromDb(row.allocatedAmount)} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
