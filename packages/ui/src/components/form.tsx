'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { t } from '@damina/i18n';
import { AlertTriangle } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import {
  FormProvider,
  useForm,
  useFormContext,
  type DefaultValues,
  type FieldValues,
  type Path,
  type Resolver,
  type SubmitHandler,
  type UseFormReturn,
} from 'react-hook-form';
import type { z } from 'zod';
import { cn } from '../lib/cn';

/**
 * Formularele, legate de ACEEASI schema Zod ca use-case-ul de pe server.
 *
 * Nu „o schema echivalenta” — literalmente acelasi obiect, importat din
 * `@damina/contracts`. Validarea din browser si cea din server nu au cum sa
 * divergheze, pentru ca nu exista doua lucruri care sa divergheze.
 */

export interface FormProps<Schema extends z.ZodType> {
  readonly schema: Schema;
  readonly defaultValues: DefaultValues<z.output<Schema>>;
  readonly onSubmit: SubmitHandler<z.output<Schema>>;
  /** Primeste formularul: `isDirty` pentru Dialog, `isSubmitting` pentru buton. */
  readonly children: (form: UseFormReturn<z.output<Schema>>) => ReactNode;
  readonly className?: string;
  /** Eroare venita de la server, deja tradusa in romana. */
  readonly serverError?: string;
  readonly id?: string;
}

export function Form<Schema extends z.ZodType>({
  schema,
  defaultValues,
  onSubmit,
  children,
  className,
  serverError,
  id,
}: FormProps<Schema>) {
  const form = useForm<z.output<Schema>>({
    // `raw: true`: `handleSubmit` primeste valorile BRUTE din formular, nu
    // rezultatul transformarilor Zod.
    //
    // Aceeasi schema ruleaza de doua ori pe acelasi obiect — o data aici, in
    // browser, si o data in server action. Fara `raw`, a doua trecere ar primi
    // rezultatul primei: `null` in loc de `''`, `number` in loc de sir,
    // `0.4500` in loc de `45`. Transformarile nu sunt idempotente (nici nu au
    // de ce sa fie), asa ca formularul corect completat ar cadea cu „Invalid
    // input" pe a doua validare. Browserul valideaza, serverul transforma —
    // o singura data, acolo unde rezultatul chiar se scrie in baza.
    resolver: zodResolver(schema, undefined, { raw: true }) as Resolver<z.output<Schema>>,
    defaultValues,
    // Validam la iesirea din camp, nu la fiecare tasta: rosul care apare cat
    // scrii omul e cel mai rapid mod de a-l invata sa ignore rosul.
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  return (
    <FormProvider {...form}>
      <form
        id={id}
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(onSubmit)(event);
        }}
        className={cn('space-y-4', className)}
      >
        {serverError === undefined ? null : <FormError message={serverError} />}
        {children(form)}
      </form>
    </FormProvider>
  );
}

/** Banda de eroare de deasupra formularului. Pentru esecuri de server, nu de camp. */
export function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 px-3 py-2.5 text-base text-danger-700"
    >
      <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

export interface FieldProps {
  readonly name: string;
  readonly label: string;
  /** Explicatia de sub camp. Vizibila mereu, nu la hover — regula din §1.7. */
  readonly hint?: string;
  readonly required?: boolean;
  /** Primeste id-urile de accesibilitate deja legate. */
  readonly children: (props: FieldControlProps) => ReactNode;
  readonly className?: string;
}

export interface FieldControlProps {
  readonly id: string;
  readonly invalid: boolean;
  readonly 'aria-describedby': string | undefined;
}

/**
 * Un camp: eticheta, control, explicatie, eroare.
 *
 * Eticheta e mereu vizibila si mereu legata prin `htmlFor`. Placeholder-ul ca
 * eticheta e o eroare frecventa: dispare exact cand omul scrie, adica exact
 * cand ar avea nevoie sa verifice ce completeaza.
 */
export function Field({ name, label, hint, required, children, className }: FieldProps) {
  const generatedId = useId();
  const id = `${generatedId}-${name}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const form = useFormContext();
  const error = getError(form.formState.errors, name);
  const invalid = error !== undefined;

  const describedBy = [hint === undefined ? null : hintId, invalid ? errorId : null]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-sm font-medium text-ink">
        {label}
        {required === true ? null : (
          <span className="text-xs font-normal text-ink-subtle">({t('common.optional')})</span>
        )}
      </label>

      {children({
        id,
        invalid,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
      })}

      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {invalid ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Mesajul de eroare al unui camp, inclusiv pe cai imbricate (`a.b.c`). */
function getError(errors: FieldValues, name: string): string | undefined {
  let current: unknown = errors;
  for (const segment of name.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current === 'object' && current !== null && 'message' in current) {
    const { message } = current as { message?: unknown };
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

/** Inregistrarea unui camp, cu tipul corect. Evita `as` in fiecare formular. */
export function useField<Values extends FieldValues>(name: Path<Values>) {
  const form = useFormContext<Values>();
  return form.register(name);
}

/** Randuri de campuri: una sau doua coloane, cu prabusire pe mobil. */
export function FieldRow({
  children,
  columns = 2,
  className,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const grid = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' } as const;
  return <div className={cn('grid grid-cols-1 gap-4', grid[columns], className)}>{children}</div>;
}

/** Grup de campuri cu titlu. Sparge formularele lungi in bucati citibile. */
export function FieldSet({
  legend,
  description,
  children,
  className,
}: {
  legend: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('space-y-4 border-t border-border pt-4 first:border-0 first:pt-0', className)}>
      <legend className="sr-only">{legend}</legend>
      <div>
        <p className="text-base font-semibold text-ink">{legend}</p>
        {description === undefined ? null : (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {children}
    </fieldset>
  );
}

export { useFormContext } from 'react-hook-form';
export type { UseFormReturn } from 'react-hook-form';
