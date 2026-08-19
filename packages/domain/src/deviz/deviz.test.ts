import { Money, Quantity } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import {
  type AdoptableClientLine,
  type DevizLineLike,
  type NormedComponentLike,
  deriveOneToOne,
  explodeNormedArticle,
  rollupDeviz,
  validateMapping,
} from './index';

const m = (value: string): Money => Money.of(value);
const q = (value: string): Quantity => Quantity.of(value);

const line = (
  id: string,
  categoryId: string | null,
  quantity: string,
  unitPrice: string,
  costs: Partial<Record<'material' | 'labor' | 'equipment' | 'transport', string>> = {},
): DevizLineLike => ({
  id,
  categoryId,
  quantity: q(quantity),
  unitPrice: m(unitPrice),
  materialCost: m(costs.material ?? '0'),
  laborCost: m(costs.labor ?? '0'),
  equipmentCost: m(costs.equipment ?? '0'),
  transportCost: m(costs.transport ?? '0'),
});

describe('rollupDeviz', () => {
  it('totalul devizului e suma liniilor, la ban (verificarea #1)', () => {
    const rollup = rollupDeviz({
      lines: [line('l1', 'op1', '340', '55'), line('l2', 'op1', '12.5', '18.40')],
      categories: [
        { id: 'cat1', parentId: null },
        { id: 'op1', parentId: 'cat1' },
      ],
    });

    // 340 x 55 = 18.700 · 12,5 x 18,40 = 230
    expect(rollup.direct.toString()).toBe('18930.00');
    expect(rollup.total.toString()).toBe('18930.00');
  });

  it('categoria aduna operatiunile ei, operatiunea doar liniile ei', () => {
    const rollup = rollupDeviz({
      lines: [
        line('l1', 'op1', '10', '100'),
        line('l2', 'op2', '10', '50'),
        line('l3', 'cat1', '1', '7'),
      ],
      categories: [
        { id: 'cat1', parentId: null },
        { id: 'op1', parentId: 'cat1' },
        { id: 'op2', parentId: 'cat1' },
      ],
    });

    const byId = new Map(rollup.categories.map((c) => [c.categoryId, c]));
    expect(byId.get('op1')?.direct.toString()).toBe('1000.00');
    expect(byId.get('op2')?.direct.toString()).toBe('500.00');
    // 1.000 + 500 din operatiuni, plus 7 pusi direct pe categorie.
    expect(byId.get('cat1')?.direct.toString()).toBe('1507.00');
    expect(byId.get('cat1')?.own.toString()).toBe('7.00');
    expect(rollup.direct.toString()).toBe('1507.00');
  });

  it('indirectele si profitul se compun, in ordinea asta (verificarea #2)', () => {
    const rollup = rollupDeviz({
      lines: [line('l1', null, '1', '100000')],
      categories: [],
      indirectPct: '0.08',
      profitPct: '0.12',
    });

    expect(rollup.indirect.toString()).toBe('8000.00');
    // 12% peste 108.000, nu peste 100.000.
    expect(rollup.profit.toString()).toBe('12960.00');
    expect(rollup.total.toString()).toBe('120960.00');
  });

  it('fara indirecte si profit, totalul e chiar directul — cazul devizului intern', () => {
    const rollup = rollupDeviz({
      lines: [line('l1', null, '2', '0', { material: '30', labor: '20' })],
      categories: [],
    });

    expect(rollup.indirect.isZero()).toBe(true);
    expect(rollup.profit.isZero()).toBe(true);
    expect(rollup.material.toString()).toBe('60.00');
    expect(rollup.labor.toString()).toBe('40.00');
  });

  it('liniile fara categorie intra in total si se numara', () => {
    const rollup = rollupDeviz({
      lines: [line('l1', null, '3', '10'), line('l2', 'op1', '1', '5')],
      categories: [{ id: 'op1', parentId: null }],
    });

    expect(rollup.uncategorizedLineCount).toBe(1);
    expect(rollup.direct.toString()).toBe('35.00');
  });
});

