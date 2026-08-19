import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type GaugeTone = 'brand' | 'success' | 'warning' | 'danger';

export interface GaugeProps {
  /** 0–100+. Peste 100 arcul ramane plin, dar cifra din centru spune adevarul. */
  readonly value: number;
  /** Cifra mare din centru. Implicit, procentul rotunjit. */
  readonly readout?: ReactNode;
  /** Ce inseamna cifra: „umplut din plafonul lunii”. OBLIGATORIU, ca la `Stat`. */
  readonly caption: string;
  /**
   * Rigla: unde ar trebui sa fie acul la ziua de azi.
   *
   * Fara ea, „38%” nu spune nimic — e excelent pe 12 si dezastruos pe 28. De
   * aceea semnul de pe arc nu e decor: e singura referinta din desen.
   */
  readonly marker?: number;
  readonly markerLabel?: string;
  readonly tone?: GaugeTone;
  readonly className?: string;
}

const TONES: Readonly<Record<GaugeTone, string>> = {
  brand: 'text-brand-500',
  success: 'text-success-600',
  warning: 'text-warning-600',
  danger: 'text-danger-600',
};

/** Semicercul: r=90 in jurul lui (100,100), de la (10,100) la (190,100). */
const RADIUS = 90;
const ARC_LENGTH = Math.PI * RADIUS;
const ARC = `M 10 100 A ${String(RADIUS)} ${String(RADIUS)} 0 0 1 190 100`;

function pointAt(fraction: number): { readonly x: number; readonly y: number } {
  const angle = Math.PI * Math.min(1, Math.max(0, fraction));
  return { x: 100 - RADIUS * Math.cos(angle), y: 100 - RADIUS * Math.sin(angle) };
}

/**
 * Gauge care SE UMPLE — pentru plafoanele de venit, nu pentru cele de cost.
 *
 * Bara de consum (`ProgressBar`) si gauge-ul asta arata la fel de departe, si
 * inseamna exact pe dos: acolo mult e rau, aici mult e bine. Sunt doua
 * componente diferite tocmai ca sa nu poata fi confundate la apel — acelasi
 * motiv pentru care `ceilingUsage` si `deltaFill` sunt doua functii, nu una cu
 * un `boolean`.
 */
export function Gauge({
  value,
  readout,
  caption,
  marker,
  markerLabel,
  tone = 'brand',
  className,
}: GaugeProps) {
  const fraction = Math.min(1, Math.max(0, value / 100));
  const rounded = Math.round(value);
  const markerPoint = marker === undefined ? null : pointAt(marker / 100);

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative w-full max-w-[15rem]">
        <svg
          viewBox="0 0 200 112"
          className="w-full"
          role="img"
          aria-label={`${caption}: ${String(rounded)}%${
            marker === undefined ? '' : `, ritmul zilei ar cere ${String(Math.round(marker))}%`
          }`}
        >
          <path
            d={ARC}
            fill="none"
            strokeLinecap="round"
            strokeWidth={14}
            className="stroke-surface-sunken"
          />
          <path
            d={ARC}
            fill="none"
            strokeLinecap="round"
            strokeWidth={14}
            strokeDasharray={`${String(ARC_LENGTH * fraction)} ${String(ARC_LENGTH)}`}
            className={cn(
              'transition-[stroke-dasharray] duration-500',
              TONES[tone],
              'stroke-current',
            )}
          />
          {markerPoint === null ? null : (
            <line
              x1={100 + (markerPoint.x - 100) * 0.86}
              y1={100 + (markerPoint.y - 100) * 0.86}
              x2={100 + (markerPoint.x - 100) * 1.13}
              y2={100 + (markerPoint.y - 100) * 1.13}
              strokeWidth={2.5}
              strokeLinecap="round"
              className="stroke-ink-subtle"
            />
          )}
        </svg>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span data-numeric className="text-4xl font-semibold tabular-nums text-ink">
            {readout ?? `${String(rounded)}%`}
          </span>
        </div>
      </div>

      <p className="mt-1 text-center text-sm text-ink-muted">{caption}</p>
      {markerLabel === undefined ? null : (
        <p className="mt-0.5 text-center text-xs text-ink-subtle">{markerLabel}</p>
      )}
    </div>
  );
}
