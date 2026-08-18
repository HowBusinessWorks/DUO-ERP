import type { Actor } from '@damina/auth';
import { breadcrumb, listChildren, type Crumb, type NodeRow } from '@damina/services';
import { CellMeta, EmptyState, Table, type Column } from '@damina/ui';
import { ChevronRight, File, FileImage, FileVideo, Folder, FolderOpen } from 'lucide-react';
import { NewFolderButton, NodeActions } from './node-actions';
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
  readonly canWrite: boolean;
  /** Text sub bara de unelte: ce e folderul asta, cand nu e evident. */
  readonly notice?: string;
}

export async function FileExplorer({
  actor,
  rootId,
  nodeId,
  href,
  canWrite,
  notice,
}: FileExplorerProps) {
  const current = nodeId ?? rootId;
  const [children, crumbs] = await Promise.all([
    listChildren(actor, current),
    breadcrumb(actor, current),
  ]);

  // Firimiturile pornesc de la radacina EXPLORERULUI, nu de la cea a firmei:
  // pe tab-ul unei unitati de lucru, drumul catre firma nu e navigabil de acolo,
  // deci afisarea lui ar promite o navigare care nu exista.
  const from = crumbs.findIndex((crumb) => crumb.id === rootId);
  const trail: readonly Crumb[] = from === -1 ? crumbs.slice(-1) : crumbs.slice(from);
  const parent = trail.length > 1 ? trail[trail.length - 2] : undefined;

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
      width: '7rem',
      cell: (node) =>
        canWrite ? (
          <NodeActions
            node={{ id: node.id, name: node.name, isSystem: node.isSystem }}
            folders={folderTargets.filter((target) => target.id !== node.id)}
          />
        ) : null,
    },
  ];

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

      {canWrite ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <NewFolderButton parentId={current} />
          </div>
          <UploadZone parentId={current} />
        </div>
      ) : null}

      <Table
        columns={columns}
        rows={children}
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
    </div>
  );
}
