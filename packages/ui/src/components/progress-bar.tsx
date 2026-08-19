import { cn } from '../lib/cn';

export type ProgressTone = 'brand' | 'success' | 'warning' | 'danger';

export interface ProgressBarProps {
  /** 0–100. Peste 100 bara ramane plina, dar cifra spune adevarul. */
  readonly value: number;
  readonly label: string;
  /**
   * Tonul se calculeaza din valoare cand nu e dat explicit. Regula implicita e
   * cea de consum: sub 80% e normal, 80–100% e atentie, peste 100% e depasire.
   * Un progres de executie foloseste `tone="brand"` — acolo mult e bine.
   */
  readonly tone?: ProgressTone;
  /** A doua cifra din antet: „62% · 26.100 din 41.800 lei”. */
  readonly detail?: string;
  readonly className?: string;
  readonly size?: 'sm' | 'md';
}

const TONES: Readonly<Record<ProgressTone, string>> = {
  brand: 'bg-brand-500',
  success: 'bg-success-600',
  warning: 'bg-warning-600',
  danger: 'bg-danger-600',
};

export function ProgressBar({
  value,
  label,
  tone,
  detail,
  className,
  size = 'md',
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const resolvedTone: ProgressTone =
    tone ?? (value > 100 ? 'danger' : value >= 80 ? 'warning' : 'brand');
  const rounded = Math.round(value);

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-ink-muted">{label}</span>
        <span
          data-numeric
          className={cn(
            'shrink-0 text-xs font-semibold tabular-nums',
            resolvedTone === 'danger' ? 'text-danger-700' : 'text-ink',
          )}
        >
          {rounded}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          'mt-1 w-full overflow-hidden rounded-full bg-surface-sunken ring-1 ring-inset ring-border',
          size === 'md' ? 'h-1.5' : 'h-1',
        )}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', TONES[resolvedTone])}
          style={{ width: `${String(clamped)}%` }}
        />
      </div>
      {detail === undefined ? null : (
        <p className="mt-1 truncate text-xs text-ink-subtle">{detail}</p>
      )}
    </div>
  );
}
