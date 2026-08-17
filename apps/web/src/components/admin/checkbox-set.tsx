'use client';

import { Button, Checkbox, useToast } from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { ActionResult } from '../../lib/action';

/**
 * Un set de casute salvat CA SET.
 *
 * Rolurile de birou si accesul pe firme sunt aceeasi forma: o lista fixa de
 * optiuni, o selectie, un buton. Nu doua componente aproape identice.
 *
 * Butonul de salvare e dezactivat cat timp nimic nu s-a schimbat, si spune de
 * ce. Fara asta, un ecran cu sapte casute invita la „salvez ca sa fiu sigur”, si
 * fiecare apasare inseamna un rand in jurnalul de audit care nu spune nimic.
 */

export interface CheckboxOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

export interface CheckboxSetProps {
  readonly options: readonly CheckboxOption[];
  readonly selected: readonly string[];
  /**
   * Server action-ul, ca REFERINTA, nu ca inchidere.
   *
   * Un `save={(values) => actiune({ personId, roles: values })}` scris in
   * componenta de server pare mai citibil si pica la randare: „Functions cannot
   * be passed directly to Client Components”. O inchidere nu se serializeaza;
   * un server action exportat cu `'use server'` da, pentru ca e o referinta pe
   * care runtime-ul o poate rezolva de partea cealalta.
   *
   * De asta corpul cererii se compune AICI, din `personId` si `payloadKey`, in
   * loc sa vina gata facut de sus.
   */
  readonly action: (raw: unknown) => Promise<ActionResult<{ id: string }>>;
  readonly personId: string;
  /** Numele campului din corpul actiunii: `roles` sau `companyIds`. */
  readonly payloadKey: 'roles' | 'companyIds';
  readonly saveLabel: string;
  /** Motivul pentru care setul nu se poate atinge. Butonul si casutele il spun. */
  readonly blockedReason?: string;
  /** Ce se afiseaza cand lista de optiuni e goala. */
  readonly emptyLabel: string;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

export function CheckboxSet({
  options,
  selected,
  action,
  personId,
  payloadKey,
  saveLabel,
  blockedReason,
  emptyLabel,
}: CheckboxSetProps) {
  const [current, setCurrent] = useState<readonly string[]>(selected);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { toast } = useToast();
  const router = useRouter();
  const prefix = useId();

  const blocked = blockedReason !== undefined;
  const dirty = !sameSet(current, selected);

  if (options.length === 0) {
    return <p className="text-base text-ink-muted">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        {options.map((option) => (
          <Checkbox
            key={option.value}
            id={`${prefix}-${option.value}`}
            label={option.label}
            hint={option.hint}
            checked={current.includes(option.value)}
            disabled={blocked || saving}
            onChange={(event) => {
              const next = event.currentTarget.checked
                ? [...current, option.value]
                : current.filter((value) => value !== option.value);
              setCurrent(next);
              setError(undefined);
            }}
          />
        ))}
      </div>

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="sm"
          loading={saving}
          disabled={blocked || !dirty}
          disabledReason={blockedReason ?? 'Nu ai schimbat nimic.'}
          onClick={() => {
            void (async () => {
              setSaving(true);
              setError(undefined);
              const result = await action({ personId, [payloadKey]: current });
              setSaving(false);
              if (result.ok) {
                toast({ tone: 'success', title: 'Salvat' });
                router.refresh();
              } else {
                setError(result.message);
              }
            })();
          }}
        >
          {saveLabel}
        </Button>

        {dirty && !blocked ? (
          <button
            type="button"
            className="text-sm text-ink-muted underline underline-offset-2 hover:text-ink"
            onClick={() => {
              setCurrent(selected);
              setError(undefined);
            }}
          >
            Renunță la modificări
          </button>
        ) : null}
      </div>
    </div>
  );
}
