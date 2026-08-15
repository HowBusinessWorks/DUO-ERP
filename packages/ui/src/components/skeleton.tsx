import { cn } from '../lib/cn';

/**
 * Locul unui continut care se incarca.
 *
 * Nu e un spinner si nu e o bara de progres falsa: un dreptunghi de dimensiunea
 * a ceea ce urmeaza, ca layoutul sa nu sara cand sosesc datele. Se foloseste in
 * `fallback`-ul de `Suspense`, unde stim exact ce forma are ce lipseste.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-sunken', className)}
    />
  );
}

/** Scheletul unui tabel: antet plus `rows` randuri de aceeasi inaltime. */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div
      role="status"
      aria-label="Se încarcă"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex gap-3 border-b border-border bg-surface-sunken px-3 py-2">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 flex-1 bg-border/60" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3 border-b border-border/70 px-3 py-2.5 last:border-0">
          {Array.from({ length: columns }, (_, index) => (
            <Skeleton key={index} className="h-3.5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
