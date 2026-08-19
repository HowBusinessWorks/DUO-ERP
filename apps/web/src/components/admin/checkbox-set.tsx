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

/**
 * Unde se trimite setul.
 *
 * Doua variante pentru ca operatiile nu sunt la fel de scumpe: accesul pe firme
 * schimba doar randuri si merge printr-un server action obisnuit, iar rolurile
 * pot revoca sesiunea celui vizat (verificarea #18) — asta cere Admin API-ul
 * GoTrue, deci cheia de service, deci o ruta `/api` (§4 regula 6).
 *
 * Varianta cu ruta accepta un `notice` in raspuns: mesajul care spune ce s-a
 * mai intamplat pe langa salvare il scrie SERVERUL, langa decizia care l-a
 * produs, nu componenta asta — ea n-are de unde sti daca s-a revocat ceva.
 */
export type CheckboxSetTarget =
  | {
      readonly kind: 'action';
      /**
       * Server action-ul, ca REFERINTA, nu ca inchidere.
       *
       * Un `save={(values) => actiune({ personId, roles: values })}` scris in
       * componenta de server pare mai citibil si pica la randare: „Functions
       * cannot be passed directly to Client Components”. O inchidere nu se
       * serializeaza; un server action exportat cu `'use server'` da, pentru ca
       * e o referinta pe care runtime-ul o poate rezolva de partea cealalta.
       *
       * De asta corpul cererii se compune AICI, din `personId` si `payloadKey`,
       * in loc sa vina gata facut de sus.
       */
      readonly action: (raw: unknown) => Promise<ActionResult<{ id: string }>>;
    }
  | { readonly kind: 'endpoint'; readonly url: string };

export interface CheckboxSetProps {
  readonly options: readonly CheckboxOption[];
  readonly selected: readonly string[];
  readonly target: CheckboxSetTarget;
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

/** Rezultatul salvarii, indiferent pe unde a mers. */
type SaveOutcome =
  | { readonly ok: true; readonly notice?: string }
  | { readonly ok: false; readonly message: string };

async function post(url: string, body: unknown): Promise<SaveOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'Nu am putut ajunge la server. Verifică conexiunea.' };
  }

  const payload: unknown = await response.json().catch(() => null);
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

  if (!response.ok) {
    const message = record['message'];
    return { ok: false, message: typeof message === 'string' ? message : 'Salvarea n-a reușit.' };
  }

  const notice = record['notice'];
  return typeof notice === 'string' ? { ok: true, notice } : { ok: true };
}

export function CheckboxSet({
  options,
  selected,
  target,
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

              const body = { personId, [payloadKey]: current };
              const result: SaveOutcome =
                target.kind === 'endpoint'
                  ? await post(target.url, body)
                  : await target
                      .action(body)
                      .then((outcome) =>
                        outcome.ok
                          ? ({ ok: true } as const)
                          : ({ ok: false, message: outcome.message } as const),
                      );

              setSaving(false);
              if (result.ok) {
                toast({ tone: 'success', title: 'Salvat', body: result.notice });
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
