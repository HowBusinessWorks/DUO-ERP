'use client';

import { t } from '@damina/i18n';
import { Button, cn } from '@damina/ui';
import { ArrowUp, ChevronDown, PanelRightClose, PanelRightOpen } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { LinkGroup, QuickAction } from '../../registry/types';

/**
 * Banda [5]: panoul de Legaturi — coloana vertebrala a interconectarii (§6).
 *
 * Trei zone: in sus (parintii) · lateral (grupuri cu contor) · actiuni rapide,
 * care se schimba cu STATUSUL entitatii.
 *
 * Regula de aur, impusa in registry si nu aici: daca doua entitati sunt legate
 * in model, legatura e navigabila IN AMBELE SENSURI. Din produs vezi furnizorul
 * implicit; din furnizor vezi produsele lui. Fara reciprocitate, jumatate din
 * intrebarile reale nu au raspuns.
 *
 * Colapsabil, deschis implicit pe desktop, inchis sub 1280px.
 */
export function LinksPanel({
  groups,
  actions,
}: {
  groups: readonly LinkGroup[];
  actions: readonly QuickAction[];
}) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <div className="hidden shrink-0 border-l border-border bg-surface p-1.5 lg:block">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setOpen(true);
          }}
          aria-label={t('links.expand')}
        >
          <PanelRightOpen className="size-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  const up = groups.filter((group) => group.kind === 'up');
  const related = groups.filter((group) => group.kind === 'related');

  return (
    <aside
      aria-label={t('links.title')}
      className="hidden w-(--spacing-links) shrink-0 border-l border-border bg-surface lg:block"
    >
      {/* `top-0`: containerul de scroll incepe deja sub bara globala. */}
      <div className="scrollbar-thin sticky top-0 max-h-[calc(100dvh-var(--spacing-topbar))] overflow-y-auto">
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
            {t('links.title')}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setOpen(false);
            }}
            aria-label={t('links.collapse')}
          >
            <PanelRightClose className="size-4" aria-hidden="true" />
          </Button>
        </header>

        <div className="space-y-4 px-3 py-3">
          {up.map((group) => (
            <ul key={group.title} className="space-y-1">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sm text-ink-muted hover:bg-surface-hover hover:text-brand-700"
                  >
                    <ArrowUp className="size-3.5 shrink-0 text-ink-subtle" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}

          {related.map((group) => (
            <LinkGroupBlock key={group.title} group={group} />
          ))}

          {actions.length === 0 ? null : (
            <section className="border-t border-border pt-3">
              <h3 className="px-1.5 pb-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                {t('links.quickActions')}
              </h3>
              <div className="flex flex-col gap-1.5">
                {actions.slice(0, 5).map((action) =>
                  action.href === undefined ? (
                    <Button
                      key={action.label}
                      variant="secondary"
                      size="sm"
                      disabled
                      disabledReason={action.disabledReason}
                      className="w-full justify-center"
                    >
                      {action.label}
                    </Button>
                  ) : (
                    <Link
                      key={action.label}
                      href={action.href}
                      className={cn(
                        // Aceleasi cote ca `Button size="sm"`: actiunile rapide
                        // stau una sub alta, iar doua inaltimi diferite se vad.
                        'flex h-7 w-full items-center justify-center rounded-md px-2.5 text-xs font-medium transition-colors duration-100',
                        action.tone === 'primary'
                          ? 'bg-brand-600 text-white shadow-xs hover:bg-brand-700'
                          : 'border border-border bg-surface text-ink shadow-xs hover:border-border-strong hover:bg-surface-hover',
                      )}
                    >
                      {action.label}
                    </Link>
                  ),
                )}
              </div>
            </section>
          )}

          {groups.length === 0 ? (
            <p className="px-1.5 text-sm text-ink-muted">{t('links.emptyHint')}</p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function LinkGroupBlock({ group }: { group: LinkGroup }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section>
      <button
        type="button"
        onClick={() => {
          setExpanded((value) => !value);
        }}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-surface-hover"
      >
        <ChevronDown
          className={cn('size-3 shrink-0 text-ink-subtle transition-transform', expanded ? '' : '-rotate-90')}
          aria-hidden="true"
        />
        <span className="flex-1 truncate text-sm font-medium text-ink">{group.title}</span>
        {group.count === undefined ? null : (
          <span data-numeric className="text-xs tabular-nums text-ink-subtle">
            {group.count}
          </span>
        )}
      </button>

      {expanded ? (
        group.items.length === 0 ? (
          <p className="px-1.5 py-1 text-sm text-ink-subtle">{t('links.empty')}</p>
        ) : (
          <ul className="mt-0.5 space-y-px">
            {group.items.map((item) => (
              <li key={`${item.href}-${item.label}`}>
                <Link
                  href={item.href}
                  className="flex items-baseline justify-between gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-hover hover:text-brand-700"
                >
                  <span className="truncate">{item.label}</span>
                  {item.meta === undefined ? null : (
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        item.tone === 'danger'
                          ? 'text-danger-700'
                          : item.tone === 'warning'
                            ? 'text-warning-700'
                            : item.tone === 'success'
                              ? 'text-success-700'
                              : 'text-ink-subtle',
                      )}
                    >
                      {item.meta}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
