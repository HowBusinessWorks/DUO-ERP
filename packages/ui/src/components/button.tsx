import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

/**
 * Cinci variante, nu cincisprezece. Fiecare are un rost declarat:
 *
 *   primary   — actiunea pe care o vrea 90% din lume pe ecranul asta. UNA
 *               singura per ecran. Doua butoane pline unul langa altul inseamna
 *               ca nu s-a decis care e actiunea, si atunci decide utilizatorul,
 *               prost.
 *   secondary — restul actiunilor reale.
 *   ghost     — actiuni din bare de unelte si din liste, unde chenarul ar face
 *               ecranul zgomotos.
 *   danger    — distructiv si greu de intors. Rosu, ca sa se ezite.
 *   link      — navigare deghizata in buton.
 */
const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600',
  secondary:
    'bg-surface text-ink border border-border shadow-xs hover:bg-surface-hover hover:border-border-strong active:bg-surface-sunken',
  ghost: 'text-ink-muted hover:bg-surface-hover hover:text-ink active:bg-surface-sunken',
  danger: 'bg-danger-600 text-white shadow-xs hover:bg-danger-700 active:bg-danger-700',
  link: 'text-brand-600 underline underline-offset-2 hover:text-brand-700 px-0',
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-8 gap-2 px-3 text-sm',
  lg: 'h-10 gap-2 px-4 text-base',
  // Patrat, minimum 32px. Sub atat, degetul rateaza pe tableta.
  icon: 'size-8 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Icoana la stanga textului. Decorativa: textul ramane sursa de adevar. */
  readonly icon?: ReactNode;
  readonly iconRight?: ReactNode;
  /** Blocheaza butonul si arata ca se lucreaza. Nu ascunde textul. */
  readonly loading?: boolean;
  /**
   * De ce e butonul dezactivat. Se afiseaza ca tooltip si ca `aria-description`.
   * Un buton gri fara explicatie e cel mai frecvent moment in care omul da
   * telefon in loc sa foloseasca aplicatia.
   */
  readonly disabledReason?: string;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  disabledReason,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      title={isDisabled && disabledReason !== undefined ? disabledReason : props.title}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center rounded-md font-medium whitespace-nowrap',
        'transition-colors duration-100',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {iconRight}
    </button>
  );
}

/** Cerc care se roteste, 12px. Fara procente false si fara "aproape gata". */
function Spinner() {
  return (
    <svg
      className="size-3.5 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
