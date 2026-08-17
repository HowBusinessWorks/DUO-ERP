import { countUnreadNotifications, listNotifications } from '@damina/services';
import { setConsolidation, setPeriod, setSelectedCompanies } from '../../app/(office)/context-actions';
import { markAllRead, markRead } from '../../app/(office)/notification-actions';
import type { AppContext } from '../../lib/context';
import { NAVIGATION } from '../../registry/navigation';
import { CommandPalette } from './command-palette';
import { CompanyPicker } from './company-picker';
import { NotificationBell } from './notification-bell';
import { PeriodPicker } from './period-picker';
import { QuickCreate } from './quick-create';
import { RouteBreadcrumb } from './route-breadcrumb';
import { UserMenu } from './user-menu';

const ROUTE_LABELS: Readonly<Record<string, string>> = Object.fromEntries([
  ...NAVIGATION.map((item) => [item.slug, item.label] as const),
  ...NAVIGATION.flatMap(
    (item) => item.children?.map((child) => [child.slug, child.label] as const) ?? [],
  ),
]);

/**
 * Banda [1]: breadcrumb de ruta, firma, cautare, perioada, clopotel, ＋.
 *
 * Nu dispare niciodata si nu se ascunde la scroll. Contextul de firma si de luna
 * trebuie sa fie vizibil in orice moment (I8) — un ecran care nu spune pe ce
 * firma si pe ce luna lucrezi e un ecran pe care nu se poate lua o decizie.
 */
export async function Topbar({
  ctx,
  usesPeriod,
}: {
  ctx: AppContext;
  /** Ecranele care nu depind de luna ascund selectorul (§5.2). */
  usesPeriod: boolean;
}) {
  const [rows, unread] = await Promise.all([
    listNotifications(ctx.actor, ctx.session.personId, 15),
    countUnreadNotifications(ctx.actor, ctx.session.personId),
  ]);

  const notifications = rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    href: row.href,
    actionKind: row.actionKind,
    createdAt: row.createdAt.toISOString(),
    read: row.readAt !== null,
  }));

  return (
    <header className="sticky top-0 z-30 flex h-(--spacing-topbar) shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="min-w-0 flex-1">
        <RouteBreadcrumb labels={ROUTE_LABELS} />
      </div>

      <div className="hidden flex-1 justify-center md:flex">
        <CommandPalette modules={NAVIGATION} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <CompanyPicker
          companies={ctx.companies}
          selectedIds={ctx.selectedCompanyIds}
          mode={ctx.companyMode}
          consolidation={ctx.consolidation}
          onChange={setSelectedCompanies}
          onConsolidationChange={setConsolidation}
        />

        {usesPeriod ? (
          <PeriodPicker
            year={ctx.year}
            month={ctx.month}
            locked={ctx.period.locked}
            closedCompanyNames={ctx.period.closedCompanyNames}
            totalCompanies={ctx.selectedCompanyIds.length}
            onChange={setPeriod}
          />
        ) : null}

        <NotificationBell
          items={notifications}
          unread={unread}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
        />

        <QuickCreate
          items={[
            { label: 'Produs nou', href: '/produse?new=1', hint: 'Nomenclator comun' },
            { label: 'Furnizor nou', href: '/furnizori?new=1' },
            { label: 'Client nou', href: '/clienti?new=1' },
            { label: 'Subcontractant nou', href: '/subcontractanti?new=1' },
          ]}
        />

        <UserMenu session={ctx.session} />
      </div>
    </header>
  );
}
