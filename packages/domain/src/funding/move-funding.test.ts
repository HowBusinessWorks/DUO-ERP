import { AppError, Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { describeFundingMove, planFundingMove, type MoveFundingInput } from './move-funding';

/**
 * Verificarea #18 a pasului: toate cazurile din §13 si §13.1, fara sa atinga
 * Postgres. Ramura de luna deschisa, ramura de luna inchisa, si cele trei feluri
 * in care mutarea trebuie refuzata.
 */

const MENTENANTA = {
  contractId: 'c-4700',
  componentId: 'comp-mentenanta',
  periodId: 'per-2026-08',
};

const DELTA = { contractId: 'c-4700', componentId: 'comp-delta', periodId: 'per-2026-08' };

function input(overrides: Partial<MoveFundingInput> = {}): MoveFundingInput {
  return {
    workUnitId: 'wu-1841',
    from: MENTENANTA,
    to: DELTA,
    fromPeriodStatus: 'open',
    currentPeriodId: 'per-2026-09',
    amount: Money.of(800),
    costLineIds: ['cl-1', 'cl-2'],
    reason: 'Depaseste pragul de 2.000 lei, trece pe Delta.',
    ...overrides,
  };
}

describe('planFundingMove', () => {
  it('luna deschisa: rescrie analitica „descarcat" pe liniile existente', () => {
    const plan = planFundingMove(input({ fromPeriodStatus: 'open' }));

    expect(plan.kind).toBe('rewrite-charged-analytics');
    if (plan.kind !== 'rewrite-charged-analytics') throw new Error('ramura gresita');

    expect(plan.target).toEqual(DELTA);
    // Costurile deja inregistrate urmeaza unitatea de lucru (§13.1).
    expect(plan.costLineIds).toEqual(['cl-1', 'cl-2']);
    expect(plan.amount.toDbString()).toBe('800.00');
  });

  it('luna inchisa: emite document de re-alocare in luna CURENTA', () => {
    const plan = planFundingMove(input({ fromPeriodStatus: 'closed' }));

    expect(plan.kind).toBe('reallocation-document');
    if (plan.kind !== 'reallocation-document') throw new Error('ramura gresita');

    // Nu in august, luna din care se muta — in septembrie, luna curenta.
    expect(plan.periodId).toBe('per-2026-09');
    expect(plan.from).toEqual(MENTENANTA);
    expect(plan.to).toEqual(DELTA);
  });

  it('documentul are AMBELE miscari, cu semne opuse si aceeasi valoare', () => {
    const plan = planFundingMove(input({ fromPeriodStatus: 'closed' }));
    if (plan.kind !== 'reallocation-document') throw new Error('ramura gresita');

    expect(plan.entries).toHaveLength(2);

    const [reversal, reapply] = plan.entries;
    if (reversal === undefined || reapply === undefined) throw new Error('lipsesc miscarile');

    expect(reversal.direction).toBe('reversal');
    expect(reversal.componentId).toBe('comp-mentenanta');
    // Miscarea atinge componenta lunii VECHI, dar se inregistreaza in cea curenta.
    expect(reversal.componentPeriodId).toBe('per-2026-08');
    expect(reversal.recordedInPeriodId).toBe('per-2026-09');
    expect(reversal.amount.toDbString()).toBe('-800.00');

    expect(reapply.direction).toBe('reapply');
    expect(reapply.componentId).toBe('comp-delta');
    expect(reapply.recordedInPeriodId).toBe('per-2026-09');
    expect(reapply.amount.toDbString()).toBe('800.00');

    // Suma celor doua e zero: documentul muta bani, nu creeaza.
    expect(reversal.amount.add(reapply.amount).isZero()).toBe(true);
  });

  it('`closing` se trateaza ca luna inchisa', () => {
    const plan = planFundingMove(input({ fromPeriodStatus: 'closing' }));
    expect(plan.kind).toBe('reallocation-document');
  });

  // Verificarea #7 a pasului.
  it('fara motiv scris: refuzat, cu VALIDATION_FAILED', () => {
    const error = (() => {
      try {
        planFundingMove(input({ reason: '   ' }));
        return null;
      } catch (e) {
        return e;
      }
    })();

    expect(AppError.is(error)).toBe(true);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect((error as AppError).message).toContain('motiv');
  });

  it('aceeasi componenta si aceeasi luna: nu e nimic de mutat', () => {
    expect(() => planFundingMove(input({ to: MENTENANTA }))).toThrow(AppError);
  });

  it('suma negativa: refuzata pe ambele ramuri', () => {
    expect(() => planFundingMove(input({ amount: Money.of(-1) }))).toThrow(AppError);
    expect(() =>
      planFundingMove(input({ amount: Money.of(-1), fromPeriodStatus: 'closed' })),
    ).toThrow(AppError);
  });

  it('mutarea pe alt contract, in aceeasi componenta si luna, e permisa', () => {
    const plan = planFundingMove(
      input({ to: { contractId: 'c-individual', componentId: 'comp-mentenanta', periodId: 'per-2026-08' } }),
    );
    expect(plan.kind).toBe('rewrite-charged-analytics');
  });

  it('zero lei mutati e o mutare valida: se muta apartenenta, nu banii', () => {
    // O UL fara costuri inregistrate isi poate schimba finantarea. Refuzul pe
    // suma zero ar face imposibila re-rutarea unei lucrari inainte de start.
    const plan = planFundingMove(input({ amount: Money.ZERO, costLineIds: [] }));
    expect(plan.kind).toBe('rewrite-charged-analytics');
  });
});

describe('describeFundingMove', () => {
  it('spune ecranului aceeasi mecanica pe care o va executa tranzactia', () => {
    for (const status of ['open', 'closing', 'closed'] as const) {
      const announced = describeFundingMove(status);
      const executed = planFundingMove(input({ fromPeriodStatus: status }));
      expect(announced.kind).toBe(executed.kind);
    }
  });

  it('luna deschisa nu e marcata ca inchisa, si invers', () => {
    expect(describeFundingMove('open').periodIsClosed).toBe(false);
    expect(describeFundingMove('closed').periodIsClosed).toBe(true);
    expect(describeFundingMove('closing').periodIsClosed).toBe(true);
  });
});
