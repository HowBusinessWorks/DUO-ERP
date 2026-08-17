import { describe, expect, it } from 'vitest';
import { physicalProgress, stageScheduleIsCoherent, type StageLike } from './stages';

function stage(overrides: Partial<StageLike> = {}): StageLike {
  return {
    position: 1,
    plannedStart: '2026-08-01',
    plannedEnd: '2026-08-10',
    actualStart: null,
    actualEnd: null,
    pctOfWork: null,
    ...overrides,
  };
}

describe('stageScheduleIsCoherent', () => {
  it('trei etape consecutive, cu intervale valide: coerent', () => {
    const check = stageScheduleIsCoherent([
      stage({ position: 1 }),
      stage({ position: 2, plannedStart: '2026-08-11', plannedEnd: '2026-08-20' }),
      stage({ position: 3, plannedStart: '2026-08-21', plannedEnd: '2026-08-31' }),
    ]);

    expect(check.coherent).toBe(true);
  });

  it('etapele au voie sa se suprapuna in timp', () => {
    const check = stageScheduleIsCoherent([
      stage({ position: 1, plannedStart: '2026-08-01', plannedEnd: '2026-08-20' }),
      stage({ position: 2, plannedStart: '2026-08-10', plannedEnd: '2026-08-25' }),
    ]);

    expect(check.coherent).toBe(true);
  });

  it('pozitie duplicata: problema', () => {
    const check = stageScheduleIsCoherent([stage({ position: 1 }), stage({ position: 1 })]);

    expect(check.coherent).toBe(false);
    expect(check.problems.map((p) => p.code)).toContain('position_duplicate');
  });

  it('gol in pozitii (1, 2, 4): problema', () => {
    const check = stageScheduleIsCoherent([
      stage({ position: 1 }),
      stage({ position: 2 }),
      stage({ position: 4 }),
    ]);

    expect(check.coherent).toBe(false);
    expect(check.problems.map((p) => p.code)).toContain('position_gap');
  });

  // Verificarea #10 a pasului, in oglinda cu `check`-ul din baza.
  it('interval planificat inversat: problema, cu pozitia in mesaj', () => {
    const check = stageScheduleIsCoherent([
      stage({ position: 1, plannedStart: '2026-08-20', plannedEnd: '2026-08-10' }),
    ]);

    expect(check.coherent).toBe(false);
    const problem = check.problems.find((p) => p.code === 'planned_range_inverted');
    expect(problem?.position).toBe(1);
  });

  it('interval realizat inversat: problema', () => {
    const check = stageScheduleIsCoherent([
      stage({ actualStart: '2026-09-05', actualEnd: '2026-09-01' }),
    ]);

    expect(check.problems.map((p) => p.code)).toContain('actual_range_inverted');
  });

  it('interval pe jumatate completat: nu e o problema', () => {
    const check = stageScheduleIsCoherent([
      stage({ plannedEnd: null, actualStart: '2026-08-02', actualEnd: null }),
    ]);

    expect(check.coherent).toBe(true);
  });

  it('procentele etapelor peste 100%: problema', () => {
    const check = stageScheduleIsCoherent([
      stage({ position: 1, pctOfWork: 0.7 }),
      stage({ position: 2, pctOfWork: 0.5 }),
    ]);

    expect(check.coherent).toBe(false);
    const problem = check.problems.find((p) => p.code === 'pct_sum_exceeded');
    expect(problem?.detail).toContain('120.00%');
  });

  it('procente care insumeaza sub 100%: valid — lucrarea poate fi in curs de planificare', () => {
    const check = stageScheduleIsCoherent([
      stage({ position: 1, pctOfWork: 0.3 }),
      stage({ position: 2, pctOfWork: 0.2 }),
    ]);

    expect(check.coherent).toBe(true);
  });

  it('nicio etapa: coerent', () => {
    expect(stageScheduleIsCoherent([]).coherent).toBe(true);
  });
});

describe('physicalProgress', () => {
  it('fara ponderi: se numara etapele terminate', () => {
    const progress = physicalProgress([
      stage({ position: 1, actualEnd: '2026-08-10' }),
      stage({ position: 2, actualEnd: '2026-08-20' }),
      stage({ position: 3 }),
      stage({ position: 4 }),
    ]);

    expect(progress.percent).toBe(50);
    expect(progress.completedStages).toBe(2);
    expect(progress.totalStages).toBe(4);
    // Ecranul trebuie sa poata spune ca procentul vine dintr-o presupunere.
    expect(progress.weighted).toBe(false);
  });

  it('cu ponderi scrise: conteaza greutatea, nu numarul', () => {
    const progress = physicalProgress([
      stage({ position: 1, pctOfWork: 0.7, actualEnd: '2026-08-10' }),
      stage({ position: 2, pctOfWork: 0.2 }),
      stage({ position: 3, pctOfWork: 0.1 }),
    ]);

    expect(progress.percent).toBeCloseTo(70);
    expect(progress.completedStages).toBe(1);
    expect(progress.weighted).toBe(true);
  });

  it('ponderi puse doar pe unele etape: se cade pe numarare', () => {
    // Un amestec de ponderi si goluri ar da un procent care nu inseamna nimic.
    const progress = physicalProgress([
      stage({ position: 1, pctOfWork: 0.9, actualEnd: '2026-08-10' }),
      stage({ position: 2, pctOfWork: null }),
    ]);

    expect(progress.weighted).toBe(false);
    expect(progress.percent).toBe(50);
  });

  it('o etapa e terminata doar cu `actual_end`, nu cu `actual_start`', () => {
    const progress = physicalProgress([stage({ actualStart: '2026-08-01', actualEnd: null })]);

    expect(progress.percent).toBe(0);
    expect(progress.completedStages).toBe(0);
  });

  it('nicio etapa: zero la suta, nu impartire la zero', () => {
    const progress = physicalProgress([]);

    expect(progress.percent).toBe(0);
    expect(progress.totalStages).toBe(0);
  });
});
