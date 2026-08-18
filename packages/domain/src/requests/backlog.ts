import { Money } from '@damina/shared';

/**
 * Umplerea Deltei din backlog (§0, §3.5) — funcționalitatea cu cel mai bun
 * raport efort/venit din tot pasul. Omul selectează manual din ecran; funcția
 * de aici e sugestia: combinația de propuneri care umple cel mai bine un
 * plafon dat, fără să-l depășească.
 *
 * Knapsack 0/1 exact, în bani (cenți) — seturile reale sunt zeci de propuneri
 * pe un contract, nu mii, deci DP-ul e milisecunde. Peste `MAX_ITEMS_EXACT` se
 * trece pe greedy (cele mai mari primele): tot optim n-ar mai fi, dar rămâne
 * rezonabil, iar planul nu cere exactitate garantată la scară mare.
 */

export interface BacklogProposalLike {
  readonly id: string;
  readonly estimatedValue: Money;
}

export interface BacklogSelection {
  readonly selectedIds: readonly string[];
  readonly total: Money;
  /** 0–100+. Cat de plin ajunge plafonul cu selectia asta. */
  readonly fillPercent: number;
}

const MAX_ITEMS_EXACT = 200;

function toCents(m: Money): number {
  return Math.round(m.toUnsafeNumber() * 100);
}

function knapsackExact(
  proposals: readonly BacklogProposalLike[],
  capacityCents: number,
): readonly BacklogProposalLike[] {
  const n = proposals.length;
  // best[c] = suma maxima atinsa cu capacitate c, folosind primele i propuneri.
  let best = new Array<number>(capacityCents + 1).fill(0);
  const choice = new Array<Uint8Array>(n);

  for (let i = 0; i < n; i += 1) {
    const value = toCents(proposals[i]!.estimatedValue);
    const next = best.slice();
    const picked = new Uint8Array(capacityCents + 1);
    for (let c = 0; c <= capacityCents; c += 1) {
      if (value > 0 && value <= c && best[c - value]! + value > next[c]!) {
        next[c] = best[c - value]! + value;
        picked[c] = 1;
      }
    }
    best = next;
    choice[i] = picked;
  }

  // Reconstructie de la ultima propunere spre prima.
  const selected: BacklogProposalLike[] = [];
  let c = capacityCents;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (choice[i]![c] === 1) {
      const p = proposals[i]!;
      selected.push(p);
      c -= toCents(p.estimatedValue);
    }
  }
  return selected;
}

function knapsackGreedy(
  proposals: readonly BacklogProposalLike[],
  capacityCents: number,
): readonly BacklogProposalLike[] {
  const sorted = [...proposals].sort(
    (a, b) => toCents(b.estimatedValue) - toCents(a.estimatedValue),
  );
  const selected: BacklogProposalLike[] = [];
  let remaining = capacityCents;
  for (const p of sorted) {
    const cents = toCents(p.estimatedValue);
    if (cents > 0 && cents <= remaining) {
      selected.push(p);
      remaining -= cents;
    }
  }
  return selected;
}

export function selectBacklogToFill(
  proposals: readonly BacklogProposalLike[],
  freeAmount: Money,
): BacklogSelection {
  const capacityCents = Math.max(0, toCents(freeAmount));
  if (capacityCents === 0 || proposals.length === 0) {
    return { selectedIds: [], total: Money.ZERO, fillPercent: 0 };
  }

  const selected =
    proposals.length <= MAX_ITEMS_EXACT
      ? knapsackExact(proposals, capacityCents)
      : knapsackGreedy(proposals, capacityCents);

  const total = Money.sum(selected.map((p) => p.estimatedValue));
  const fillPercent = freeAmount.isZero()
    ? 0
    : Math.round((total.toUnsafeNumber() / freeAmount.toUnsafeNumber()) * 10000) / 100;

  return { selectedIds: selected.map((p) => p.id), total, fillPercent };
}
