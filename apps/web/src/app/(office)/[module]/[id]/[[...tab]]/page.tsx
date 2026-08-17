import { EmptyState } from '@damina/ui';
import { notFound, redirect } from 'next/navigation';
import { EntityHeader } from '../../../../../components/shell/entity-header';
import { LinksPanel } from '../../../../../components/shell/links-panel';
import { PeriodLockBanner } from '../../../../../components/shell/period-lock-banner';
import { getAppContext } from '../../../../../lib/context';
import { entityRegistry } from '../../../../../registry/entities';
import type { EntityContext } from '../../../../../registry/types';

export const dynamic = 'force-dynamic';

/**
 * PAGINA FRACTALA (I2). Singura pagina de detaliu din aplicatia de birou.
 *
 * Contract → lucrare → etapa → deviz au aceeasi anatomie, deci au aceeasi
 * pagina, parametrizata din `entityRegistry`. Cine a invatat un nivel le-a
 * invatat pe toate.
 *
 * Regula care nu se negociaza: **daca cineva scrie a doua pagina de detaliu
 * „pentru ca entitatea lui e speciala”, se opreste.** Ce lipseste se adauga in
 * `registry/types.ts`, unde beneficiaza toate entitatile deodata.
 */
export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ module: string; id: string; tab?: string[] }>;
}) {
  const { module, id, tab } = await params;

  const entity = entityRegistry[module];
  if (entity?.detail === undefined) {
    notFound();
  }

  // `/contracte/plafoane` din sidebar nu e un contract cu id-ul „plafoane”, e o
  // VEDERE a listei. Ruta plata le-ar confunda si ar da 404 pe o intrare de
  // meniu care exista — de aceea vederile se recunosc inainte de incarcare.
  if (entity.list?.views?.some((view) => view.key === id) === true) {
    redirect(`/${module}?view=${id}`);
  }

  const ctx = await getAppContext();

  if (entity.canRead !== undefined && !entity.canRead(ctx.session)) {
    return <Denied reason={entity.readDeniedReason} />;
  }

  const entityCtx: EntityContext = { session: ctx.session, actor: ctx.actor, app: ctx };
  const record = await entity.detail.load(entityCtx, id);
  if (record === null) {
    notFound();
  }

  // Filtrarea pe drept se face INAINTE de randare: tab-urile fara drept nu
  // ajung in DOM, deci nu pot fi nici vazute, nici deschise cu URL (§30.5).
  const visibleTabs = entity.detail.tabs.filter(
    (definition) => definition.visible?.(ctx.session) ?? true,
  );

  const activeSlug = tab?.[0] ?? '';
  const activeTab = visibleTabs.find((definition) => definition.slug === activeSlug);

  if (activeTab === undefined) {
    // Ruta exista, dar tab-ul e ascuns pentru rolul asta — sau nu exista deloc.
    const hidden = entity.detail.tabs.some((definition) => definition.slug === activeSlug);
    if (hidden) {
      return <Denied />;
    }
    notFound();
  }

  const [header, links, content] = await Promise.all([
    Promise.resolve(entity.detail.header(record, entityCtx)),
    entity.detail.links(record, entityCtx),
    Promise.resolve(activeTab.render(record, entityCtx, tab?.slice(1) ?? [])),
  ]);

  const actions = entity.detail.quickActions(record, entityCtx);

  return (
    <>
      {entity.usesPeriod ? (
        <PeriodLockBanner period={ctx.period} totalCompanies={ctx.selectedCompanyIds.length} />
      ) : null}

      <EntityHeader
        header={header}
        activeTab={activeSlug}
        tabs={visibleTabs.map((definition) => ({
          key: definition.slug,
          label: definition.label,
          href:
            definition.slug === ''
              ? `/${module}/${id}`
              : `/${module}/${id}/${definition.slug}`,
          count: definition.count?.(record),
        }))}
      />

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 p-5">{content}</main>
        <LinksPanel groups={links} actions={actions} />
      </div>
    </>
  );
}

function Denied({ reason }: { reason?: string }) {
  return (
    <div className="p-5">
      <EmptyState
        title="Nu ai acces la această secțiune"
        body={
          reason ??
          'Rolul tău nu o deschide — cere-i unui administrator dreptul dacă îți trebuie.'
        }
      />
    </div>
  );
}
