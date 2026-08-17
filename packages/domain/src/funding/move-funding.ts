import { AppError, type Money } from '@damina/shared';

/**
 * Mutarea finantarii (§13.1, §25) — locul in care se vede de ce `domain` nu
 * importa `db`.
 *
 * Toata decizia sta intr-o functie pura de trei rinduri: mecanica depinde DOAR
 * de starea lunii din care se muta. `services` executa planul intr-o tranzactie,
 * dar nu-l mai judeca; iar toate cazurile din tabelul §13 se testeaza in
 * milisecunde, fara Postgres.
 *
 * Ce nu se schimba NICIODATA la mutare, pe nicio ramura: data documentului,
 * obiectivul si analitica „folosit" — adica unde s-a intamplat fizic munca. Se
 * muta doar analitica „descarcat": cine plateste. De aceea planul nu are nicio
 * cheie prin care sa se poata atinge obiectivul: nu e o omisiune, e garantia.
 */

/** Starile lunii, ca in `app.period_status`. */
export type PeriodStatus = 'open' | 'closing' | 'closed';

/** Unde se descarca banii: contract × componenta × luna. */
export interface FundingTarget {
  readonly contractId: string;
  readonly componentId: string;
  readonly periodId: string;
}

export interface MoveFundingInput {
  readonly workUnitId: string;
  /** De unde pleaca finantarea acum. */
  readonly from: FundingTarget;
  /** Unde ajunge. */
  readonly to: FundingTarget;
  /**
   * Starea lunii DIN CARE se muta. Singurul lucru care decide mecanica.
   *
   * `closing` se trateaza ca `closed`: o luna in curs de inchidere are deja
   * raportul in verificare, iar o rescriere in timpul verificarii e cel mai
   * prost moment posibil.
   */
  readonly fromPeriodStatus: PeriodStatus;
  /** Luna curenta. Aici se emite documentul, cand se emite. */
  readonly currentPeriodId: string;
  /** Cat se muta. Costurile deja inregistrate urmeaza unitatea de lucru. */
  readonly amount: Money;
  /** Liniile de cost existente, pentru ramura de rescriere. */
  readonly costLineIds: readonly string[];
  /** Motiv scris. Obligatoriu pe ambele ramuri (regula 4 din pas). */
  readonly reason: string;
}

/** O miscare din documentul de re-alocare. Doua la un document: scoate si pune. */
export interface ReallocationEntry {
  readonly direction: 'reversal' | 'reapply';
  readonly contractId: string;
  readonly componentId: string;
  /** Luna componentei atinse — cea VECHE la scoatere, cea noua la punere. */
  readonly componentPeriodId: string;
  /** Luna in care se inregistreaza miscarea: mereu cea curenta. */
  readonly recordedInPeriodId: string;
  /** Negativ la scoatere, pozitiv la punere. Semnul e informatia. */
  readonly amount: Money;
}

export type FundingMovePlan =
  | {
      readonly kind: 'rewrite-charged-analytics';
      readonly workUnitId: string;
      readonly target: FundingTarget;
      readonly costLineIds: readonly string[];
      readonly amount: Money;
      readonly reason: string;
    }
  | {
      readonly kind: 'reallocation-document';
      readonly workUnitId: string;
      /** Luna in care se emite documentul: cea curenta, nu cea din care se muta. */
      readonly periodId: string;
      readonly from: FundingTarget;
      readonly to: FundingTarget;
      readonly amount: Money;
      readonly entries: readonly ReallocationEntry[];
      readonly reason: string;
    };

function sameTarget(a: FundingTarget, b: FundingTarget): boolean {
  return (
    a.contractId === b.contractId && a.componentId === b.componentId && a.periodId === b.periodId
  );
}

/**
 * Cele doua miscari ale unui document de re-alocare.
 *
 * Amandoua se inregistreaza in luna CURENTA, si amandoua ramin vizibile: lista
 * lunii arata si de unde au plecat banii, si unde au ajuns. Un document care ar
 * arata doar sosirea ar face suma lunii sa nu se mai potriveasca cu nimic.
 */
function buildReversalAndReapply(input: MoveFundingInput): readonly ReallocationEntry[] {
  return [
    {
      direction: 'reversal',
      contractId: input.from.contractId,
      componentId: input.from.componentId,
      componentPeriodId: input.from.periodId,
      recordedInPeriodId: input.currentPeriodId,
      amount: input.amount.negate(),
    },
    {
      direction: 'reapply',
      contractId: input.to.contractId,
      componentId: input.to.componentId,
      componentPeriodId: input.to.periodId,
      recordedInPeriodId: input.currentPeriodId,
      amount: input.amount,
    },
  ];
}

export function planFundingMove(input: MoveFundingInput): FundingMovePlan {
  // Motivul se verifica primul, inaintea oricarei alte reguli: e singurul lucru
  // care nu se poate deduce si repara mai tarziu din date.
  if (input.reason.trim().length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Mutarea finantarii cere un motiv scris.', {
      field: 'reason',
    });
  }

  if (input.amount.isNegative()) {
    throw new AppError('VALIDATION_FAILED', 'Suma mutata nu poate fi negativa.', {
      amount: input.amount.toDbString(),
    });
  }

  if (sameTarget(input.from, input.to)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Finantarea e deja pe componenta si luna alese — nu e nimic de mutat.',
      { componentId: input.to.componentId, periodId: input.to.periodId },
    );
  }

  return input.fromPeriodStatus === 'open'
    ? {
        kind: 'rewrite-charged-analytics',
        workUnitId: input.workUnitId,
        target: input.to,
        costLineIds: input.costLineIds,
        amount: input.amount,
        reason: input.reason,
      }
    : {
        kind: 'reallocation-document',
        workUnitId: input.workUnitId,
        periodId: input.currentPeriodId,
        from: input.from,
        to: input.to,
        amount: input.amount,
        entries: buildReversalAndReapply(input),
        reason: input.reason,
      };
}

/**
 * Ce anunta ecranul INAINTE de confirmare (§3.4). Aceeasi sursa de adevar ca
 * planul executat — daca ar fi doua, ecranul ar putea promite o mecanica si
 * tranzactia ar face-o pe cealalta.
 */
export function describeFundingMove(status: PeriodStatus): {
  readonly kind: FundingMovePlan['kind'];
  readonly periodIsClosed: boolean;
} {
  return status === 'open'
    ? { kind: 'rewrite-charged-analytics', periodIsClosed: false }
    : { kind: 'reallocation-document', periodIsClosed: true };
}
