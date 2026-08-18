import { can } from '@damina/auth';
import { companyRootFolder, listTrash } from '@damina/services';
import { CellMeta, EmptyState, Table, type Column } from '@damina/ui';
import { Folder, Lock, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { FileExplorer, formatBytes } from '../../../components/files/file-explorer';
import { RestoreButton } from '../../../components/files/node-actions';
import { getAppContext } from '../../../lib/context';

export const dynamic = 'force-dynamic';

/**
 * Documente › Arbore de fisiere.
 *
 * E singurul ecran de birou care nu trece prin `entityRegistry`, si are un motiv:
 * pagina fractala randeaza LISTE de randuri, iar asta e navigare intr-un arbore.
 * Contractul `ListQuery` are cautare si vedere, nu un nod curent; ca sa intre
 * aici, ar fi trebuit intins pana ar fi incetat sa mai insemne ceva. Precedentul
 * exista deja la `panou/rapoarte`.
 *
 * Explorerul in sine NU e scris aici — e `FileExplorer`, aceeasi componenta pe
 * care o monteaza si tab-ul `Documente` al fiecarei entitati.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getAppContext();

  if (!can(ctx.session, 'files.read')) {
    return (
      <div className="p-5">
        <EmptyState
          icon={<Lock className="size-5" aria-hidden="true" />}
          title="Nu ai acces la documente"
          body="Rolul tău nu deschide arborele de fișiere. Cere-i unui administrator dreptul dacă îți trebuie."
        />
      </div>
    );
  }

  const canWrite = can(ctx.session, 'files.write');
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  };

  // Arborele e AL UNEI FIRME: radacina lui e firma, nu utilizatorul. Cand
  // contextul are mai multe firme bifate, se alege una — un explorer care ar
  // amesteca doua firme intr-un singur arbore ar fi minciuna, fiindca nodurile
  // au `company_id` si politicile de acces merg pe el.
  const requested = one('firma');
  const companyId =
    requested !== undefined && ctx.selectedCompanyIds.includes(requested)
      ? requested
      : ctx.selectedCompanyIds.length === 1
        ? ctx.selectedCompanyIds[0]
        : undefined;

  if (companyId === undefined) {
    return (
      <div className="space-y-4 p-5">
        <h1 className="text-lg font-semibold text-ink">Documente</h1>
        <p className="text-sm text-ink-muted">
          Ai mai multe firme în context. Arborele de fișiere e al unei firme — alege-o pe care o
          deschizi.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {ctx.companies
            .filter((company) => ctx.selectedCompanyIds.includes(company.id))
            .map((company) => (
              <li key={company.id}>
                <Link
                  href={`/documente?firma=${company.id}`}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-hover"
                >
                  <Folder className="size-4 text-brand-600" aria-hidden="true" />
                  {company.name}
                </Link>
              </li>
            ))}
        </ul>
      </div>
    );
  }

  const rootId = await companyRootFolder(ctx.actor, companyId);
  if (rootId === null) {
    return (
      <div className="p-5">
        <EmptyState
          icon={<Folder className="size-5" aria-hidden="true" />}
          title="Firma n-are încă arbore de fișiere"
          body="Rădăcina se creează odată cu firma, prin trigger. Dacă lipsește, firma e dinaintea pasului 07 și are nevoie de backfill."
        />
      </div>
    );
  }

  const inTrash = one('view') === 'cos';
  // Coșul e tot o „vedere", dar una care înlocuiește explorerul; galeria e una
  // dintre vederile LUI. De aceea se citesc din același `?view=`, dar se ramifică
  // în locuri diferite.
  const vederea = one('view') === 'galerie' ? 'galerie' : undefined;
  const link = (extra?: Readonly<Record<string, string>>): string => {
    const query = new URLSearchParams({
      ...(requested === undefined ? {} : { firma: requested }),
      ...extra,
    });
    const rendered = query.toString();
    return rendered === '' ? '/documente' : `/documente?${rendered}`;
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">Documente</h1>
        <Link
          href={inTrash ? link() : link({ view: 'cos' })}
          className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {inTrash ? 'Înapoi în arbore' : 'Coșul de gunoi'}
        </Link>
      </div>

      {inTrash ? (
        <TrashList companyId={companyId} ctx={ctx} canWrite={canWrite} />
      ) : (
        <FileExplorer
          actor={ctx.actor}
          session={ctx.session}
          rootId={rootId}
          nodeId={one('node')}
          href={(id) =>
            id === rootId
              ? link(vederea === undefined ? undefined : { view: vederea })
              : link(vederea === undefined ? { node: id } : { node: id, view: vederea })
          }
          view={vederea}
          showAll={one('tot') === '1'}
          showAllHref={link({
            ...(one('node') === undefined ? {} : { node: one('node') as string }),
            ...(vederea === undefined ? {} : { view: vederea }),
            tot: '1',
          })}
          viewHref={(next) => {
            const node = one('node');
            return link({
              ...(node === undefined ? {} : { node }),
              ...(next === '' ? {} : { view: next }),
            });
          }}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}

async function TrashList({
  companyId,
  ctx,
  canWrite,
}: {
  readonly companyId: string;
  readonly ctx: Awaited<ReturnType<typeof getAppContext>>;
  readonly canWrite: boolean;
}) {
  const rows = await listTrash(ctx.actor, companyId);

  const columns: readonly Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'Nume',
      cell: (node) => (
        <span className="flex items-center gap-2">
          <Folder className="size-4 text-ink-subtle" aria-hidden="true" />
          {node.name}
        </span>
      ),
    },
    {
      key: 'kind',
      header: 'Ce e',
      width: '7rem',
      cell: (node) => <CellMeta>{node.kind === 'folder' ? 'folder' : 'fișier'}</CellMeta>,
    },
    {
      key: 'size',
      header: 'Mărime',
      align: 'right',
      width: '7rem',
      cell: (node) => <CellMeta>{node.kind === 'folder' ? '—' : formatBytes(node.size)}</CellMeta>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '10rem',
      cell: (node) => (canWrite ? <RestoreButton nodeId={node.id} name={node.name} /> : null),
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Ce se șterge ajunge aici și se poate lua înapoi. Fișierele pleacă din R2 abia la 30 de zile
        după golirea coșului — pasul e lent dinadins.
      </p>
      <Table
        columns={columns}
        rows={rows}
        rowKey={(node) => node.id}
        caption="Coșul de gunoi"
        empty={
          <EmptyState
            icon={<Trash2 className="size-5" aria-hidden="true" />}
            title="Coșul e gol"
            body="Nimic șters în firma asta."
          />
        }
      />
    </div>
  );
}
