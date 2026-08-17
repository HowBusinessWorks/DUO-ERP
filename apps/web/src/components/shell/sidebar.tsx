'use client';

import { t } from '@damina/i18n';
import { Button, cn, CountBadge } from '@damina/ui';
import {
  Award,
  Banknote,
  Building2,
  ChevronRight,
  FileSignature,
  Folder,
  Gauge,
  Hammer,
  Handshake,
  Inbox,
  Library,
  MapPin,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { IconName, NavGroup, NavItem } from '../../registry/navigation';

const ICONS: Readonly<Record<IconName, LucideIcon>> = {
  gauge: Gauge,
  fileSignature: FileSignature,
  mapPin: MapPin,
  inbox: Inbox,
  hammer: Hammer,
  truck: Truck,
  users: Users,
  banknote: Banknote,
  folder: Folder,
  library: Library,
  settings: Settings,
  package: Package,
  building: Building2,
  handshake: Handshake,
  award: Award,
  receipt: Receipt,
};

const GROUP_LABEL: Readonly<Record<NavGroup, string>> = {
  operational: t('nav.groups.operational'),
  libraries: t('nav.groups.libraries'),
  configuration: t('nav.groups.configuration'),
};

const PANEL_SLUG = 'panou';

export interface SidebarProps {
  readonly items: readonly NavItem[];
  /** Cate lucruri asteapta de la mine, pe module. Calculate pe server. */
  readonly badges: Readonly<Record<string, number>>;
}

/**
 * Banda de navigare. Trei grupe: munca zilnica / biblioteci / configurare (§3).
 *
 * Modulul activ se expandeaza inline si isi arata sub-sectiunile — nu un meniu
 * care zboara la hover. Un meniu care apare la trecerea mouse-ului nu poate fi
 * citit pe indelete, nu se poate atinge pe tableta si dispare exact cand omul
 * incearca sa ajunga la el.
 */
export function Sidebar({ items, badges }: SidebarProps) {
  const pathname = usePathname();
  // Sub-sectiunile listelor stau in `?view=`, nu intr-un al doilea segment de
  // ruta: `/obiective/profile` face redirect la `/obiective?view=profile`. Fara
  // parametru, sidebar-ul ar arata mereu prima sub-sectiune ca activa.
  const view = useSearchParams().get('view') ?? '';
  const [collapsed, setCollapsed] = useState(false);

  const activeSlug = pathname.split('/')[1] ?? '';
  const groups: readonly NavGroup[] = ['operational', 'libraries', 'configuration'];

  return (
    <nav
      aria-label={t('a11y.mainNavigation')}
      data-collapsed={collapsed || undefined}
      className={cn(
        'flex shrink-0 flex-col border-r border-brand-800/60 bg-brand-900 text-brand-100',
        'transition-[width] duration-200',
        collapsed ? 'w-(--spacing-sidebar-collapsed)' : 'w-(--spacing-sidebar)',
      )}
    >
      <div className="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto py-2">
        {/* Panoul sta deasupra grupelor, fara titlu: e punctul de plecare, nu
            un modul intre altele. */}
        <ul className="space-y-px px-1.5">
          {items
            .filter((item) => item.slug === PANEL_SLUG)
            .map((item) => (
              <SidebarItem
                key={item.slug}
                item={item}
                active={item.slug === activeSlug}
                pathname={pathname}
                view={view}
                badge={badges[item.slug] ?? 0}
                collapsed={collapsed}
              />
            ))}
        </ul>

        {groups.map((group) => {
          const groupItems = items.filter(
            (item) => item.group === group && item.slug !== PANEL_SLUG,
          );
          if (groupItems.length === 0) {
            return null;
          }

          return (
            <div key={group} className="mb-1">
              {collapsed ? (
                <div aria-hidden="true" className="mx-3 my-2 border-t border-brand-800/70" />
              ) : (
                <p className="px-3 pt-4 pb-1.5 text-xs font-semibold tracking-wider text-brand-300/80 uppercase">
                  {GROUP_LABEL[group]}
                </p>
              )}
              <ul className="space-y-px px-1.5">
                {groupItems.map((item) => (
                  <SidebarItem
                    key={item.slug}
                    item={item}
                    active={item.slug === activeSlug}
                    pathname={pathname}
                    view={view}
                    badge={badges[item.slug] ?? 0}
                    collapsed={collapsed}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="border-t border-brand-800/60 p-1.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setCollapsed((value) => !value);
          }}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          className="text-brand-200 hover:bg-brand-800 hover:text-white"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </nav>
  );
}

function SidebarItem({
  item,
  active,
  pathname,
  view,
  badge,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  pathname: string;
  view: string;
  badge: number;
  collapsed: boolean;
}) {
  const Icon = ICONS[item.icon];
  const href = `/${item.slug}`;

  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium',
          'transition-colors duration-100',
          active ? 'bg-brand-700 text-white' : 'text-brand-100/85 hover:bg-brand-800 hover:text-white',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {collapsed ? null : (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            {/* Badge-ul e o COADA personala, nu un total: „câte lucruri
                așteaptă de la mine aici”. Zero nu se afișează. */}
            <CountBadge
              count={badge}
              label={t('nav.queueBadge', { count: badge, module: item.label })}
              tone="danger"
            />
          </>
        )}
      </Link>

      {/* Sub-sectiunile modulului activ, inline. */}
      {active && !collapsed && item.children !== undefined ? (
        <ul className="mt-px mb-1 ml-[1.4rem] space-y-px border-l border-brand-700/70 pl-2">
          {item.children.map((child) => {
            const childHref = child.slug === '' ? href : `${href}/${child.slug}`;
            // Pe pagina modulului, sub-sectiunea activa o da `?view=`; pe o
            // ruta proprie (ex. `/panou/grup`), o da calea.
            const childActive =
              pathname === href ? view === child.slug : pathname === childHref;
            return (
              <li key={child.slug}>
                <Link
                  href={childHref}
                  aria-current={childActive ? 'page' : undefined}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded px-2 text-sm',
                    // Sub-sectiunile se disting prin TEXT, nu prin fundal: un al
                    // doilea dreptunghi colorat sub modulul activ ar concura cu
                    // el si s-ar citi ca doua selectii deodata.
                    childActive
                      ? 'font-semibold text-white'
                      : 'text-brand-200/70 hover:text-white',
                  )}
                >
                  <ChevronRight
                    className={cn('size-3 shrink-0', childActive ? 'opacity-100' : 'opacity-0')}
                    aria-hidden="true"
                  />
                  <span className="truncate">{child.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
