import { can, type Session } from '@damina/auth';
import type { Actor } from '@damina/auth';
import {
  breadcrumb,
  countChildren,
  listChildren,
  listShares,
  listSubcontractors,
  nodeSummary,
  type Crumb,
  type NodeRow,
} from '@damina/services';
import { CellMeta, EmptyState, Table, type Column } from '@damina/ui';
import {
  ChevronRight,
  Eye,
  File,
  FileImage,
  FileVideo,
  Folder,
  FolderOpen,
  History,
  Images,
  Rows3,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NewFolderButton, NodeActions } from './node-actions';
import { PhotoGallery, type Photo } from './photo-gallery';
import { ShareDialog } from './share-dialog';
import { VersionHistory } from './version-history';
import { UploadZone } from './upload-zone';

/**
 * Arborele de fisiere, o singura data.
 *
 * Aceeasi componenta serveste si ecranul `/documente`, si tab-ul `Documente` de
 * pe contract, obiectiv, unitate de lucru si etapa. Diferenta dintre ele e un
 * singur parametru — `rootId`, folderul de la care incepe — pentru ca tab-ul unei
 * entitati arata EXACT folderul ei, nu un filtru peste tot arborele.
 *
 * Se randeaza pe server, dinadins: navigarea prin arbore e navigare adevarata
 * (URL cu `?node=`, buton de inapoi, link care se poate trimite pe chat), iar
 * randurile sunt HTML — deci se pot verifica fara browser. Client sunt doar
 * bucatile care chiar au nevoie: zona de upload si dialogurile.
 *
 * Nu exista niciun `where` de drepturi aici. Ce nu se vede nu vine din baza:
 * RLS-ul si `app.can_access_node()` fac filtrarea, la fel pentru birou, pentru
 * teren si pentru subcontractant.
 */

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return '—';
  }
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${String(units[unit])}`;
}

/**
 * Ce se poate deschide in pagina. Aceeasi lista ca in `previewUrl`, si serviciul
 * ramane arbitrul: butonul de aici doar evita sa promita ce ar fi refuzat.
 */
function isPreviewable(mime: string | null): boolean {
  return mime !== null && (mime.startsWith('image/') || mime === 'application/pdf');
}

function nodeIcon(node: NodeRow) {
  if (node.kind === 'folder') {
    return node.isSystem ? (
      <FolderOpen className="size-4 text-brand-600" aria-hidden="true" />
    ) : (
      <Folder className="size-4 text-brand-600" aria-hidden="true" />
    );
  }
  if (node.mime?.startsWith('image/') === true) {
    return <FileImage className="size-4 text-ink-subtle" aria-hidden="true" />;
  }
  if (node.mime?.startsWith('video/') === true) {
    return <FileVideo className="size-4 text-ink-subtle" aria-hidden="true" />;
  }
  return <File className="size-4 text-ink-subtle" aria-hidden="true" />;
}

export interface FileExplorerProps {
  readonly actor: Actor;
  /** Folderul de la care incepe explorerul. Firimiturile nu urca peste el. */
  readonly rootId: string;
  /** Folderul deschis acum. Lipsa lui inseamna radacina. */
  readonly nodeId?: string;
  /**
   * Cum arata linkul catre un folder.
   *
   * Il da apelantul pentru ca cele doua locuri unde traieste explorerul au forme
   * de URL diferite, si amandoua sunt corecte acolo unde sunt: `/documente` pune
   * nodul in query (`?node=`), iar tab-ul unei entitati il pune in segmentele de
   * dupa slug (`/activitate/{id}/documente/{nod}`), fiindca pagina fractala nu
   * primeste `searchParams` — segmentele sunt exact mecanismul pe care il are.
   */
  readonly href: (nodeId: string) => string;
  /**
   * Vederea: tabel (implicit) sau galerie.
   *
   * E acelasi tipar ca la obiective — harta si tabelul citesc ACELEASI randuri,
   * deci nu pot arata numere diferite. Galeria nu e o a doua incarcare, e alta
   * reprezentare a lui `listChildren`.
   */
  readonly view?: string;
  /** Cum arata linkul catre o vedere. Fara el, comutatorul nu se afiseaza. */
  readonly viewHref?: (view: string) => string;
  readonly session: Session;
  /**
   * Arata TOT folderul, nu doar primele randuri.
   *
   * Lista e plafonata dinadins: un folder de poze de santier ajunge la mii de
   * fisiere, iar interogarea le duce (2 ms), dar randarea lor deodata nu. Cine
   * chiar vrea toata lista o cere explicit, si atunci o primeste — plafonul nu e
   * o limita a datelor, e una a ecranului.
   */
  readonly showAll?: boolean;
  /** Linkul care ridica plafonul. Fara el, „mai sunt N" nu e navigabil. */
  readonly showAllHref?: string;
  readonly canWrite: boolean;
  /** Text sub bara de unelte: ce e folderul asta, cand nu e evident. */
  readonly notice?: string;
}

export async function FileExplorer({
  actor,
  rootId,
  nodeId,
  href,
  view,
  viewHref,
  session,
  showAll,
  showAllHref,
  canWrite,
  notice,
}: FileExplorerProps) {
  const current = nodeId ?? rootId;
  const canShare = can(session, 'files.share');

  const [summary, children, total, crumbs, shares, subcontractors] = await Promise.all([
    nodeSummary(actor, current),
    listChildren(actor, current, showAll === true ? { limit: 5000 } : {}),
    countChildren(actor, current),
    breadcrumb(actor, current),
    // Partajarile si subiectii se citesc doar daca butonul chiar apare: fara
    // dreptul `files.share`, ar fi doua interogari pentru un ecran care nu le
    // arata nimanui.
    canShare ? listShares(actor, current) : Promise.resolve([]),
    canShare ? listSubcontractors(actor, {}) : Promise.resolve([]),
  ]);

  // Firimiturile pornesc de la radacina EXPLORERULUI, nu de la cea a firmei:
  // pe tab-ul unei unitati de lucru, drumul catre firma nu e navigabil de acolo,
  // deci afisarea lui ar promite o navigare care nu exista.
  const from = crumbs.findIndex((crumb) => crumb.id === rootId);
  const trail: readonly Crumb[] = from === -1 ? crumbs.slice(-1) : crumbs.slice(from);
  const parent = trail.length > 1 ? trail[trail.length - 2] : undefined;

  // Un nod poate fi si fisier: atunci ecranul arata VERSIUNILE lui, nu copiii.
  // Se citeste din `kind`, nu din „lista de copii a iesit goala" — un folder gol
  // si un fisier ar fi aratat identic.
  const isFile = summary?.kind === 'file';
  const hidden = Math.max(0, total - children.length);

  // Tintele mutarii: folderul de deasupra si folderele surori. Mutarea la
  // distanta se face din doi pasi, ca in orice explorer.
  const folderTargets = [
    ...(parent === undefined ? [] : [{ id: parent.id, name: `↑ ${parent.name}` }]),
    ...children
      .filter((child) => child.kind === 'folder')
      .map((child) => ({ id: child.id, name: child.name })),
  ];

  const columns: readonly Column<NodeRow>[] = [
    {
      key: 'name',
      header: 'Nume',
      cell: (node) => (
        <span className="flex items-center gap-2">
          {nodeIcon(node)}
          <span className="truncate">{node.name}</span>
          {node.kind === 'file' && node.currentVersionId === null ? (
            <CellMeta>se încarcă…</CellMeta>
          ) : null}
        </span>
      ),
    },
    {
      key: 'size',
      header: 'Mărime',
      align: 'right',
      width: '7rem',
      cell: (node) => <CellMeta>{node.kind === 'folder' ? '—' : formatBytes(node.size)}</CellMeta>,
    },
    {
      key: 'created',
      header: 'Adăugat',
      width: '8rem',
      hideBelow: 'md',
      cell: (node) => <CellMeta>{dateFormat.format(node.createdAt)}</CellMeta>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '9rem',
      cell: (node) => (
        <span className="flex items-center justify-end gap-1">
          {node.currentVersionId !== null && isPreviewable(node.mime) ? (
            <a
              href={`/api/files/${node.currentVersionId}/preview`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Vezi ${node.name}`}
              title="Vezi în pagină"
              className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
            >
              <Eye className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
          {node.kind === 'file' ? (
            <a
              href={href(node.id)}
              aria-label={`Versiunile lui ${node.name}`}
              title="Versiuni"
              className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
            >
              <History className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
          {canWrite ? (
            <NodeActions
              node={{ id: node.id, name: node.name, isSystem: node.isSystem }}
              folders={folderTargets.filter((target) => target.id !== node.id)}
            />
          ) : null}
        </span>
      ),
    },
  ];

  const photos: readonly Photo[] = children
    .filter((node) => node.kind === 'file' && node.mime?.startsWith('image/') === true)
    .map((node) => ({
      id: node.id,
      name: node.name,
      versionId: node.currentVersionId,
      capturedAt: node.capturedAt === null ? null : node.capturedAt.toISOString(),
      geoLat: node.geoLat,
      geoLng: node.geoLng,
      geoSource: node.geoSource,
    }));

  return (
    <div className="space-y-3">
      <nav aria-label="Cale" className="flex flex-wrap items-center gap-1 text-sm">
        {trail.map((crumb, index) => (
          <span key={crumb.id} className="flex items-center gap-1">
            {index === 0 ? null : (
              <ChevronRight className="size-3.5 text-ink-subtle" aria-hidden="true" />
            )}
            {index === trail.length - 1 ? (
              <span className="font-medium text-ink">{crumb.name}</span>
            ) : (
              <a href={href(crumb.id)} className="text-ink-muted hover:text-ink hover:underline">
                {crumb.name}
              </a>
            )}
          </span>
        ))}
      </nav>

      {notice === undefined ? null : <p className="text-sm text-ink-muted">{notice}</p>}

      {isFile ? (
        <VersionHistory
          actor={actor}
          nodeId={current}
          currentVersionId={summary?.currentVersionId ?? null}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? <NewFolderButton parentId={current} /> : null}
            {canShare ? (
              <ShareDialog
                nodeId={current}
                nodeName={trail.at(-1)?.name ?? 'folderul'}
                subjects={subcontractors.map((row) => ({
                  id: row.id,
                  name: row.name,
                  type: 'subcontractor' as const,
                }))}
                shares={shares}
              />
            ) : null}
            {viewHref === undefined ? null : (
              <span className="ml-auto flex items-center gap-1 text-xs">
                <ViewLink href={viewHref('')} active={view !== 'galerie'} label="Tabel">
                  <Rows3 className="size-3.5" aria-hidden="true" />
                </ViewLink>
                <ViewLink href={viewHref('galerie')} active={view === 'galerie'} label="Galerie">
                  <Images className="size-3.5" aria-hidden="true" />
                </ViewLink>
              </span>
            )}
          </div>

          {canWrite ? <UploadZone parentId={current} /> : null}

          {view === 'galerie' ? (
            <>
              <PhotoGallery photos={photos} />
              {hidden === 0 ? null : (
                <p className="text-sm text-ink-muted">
                  Se văd primele {String(children.length)} din {String(total)}.{' '}
                  {showAllHref === undefined ? null : (
                    <Link href={showAllHref} className="text-brand-600 underline">
                      Arată-le pe toate
                    </Link>
                  )}
                </p>
              )}
            </>
          ) : (
            <Table
              columns={columns}
              rows={children}
              footer={
                hidden === 0 ? undefined : (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-2 text-sm text-ink-muted">
                      Se văd primele {String(children.length)} din {String(total)}.{' '}
                      {showAllHref === undefined ? null : (
                        <Link href={showAllHref} className="text-brand-600 underline">
                          Arată-le pe toate
                        </Link>
                      )}
                    </td>
                  </tr>
                )
              }
              rowKey={(node) => node.id}
              rowHref={(node) =>
                node.kind === 'folder'
                  ? href(node.id)
                  : node.currentVersionId === null
                    ? href(current)
                    : `/api/files/${node.currentVersionId}`
              }
              caption="Conținutul folderului"
              empty={
                <EmptyState
                  icon={<Folder className="size-5" aria-hidden="true" />}
                  title="Folderul e gol"
                  body={
                    canWrite
                      ? 'Trage fișiere peste zona de mai sus, sau creează un folder.'
                      : 'Nu s-a încărcat nimic aici încă.'
                  }
                />
              }
            />
          )}
        </>
      )}
    </div>
  );
}

function ViewLink({
  href,
  active,
  label,
  children,
}: {
  readonly href: string;
  readonly active: boolean;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'flex items-center gap-1 rounded bg-surface-sunken px-2 py-1 font-medium text-ink'
          : 'flex items-center gap-1 rounded px-2 py-1 text-ink-muted hover:bg-surface-hover hover:text-ink'
      }
    >
      {children}
      {label}
    </Link>
  );
}
