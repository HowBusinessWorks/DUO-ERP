import type { PmPanel } from '@damina/services';
import { Money as MoneyValue } from '@damina/shared';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Gauge,
  Money,
  ProgressBar,
} from '@damina/ui';
import { AlertTriangle, ArrowRight, CheckCheck, TrendingDown } from 'lucide-react';
import Link from 'next/link';

/**
 * Panoul PM (§3.7 al pasului 10), pe patru carduri, in ordinea deciziei:
 *
 *   1. **Delta** — ce se pierde daca nu faci nimic azi. Sta primul si e cel mai
 *      mare lucru de pe ecran, fiindca e singurul ireversibil.
 *   2. **Contractele mele** — de unde vin leii aia si cum sta consumul.
 *   3. **De aprobat** — ce sta blocat din cauza mea.
 *   4. **Lucrari in risc** — unde banii au luat-o inaintea muncii.
 *
 * Toate cifrele sunt legate de ecranul care le desface (principiul I3): un panou
 * din care nu se poate intra nicaieri e un afis, nu un instrument.
 */

const BACKLOG_HREF = '/cereri?view=backlog';

export function PmSection({ panel }: { panel: PmPanel }) {
  const scopeLabel = panel.scope === 'mine' ? 'contractele mele' : 'toate contractele vizibile';

  return (
    <div className="mb-5 space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <DeltaCard panel={panel} scopeLabel={scopeLabel} />
        <ContractsCard panel={panel} scopeLabel={scopeLabel} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ApprovalsCard panel={panel} />
        <RiskCard panel={panel} />
      </div>
    </div>
  );
}

// ── 1. Delta ─────────────────────────────────────────────────────────────────

