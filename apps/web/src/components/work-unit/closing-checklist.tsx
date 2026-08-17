import type { ClosingChecklist as ChecklistModel } from '@damina/services';
import { Banner } from '@damina/ui';
import { Check, CircleAlert, Clock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Checklist-ul de inchidere. **Blocant, nu informativ** (§3.4).
 *
 * Doua reguli se vad direct in randare:
 *
 * 1. **Fiecare rand blocant are link la ce trebuie rezolvat.** Un checklist care
 *    spune „lipseste finantarea" fara sa duca acolo il pune pe om sa caute
 *    ecranul singur, si atunci lista devine o reclamatie, nu o unealta.
 * 2. **Randurile care depind de module viitoare APAR**, dezactivate, cu
 *    explicatie. Ascunse, ar lasa impresia ca inchiderea e completa — si aia e
 *    cea mai scumpa impresie greșită din tot pasul.
 */

const ICONS: Readonly<Record<string, ReactNode>> = {
  ok: <Check className="size-4 text-success-600" aria-hidden="true" />,
  blocking: <CircleAlert className="size-4 text-danger-600" aria-hidden="true" />,
  pending_module: <Clock className="size-4 text-ink-subtle" aria-hidden="true" />,
};

const STATE_LABELS: Readonly<Record<string, string>> = {
  ok: 'în regulă',
  blocking: 'blochează închiderea',
  pending_module: 'vine în alt pas',
};

export function ClosingChecklist({
  checklist,
  action,
}: {
  readonly checklist: ChecklistModel;
  /** Butonul de inchidere. Randat de apelant, care stie si dreptul si luna. */
  readonly action?: ReactNode;
}) {
  const blocking = checklist.items.filter((item) => item.state === 'blocking');

  return (
    <div className="space-y-4">
      {checklist.canClose ? (
        <Banner
          tone="success"
          title="Se poate închide"
          body="Toate rândurile care blochează sunt rezolvate. După închidere nu se mai înregistrează costuri noi pe unitate."
        />
      ) : (
        <Banner
          tone="warning"
          title={`${String(blocking.length)} ${blocking.length === 1 ? 'lucru' : 'lucruri'} de rezolvat înainte de închidere`}
          body="Butonul de închidere rămâne blocat până atunci. Fiecare rând de mai jos duce direct la locul în care se rezolvă."
        />
      )}

      <ul className="divide-y divide-line rounded-md border border-line bg-surface">
        {checklist.items.map((item) => (
          <li key={item.code} className="flex items-start gap-3 p-3">
            <span className="mt-0.5 shrink-0">{ICONS[item.state]}</span>

            <div className="min-w-0 flex-1">
              <p
                className={
                  item.state === 'pending_module'
                    ? 'text-sm font-medium text-ink-subtle'
                    : 'text-sm font-medium text-ink'
                }
              >
                {item.label}
                <span className="sr-only"> — {STATE_LABELS[item.state] ?? item.state}</span>
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">{item.detail}</p>
            </div>

            {item.href === null ? null : (
              <Link
                href={item.href}
                className="shrink-0 self-center rounded px-2 py-1 text-sm font-medium text-brand-700 hover:underline"
              >
                Rezolvă
              </Link>
            )}
          </li>
        ))}
      </ul>

      {action}
    </div>
  );
}
