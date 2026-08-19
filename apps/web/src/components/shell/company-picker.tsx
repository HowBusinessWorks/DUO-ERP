'use client';

import { t } from '@damina/i18n';
import { Badge, Button, cn } from '@damina/ui';
import { Building2, Check, ChevronDown, Lock } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { CompanyMode, ConsolidationMode } from '../../lib/context';

export interface CompanyPickerProps {
  readonly companies: readonly { readonly id: string; readonly name: string }[];
  readonly selectedIds: readonly string[];
  readonly mode: CompanyMode;
  readonly consolidation: ConsolidationMode;
  /**
   * Firma e impusa de entitatea deschisa (o factura, un contract).
   *
   * Nu poti fi „pe toate firmele” in timp ce esti pe factura firmei B (§5.1),
   * asa ca selectorul se blocheaza si spune de ce.
   */
  readonly lockedTo?: { readonly id: string; readonly name: string };
  readonly onChange: (ids: readonly string[]) => Promise<void>;
  readonly onConsolidationChange: (mode: ConsolidationMode) => Promise<void>;
}

export function CompanyPicker({
  companies,
  selectedIds,
  mode,
  consolidation,
  lockedTo,
  onChange,
  onConsolidationChange,
}: CompanyPickerProps) {
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
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const label =
    lockedTo !== undefined
      ? lockedTo.name
      : mode === 'all'
        ? t('company.all')
        : mode === 'one'
          ? (companies.find((company) => company.id === selectedIds[0])?.name ?? t('company.all'))
          : t('company.some', { count: selectedIds.length });

  const toggle = (id: string): void => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((value) => value !== id)
      : [...selectedIds, id];
    // Zero firme selectate nu inseamna nimic: contextul cade inapoi pe toate.
    startTransition(() => {
      void onChange(next.length === 0 ? companies.map((company) => company.id) : next);
    });
  };

  if (lockedTo !== undefined) {
    return (
      <span
        title={t('company.locked', { name: lockedTo.name })}
        className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2.5 text-sm font-medium text-ink-muted"
      >
        <Lock className="size-3.5" aria-hidden="true" />
        {lockedTo.name}
      </span>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="secondary"
        size="md"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-haspopup="true"
        icon={<Building2 className="size-4 text-ink-muted" aria-hidden="true" />}
        iconRight={<ChevronDown className="size-3.5 text-ink-subtle" aria-hidden="true" />}
        loading={pending}
        className="max-w-56"
      >
        <span className="truncate">{label}</span>
      </Button>

      {open ? (
        <div className="absolute top-full right-0 z-40 mt-1.5 w-80 rounded-lg border border-border bg-surface p-1.5 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {t('company.selector')}
            </p>
            <button
              type="button"
              onClick={() => {
                startTransition(() => {
                  void onChange(companies.map((company) => company.id));
                });
              }}
              className="text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              {t('company.selectAll')}
            </button>
          </div>

          <ul className="scrollbar-thin max-h-72 overflow-y-auto">
            {companies.map((company) => {
              const checked = selectedIds.includes(company.id);
              return (
                <li key={company.id}>
                  <button
                    type="button"
                    onClick={() => {
                      toggle(company.id);
                    }}
                    aria-pressed={checked}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-base',
                      checked ? 'text-ink' : 'text-ink-muted',
                      'hover:bg-surface-hover',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        checked
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-border-strong',
                      )}
                    >
                      {checked ? <Check className="size-3" /> : null}
                    </span>
                    <span className="truncate">{company.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/*
            Vederea pe mai multe firme trebuie ETICHETATA (§5.1). Fara eticheta,
            nimeni nu stie daca cifra de pe ecran contine sau nu facturile dintre
            firmele grupului — si diferenta e de ordinul milioanelor.
          */}
          {selectedIds.length > 1 ? (
            <div className="mt-1.5 border-t border-border px-2 pt-2 pb-1">
              <div className="flex items-center justify-between gap-2">
                <Badge tone={consolidation === 'consolidated' ? 'brand' : 'warning'}>
                  {consolidation === 'consolidated'
                    ? t('company.allConsolidated')
                    : t('company.allGross')}
                </Badge>
                <button
                  type="button"
                  onClick={() => {
                    startTransition(() => {
                      void onConsolidationChange(
                        consolidation === 'consolidated' ? 'gross' : 'consolidated',
                      );
                    });
                  }}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  Comută
                </button>
              </div>
              <p className="mt-1.5 text-sm text-ink-muted">{t('company.consolidationHint')}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
