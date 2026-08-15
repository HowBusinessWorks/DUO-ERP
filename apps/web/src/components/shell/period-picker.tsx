'use client';

import { formatPeriodShort, monthName, t } from '@damina/i18n';
import { Button, cn } from '@damina/ui';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

export interface PeriodPickerProps {
  readonly year: number;
  readonly month: number;
  /** Luna e inchisa in cel putin o firma selectata. */
  readonly locked: boolean;
  readonly closedCompanyNames: readonly string[];
  readonly totalCompanies: number;
  readonly onChange: (year: number, month: number) => Promise<void>;
}

/**
 * Selectorul de luna (§5.2).
 *
 * LACATUL e cea mai importanta indicatie vizuala din aplicatie. Nu e un
 * ornament: pe o luna inchisa se poate naviga si citi tot, dar nu se poate
 * modifica nimic, iar omul trebuie sa stie asta INAINTE sa completeze un
 * formular, nu dupa ce apasa Salvează.
 */
export function PeriodPicker({
  year,
  month,
  locked,
  closedCompanyNames,
  totalCompanies,
  onChange,
}: PeriodPickerProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const shift = (delta: number): void => {
    const index = year * 12 + (month - 1) + delta;
    startTransition(() => {
      void onChange(Math.floor(index / 12), (index % 12) + 1);
    });
  };

  const lockTitle = locked
    ? closedCompanyNames.length === totalCompanies
      ? t('period.lockedTitle', { period: `${monthName(month)} ${String(year)}` })
      : t('period.mixedCompanies', {
          period: `${monthName(month)} ${String(year)}`,
          closed: closedCompanyNames.length,
          total: totalCompanies,
        })
    : undefined;

  return (
    <div ref={containerRef} className="relative flex items-center">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          shift(-1);
        }}
        aria-label={t('period.previous')}
        className="rounded-r-none"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>

      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        title={lockTitle}
        disabled={pending}
        className={cn(
          'flex h-8 items-center gap-1.5 border-x border-transparent px-2 text-sm font-medium',
          'rounded transition-colors hover:bg-surface-hover',
          locked ? 'text-warning-700' : 'text-ink',
        )}
      >
        {locked ? <Lock className="size-3.5" aria-hidden="true" /> : null}
        {formatPeriodShort(year, month)}
      </button>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          shift(1);
        }}
        aria-label={t('period.next')}
        className="rounded-l-none"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>

      {open ? (
        <div className="absolute top-full right-0 z-40 mt-1.5 w-64 rounded-lg border border-border bg-surface p-2 shadow-lg">
          <div className="flex items-center justify-between px-1 pb-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                startTransition(() => {
                  void onChange(year - 1, month);
                });
              }}
              aria-label={`Anul ${String(year - 1)}`}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <span data-numeric className="text-base font-semibold tabular-nums">
              {year}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                startTransition(() => {
                  void onChange(year + 1, month);
                });
              }}
              aria-label={`Anul ${String(year + 1)}`}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setOpen(false);
                  startTransition(() => {
                    void onChange(year, value);
                  });
                }}
                className={cn(
                  'rounded px-1 py-1.5 text-sm capitalize transition-colors',
                  value === month
                    ? 'bg-brand-600 font-medium text-white'
                    : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
                )}
              >
                {monthName(value, true)}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setOpen(false);
              startTransition(() => {
                void onChange(now.getFullYear(), now.getMonth() + 1);
              });
            }}
            className="mt-2 w-full rounded border border-border py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            {t('period.current')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
