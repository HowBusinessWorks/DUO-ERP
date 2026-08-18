import { Money } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import { selectBacklogToFill } from './backlog';

describe('selectBacklogToFill', () => {
  // Verificarea #14: umplerea Deltei — cazul exact din mockup-ul §0.
  it('gaseste combinatia care umple exact plafonul, cand exista', () => {
    const proposals = [
      { id: 'a', estimatedValue: Money.of(1800) },
      { id: 'b', estimatedValue: Money.of(2300) },
      { id: 'c', estimatedValue: Money.of(4000) },
    ];
    const result = selectBacklogToFill(proposals, Money.of(4100));
    expect([...result.selectedIds].sort()).toEqual(['a', 'b']);
    expect(result.total.equals(Money.of(4100))).toBe(true);
    expect(result.fillPercent).toBe(100);
  });

  it('nu depaseste niciodata plafonul', () => {
    const proposals = [
      { id: 'a', estimatedValue: Money.of(3000) },
      { id: 'b', estimatedValue: Money.of(3000) },
    ];
    const result = selectBacklogToFill(proposals, Money.of(4000));
    expect(result.total.lte(Money.of(4000))).toBe(true);
  });

  it('plafon zero sau lista goala → nimic selectat', () => {
    expect(selectBacklogToFill([], Money.of(1000)).selectedIds).toEqual([]);
    expect(
      selectBacklogToFill([{ id: 'a', estimatedValue: Money.of(100) }], Money.ZERO).selectedIds,
    ).toEqual([]);
  });
});

describe('selectBacklogToFill — plafoane realiste', () => {
  /*
   * Regresia care a motivat rescrierea: DP-ul pe CENTI aloca ~10 MB de `choice`
   * pentru fiecare propunere la un plafon de 100.000 lei. La cincizeci de
   * propuneri — un backlog obisnuit de contract — insemna ~660 MB si sute de
   * milioane de iteratii, iar ecranul cheama functia la fiecare bifa.
   *
   * Testul nu masoara memoria (n-ar fi stabil in CI): masoara TIMPUL, care e
   * proportional cu acelasi produs capacitate × propuneri. Varianta pe centi nu
   * termina in doua secunde nici pe o masina buna.
   */
  it('un plafon de 100.000 lei cu 50 de propuneri se rezolva instant', () => {
    const proposals = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      estimatedValue: Money.of(1500 + i * 37),
    }));
    const started = Date.now();
    const result = selectBacklogToFill(proposals, Money.of(100000));

    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.exact).toBe(true);
    expect(result.total.lte(Money.of(100000))).toBe(true);
  });

  // Rotunjirea asimetrica: valorile in sus, capacitatea in jos. Doua propuneri
  // de 50,60 lei fac 101,20 — peste plafonul de 101 lei. Selectia trebuie sa
  // ramana sub el, nu sa-l depaseasca cu banuti.
  it('bănuții nu împing selecția peste plafon', () => {
    const proposals = [
      { id: 'a', estimatedValue: Money.of('50.60') },
      { id: 'b', estimatedValue: Money.of('50.60') },
    ];
    const result = selectBacklogToFill(proposals, Money.of('101.00'));
    expect(result.total.lte(Money.of('101.00'))).toBe(true);
  });

  it('peste bugetul de celule trece pe euristica, nu cade', () => {
    const proposals = Array.from({ length: 60 }, (_, i) => ({
      id: `p${i}`,
      estimatedValue: Money.of(100000 + i),
    }));
    const result = selectBacklogToFill(proposals, Money.of(5000000));

    expect(result.exact).toBe(false);
    expect(result.total.lte(Money.of(5000000))).toBe(true);
    expect(result.selectedIds.length).toBeGreaterThan(0);
  });
});
