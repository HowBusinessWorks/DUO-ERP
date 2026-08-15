import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'outline';

const TONES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-surface-sunken text-ink-muted ring-border',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  success: 'bg-success-50 text-success-700 ring-success-200',
  warning: 'bg-warning-50 text-warning-700 ring-warning-200',
  danger: 'bg-danger-50 text-danger-700 ring-danger-200',
  outline: 'bg-transparent text-ink-muted ring-border',
};

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly icon?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
  readonly title?: string;
}

/**
 * Eticheta de stare. Ton, nu culoare: apelantul spune ce INSEAMNA, nu ce culoare
 * vrea. Cand paleta se schimba, se schimba intr-un loc.
 */
export function Badge({ tone = 'neutral', icon, className, children, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium',
        'ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export interface CountBadgeProps {
  readonly count: number;
  /** Ce inseamna cifra, pentru cititorul de ecran. Fara asta, badge-ul e mut. */
  readonly label: string;
  readonly tone?: 'brand' | 'danger' | 'neutral';
  readonly className?: string;
}

/**
 * Cifra dintr-un badge de coada sau de tab.
 *
 * Zero NU se afiseaza: un badge care arata „0” e o pata pe ecran care nu cere
 * nimic. O coada goala trebuie sa dispara, nu sa se laude ca e goala.
 * Peste 99 se scrie „99+” — cifra exacta oricum nu schimba decizia.
 */
export function CountBadge({ count, label, tone = 'brand', className }: CountBadgeProps) {
  if (count <= 0) {
    return null;
  }

  const tones = {
    brand: 'bg-brand-600 text-white',
    danger: 'bg-danger-600 text-white',
    neutral: 'bg-surface-sunken text-ink-muted ring-1 ring-inset ring-border',
  } as const;

  return (
    <span
      aria-label={label}
      data-numeric
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded px-1',
        'text-xs leading-none font-semibold tabular-nums',
        tones[tone],
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
