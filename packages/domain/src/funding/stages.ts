/**
 * Etapele unei lucrari: coerenta graficului si progresul fizic.
 *
 * Coerenta temporala se impune in MODEL, nu prin instruire (regula 7 din pas):
 * `check`-urile din migrare tin fiecare etapa in parte, iar functiile de aici tin
 * SETUL — pozitii fara goluri, procente care nu depasesc lucrarea. Cele doua
 * straturi nu se suprapun: unul nu poate vedea decat un rand, celalalt toate.
 */

export interface StageLike {
  readonly position: number;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  /** Fractie, nu procent: 0.25 = 25% din lucrare. */
  readonly pctOfWork: number | null;
}

export type StageProblemCode =
  | 'position_duplicate'
  | 'position_gap'
  | 'planned_range_inverted'
  | 'actual_range_inverted'
  | 'pct_sum_exceeded';

export interface StageProblem {
  readonly code: StageProblemCode;
  readonly position?: number;
  readonly detail: string;
}

export interface StageScheduleCheck {
  readonly coherent: boolean;
  readonly problems: readonly StageProblem[];
}

/**
 * Ce NU se verifica aici, dinadins: etapele **au voie sa se suprapuna in timp**.
 * Pe un santier zugravitul incepe intr-o camera in timp ce instalatiile se
 * termina in alta, iar un grafic care ar refuza suprapunerea ar fi minciuna
 * comoda a softului, nu ordine.
 */
export function stageScheduleIsCoherent(stages: readonly StageLike[]): StageScheduleCheck {
  const problems: StageProblem[] = [];

  // ── Pozitiile: 1..n, fara goluri, fara duplicate ──────────────────────────
  // Goluri conteaza pentru ca reordonarea din ecran rescrie pozitiile: un gol
  // inseamna ca o etapa a fost stearsa fara renumerotare, si urmatoarea mutare
  // ar suprapune doua etape pe acelasi loc.
  const positions = stages.map((s) => s.position);
  const seen = new Set<number>();
  for (const position of positions) {
    if (seen.has(position)) {
      problems.push({
        code: 'position_duplicate',
        position,
        detail: `pozitia ${position} apare de mai multe ori`,
      });
    }
    seen.add(position);
  }

  const sorted = [...seen].sort((a, b) => a - b);
  sorted.forEach((position, index) => {
    if (position !== index + 1) {
      problems.push({
        code: 'position_gap',
        position,
        detail: `pozitiile trebuie sa fie 1..${sorted.length}, iar ${position} sta pe locul ${index + 1}`,
      });
    }
  });

  // ── Intervalele fiecarei etape ────────────────────────────────────────────
  for (const stage of stages) {
    if (
      stage.plannedStart !== null &&
      stage.plannedEnd !== null &&
      stage.plannedEnd < stage.plannedStart
    ) {
      problems.push({
        code: 'planned_range_inverted',
        position: stage.position,
        detail: `planificat ${stage.plannedStart} → ${stage.plannedEnd}`,
      });
    }

    if (
      stage.actualStart !== null &&
      stage.actualEnd !== null &&
      stage.actualEnd < stage.actualStart
    ) {
      problems.push({
        code: 'actual_range_inverted',
        position: stage.position,
        detail: `realizat ${stage.actualStart} → ${stage.actualEnd}`,
      });
    }
  }

  // ── Procentele, insumate ──────────────────────────────────────────────────
  const pctSum = stages.reduce((acc, s) => acc + (s.pctOfWork ?? 0), 0);
  if (pctSum > 1 + 1e-9) {
    problems.push({
      code: 'pct_sum_exceeded',
      detail: `etapele insumeaza ${(pctSum * 100).toFixed(2)}% din lucrare`,
    });
  }

  return { coherent: problems.length === 0, problems };
}

export interface PhysicalProgress {
  /** 0-100. Cat s-a executat fizic, dupa etapele terminate. */
  readonly percent: number;
  readonly completedStages: number;
  readonly totalStages: number;
  /**
   * Ponderile sunt scrise pe etape (`pct_of_work`) sau presupuse egale.
   *
   * Ecranul trebuie sa poata spune care din cele doua, pentru ca „50% executat"
   * dintr-o presupunere si „50% executat" din ponderi scrise de PM nu sunt
   * aceeasi afirmatie, chiar daca arata identic.
   */
  readonly weighted: boolean;
}

/**
 * Progresul FIZIC, din etape. Jumatatea de sus a celor doua bare din Prezentare
 * (§3.4); cealalta jumatate — consumul financiar — vine din registrul de cost, in
 * pasul 06.
 *
 * Divergenta dintre ele e semnalul de risc, si de aceea nu se calculeaza
 * niciodata una din cealalta: doua numere care se deduc unul din altul nu pot
 * divergea, deci n-ar mai semnala nimic.
 *
 * O etapa se numara terminata cand are `actual_end`. Nu exista „pe jumatate":
 * procentul unei etape in lucru ar fi o estimare, iar estimarile n-au ce sa caute
 * intr-o bara pusa langa consumul real.
 */
export function physicalProgress(stages: readonly StageLike[]): PhysicalProgress {
  const totalStages = stages.length;
  if (totalStages === 0) {
    return { percent: 0, completedStages: 0, totalStages: 0, weighted: false };
  }

  const completed = stages.filter((s) => s.actualEnd !== null);
  const weighted = stages.every((s) => s.pctOfWork !== null);

  const percent = weighted
    ? completed.reduce((acc, s) => acc + (s.pctOfWork ?? 0), 0) * 100
    : (completed.length / totalStages) * 100;

  return {
    percent,
    completedStages: completed.length,
    totalStages,
    weighted,
  };
}