describe('explodeNormedArticle', () => {
  const article = { id: 'a1', code: 'HZ-02', name: 'Hidroizolație bituminoasă', uom: 'mp' };

  const component = (
    id: string,
    kind: NormedComponentLike['kind'],
    quantityPerUom: string,
    position: number,
    normHours: string | null = null,
  ): NormedComponentLike => ({
    id,
    kind,
    productId: kind === 'material' ? 'p1' : null,
    qualificationId: kind === 'manopera' ? 'qq1' : null,
    label: kind,
    uom: kind === 'manopera' ? 'ore' : 'kg',
    quantityPerUom: q(quantityPerUom),
    normHours: normHours === null ? null : q(normHours),
    position,
  });

  it('trei componente dau trei linii, cu cantitatile inmultite (verificarea #12)', () => {
    const lines = explodeNormedArticle(
      article,
      [
        component('c1', 'material', '2.4', 1),
        component('c2', 'manopera', '0.35', 2, '0.35'),
        component('c3', 'utilaj', '0.1', 3),
      ],
      q('20'),
    );

    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.quantity.toString())).toEqual([
      '48.0000',
      '7.0000',
      '2.0000',
    ]);
    expect(lines[1]?.hours?.toString()).toBe('7.0000');
    expect(lines.every((l) => l.normedArticleId === 'a1')).toBe(true);
    expect(lines.every((l) => l.code === 'HZ-02')).toBe(true);
  });

  it('respecta ordinea din articol, nu ordinea din care vin componentele', () => {
    const lines = explodeNormedArticle(
      article,
      [component('c2', 'manopera', '1', 2), component('c1', 'material', '1', 1)],
      q('1'),
    );

    expect(lines.map((l) => l.kind)).toEqual(['material', 'manopera']);
    expect(lines.map((l) => l.position)).toEqual([1, 2]);
  });
});

describe('validateMapping', () => {
  it('raporteaza pozitia client nemapata, fara sa blocheze (verificarea #6)', () => {
    const check = validateMapping(
      ['c1', 'c2'],
      ['i1'],
      [{ clientLineId: 'c1', internLineId: 'i1', coefficient: q('1') }],
    );

    expect(check.uncoveredClientLineIds).toEqual(['c2']);
    expect(check.coefficientProblems).toEqual([]);
    expect(check.isComplete).toBe(false);
  });

  it('accepta o pozitie sparta in trei, cu 0,5 / 0,3 / 0,2 (verificarea #5)', () => {
    const check = validateMapping(
      ['c1'],
      ['i1', 'i2', 'i3'],
      [
        { clientLineId: 'c1', internLineId: 'i1', coefficient: q('0.5') },
        { clientLineId: 'c1', internLineId: 'i2', coefficient: q('0.3') },
        { clientLineId: 'c1', internLineId: 'i3', coefficient: q('0.2') },
      ],
    );

    expect(check.isComplete).toBe(true);
  });

  it('semnaleaza coeficientii care nu insumeaza 1', () => {
    const check = validateMapping(
      ['c1'],
      ['i1', 'i2'],
      [
        { clientLineId: 'c1', internLineId: 'i1', coefficient: q('0.5') },
        { clientLineId: 'c1', internLineId: 'i2', coefficient: q('0.2') },
      ],
    );

    expect(check.coefficientProblems).toHaveLength(1);
    expect(check.coefficientProblems[0]?.sum.toString()).toBe('0.7000');
  });

  it('semnaleaza pozitia interna care nu urca nicaieri', () => {
    const check = validateMapping(
      ['c1'],
      ['i1', 'i2'],
      [{ clientLineId: 'c1', internLineId: 'i1', coefficient: q('1') }],
    );

    expect(check.unmappedInternLineIds).toEqual(['i2']);
  });
});

describe('deriveOneToOne', () => {
  const clientLine = (id: string, position: number): AdoptableClientLine => ({
    id,
    categoryId: 'op1',
    code: null,
    name: `Poziția ${String(position)}`,
    uom: 'mp',
    quantity: q('10'),
    stageId: null,
    position,
  });

  it('doua sprezece pozitii dau douasprezece drafturi cu coeficient 1 (verificarea #4)', () => {
    const drafts = deriveOneToOne(
      Array.from({ length: 12 }, (_unused, index) => clientLine(`c${String(index)}`, index + 1)),
    );

    expect(drafts).toHaveLength(12);
    expect(drafts.every((d) => d.coefficient.equals(q('1')))).toBe(true);
    expect(drafts.map((d) => d.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('renumeroteaza pozitiile compact, dupa ordinea din devizul client', () => {
    const drafts = deriveOneToOne([clientLine('c2', 7), clientLine('c1', 3)]);

    expect(drafts.map((d) => d.clientLineId)).toEqual(['c1', 'c2']);
    expect(drafts.map((d) => d.position)).toEqual([1, 2]);
  });
});
