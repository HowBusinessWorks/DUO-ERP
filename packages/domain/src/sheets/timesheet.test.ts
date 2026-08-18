import { Money, Quantity } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { rateCardAt, timesheetTotals, type RateCardLike } from './timesheet';

const cards: RateCardLike[] = [
  {
    id: 'vechi',
    qualificationId: 'inst',
    validFrom: '2025-01-01',
    validTo: '2026-04-01',
    hourlyCost: Money.of('42.00'),
  },
  {
    id: 'curent',
    qualificationId: 'inst',
    validFrom: '2026-04-01',
    validTo: null,
    hourlyCost: Money.of('51.75'),
  },
  {
    id: 'alta-calificare',
    qualificationId: 'elec',
    validFrom: '2025-01-01',
    validTo: null,
    hourlyCost: Money.of('60.00'),
  },
];

describe('rateCardAt', () => {
  it('aplica tariful valabil la data pontajului, nu pe cel curent (#14)', () => {
    expect(rateCardAt(cards, 'inst', '2026-03-15')?.id).toBe('vechi');
    expect(rateCardAt(cards, 'inst', '2026-08-15')?.id).toBe('curent');
  });

  it('trateaza intervalul ca [validFrom, validTo) — ziua de schimbare e a celui nou', () => {
    expect(rateCardAt(cards, 'inst', '2026-04-01')?.id).toBe('curent');
    expect(rateCardAt(cards, 'inst', '2026-03-31')?.id).toBe('vechi');
  });

  it('nu amesteca calificarile', () => {
    expect(rateCardAt(cards, 'elec', '2026-08-15')?.id).toBe('alta-calificare');
  });

  it('intoarce null cand nu exista tarif — apelantul decide ce inseamna', () => {
    expect(rateCardAt(cards, 'inst', '2024-06-01')).toBeNull();
    expect(rateCardAt(cards, 'necunoscuta', '2026-08-15')).toBeNull();
  });
});

describe('timesheetTotals', () => {
  it('imparte ziua pe mai multe unitati de lucru (#13): 4+2+2', () => {
    const totals = timesheetTotals([
      { workUnitId: 'a', hours: Quantity.of('4') },
      { workUnitId: 'b', hours: Quantity.of('2') },
      { workUnitId: 'c', hours: Quantity.of('2') },
    ]);

    expect(totals.total.toDbString()).toBe('8.0000');
    expect(totals.byWorkUnit.size).toBe(3);
    expect(totals.withinDay).toBe(true);
  });

  it('aduna doua linii pe aceeasi unitate', () => {
    const totals = timesheetTotals([
      { workUnitId: 'a', hours: Quantity.of('3') },
      { workUnitId: 'a', hours: Quantity.of('1.5') },
    ]);

    expect(totals.byWorkUnit.get('a')?.toDbString()).toBe('4.5000');
  });

  it('respinge o zi de 26 de ore (#12)', () => {
    const totals = timesheetTotals([
      { workUnitId: 'a', hours: Quantity.of('13') },
      { workUnitId: 'b', hours: Quantity.of('13') },
    ]);

    expect(totals.withinDay).toBe(false);
  });

  it('respinge si o zi goala — zero ore pontate nu e un pontaj', () => {
    expect(timesheetTotals([]).withinDay).toBe(false);
  });
});
