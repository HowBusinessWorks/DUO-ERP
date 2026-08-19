import { describe, expect, it } from 'vitest';
import { canIssueMaintenanceInvoice, reportProgress, reportTransition } from './index';

describe('reportTransition', () => {
  it('nu aproba un raport care inca se genereaza', () => {
    const result = reportTransition('building', 'approve');
    expect(result.ok).toBe(false);
    expect(result.next).toBe('building');
    expect(result.reason).toContain('Generează');
  });

  it('nu ingheata fara aprobare', () => {
    expect(reportTransition('review', 'freeze').ok).toBe(false);
    expect(reportTransition('approved', 'freeze')).toEqual({ ok: true, next: 'frozen' });
  });

  it('nu trimite un raport neinghetat', () => {
    expect(reportTransition('approved', 'send').ok).toBe(false);
    expect(reportTransition('frozen', 'send')).toEqual({ ok: true, next: 'sent' });
  });

  it('permite regenerarea dupa inghet — asa apare versiunea 2', () => {
    expect(reportTransition('frozen', 'generate')).toEqual({ ok: true, next: 'building' });
    expect(reportTransition('sent', 'generate')).toEqual({ ok: true, next: 'building' });
  });

  it('nu porneste o a doua generare cat timp una ruleaza', () => {
    expect(reportTransition('building', 'generate').ok).toBe(false);
  });
});

describe('reportProgress', () => {
  it('spune cat din cat, nu un procent gol', () => {
    expect(reportProgress(312, 480)).toMatchObject({ percent: 65, label: '312 din 480 poze' });
  });

  it('total zero inseamna „se pregateste", nu 100%', () => {
    expect(reportProgress(0, 0)).toMatchObject({ percent: 0, label: 'se pregătește…' });
  });

  it('nu depaseste totalul si nu coboara sub zero', () => {
    expect(reportProgress(600, 480).done).toBe(480);
    expect(reportProgress(-3, 480).done).toBe(0);
  });
});

describe('canIssueMaintenanceInvoice', () => {
  it('blocheaza factura pana la aprobarea interna', () => {
    expect(canIssueMaintenanceInvoice(null)).toBe(false);
    expect(canIssueMaintenanceInvoice('building')).toBe(false);
    expect(canIssueMaintenanceInvoice('review')).toBe(false);
    expect(canIssueMaintenanceInvoice('approved')).toBe(true);
    expect(canIssueMaintenanceInvoice('sent')).toBe(true);
  });
});
