import type { Actor } from '@damina/auth';
import { listVersions } from '@damina/services';
import { Badge, CellMeta, Table, type Column } from '@damina/ui';
import { Download } from 'lucide-react';

/**
 * Istoricul de versiuni al unui fișier.
 *
 * Există pentru că uploadul unui fișier cu același nume în același folder **nu e
 * conflict, e o versiune nouă** — așa se comportă orice explorer, și așa nu se
 * pierde ce era înainte. Dar comportamentul ăla e minciună dacă versiunile
 * vechi nu se pot vedea și lua înapoi: cine urcă din greșeală peste un deviz
 * semnat trebuie să aibă unde se întoarce.
 *
 * Fiecare rând e descărcabil separat, prin `versionId` — ruta de descărcare
 * lucrează oricum pe versiune, nu pe nod, deci nu e nimic special aici.
 */

const dateTimeFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatBytes(bytes: number): string {
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

export async function VersionHistory({
  actor,
  nodeId,
  currentVersionId,
}: {
  readonly actor: Actor;
  readonly nodeId: string;
  readonly currentVersionId: string | null;
}) {
  const versions = await listVersions(actor, nodeId);

  const columns: readonly Column<(typeof versions)[number]>[] = [
    {
      key: 'when',
      header: 'Când',
      cell: (row) => (
        <span className="flex items-center gap-2">
          {dateTimeFormat.format(row.createdAt)}
          {row.id === currentVersionId ? <Badge tone="success">curentă</Badge> : null}
          {/*
           * `uploading` și `failed` se arată, nu se ascund: un upload rămas la
           * jumătate e exact lucrul pe care omul îl caută când se întreabă de ce
           * nu-i apare fișierul.
           */}
          {row.state === 'ready' ? null : <Badge tone="warning">{row.state}</Badge>}
        </span>
      ),
    },
    {
      key: 'size',
      header: 'Mărime',
      align: 'right',
      width: '7rem',
      cell: (row) => <CellMeta>{formatBytes(row.size)}</CellMeta>,
    },
    {
      key: 'mime',
      header: 'Tip',
      width: '11rem',
      hideBelow: 'md',
      cell: (row) => <CellMeta>{row.mime}</CellMeta>,
    },
    {
      key: 'download',
      header: '',
      align: 'right',
      width: '3rem',
      cell: (row) =>
        row.state === 'ready' ? (
          <a
            href={`/api/files/${row.id}`}
            aria-label={`Descarcă versiunea din ${dateTimeFormat.format(row.createdAt)}`}
            className="inline-block rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            <Download className="size-3.5" aria-hidden="true" />
          </a>
        ) : null,
    },
  ];

  return (
    <Table
      columns={columns}
      rows={versions}
      rowKey={(row) => row.id}
      caption="Versiunile fișierului"
      empty={
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-ink-muted">
          Fișierul n-are încă nicio versiune finalizată.
        </p>
      }
    />
  );
}
