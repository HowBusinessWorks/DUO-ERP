'use client';

import { formatPeriodShort } from '@damina/i18n';
import { Button, cn } from '@damina/ui';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useTransition } from 'react';
import { setPeriod } from '../../app/(office)/context-actions';

/**
 * Navigarea ◀ ▶ pe luni, de pe ecranul de Prezentare (verificarea #8).
 *
 * Schimba ACELASI context global pe care il schimba selectorul din bara de sus,
 * nu o stare locala a ecranului. Doua surse de adevar pentru „ce luna privesc”
 * ar insemna ca omul deruleaza contractul pe iulie si sidebar-ul ii arata
 * badge-urile lui august — exact contradictia pe care I8 o interzice.
 */
export function MonthNav({
  year,
  month,
  locked,
}: {
  readonly year: number;
  readonly month: number;
  readonly locked: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const shift = (delta: number): void => {
    const index = year * 12 + (month - 1) + delta;
    startTransition(() => {
      void setPeriod(Math.floor(index / 12), (index % 12) + 1);
    });
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Luna anterioară"
        disabled={pending}
        onClick={() => {
          shift(-1);
        }}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>

      <span
        data-numeric
        title={
          locked ? 'Luna e închisă. Se poate citi tot, nu se poate modifica nimic.' : undefined
        }
        className={cn(
          'flex min-w-32 items-center justify-center gap-1.5 text-base font-semibold tabular-nums',
          locked ? 'text-warning-700' : 'text-ink',
        )}
      >
        {locked ? <Lock className="size-3.5" aria-hidden="true" /> : null}
        {formatPeriodShort(year, month)}
      </span>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Luna următoare"
        disabled={pending}
        onClick={() => {
          shift(1);
        }}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
