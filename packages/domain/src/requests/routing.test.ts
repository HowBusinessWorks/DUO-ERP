import { Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { routeRequest, type RoutingCeilings } from './routing';

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
