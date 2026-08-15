import { EmptyState, Table } from '@damina/ui';
import { Construction } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PeriodLockBanner } from '../../../components/shell/period-lock-banner';
import { RecordFormDialog } from '../../../components/nomenclature/record-form-dialog';
import { ListSearch } from '../../../components/nomenclature/list-search';
import { getAppContext } from '../../../lib/context';
import { entityRegistry } from '../../../registry/entities';
import { findNavItem } from '../../../registry/navigation';
import type { EntityContext } from '../../../registry/types';
import { saveRecord } from '../nomenclature-actions';

export const dynamic = 'force-dynamic';

/**
 * UNICA pagina de lista din aplicatia de birou.
 *
 * Coloanele, incarcarea, starea goala si formularul vin din registry. Ca sa
 * apara un modul nou nu se creeaza niciun fisier aici — se adauga o intrare in
 * `entityRegistry` si, daca modulul nu e construit inca, doar in `NAVIGATION`,
 * caz in care ecranul spune din ce faza vine, in loc sa dea 404.
 */
export default async function ModuleListPage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { module } = await params;
  const search = await searchParams;

  const navItem = findNavItem(module);
  const entity = entityRegistry[module];

  if (navItem === undefined && entity === undefined) {
    notFound();
  }

  const ctx = await getAppContext();

  // Modulele fara drept nu se randeaza — nici macar gri (§30.5).
  if (entity?.canRead !== undefined && !entity.canRead(ctx.session)) {
    return (
      <Forbidden
        title="Nu ai acces la acest nomenclator"
        body="Tarifele conțin salarii și cost orar. Rolul tău nu deschide ecranul acesta."
      />
    );
  }

  // Modul prevazut in plan dar neconstruit: navigarea merge, ecranul explica.
  if (entity?.list === undefined) {
    const phase = navItem?.phase ?? 1;
    return (
      <div className="p-5">
        <h1 className="mb-4 text-2xl font-semibold">{navItem?.label ?? module}</h1>
        <EmptyState
          icon={<Construction className="size-5" aria-hidden="true" />}
          title={`${navItem?.label ?? module} vine în faza ${String(phase)}`}
          body="Modulul e prevăzut în plan, dar încă nu e construit. Navigarea către el funcționează deja, ca să nu se rupă nicio legătură când sosește."
        />
      </div>
    );
  }

  const entityCtx: EntityContext = { session: ctx.session, actor: ctx.actor, app: ctx };
  const query = typeof search.q === 'string' ? search.q : undefined;

  const [rows, lookups] = await Promise.all([
    entity.list.load(entityCtx, { query }),
    entity.form?.loadLookups?.(entityCtx) ?? Promise.resolve({}),
  ]);

  const canWrite = entity.canWrite?.(ctx.session) ?? false;
  const usesPeriod = entity.usesPeriod;

  // Pe o luna inchisa, butonul de creare e dezactivat CU EXPLICATIE — nu doar
  // gri. Blocajul real e in baza (trigger), asta e doar ca omul sa afle inainte.
  const blockedReason =
    usesPeriod && ctx.period.locked
      ? 'Luna selectată este închisă. Schimbă luna ca să poți modifica.'
      : undefined;

  const editable: Record<string, Record<string, unknown>> = {};
  if (entity.form !== undefined && entity.form.editable) {
    for (const row of rows) {
      editable[entity.list.rowKey(row)] = { ...entity.form.toFormValues(row) };
    }
  }

  return (
    <>
      {usesPeriod ? (
        <PeriodLockBanner period={ctx.period} totalCompanies={ctx.selectedCompanyIds.length} />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col p-5">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink">{entity.plural}</h1>
            {entity.list.notice === undefined ? null : (
              <p className="mt-1 max-w-prose text-base text-ink-muted">{entity.list.notice}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ListSearch placeholder={entity.list.searchPlaceholder} />
            {entity.form === undefined ? null : (
              <RecordFormDialog
                module={module}
                fields={[...entity.form.fields(lookups)]}
                blank={entity.form.blank}
                createTitle={entity.form.createTitle}
                editTitle={entity.form.editTitle}
                triggerLabel={entity.form.createTitle}
                editable={editable}
                canEdit={canWrite}
                save={saveRecord}
                blockedReason={blockedReason}
              />
            )}
          </div>
        </header>

        <Table
          caption={entity.plural}
          columns={entity.list.columns}
          rows={rows}
          rowKey={entity.list.rowKey}
          rowHref={entity.list.rowHref}
          rowFlagged={entity.list.rowFlagged}
          className="min-h-0"
          empty={
            query === undefined ? (
              <EmptyState
                title={entity.list.empty.title}
                body={entity.list.empty.body}
                className="rounded-lg border border-dashed border-border bg-surface"
              />
            ) : (
              <EmptyState
                title={`Niciun rezultat pentru „${query}”`}
                body="Încearcă un alt cuvânt sau golește căutarea. Înregistrările inactive nu apar în listă."
                className="rounded-lg border border-dashed border-border bg-surface"
              />
            )
          }
        />

        {rows.length === 0 ? null : (
          <p className="mt-2 text-sm text-ink-subtle">
            {rows.length === 1 ? 'un rând' : `${String(rows.length)} rânduri`}
          </p>
        )}
      </div>
    </>
  );
}

function Forbidden({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-5">
      <EmptyState title={title} body={body} />
    </div>
  );
}
