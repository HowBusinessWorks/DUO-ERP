import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type BannerTone = 'info' | 'warning' | 'danger' | 'success';

const TONES: Readonly<Record<BannerTone, string>> = {
  info: 'border-brand-200 bg-brand-50 text-brand-900',
  warning: 'border-warning-200 bg-warning-50 text-warning-700',
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
  success: 'border-success-200 bg-success-50 text-success-700',
};

export interface BannerProps {
  readonly tone?: BannerTone;
  readonly icon?: ReactNode;
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
  readonly className?: string;
  /** Compact: o singura linie, pentru banda de sub antet. */
  readonly dense?: boolean;
}

/**
 * Banda de context care sta PESTE continut, nu langa el.
 *
 * Doua folosinte, ambele din reguli explicite:
 *  - luna inchisa (§30.10) — cea mai importanta indicatie vizuala din
 *    aplicatie, deci apare pe orice ecran care depinde de perioada;
 *  - alerta deschisa (§28) — prag depasit, persista pana se rezolva.
 *
 * Ce NU e: notificare. Notificarile sunt in clopotel si se citesc o data.
 */
export function Banner({
  tone = 'info',
  icon,
  title,
  body,
  action,
  className,
  dense = false,
}: BannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2.5 border-b px-4',
        dense ? 'py-2' : 'py-2.5',
        TONES[tone],
        className,
      )}
    >
      {icon === undefined ? null : <span className="mt-px shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className={cn('font-semibold', dense ? 'text-sm' : 'text-base')}>{title}</p>
        {body === undefined ? null : (
          <p className={cn('opacity-90', dense ? 'text-sm' : 'mt-0.5 text-base')}>{body}</p>
        )}
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}
