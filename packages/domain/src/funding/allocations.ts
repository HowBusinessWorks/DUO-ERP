import { AppError, Money } from '@damina/shared';

/**
 * Alocarile de finantare: cate randuri, cu ce sume, si cand suma nu se leaga.
 *
 * Regula centrala a pasului: **finantarea nu e un camp pe unitatea de lucru**. O
 * lucrare finantata din Delta pe trei luni consecutive are TREI alocari, iar una
 * finantata din doua contracte simultan are doua alocari cu procente. Functiile
 * de aici lucreaza deci mereu pe liste, niciodata pe un singur rand.
 */

/** Cum arata o alocare pentru regulile pure. Doar ce conteaza la calcul. */
export interface AllocationLike {
  readonly periodId: string;
  readonly componentId: string;
  /** Suma alocata. `null` cand alocarea e exprimata in procent. */
  readonly allocatedAmount: Money | null;
  /** Fractie, nu procent: 0.6 = 60%. `null` cand e exprimata in suma. */
  readonly allocatedPct: number | null;
  readonly status: 'active' | 'superseded';
}

export interface AllocationSplit {
  readonly periodId: string;
  readonly amount: Money;
}

/**
 * Taie o suma pe mai multe luni — „Delta ×3 luni", cazul cel mai des din §13.
 *
 * Foloseste `Money.allocate`, deci **suma bucatilor e exact suma initiala**:
 * 34.800 pe trei luni da 11.600 × 3, iar 100 pe trei da 33.34 + 33.33 + 33.33.
 * Fara asta, un ban pierdut la rotunjire ar aparea ca diferenta intre valoarea
 * lucrarii si suma alocarilor ei, adica exact verificarea #1 a pasului.
 *
 * `weights` acopera cazul real in care lunile nu sunt egale (aug 12.500 · sep
 * 12.500 · oct 9.800): se dau ponderile, se pastreaza exactitatea.
 */
export function splitAcrossPeriods(
  amount: Money,
  periodIds: readonly string[],
  weights?: readonly number[],
): AllocationSplit[] {
  if (periodIds.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Finantarea are nevoie de cel putin o luna.');
  }

  if (weights !== undefined && weights.length !== periodIds.length) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Numarul de ponderi nu se potriveste cu numarul de luni.',
      { periods: periodIds.length, weights: weights.length },
    );
  }

  if (new Set(periodIds).size !== periodIds.length) {
    throw new AppError('VALIDATION_FAILED', 'Aceeasi luna apare de doua ori in taiere.');
  }

  const ratios = weights ?? periodIds.map(() => 1);
  const shares = amount.allocate(ratios);

  return periodIds.map((periodId, i) => ({
    periodId,
    // `allocate` intoarce exact atatea bucati cate rapoarte a primit.
    amount: shares[i] ?? Money.ZERO,
  }));
}

/** Suma alocarilor ACTIVE exprimate in bani. Cele in procent nu se aduna aici. */
export function allocatedTotal(allocations: readonly AllocationLike[]): Money {
  return Money.sum(
    allocations
      .filter((a) => a.status === 'active')
      .flatMap((a) => (a.allocatedAmount === null ? [] : [a.allocatedAmount])),
  );
}

export type AllocationProblemCode = 'pct_sum_exceeded' | 'total_mismatch' | 'duplicate_active';

export interface AllocationProblem {
  readonly code: AllocationProblemCode;
  readonly periodId?: string;
  readonly componentId?: string;
  /** Cifra care a picat verificarea: procentul insumat sau suma alocarilor. */
  readonly found: string;
  readonly expected: string;
}

export interface AllocationSumCheck {
  readonly valid: boolean;
  readonly problems: readonly AllocationProblem[];
  /** Suma alocarilor active, in bani. */
  readonly total: Money;
  /** Procentele active, insumate pe luna. */
  readonly pctByPeriod: ReadonlyMap<string, number>;
}

/**
 * Cele trei feluri in care o lista de alocari poate fi gresita.
 *
 * Intoarce structura, nu arunca: ecranul de finantare trebuie sa poata ARATA
 * problema langa cifre, iar `services` decide singur cand o transforma in eroare.
 * Trigger-ul din baza ramane ultima plasa — regula procentelor e impusa si
 * acolo, pentru cazul in care cineva scrie direct in tabela.
 *
 * `expectedTotal` e optional: la o lucrare cu valoare estimata, suma alocarilor
 * trebuie s-o dea exact (verificarea #1); la una fara valoare, n-are cu ce sa se
 * compare si intrebarea nu se pune.
 */
export function validateAllocationSum(
  allocations: readonly AllocationLike[],
  expectedTotal?: Money,
): AllocationSumCheck {
  const problems: AllocationProblem[] = [];
  const active = allocations.filter((a) => a.status === 'active');

  // ── Procentele, insumate pe luna ──────────────────────────────────────────
  const pctByPeriod = new Map<string, number>();
  for (const allocation of active) {
    if (allocation.allocatedPct === null) continue;
    pctByPeriod.set(
      allocation.periodId,
      (pctByPeriod.get(allocation.periodId) ?? 0) + allocation.allocatedPct,
    );
  }

  for (const [periodId, sum] of pctByPeriod) {
    // Toleranta de 1e-9: procentele vin din `numeric(6,4)`, deci 0.3333 × 3
    // nu da niciodata exact 1 in aritmetica binara a lui JS.
    if (sum > 1 + 1e-9) {
      problems.push({
        code: 'pct_sum_exceeded',
        periodId,
        found: `${(sum * 100).toFixed(2)}%`,
        expected: '100%',
      });
    }
  }

  // ── Doua alocari active pe aceeasi componenta × luna ──────────────────────
  // Aceeasi regula ca indexul unic partial din migrare. Aici e prinsa inainte de
  // a ajunge la baza, ca omul sa vada ce a introdus de doua ori.
  const seen = new Set<string>();
  for (const allocation of active) {
    const key = `${allocation.componentId}::${allocation.periodId}`;
    if (seen.has(key)) {
      problems.push({
        code: 'duplicate_active',
        periodId: allocation.periodId,
        componentId: allocation.componentId,
        found: '2 alocari active',
        expected: '1 alocare activa',
      });
    }
    seen.add(key);
  }

  // ── Suma, fata de valoarea lucrarii ──────────────────────────────────────
  const total = allocatedTotal(allocations);
  if (expectedTotal !== undefined && !total.equals(expectedTotal)) {
    problems.push({
      code: 'total_mismatch',
      found: total.toDbString(),
      expected: expectedTotal.toDbString(),
    });
  }

  return { valid: problems.length === 0, problems, total, pctByPeriod };
}
