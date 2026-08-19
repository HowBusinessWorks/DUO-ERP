import { evaluatePeriodClose, findPeriodId, type PeriodCloseState } from '@damina/services';
import { Badge, Banner, EmptyState } from '@damina/ui';
import { Check, CircleAlert, Clock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { EntityContext } from '../../registry/types';
import { ClosePeriodButton, ReopenPeriodButton, StartClosingButton } from './period-close-actions';

/**
 * Bani › Închidere de perioadă (§3.3).
 *
 * Checklist-ul e **blocant, nu informativ**. Doua consecinte se vad direct in
 * randare:
 *
 * 1. **Fiecare rand blocat spune CE si duce ACOLO.** Un rand care spune doar „nu
 *    merge" muta munca de gasit pe umerii omului, si atunci lista devine o
 *    reclamatie.
 * 2. **Randurile modulelor care inca nu exista APAR**, cu explicatie. Ascunse, ar
 *    lasa impresia ca inchiderea verifica tot — cea mai scumpa impresie gresita
 *    din pas.
 *
 * Ecranul se randeaza per firma selectata: luna e a firmei, nu a grupului. Doua
 * firme pot fi in stari diferite in aceeasi luna calendaristica, si asta e normal.
 */

const ICONS: Readonly<Record<string, ReactNode>> = {
  ok: <Check className="size-4 text-success-600" aria-hidden="true" />,
  blocked: <CircleAlert className="size-4 text-danger-600" aria-hidden="true" />,
  pending: <Clock className="size-4 text-ink-subtle" aria-hidden="true" />,
  pending_module: <Clock className="size-4 text-ink-subtle" aria-hidden="true" />,
  not_applicable: <Clock className="size-4 text-ink-subtle" aria-hidden="true" />,
};

const STATE_LABELS: Readonly<Record<string, string>> = {
  ok: 'în regulă',
  blocked: 'blochează închiderea',
  pending: 'neevaluat',
  pending_module: 'vine în alt pas',
  not_applicable: 'nu se aplică',
};

const STATUS_BADGES: Readonly<
  Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }>
> = {
  open: { label: 'deschisă', tone: 'success' },
  closing: { label: 'în verificare', tone: 'warning' },
  closed: { label: 'închisă', tone: 'neutral' },
};

export async function PeriodCloseScreen({ ctx }: { ctx: EntityContext }) {
  const companies = ctx.app.companies.filter((company) =>
    ctx.app.selectedCompanyIds.includes(company.id),
  );

  const blocks: { companyName: string; periodId: string; state: PeriodCloseState }[] = [];
  for (const company of companies) {
    const periodId = await findPeriodId(ctx.actor, company.id, ctx.app.year, ctx.app.month);
    if (periodId === null) continue;
    blocks.push({
      companyName: company.name,
      periodId,
      state: await evaluatePeriodClose(ctx.actor, periodId),
    });
  }

  if (blocks.length === 0) {
    return (
      <EmptyState
        title="Luna asta nu există la firmele selectate"
        body="Lunile se deschid automat la prima scriere din ele. Dacă vrei să pregătești închiderea unei luni viitoare, deschide-o întâi înregistrând ceva în ea."
      />
    );
  }

  return (
    <div className="space-y-8">
      {blocks.map((block) => (
        <CompanyClosing key={block.periodId} {...block} />
      ))}
    </div>
  );
}

function CompanyClosing({
  companyName,
  periodId,
  state,
}: {
  readonly companyName: string;
  readonly periodId: string;
  readonly state: PeriodCloseState;
}) {
  const blocked = state.checks.filter((check) => check.status === 'blocked');
  const badge = STATUS_BADGES[state.status] ?? STATUS_BADGES.open;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          {companyName}
          <Badge tone={badge?.tone ?? 'neutral'}>{badge?.label ?? state.status}</Badge>
        </h2>

        <div className="flex items-center gap-2">
          {state.status === 'open' ? <StartClosingButton periodId={periodId} /> : null}
          {state.status === 'closed' ? (
            <ReopenPeriodButton periodId={periodId} />
          ) : (
            <ClosePeriodButton
              periodId={periodId}
              {...(state.canClose
                ? {}
                : {
                    blockedReason: `${String(blocked.length)} ${
                      blocked.length === 1 ? 'verificare blochează' : 'verificări blochează'
                    } închiderea. Rezolvă-le întâi — fiecare rând de mai jos duce acolo.`,
                  })}
            />
          )}
        </div>
      </div>

      {state.status === 'closed' ? (
        <Banner
          tone="info"
          title="Luna e închisă"
          body="Nicio scriere nu mai intră în ea. Mutările de finanțare din ea se fac prin documente de re-alocare, în luna curentă, cu ambele capete vizibile."
        />
      ) : state.canClose ? (
        <Banner
          tone="success"
          title="Se poate închide"
          body="Nicio verificare nu mai blochează. Închiderea cere un motiv scris și îngheață cifrele lunii."
        />
      ) : (
        <Banner
          tone="warning"
          title={`${String(blocked.length)} ${blocked.length === 1 ? 'verificare blochează' : 'verificări blochează'} închiderea`}
          body="Butonul rămâne blocat până se rezolvă. Fiecare rând duce direct la ce trebuie lămurit."
        />
      )}

      <ul className="divide-y divide-line rounded-md border border-line bg-surface">
        {state.checks.map((check) => (
          <li key={check.checkKey} className="flex items-start gap-3 p-3">
            <span className="mt-0.5 shrink-0">{ICONS[check.status]}</span>

            <div className="min-w-0 flex-1">
              <p
                className={
                  check.status === 'pending_module' || check.status === 'not_applicable'
                    ? 'text-sm font-medium text-ink-subtle'
                    : 'text-sm font-medium text-ink'
                }
              >
                {check.title}
                {check.blockingCount > 0 ? (
                  <span className="ml-2 rounded-full bg-danger-100 px-2 py-0.5 text-xs font-semibold text-danger-800">
                    {check.blockingCount}
                  </span>
                ) : null}
                <span className="sr-only"> — {STATE_LABELS[check.status] ?? check.status}</span>
              </p>

              {check.pendingModule === null ? null : (
                <p className="mt-0.5 text-sm text-ink-subtle">
                  Se verifică din {check.pendingModule}. Rândul se aprinde singur când apare
                  modulul.
                </p>
              )}

              {check.detail === null || check.detail === undefined ? null : (
                <ul className="mt-1 space-y-0.5">
                  {check.detail.items.map((item) => (
                    <li key={item.label} className="text-sm text-ink-muted">
                      {item.href === undefined ? (
                        item.label
                      ) : (
                        <Link href={item.href} className="text-brand-700 hover:underline">
                          {item.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
