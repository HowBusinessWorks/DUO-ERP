import { Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { aggregateDeltaFill, consumptionRisk } from './pm-panel';

const lei = (text: string) => Money.fromDb(text);

describe('aggregateDeltaFill', () => {
  it('insumeaza pe lei, nu pe procente', () => {
    // 90% dintr-o Delta mica si 10% dintr-una mare nu fac 50%.
    const fill = aggregateDeltaFill(
      [
        { revenueCeiling: lei('10000.00'), allocatedRevenue: lei('9000.00') },
        { revenueCeiling: lei('90000.00'), allocatedRevenue: lei('9000.00') },
      ],
      '2026-08-14',
    );

    expect(Math.round(fill.fillPercent)).toBe(18);
    expect(fill.unfilled.toDbString()).toBe('82000.00');
  });

  it('ignora componentele fara plafon setat', () => {
    const fill = aggregateDeltaFill(
      [
        { revenueCeiling: lei('12000.00'), allocatedRevenue: lei('8040.00') },
        { revenueCeiling: null, allocatedRevenue: lei('500.00') },
      ],
      '2026-08-14',
    );

    expect(fill.revenueCeiling?.toDbString()).toBe('12000.00');
    expect(Math.round(fill.fillPercent)).toBe(67);
    expect(fill.unfilled.toDbString()).toBe('3960.00');
    // Verificarea #27 spune "17 zile" pe 14 august; `deltaFill` numara ziua
    // curenta inclusiv (pe 31 mai e o zi de lucrat), deci 18. Regula de numarare
    // e cea din domeniu, scrisa la 04 — nu se schimba dintr-un panou.
    expect(fill.daysLeft).toBe(18);
  });

  it('fara niciun plafon setat, starea e `nesetat`', () => {
    const fill = aggregateDeltaFill(
      [{ revenueCeiling: null, allocatedRevenue: Money.ZERO }],
      '2026-08-14',
    );
    expect(fill.state).toBe('nesetat');
  });
});

describe('consumptionRisk', () => {
  it('consum peste progres intra in lista', () => {
    const risk = consumptionRisk(68, 62);
    expect(risk.atRisk).toBe(true);
    expect(risk.severity).toBe('atentie');
    expect(risk.gap).toBe(6);
  });

  it('decalaj mare e critic', () => {
    expect(consumptionRisk(80, 40).severity).toBe('critic');
  });

  it('progres peste consum nu e risc', () => {
    expect(consumptionRisk(30, 55).atRisk).toBe(false);
  });
});
