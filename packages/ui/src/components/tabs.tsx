import type { ComponentType, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { CountBadge } from './badge';

export interface TabItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  /** Cate elemente sau cate de rezolvat. Zero nu se afiseaza. */
  readonly count?: number;
  /** Cifra e o coada, nu un total: badge rosu, nu petrol. */
  readonly urgent?: boolean;
  readonly icon?: ReactNode;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  readonly activeKey: string;
  /**
   * Componenta de link. `apps/web` trimite `next/link`, ca sa se schimbe doar
   * banda de continut, nu toata pagina. Implicit `<a>`, ca sa ramana folosibila
   * si in afara lui Next (Storybook, teste).
   *
   * `packages/ui` nu importa Next: pachetul trebuie sa ramana un design system,
   * nu o bucata de aplicatie.
   */
  readonly linkComponent?: ComponentType<{
    href: string;
    className?: string;
    'aria-current'?: 'page';
    children: ReactNode;
  }>;
  readonly label: string;
  readonly className?: string;
}

/**
 * Banda [3] din anatomia paginii: fatetele aceleiasi entitati.
 *
 * Tab-urile sunt RUTE, nu stare de client. Consecinta practica: „Costuri” se
 * poate trimite pe chat cu link, se poate pune la favorite si se deschide in
 * tab nou. Un tab pe `useState` pierde toate trei.
 *
 * Tab-urile fara drept nu ajung aici deloc — sunt filtrate in registry, inainte
 * de randare (§30.5: lipsesc, nu sunt gri). Nu exista `disabled` in semnatura,
 * intentionat.
 */
export function Tabs({ items, activeKey, linkComponent, label, className }: TabsProps) {
  const Link = linkComponent ?? DefaultLink;

  return (
    <nav aria-label={label} className={cn('relative', className)}>
      <ul className="scrollbar-thin -mb-px flex items-stretch gap-0.5 overflow-x-auto">
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                  'transition-colors duration-100',
                  active
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-ink-muted hover:border-border-strong hover:text-ink',
                )}
              >
                {item.icon}
                {item.label}
                {item.count === undefined ? null : (
                  <CountBadge
                    count={item.count}
                    label={`${String(item.count)} în ${item.label}`}
                    tone={item.urgent === true ? 'danger' : 'neutral'}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function DefaultLink({
  href,
  className,
  children,
  ...props
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  );
}
