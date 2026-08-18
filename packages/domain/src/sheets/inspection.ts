/**
 * Regula 1 a pasului 09, scrisa a doua oara — dinadins.
 *
 * Adevarul e in baza: un trigger refuza `validated_at` cat timp exista un NOK
 * fara iesire sau un punct cu poza obligatorie fara poza. Functia asta nu
 * inlocuieste trigger-ul si nu are voie sa-l inlocuiasca; ea exista ca ecranul
 * sa poata **arata omului CE punct il blocheaza inainte sa apese**, in loc sa-i
 * intoarca o eroare de baza de date dupa.
 *
 * Consecinta practica: daca cele doua reguli se despart vreodata, cea din baza
 * castiga si fisa pur si simplu nu se valideaza. Un ecran permisiv e o
 * neplacere; o baza permisiva e un backlog gol si o Delta umpluta reactiv.
 */

export interface ChecklistPointLike {
  readonly itemId: string;
  readonly position: number;
  readonly text: string;
  readonly requiresPhoto: boolean;
}

export interface AnswerLike {
  readonly itemId: string;
  readonly answer: 'ok' | 'nok' | 'na';
  readonly hasPhoto: boolean;
  /** Are deja o iesire scrisa (`inspection_findings`). */
  readonly hasFinding: boolean;
}

export type InspectionBlockerCode = 'unanswered' | 'finding_required' | 'photo_required';

export interface InspectionBlocker {
  readonly code: InspectionBlockerCode;
  readonly itemId: string;
  readonly position: number;
  readonly text: string;
}

export interface InspectionValidationCheck {
  readonly canValidate: boolean;
  readonly blockers: readonly InspectionBlocker[];
  /** Cate puncte au raspuns, din cate. Bara de progres a fisei. */
  readonly answered: number;
  readonly total: number;
}

/**
 * Ce impiedica validarea fisei, in ordinea punctelor din checklist.
 *
 * Ordinea conteaza: omul repara de sus in jos, iar o lista in ordine aleatoare
 * il pune sa caute de fiecare data punctul despre care ii vorbeste mesajul.
 */
export function inspectionValidationCheck(
  points: readonly ChecklistPointLike[],
  answers: readonly AnswerLike[],
): InspectionValidationCheck {
  const byItem = new Map(answers.map((a) => [a.itemId, a]));
  const blockers: InspectionBlocker[] = [];
  let answered = 0;

  for (const point of [...points].sort((a, b) => a.position - b.position)) {
    const answer = byItem.get(point.itemId);
    const where = { itemId: point.itemId, position: point.position, text: point.text };

    if (answer === undefined) {
      blockers.push({ code: 'unanswered', ...where });
      continue;
    }
    answered += 1;

    if (answer.answer === 'nok' && !answer.hasFinding) {
      blockers.push({ code: 'finding_required', ...where });
    }
    // `na` nu cere poza: punctul nu se aplica obiectivului, deci n-are ce
    // fotografia. `ok` cere, si asta e chiar rostul dovezii — nimeni nu
    // fotografiaza defectele pe care le-a si raportat ca defecte.
    if (point.requiresPhoto && answer.answer !== 'na' && !answer.hasPhoto) {
      blockers.push({ code: 'photo_required', ...where });
    }
  }

  return { canValidate: blockers.length === 0, blockers, answered, total: points.length };
}

export const INSPECTION_BLOCKER_MESSAGES: Readonly<Record<InspectionBlockerCode, string>> = {
  unanswered: 'nu are răspuns',
  finding_required: 'e NOK și nu are ieșire',
  photo_required: 'cere poză',
};

/** Mesajul de pe ecran, cu punctul numit. */
export function describeInspectionBlocker(blocker: InspectionBlocker): string {
  return `Punctul ${blocker.position} — ${blocker.text}: ${INSPECTION_BLOCKER_MESSAGES[blocker.code]}.`;
}