function DeltaCard({ panel, scopeLabel }: { panel: PmPanel; scopeLabel: string }) {
  const { delta } = panel;

  if (delta.state === 'nesetat') {
    return (
      <Card>
        <CardHeader title="Delta lunii" description={`Plafonul de venit pe ${scopeLabel}.`} />
        <CardBody>
          <EmptyState
            icon={<TrendingDown className="size-5" aria-hidden="true" />}
            title="Plafonul de venit nu e setat"
            body="Delta se setează manual, în fiecare lună. Fără ea nu se poate ști cât venit rămâne neumplut — iar neumplutul se pierde la 31, nu se reportează."
            size="sm"
            action={
              <Link
                href="/contracte?view=plafoane"
                className="text-sm font-medium text-brand-700 hover:underline"
              >
                Deschide plafoanele →
              </Link>
            }
          />
        </CardBody>
      </Card>
    );
  }

  const behind = delta.state === 'in_urma';
  const full = delta.state === 'plin';

  return (
    <Card>
      <CardHeader
        title="Delta lunii"
        description={`Plafon de VENIT pe ${scopeLabel}. Se umple; ce rămâne neumplut la finalul lunii se pierde.`}
        actions={
          <Badge tone={full ? 'success' : behind ? 'danger' : 'brand'}>
            {full ? 'plină' : behind ? 'sub ritm' : 'în grafic'}
          </Badge>
        }
      />
      <CardBody>
        <Gauge
          value={delta.fillPercent}
          caption="umplut din plafonul lunii"
          tone={full ? 'success' : behind ? 'danger' : 'brand'}
          marker={delta.expectedPercent}
          markerLabel={`semnul de pe arc e ritmul zilei: ${String(Math.round(delta.expectedPercent))}%`}
        />

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
          <div>
            <dt className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              Lei liberi
            </dt>
            <dd
              data-numeric
              className={`mt-0.5 text-lg font-semibold tabular-nums ${
                behind ? 'text-danger-700' : 'text-ink'
              }`}
            >
              <Money value={delta.unfilled} />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              Zile rămase
            </dt>
            <dd data-numeric className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
              {delta.daysLeft}
            </dd>
          </div>
        </dl>

        {panel.deltaUnset === 0 ? null : (
          <p className="mt-3 text-xs text-ink-subtle">
            {panel.deltaUnset === 1
              ? 'O componentă Delta n-are plafon setat și nu intră în cifra de mai sus.'
              : `${String(panel.deltaUnset)} componente Delta n-au plafon setat și nu intră în cifra de mai sus.`}
          </p>
        )}

        {delta.daysLeft === 0 ? null : (
          <Link
            href={BACKLOG_HREF}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
          >
            Umple din backlog
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </CardBody>
    </Card>
  );
}

// ── 2. Contractele mele ──────────────────────────────────────────────────────

function ContractsCard({ panel, scopeLabel }: { panel: PmPanel; scopeLabel: string }) {
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title={panel.scope === 'mine' ? 'Contractele mele' : 'Contracte active'}
        description={
          panel.scope === 'mine'
            ? 'Contractele pe care ești PM, cu umplerea Deltei și consumul din plafoanele de cost.'
            : 'Nu ești PM pe niciun contract activ, așa că se arată toate cele vizibile.'
        }
      />
      {panel.contracts.length === 0 ? (
        <EmptyState
          title={`Niciun contract activ pe ${scopeLabel}`}
          body="Panoul se umple singur când un contract activ intră pe firmele selectate în antet."
          size="sm"
        />
      ) : (
        <ul className="divide-y divide-border">
          {panel.contracts.map((contract) => (
            <li key={contract.contractId}>
              <Link
                href={`/contracte/${contract.contractId}`}
                className="block px-4 py-3 hover:bg-surface-hover"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span data-numeric className="font-medium tabular-nums text-ink">
                    {contract.code}
                  </span>
                  <span className="truncate text-sm text-ink-muted">{contract.clientName}</span>
                </div>

                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {contract.fill === null || contract.fill.state === 'nesetat' ? (
                    <p className="self-center text-xs text-ink-subtle">Delta fără plafon setat</p>
                  ) : (
                    <ProgressBar
                      size="sm"
                      label="Umplere Delta"
                      value={contract.fill.fillPercent}
                      // Tonul e EXPLICIT si e inversul celui implicit: la Delta
                      // mult inseamna bine. Lasat pe implicit, 90% umplut ar iesi
                      // portocaliu, ca o depasire de buget.
                      tone={
                        contract.fill.state === 'plin'
                          ? 'success'
                          : contract.fill.state === 'in_urma'
                            ? 'danger'
                            : 'brand'
                      }
                      detail={`${contract.fill.unfilled.format()} neumpluți`}
                    />
                  )}

                  {contract.usage.hasCeiling ? (
                    <ProgressBar
                      size="sm"
                      label="Consum din plafoane"
                      value={Number.isFinite(contract.usage.percent) ? contract.usage.percent : 100}
                      detail={`${contract.usage.used.format()} din ${(
                        contract.usage.ceiling ?? MoneyValue.ZERO
                      ).format()}`}
                    />
                  ) : (
                    <p className="self-center text-xs text-ink-subtle">
                      Plafoane de cost nesetate luna asta
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── 3. De aprobat ────────────────────────────────────────────────────────────

function ApprovalsCard({ panel }: { panel: PmPanel }) {
  return (
    <Card>
      <CardHeader
        title="De aprobat"
        description="Fișe și pontaje care stau nevalidate. Până la validare nu intră în luna de raportare."
      />
      {panel.approvals.length === 0 ? (
        <EmptyState
          icon={<CheckCheck className="size-5" aria-hidden="true" />}
          title="Nimic nevalidat"
          body="Fișele și pontajele trimise de pe teren apar aici în momentul în care ajung la birou."
          size="sm"
        />
      ) : (
        <ul className="divide-y divide-border">
          {panel.approvals.map((approval) => (
            <li key={approval.kind}>
              <Link
                href={approval.href}
                className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
              >
                <span className="text-base text-ink">{approval.label}</span>
                <Badge tone="warning">{approval.count}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── 4. Lucrări în risc ───────────────────────────────────────────────────────

function RiskCard({ panel }: { panel: PmPanel }) {
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Lucrări în risc"
        description="Consumul a depășit execuția. Cele două cifre vin din surse diferite — registrul de cost și etapele — tocmai ca să poată diverge."
      />
      {panel.atRisk.length === 0 ? (
        <EmptyState
          title="Nicio lucrare cu banii înaintea muncii"
          body="O lucrare intră aici când procentul consumat din buget trece peste procentul executat din etape."
          size="sm"
        />
      ) : (
        <ul className="divide-y divide-border">
          {panel.atRisk.map((row) => (
            <li key={row.workUnitId}>
              <Link
                href={`/activitate/${row.workUnitId}`}
                className="block px-4 py-3 hover:bg-surface-hover"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span data-numeric className="font-medium tabular-nums text-ink">
                      {row.code}
                    </span>
                    <span className="ml-2 text-sm text-ink-muted">{row.name}</span>
                  </span>
                  <Badge tone={row.risk.severity === 'critic' ? 'danger' : 'warning'}>
                    <AlertTriangle className="mr-1 inline size-3" aria-hidden="true" />+
                    {Math.round(row.risk.gap)} pp
                  </Badge>
                </div>

                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <ProgressBar
                    size="sm"
                    label="Consumat din buget"
                    value={row.consumedPercent}
                    tone={row.risk.severity === 'critic' ? 'danger' : 'warning'}
                    detail={`${row.consumed.format()} din ${row.costBudget.format()}`}
                  />
                  <ProgressBar
                    size="sm"
                    label="Executat"
                    value={row.progressPercent}
                    tone="brand"
                    detail={row.weighted ? 'din ponderile etapelor' : 'etape numărate egal'}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
