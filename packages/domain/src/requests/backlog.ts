import { Money } from '@damina/shared';

/**
 * Umplerea Deltei din backlog (§0, §3.5) — funcționalitatea cu cel mai bun
 * raport efort/venit din tot pasul. Omul selectează manual din ecran; funcția
 * de aici e sugestia: combinația de propuneri care umple cel mai bine un
 * plafon dat, fără să-l depășească.
 *
 * Knapsack 0/1, dar **în lei întregi, nu în cenți**. Un DP pe cenți pare mai
 * exact și e de fapt inutilizabil: un plafon de 100.000 lei înseamnă 10.000.001
 * celule PE PROPUNERE, adică ~10 MB de `choice` la fiecare, ~500 MB la cincizeci
 * de propuneri — procesul moare, iar ecranul de backlog cheamă funcția la
 * fiecare bifă. Scalarea la lei taie de 100× și memoria, și iterațiile.
 *
 * Rotunjirea e ASIMETRICĂ, intenționat: capacitatea în jos, valorile în sus.
 * Așa suma reală a selecției nu poate depăși niciodată plafonul real — cel mult
 * rămâne sub el cu sub un leu pe propunere. Într-o sugestie de umplere, „puțin
 * mai puțin" e o imprecizie; „puțin mai mult" ar fi o depășire de plafon.
 *
 * Peste `MAX_CELLS` (sau peste `MAX_ITEMS_EXACT`) se trece pe greedy: tot optim
 * n-ar mai fi, dar rămâne rezonabil, iar planul nu cere exactitate garantată la
 * scară mare.
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
  /** `false` cand s-a folosit euristica in loc de DP-ul exact. */
  readonly exact: boolean;
}

const MAX_ITEMS_EXACT = 200;

/**
 * Bugetul de memorie al DP-ului, în celule de `choice` (un octet fiecare):
 * ~20 MB în cel mai rău caz acceptat. Peste asta, greedy.
 */
const MAX_CELLS = 20_000_000;

/** Valoarea propunerii, în lei întregi, rotunjită ÎN SUS (vezi antetul). */
function toLeiCeil(m: Money): number {
  return Math.ceil(m.toUnsafeNumber());
}

function knapsackExact(
  proposals: readonly BacklogProposalLike[],
  capacityLei: number,
): readonly BacklogProposalLike[] {
  const n = proposals.length;
  // best[c] = suma maxima atinsa cu capacitate c, folosind primele i propuneri.
  let best = new Array<number>(capacityLei + 1).fill(0);
  const choice = new Array<Uint8Array>(n);

  for (let i = 0; i < n; i += 1) {
    const value = toLeiCeil(proposals[i]!.estimatedValue);
    const next = best.slice();
    const picked = new Uint8Array(capacityLei + 1);
    for (let c = value; c <= capacityLei; c += 1) {
      if (value > 0 && best[c - value]! + value > next[c]!) {
        next[c] = best[c - value]! + value;
        picked[c] = 1;
      }
    }
    best = next;
    choice[i] = picked;
  }

  // Reconstructie de la ultima propunere spre prima.
  const selected: BacklogProposalLike[] = [];
  let c = capacityLei;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (choice[i]![c] === 1) {
      const p = proposals[i]!;
      selected.push(p);
      c -= toLeiCeil(p.estimatedValue);
    }
  }
  return selected;
}

function knapsackGreedy(
  proposals: readonly BacklogProposalLike[],
  capacityLei: number,
): readonly BacklogProposalLike[] {
  const sorted = [...proposals].sort(
    (a, b) => toLeiCeil(b.estimatedValue) - toLeiCeil(a.estimatedValue),
  );
  const selected: BacklogProposalLike[] = [];
  let remaining = capacityLei;
  for (const p of sorted) {
    const lei = toLeiCeil(p.estimatedValue);
    if (lei > 0 && lei <= remaining) {
      selected.push(p);
      remaining -= lei;
    }
  }
  return selected;
}

export function selectBacklogToFill(
  proposals: readonly BacklogProposalLike[],
  freeAmount: Money,
): BacklogSelection {
  const capacityLei = Math.max(0, Math.floor(freeAmount.toUnsafeNumber()));
  if (capacityLei === 0 || proposals.length === 0) {
    return { selectedIds: [], total: Money.ZERO, fillPercent: 0, exact: true };
  }

  const exact =
    proposals.length <= MAX_ITEMS_EXACT && (capacityLei + 1) * proposals.length <= MAX_CELLS;

  const selected = exact
    ? knapsackExact(proposals, capacityLei)
    : knapsackGreedy(proposals, capacityLei);

  const total = Money.sum(selected.map((p) => p.estimatedValue));
  const fillPercent = freeAmount.isZero()
    ? 0
    : Math.round((total.toUnsafeNumber() / freeAmount.toUnsafeNumber()) * 10000) / 100;

  return { selectedIds: selected.map((p) => p.id), total, fillPercent, exact };
}
