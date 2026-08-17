import { Badge, ProgressBar, Tabs } from '@damina/ui';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { EntityHeaderModel } from '../../registry/types';

/**
 * Benzile [2] si [3]: antetul entitatii si tab-urile ei.
 *
 * Amandoua raman FIXE la scroll. Pe un deviz cu 500 de pozitii sau pe un registru
 * de cost, omul trebuie sa stie permanent pe ce entitate e — altfel citeste
 * cifre corecte despre alt obiect decat crede.
 *
 * Maximum doua bare de progres, si sunt cele pe care se ia decizia. Restul
 * indicatorilor stau in tab-uri.
 *
 * `sticky top-0`, nu `top-(--spacing-topbar)`: containerul care face scroll
 * (`#continut`) incepe DEJA sub bara globala. Un offset in plus lipea antetul cu
 * 3rem mai jos, lasa o banda goala deasupra lui si taia primul rand de continut.
 */
export function EntityHeader({
  header,
  tabs,
  activeTab,
  children,
}: {
  header: EntityHeaderModel;
  tabs: readonly { key: string; label: string; href: string; count?: number }[];
  activeTab: string;
  children?: ReactNode;
}) {
  const progress = (header.progress ?? []).slice(0, 2);

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-surface">
      <div className="px-5 pt-3 pb-2">
        {/* Breadcrumb SEMANTIC: nume, nu ID-uri. */}
        <nav aria-label="Traseu semantic">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-ink-muted">
            {header.breadcrumb.map((crumb, index) => (
              <li key={`${crumb.label}-${String(index)}`} className="flex items-center gap-1">
                {index === 0 ? null : (
                  <ChevronRight className="size-3 text-ink-subtle" aria-hidden="true" />
                )}
                {crumb.href === undefined ? (
                  <span>{crumb.label}</span>
                ) : (
                  <Link href={crumb.href} className="hover:text-ink">
                    {crumb.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-xl font-semibold text-balance text-ink">{header.title}</h1>
              <div className="flex flex-wrap items-center gap-1.5">
                {header.badges.map((badge) => (
                  <Badge key={badge.label} tone={badge.tone}>
                    {badge.label}
                  </Badge>
                ))}
              </div>
            </div>

            {header.meta.length === 0 ? null : (
              <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-muted">
                {header.meta.map((item) => (
                  <div key={item.label} className="flex items-baseline gap-1.5">
                    <dt className="text-ink-subtle">{item.label}:</dt>
                    <dd className="font-medium text-ink">{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {progress.length === 0 ? null : (
            <div className="flex w-full max-w-md shrink-0 gap-6">
              {progress.map((bar) => (
                <ProgressBar
                  key={bar.label}
                  label={bar.label}
                  value={bar.value}
                  detail={bar.detail}
                  tone={bar.tone}
                  className="flex-1"
                />
              ))}
            </div>
          )}

          {children}
        </div>
      </div>

      <div className="px-5">
        <Tabs
          items={tabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            href: tab.href,
            count: tab.count,
          }))}
          activeKey={activeTab}
          linkComponent={Link}
          label="Secțiunile entității"
        />
      </div>
    </div>
  );
}
