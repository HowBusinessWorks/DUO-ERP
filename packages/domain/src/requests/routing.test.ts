import { Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { routeRequest, splitDeltaAcrossPeriods, type RoutingCeilings } from './routing';

const noLucrari: RoutingCeilings['lucrariCeilingFree'] = null;

function ceilings(overrides: Partial<RoutingCeilings> = {}): RoutingCeilings {
  return {
    deltaFreeByPeriod: [{ periodId: '2026-08', free: Money.of(4100) }],
    lucrariCeilingFree: noLucrari,
    isCommercialOpportunity: false,
    ...overrides,
  };
}

describe('routeRequest', () => {
  // Verificarea #6: sub prag → Mentenanta.
  it('propune Mentenanta sub pragul de 2.000 lei', () => {
    const result = routeRequest({ value: Money.of(1500), ceilings: ceilings() });
    expect(result.proposal).toBe('interventie_mentenanta');
    const option = result.options.find((o) => o.choice === 'interventie_mentenanta');
    expect(option?.available).toBe(true);
  });

  // Verificarea #7: peste prag, incape intr-o luna → Delta, cu procentul de umplere.
  it('propune Delta o luna cand incape, cu umplerea corecta', () => {
    const result = routeRequest({
      value: Money.of(3400),
      ceilings: ceilings({ deltaFreeByPeriod: [{ periodId: '2026-08', free: Money.of(4100) }] }),
    });
    expect(result.proposal).toBe('lucrare_delta');
    const option = result.options.find((o) => o.choice === 'lucrare_delta');
    expect(option?.available).toBe(true);
    expect(option?.fillPercent).toBeCloseTo(82.93, 1);
  });

  // Verificarea #8: 12.000 lei, Delta liber 4.100 → split pe 2-3 luni sau
  // componenta Lucrari; "Delta o luna" marcata explicit indisponibila.
  it('propune split sau componenta Lucrari cand nu incape intr-o luna, si marcheaza optiunea de-o-luna indisponibila', () => {
    const result = routeRequest({
      value: Money.of(12000),
      ceilings: ceilings({
        deltaFreeByPeriod: [
          { periodId: '2026-08', free: Money.of(4100) },
          { periodId: '2026-09', free: Money.of(4100) },
          { periodId: '2026-10', free: Money.of(4100) },
        ],
      }),
    });
    const oneMonth = result.options.find((o) => o.choice === 'lucrare_delta');
    expect(oneMonth?.available).toBe(false);
    expect(oneMonth?.reason).toMatch(/^✗/);

    const multi = result.options.find((o) => o.choice === 'lucrare_delta_multi_luna');
    expect(multi?.available).toBe(true);
    expect(multi?.targetPeriods).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(result.proposal).toBe('lucrare_delta_multi_luna');
  });

  it('prefera componenta Lucrari fata de split cand operatiunea e prevazuta in contract', () => {
    const result = routeRequest({
      value: Money.of(12000),
      ceilings: ceilings({
        deltaFreeByPeriod: [
          { periodId: '2026-08', free: Money.of(4100) },
          { periodId: '2026-09', free: Money.of(4100) },
          { periodId: '2026-10', free: Money.of(4100) },
        ],
        lucrariCeilingFree: Money.of(20000),
      }),
    });
    expect(result.proposal).toBe('lucrare_componenta_lucrari');
  });

  it('propune contract individual nou pentru o oportunitate care nu incape nicaieri', () => {
    const result = routeRequest({
      value: Money.of(50000),
      ceilings: ceilings({ isCommercialOpportunity: true }),
    });
    expect(result.proposal).toBe('contract_individual_nou');
  });

  it('cade in backlog cand nimic altceva nu se potriveste', () => {
    const result = routeRequest({
      value: Money.of(50000),
      ceilings: ceilings(),
    });
    expect(result.proposal).toBe('amanata_backlog');
    expect(result.options.find((o) => o.choice === 'amanata_backlog')?.available).toBe(true);
  });

  it('foloseste un prag custom cand e dat', () => {
    const result = routeRequest({
      value: Money.of(2500),
      ceilings: ceilings(),
      threshold: Money.of(3000),
    });
    expect(result.proposal).toBe('interventie_mentenanta');
  });

  it('nu are nicio luna de Delta deschisa → optiunile de Delta sunt indisponibile', () => {
    const result = routeRequest({
      value: Money.of(3000),
      ceilings: ceilings({ deltaFreeByPeriod: [] }),
    });
    expect(result.options.find((o) => o.choice === 'lucrare_delta')?.available).toBe(false);
    expect(result.options.find((o) => o.choice === 'lucrare_delta_multi_luna')?.available).toBe(
      false,
    );
  });
});

describe('splitDeltaAcrossPeriods', () => {
  // Verificarea #12: „3 alocari, sumele corecte". Cifrele de aici sunt sursa de
  // adevar a ecranului de decizie — daca ecranul si-ar calcula singur feliile,
  // ar exista doua adevaruri despre aceleasi alocari.
  it('umple fiecare luna pana la liberul ei, in ordine', () => {
    const parts = splitDeltaAcrossPeriods(Money.of(10000), [
      { periodId: '2026-08', free: Money.of(4000) },
      { periodId: '2026-09', free: Money.of(4000) },
      { periodId: '2026-10', free: Money.of(5000) },
    ]);

    expect(parts.map((p) => p.amount.toString())).toEqual(['4000.00', '4000.00', '2000.00']);
    expect(Money.sum(parts.map((p) => p.amount)).equals(Money.of(10000))).toBe(true);
  });

  it('nu pierde niciun ban la rotunjire', () => {
    const parts = splitDeltaAcrossPeriods(Money.of('1000.01'), [
      { periodId: 'a', free: Money.of('333.33') },
      { periodId: 'b', free: Money.of('333.33') },
      { periodId: 'c', free: Money.of('333.33') },
    ]);
    expect(Money.sum(parts.map((p) => p.amount)).toString()).toBe('1000.01');
  });

  it('valoarea peste suma liberelor cade toata pe ultima luna', () => {
    const parts = splitDeltaAcrossPeriods(Money.of(9000), [
      { periodId: 'a', free: Money.of(1000) },
      { periodId: 'b', free: Money.of(1000) },
    ]);
    expect(parts.map((p) => p.amount.toString())).toEqual(['1000.00', '8000.00']);
  });

  it('o luna cu liber zero nu primeste nimic', () => {
    const parts = splitDeltaAcrossPeriods(Money.of(500), [
      { periodId: 'a', free: Money.ZERO },
      { periodId: 'b', free: Money.of(900) },
    ]);
    expect(parts.map((p) => p.amount.toString())).toEqual(['0.00', '500.00']);
  });

  it('fara luni nu intoarce nimic', () => {
    expect(splitDeltaAcrossPeriods(Money.of(100), [])).toEqual([]);
  });
});

describe('routeRequest — impartirea pe luni', () => {
  it('optiunea de Delta disponibila poarta si feliile pe luni', () => {
    const result = routeRequest({
      value: Money.of(6000),
      ceilings: ceilings({
        deltaFreeByPeriod: [
          { periodId: '2026-08', free: Money.of(4000) },
          { periodId: '2026-09', free: Money.of(4000) },
        ],
      }),
    });

    const multi = result.options.find((o) => o.choice === 'lucrare_delta_multi_luna');
    expect(multi?.available).toBe(true);
    expect(multi?.split?.map((p) => p.amount.toString())).toEqual(['4000.00', '2000.00']);
  });
});
