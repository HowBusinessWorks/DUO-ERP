import { cn } from '@damina/ui';
import type { ReactNode } from 'react';

export interface DefinitionItem {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: string;
  readonly full?: boolean;
}

/**
 * Perechi eticheta/valoare — continutul tab-ului „Prezentare” al oricarei
 * entitati.
 *
 * Eticheta deasupra, nu la stanga: pe doua coloane, etichetele laterale de
 * lungimi diferite produc o coloana de valori zimtata, si ochiul nu mai poate
 * scana in jos.
 */
export function DefinitionList({
  items,
  columns = 2,
  className,
}: {
  items: readonly DefinitionItem[];
  columns?: 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-x-8 gap-y-5',
        columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className={item.full === true ? 'sm:col-span-full' : undefined}>
          <dt className="text-xs font-medium tracking-wide text-ink-muted uppercase">
            {item.label}
          </dt>
          <dd className="mt-1 text-base text-ink">{item.value}</dd>
          {item.hint === undefined ? null : (
            <p className="mt-0.5 text-sm text-ink-subtle">{item.hint}</p>
          )}
        </div>
      ))}
    </dl>
  );
}

/** Valoare lipsa. O liniuta, nu un gol — golul se citeste ca bug de randare. */
export function Empty() {
  return <span className="text-ink-subtle">—</span>;
}
