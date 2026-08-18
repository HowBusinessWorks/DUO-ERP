import { Money } from '@damina/shared';

/**
 * Evaluarea unei cereri din catalogul de operatiuni (§3.5, tab Evaluare).
 *
 * `estimatedLabor`/`estimatedMaterial` de pe fiecare operatiune sunt deja
 * derivate din tariful curent la CRUD-ul catalogului (comentariul din schema);
 * aici doar se inmultesc cu cantitatea si se aduna — fara sa se atinga baza.
 */

export interface EstimateLineInput {
  readonly quantity: number;
  readonly operation: {
    readonly estimatedLabor: Money;
    readonly estimatedMaterial: Money;
  };
}

export interface EstimateResult {
  readonly labor: Money;
  readonly material: Money;
  readonly total: Money;
}

export function estimateFromCatalog(lines: readonly EstimateLineInput[]): EstimateResult {
  const labor = Money.sum(lines.map((l) => l.operation.estimatedLabor.mul(l.quantity)));
  const material = Money.sum(lines.map((l) => l.operation.estimatedMaterial.mul(l.quantity)));
  return { labor, material, total: labor.add(material) };
}
