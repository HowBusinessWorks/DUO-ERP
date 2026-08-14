/**
 * Cele patru spatii de lucru ale sistemului. Fiecare are rutele lui, ecranele
 * lui si — mai important — rolul lui de Postgres, deci un set diferit de
 * coloane vizibile la nivel de date.
 *
 * Corespunde tipului `app.persona` din baza de date.
 */
export const PERSONAS = ['office', 'field', 'subcontractor', 'client'] as const;

export type Persona = (typeof PERSONAS)[number];

export function isPersona(value: string): value is Persona {
  return (PERSONAS as readonly string[]).includes(value);
}
