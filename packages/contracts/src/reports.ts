import { z } from 'zod';
import { uuidSchema } from './primitives';

/**
 * Raportul lunar catre client (pasul 10, §3.6).
 *
 * Intrarile sunt minuscule dinadins: contractul si luna. Continutul raportului
 * NU se alege de pe ecran — el e „tot ce s-a validat in luna asta, pe
 * contractul asta". Un raport in care omul bifeaza ce intra ar fi un raport
 * despre care s-ar putea discuta la fiecare emitere, si tocmai discutia aia
 * trebuie sa dispara.
 */

/** Sabloanele de randare. Text, ca `template_id` din tabela. */
export const REPORT_TEMPLATES = ['standard', 'client_branding'] as const;

export const generateMonthlyReportInputSchema = z.object({
  contractId: uuidSchema,
  periodId: uuidSchema,
  templateId: z.enum(REPORT_TEMPLATES).default('standard'),
});

export const monthlyReportActionInputSchema = z.object({
  reportId: uuidSchema,
});

export type GenerateMonthlyReportInput = z.input<typeof generateMonthlyReportInputSchema>;
export type MonthlyReportActionInput = z.input<typeof monthlyReportActionInputSchema>;
export type ReportTemplate = (typeof REPORT_TEMPLATES)[number];
