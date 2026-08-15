import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps {
  /** Ce e lista asta. O propozitie, nu „Fara date”. */
  readonly title: string;
  /** De ce e goala si ce se intampla cand se umple. */
  readonly body: string;
  /** Butonul care o umple. Lipseste doar cand nu exista actiune posibila. */
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

/**
 * Starea goala. Obligatorie pe ORICE lista (§30.11).
 *
 * Motivul e din teren, nu estetic: la 700 de obiective si 40 de utilizatori,
 * majoritatea listelor sunt goale in prima luna. Un tabel gol nu spune nimic si
 * omul pleaca; o stare goala care explica ce e lista, cum se umple si are
 * butonul de actiune la indemana e locul unde se castiga sau se pierde adoptia.
 *
 * De aceea `title`, `body` si `action` sunt in semnatura si `title`/`body` nu
 * sunt optionale: e imposibil sa livrezi o stare goala nedesenata.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
  size = 'md',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'gap-3 px-6 py-14' : 'gap-2 px-4 py-8',
        className,
      )}
    >
      {icon === undefined ? null : (
        <div
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-lg bg-surface-sunken text-ink-subtle"
        >
          {icon}
        </div>
      )}
      <div className="max-w-prose space-y-1">
        <p className={cn('font-semibold text-ink', size === 'md' ? 'text-lg' : 'text-base')}>
          {title}
        </p>
        <p className="text-base leading-relaxed text-balance text-ink-muted">{body}</p>
      </div>
      {action === undefined ? null : <div className="mt-1">{action}</div>}
    </div>
  );
}
