import { describe, expect, it } from 'vitest';
import { inspectionValidationCheck, type AnswerLike, type ChecklistPointLike } from './inspection';

const points: ChecklistPointLike[] = [
  { itemId: 'p1', position: 1, text: 'Capac cămin', requiresPhoto: false },
  { itemId: 'p2', position: 2, text: 'Etanșare', requiresPhoto: true },
  { itemId: 'p3', position: 3, text: 'Grătar', requiresPhoto: false },
];

const answer = (over: Partial<AnswerLike> & Pick<AnswerLike, 'itemId'>): AnswerLike => ({
  answer: 'ok',
  hasPhoto: false,
  hasFinding: false,
  ...over,
});

describe('inspectionValidationCheck', () => {
  it('cere raspuns la fiecare punct', () => {
    const result = inspectionValidationCheck(points, [answer({ itemId: 'p1' })]);

    expect(result.canValidate).toBe(false);
    expect(result.answered).toBe(1);
    expect(result.total).toBe(3);
    // Un punct fara raspuns produce UN singur blocaj, nu doua: „nu are raspuns"
    // si „cere poza" ar trimite omul de doua ori la acelasi rand.
    expect(result.blockers.map((b) => b.code)).toEqual(['unanswered', 'unanswered']);
  });

  it('blocheaza un NOK fara iesire — regula 1 a pasului', () => {
    const result = inspectionValidationCheck(points, [
      answer({ itemId: 'p1', answer: 'nok' }),
      answer({ itemId: 'p2', hasPhoto: true }),
      answer({ itemId: 'p3' }),
    ]);

    expect(result.canValidate).toBe(false);
    expect(result.blockers).toEqual([
      { code: 'finding_required', itemId: 'p1', position: 1, text: 'Capac cămin' },
    ]);
  });

  it('lasa sa treaca NOK-ul cu iesire', () => {
    const result = inspectionValidationCheck(points, [
      answer({ itemId: 'p1', answer: 'nok', hasFinding: true }),
      answer({ itemId: 'p2', hasPhoto: true }),
      answer({ itemId: 'p3' }),
    ]);

    expect(result.canValidate).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('blocheaza un punct cu poza obligatorie fara poza', () => {
    const result = inspectionValidationCheck(points, [
      answer({ itemId: 'p1' }),
      answer({ itemId: 'p2' }),
      answer({ itemId: 'p3' }),
    ]);

    expect(result.blockers.map((b) => b.code)).toEqual(['photo_required']);
  });

  it('nu cere poza pentru un punct marcat „nu se aplica”', () => {
    const result = inspectionValidationCheck(points, [
      answer({ itemId: 'p1' }),
      answer({ itemId: 'p2', answer: 'na' }),
      answer({ itemId: 'p3' }),
    ]);

    expect(result.canValidate).toBe(true);
  });

  it('listeaza blocajele in ordinea punctelor, nu in ordinea raspunsurilor', () => {
    const result = inspectionValidationCheck(points, [
      answer({ itemId: 'p3', answer: 'nok' }),
      answer({ itemId: 'p1', answer: 'nok' }),
      answer({ itemId: 'p2', hasPhoto: true }),
    ]);

    expect(result.blockers.map((b) => b.position)).toEqual([1, 3]);
  });
});
