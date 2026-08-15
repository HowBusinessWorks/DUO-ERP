import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface StatProps {
  readonly label: string;
  readonly value: ReactNode;
  /**
   * Ce inseamna cifra. OBLIGATORIU.
   *
   * O cifra fara referinta nu sustine nicio decizie: „18.400 lei” nu spune daca
   * e bine sau rau. „68% din plafon” spune. De aceea `context` nu e optional —
   * daca nu se poate scrie, indicatorul probabil nu merita ecran.
   */
  readonly context: string;
  /** Ruta catre desfacerea cifrei (I3: orice cifra se poate deschide). */
  readonly href?: string;
  readonly tone?: 'neutral' | 'warning' | 'danger' | 'success';
  readonly icon?: ReactNode;
  readonly className?: string;
}

const TONES = {
  neutral: 'text-ink',
  warning: 'text-warning-700',
  danger: 'text-danger-700',
  success: 'text-success-700',
} as const;

export function Stat({ label, value, context, href, tone = 'neutral', icon, className }: StatProps) {
  const content = (
    <>
      <div className="flex items-center gap-1.5">
        {icon === undefined ? null : <span className="text-ink-subtle">{icon}</span>}
        <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</p>
      </div>
      <p data-numeric className={cn('mt-1.5 text-3xl font-semibold tabular-nums', TONES[tone])}>
        {value}
      </p>
      <p className="mt-1 text-sm text-ink-muted">{context}</p>
    </>
  );

  if (href === undefined) {
    return (
      <div className={cn('rounded-lg border border-border bg-surface p-4', className)}>
        {content}
      </div>
    );
  }

  return (
    <a
      href={href}
      className={cn(
        'block rounded-lg border border-border bg-surface p-4 transition-colors',
        'hover:border-brand-300 hover:bg-brand-50/40',
        className,
      )}
    >
      {content}
    </a>
  );
}
