import { describe, expect, it } from 'vitest';
import {
  canPromote,
  PROMOTION_ADDS,
  PROMOTION_PRESERVES,
  type WorkUnitStatus,
} from './promotion';

describe('canPromote', () => {
  it('interventie in lucru: se poate promova', () => {
    const check = canPromote({ type: 'interventie', status: 'in_executie' });

    expect(check.allowed).toBe(true);
    expect(check.blockers).toEqual([]);
  });

  it('spune ce se pastreaza si ce se adauga — ecranul nu inventeaza listele', () => {
    const check = canPromote({ type: 'interventie', status: 'draft' });

    // Regula de aur 2: nimic nu se copiaza, nimic nu se muta.
    expect(check.preserves).toEqual([...PROMOTION_PRESERVES]);
    expect(check.preserves).toContain('id');
    expect(check.preserves).toContain('photos');
    expect(check.preserves).toContain('hours');

    expect(check.adds).toEqual([...PROMOTION_ADDS]);
    expect(check.adds).toEqual(['deviz', 'stages']);
  });

  it('o lucrare nu se mai promoveaza', () => {
    const check = canPromote({ type: 'lucrare', status: 'in_executie' });

    expect(check.allowed).toBe(false);
    expect(check.blockers).toEqual(['already_lucrare']);
  });

  it('o inspectie nu devine lucrare: ea produce o constatare', () => {
    const check = canPromote({ type: 'inspectie', status: 'in_executie' });

    expect(check.allowed).toBe(false);
    expect(check.blockers).toEqual(['not_promotable_type']);
  });

  it.each<WorkUnitStatus>(['finalizata', 'inchisa', 'anulata'])(
    'starea %s blocheaza promovarea',
    (status) => {
      const check = canPromote({ type: 'interventie', status });

      expect(check.allowed).toBe(false);
      expect(check.blockers).toContain('status_final');
    },
  );

  it.each<WorkUnitStatus>(['draft', 'planificata', 'in_executie', 'suspendata'])(
    'starea %s permite promovarea',
    (status) => {
      expect(canPromote({ type: 'interventie', status }).allowed).toBe(true);
    },
  );

  it('doua motive deodata se raporteaza amandoua', () => {
    const check = canPromote({ type: 'lucrare', status: 'inchisa' });

    expect(check.blockers).toEqual(['already_lucrare', 'status_final']);
  });
});
