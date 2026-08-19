/**
 * Promovarea unei interventii in lucrare (§6, regula de aur 2).
 *
 * **Promovarea nu creeaza un obiect nou.** Cand o interventie se dovedeste mai
 * mare decat parea, ID-ul se pastreaza: nu se copiaza pozele, nu se re-introduc
 * orele, nu se muta folderul. Se ADAUGA structura de lucrare — deviz si etape.
 *
 * Functia de aici nu promoveaza nimic; spune daca se poate si, mai important,
 * **ce se pastreaza si ce se adauga**. Ecranul de confirmare are obligatia sa
 * arate exact asta (§3.4), iar listele vin de aici tocmai ca sa nu le inventeze
 * fiecare ecran pe cont propriu.
 */

export type WorkUnitType = 'inspectie' | 'interventie' | 'lucrare';

export type WorkUnitStatus =
  'draft' | 'planificata' | 'in_executie' | 'suspendata' | 'finalizata' | 'inchisa' | 'anulata';

export interface PromotableWorkUnit {
  readonly type: WorkUnitType;
  readonly status: WorkUnitStatus;
}

export type PromotionBlockerCode = 'already_lucrare' | 'not_promotable_type' | 'status_final';

/** Ce NU se atinge la promovare. Chei stabile; ecranul le traduce. */
export const PROMOTION_PRESERVES = [
  'id',
  'code',
  'objective',
  'photos',
  'hours',
  'materials',
  'documents',
] as const;

/** Ce se adauga. Restul tab-urilor lucrarii se umplu in pasii 06-10. */
export const PROMOTION_ADDS = ['deviz', 'stages'] as const;

export interface PromotionCheck {
  readonly allowed: boolean;
  readonly blockers: readonly PromotionBlockerCode[];
  readonly preserves: readonly (typeof PROMOTION_PRESERVES)[number][];
  readonly adds: readonly (typeof PROMOTION_ADDS)[number][];
}

/**
 * Stari din care nu se mai promoveaza nimic. O lucrare inchisa are luna
 * raportata in spate; una anulata n-are ce sa devina.
 *
 * `finalizata` e inclusa dinadins: lucrul s-a terminat, deci intrebarea „e mai
 * mare decat parea" nu se mai pune — daca totusi e, se deschide o UL noua legata
 * prin `promoted_from_id`, care exista exact pentru cazul de scindare.
 */
const FINAL_STATUSES: readonly WorkUnitStatus[] = ['finalizata', 'inchisa', 'anulata'];

export function canPromote(workUnit: PromotableWorkUnit): PromotionCheck {
  const blockers: PromotionBlockerCode[] = [];

  if (workUnit.type === 'lucrare') {
    blockers.push('already_lucrare');
  } else if (workUnit.type !== 'interventie') {
    // O inspectie nu devine lucrare: ea PRODUCE o constatare, iar constatarea
    // intra in palnia de cereri (pasul 08). Altfel fisa de inspectie ar deveni
    // dintr-o data purtatoare de deviz si etape, si n-ar mai fi o fisa.
    blockers.push('not_promotable_type');
  }

  if (FINAL_STATUSES.includes(workUnit.status)) {
    blockers.push('status_final');
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    preserves: [...PROMOTION_PRESERVES],
    adds: [...PROMOTION_ADDS],
  };
}
