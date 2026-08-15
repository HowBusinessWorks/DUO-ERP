import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface CardProps {
  readonly className?: string;
  readonly children: ReactNode;
  /** Fara chenar si fara umbra — cand cardul sta deja intr-un container. */
  readonly flush?: boolean;
}

export function Card({ className, children, flush = false }: CardProps) {
  return (
    <section
      className={cn(
        'rounded-lg bg-surface',
        flush ? '' : 'border border-border shadow-xs',
        className,
      )}
    >
      {children}
    </section>
  );
}

export interface CardHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Butoane sau filtre, aliniate la dreapta titlului. */
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function CardHeader({ title, description, actions, className }: CardHeaderProps) {
  return (
    <header
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
        {description === undefined ? null : (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <footer
      className={cn(
        'flex items-center justify-end gap-2 border-t border-border bg-surface-sunken/60 px-4 py-3',
        className,
      )}
    >
      {children}
    </footer>
  );
}
