import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../lib/cn';

/**
 * Controalele brute. Nu stiu nimic despre formulare — `form.tsx` le leaga de
 * react-hook-form. Separarea le face folosibile si in filtre, unde nu exista
 * formular, si tine stilul intr-un singur loc.
 */

const CONTROL = [
  'w-full rounded-md border bg-surface px-2.5 text-base text-ink',
  'placeholder:text-ink-subtle',
  'transition-colors duration-100',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle',
  'read-only:bg-surface-sunken read-only:text-ink-muted',
].join(' ');

const CONTROL_HEIGHT = 'h-9';

/** Rosu doar cand campul chiar e gresit — nu la fiecare tasta apasata. */
const invalidClass = (invalid: boolean): string =>
  invalid
    ? 'border-danger-600 hover:border-danger-700'
    : 'border-border hover:border-border-strong';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
  /** Unitate sau simbol lipit la dreapta: „lei”, „%”, „ore”. */
  readonly suffix?: string;
  readonly ref?: Ref<HTMLInputElement>;
}

export function Input({ invalid = false, suffix, className, ...props }: InputProps) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        CONTROL_HEIGHT,
        invalidClass(invalid),
        suffix === undefined ? '' : 'pr-12',
        className,
      )}
      {...props}
    />
  );

  if (suffix === undefined) {
    return input;
  }

  return (
    <span className="relative block">
      {input}
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-ink-subtle">
        {suffix}
      </span>
    </span>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
  readonly ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ invalid = false, className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, 'py-2 leading-relaxed', invalidClass(invalid), className)}
      {...props}
    />
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  readonly options: readonly SelectOption[];
  readonly invalid?: boolean;
  /** Prima intrare, cu valoare goala. Lipseste cand campul e obligatoriu si are implicit. */
  readonly placeholder?: string;
  readonly ref?: Ref<HTMLSelectElement>;
}

/**
 * Select nativ, intentionat.
 *
 * Un combobox scris de mana arata mai bine in captura de ecran si se comporta
 * mai prost peste tot: pe tableta in soare, cu tastatura, cu cititorul de
 * ecran, cu 800 de produse in lista. Cand chiar avem nevoie de cautare in
 * lista, se face un `SearchSelect` dedicat — nu se strica cel simplu.
 */
export function Select({
  options,
  invalid = false,
  placeholder,
  className,
  ...props
}: SelectProps) {
  return (
    <span className="relative block">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL,
          CONTROL_HEIGHT,
          'cursor-pointer appearance-none pr-8',
          invalidClass(invalid),
          className,
        )}
        {...props}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="pointer-events-none absolute inset-y-0 right-2.5 my-auto size-3 text-ink-subtle"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M3 4.5 6 7.5 9 4.5" />
      </svg>
    </span>
  );
}

export interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly invalid?: boolean;
  readonly ref?: Ref<HTMLInputElement>;
}

/**
 * Data, pe `input[type=date]` nativ.
 *
 * Browserul afiseaza formatul local (zz.ll.aaaa in ro-RO) si trimite mereu
 * ISO — exact ce vrea si Zod, si Postgres. In plus, pe telefon deschide
 * selectorul sistemului, care e singurul pe care omul din teren il stie deja.
 */
export function DateInput({ invalid = false, className, ...props }: DateInputProps) {
  return (
    <input
      type="date"
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, CONTROL_HEIGHT, 'cursor-text', invalidClass(invalid), className)}
      {...props}
    />
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly label: ReactNode;
  readonly hint?: string;
  readonly ref?: Ref<HTMLInputElement>;
}

export function Checkbox({ label, hint, className, id, ...props }: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      className={cn('flex cursor-pointer items-start gap-2.5 py-1 select-none', className)}
    >
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border-strong text-brand-600 accent-[var(--color-brand-600)]"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-base text-ink">{label}</span>
        {hint === undefined ? null : (
          <span className="mt-0.5 block text-sm text-ink-muted">{hint}</span>
        )}
      </span>
    </label>
  );
}
