import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface Column<Row> {
  readonly key: string;
  readonly header: ReactNode;
  /** Continutul celulei. Primeste randul intreg — fara maparea intermediara. */
  readonly cell: (row: Row) => ReactNode;
  /** Cifrele se aliniaza la dreapta. Textul, niciodata. */
  readonly align?: 'left' | 'right' | 'center';
  /** Latime fixa, pentru coloane de cod, stare sau actiuni. */
  readonly width?: string;
  /** Se ascunde sub 1024px. Coloanele esentiale nu primesc niciodata flagul. */
  readonly hideBelow?: 'md' | 'lg';
  readonly className?: string;
}

export interface TableProps<Row> {
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** Randul e navigabil: ruta se pune ca ancora pe prima celula. */
  readonly rowHref?: (row: Row) => string;
  /** Randul e evidentiat: document deschis, alerta activa (§30.3). */
  readonly rowFlagged?: (row: Row) => boolean;
  /** Ce se afiseaza cand `rows` e gol. Obligatoriu — vezi `EmptyState`. */
  readonly empty: ReactNode;
  /** Descrierea tabelului pentru cititorul de ecran. */
  readonly caption: string;
  /**
   * Inaltimea maxima a corpului. Cand e data, antetul devine lipicios si
   * corpul deruleaza — exact structura peste care se pune virtualizarea cand
   * listele trec de cateva mii de randuri (registrul de cost, pasul 06). Pana
   * atunci nu adaugam o dependinta pentru o problema pe care nu o avem.
   */
  readonly maxBodyHeight?: string;
  readonly className?: string;
  /** Randuri suplimentare sub corp: totaluri, „mai sunt N”. */
  readonly footer?: ReactNode;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;
const HIDE = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

export function Table<Row>({
  columns,
  rows,
  rowKey,
  rowHref,
  rowFlagged,
  empty,
  caption,
  maxBodyHeight,
  className,
  footer,
}: TableProps<Row>) {
  if (rows.length === 0) {
    return <>{empty}</>;
  }

  return (
    <div
      className={cn(
        'scrollbar-thin overflow-auto overscroll-contain rounded-lg border border-border bg-surface',
        className,
      )}
      style={maxBodyHeight === undefined ? undefined : { maxHeight: maxBodyHeight }}
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface-sunken">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width === undefined ? undefined : { width: column.width }}
                className={cn(
                  'border-b border-border px-3 py-2 text-xs font-semibold tracking-wide text-ink-muted uppercase',
                  ALIGN[column.align ?? 'left'],
                  column.hideBelow === undefined ? '' : HIDE[column.hideBelow],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = rowHref?.(row);
            const flagged = rowFlagged?.(row) === true;

            return (
              <tr
                key={rowKey(row)}
                className={cn(
                  'group border-b border-border/70 last:border-0',
                  href === undefined ? '' : 'cursor-pointer hover:bg-brand-50/60',
                  flagged ? 'bg-warning-50/50' : '',
                )}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3 py-2 align-middle text-ink',
                      ALIGN[column.align ?? 'left'],
                      column.hideBelow === undefined ? '' : HIDE[column.hideBelow],
                      column.className,
                    )}
                  >
                    {index === 0 && href !== undefined ? (
                      // O ancora adevarata pe prima celula, nu un `onClick` pe
                      // rand: Ctrl+click, click dreapta si Tab functioneaza. Un
                      // rand care se deschide doar cu click stang rupe cea mai
                      // folosita unealta a biroului — deschiderea in tab nou.
                      <a href={href} className="block hover:underline focus-visible:outline-offset-1">
                        {column.cell(row)}
                      </a>
                    ) : (
                      column.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {footer === undefined ? null : (
          <tfoot className="sticky bottom-0 bg-surface-sunken">{footer}</tfoot>
        )}
      </table>
    </div>
  );
}

/** Celula secundara: cod, unitate, data. Gri, mai mica, dar tot lizibila. */
export function CellMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-xs text-ink-muted', className)}>{children}</span>;
}

/** Titlul randului: numele entitatii. Ce citeste ochiul primul. */
export function CellTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-medium text-ink', className)}>{children}</span>;
}
