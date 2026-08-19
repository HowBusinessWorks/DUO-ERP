import { z } from 'zod';
import { businessDateSchema, moneySchema, uuidSchema } from './primitives';

/**
 * Schemele de intrare pentru contracte, componente si plafoane.
 *
 * Regula care organizeaza tot fisierul, si care e regula 1 a pasului 04: **cele
 * trei numere nu se amesteca niciodata.** Venitul alocat, plafonul de cost si
 * plafonul de venit au campuri separate, nume separate si — la plafoane —
 * scheme separate, ca sa nu existe niciun formular in care sa se poata scrie
 * plafon de cost pe Delta.
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);

const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);

const optionalText = (max: number) =>
  trimmed(max).transform((value) => (value === '' ? null : value));

const optionalMoney = moneySchema.or(z.literal('')).transform((v) => (v === '' ? null : v));

/**
 * Procent scris de om („5”, „5,5”) stocat ca fractie cu 4 zecimale („0.0500”).
 *
 * Gol NU inseamna zero si nici invers: zero e o decizie comerciala explicita
 * (contract fara indexare), pe care lista o marcheaza vizual. De aceea campul e
 * obligatoriu la contract si trebuie tastat „0”.
 */
const percentSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}([.,]\d{1,2})?$/, 'Scrie un procent între 0 și 99.')
  .transform((v) => (Number(v.replace(',', '.')) / 100).toFixed(4));

const optionalPercentSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}([.,]\d{1,2})?$/, 'Scrie un procent între 0 și 99.')
  .or(z.literal(''))
  .transform((v) => (v === '' ? null : (Number(v.replace(',', '.')) / 100).toFixed(4)));

export const CONTRACT_TYPES = [
  'mentenanta_multianual',
  'individual_deviz',
  'individual_taxare_inversa',
] as const;

export const CONTRACT_TYPE_LABELS: Readonly<Record<(typeof CONTRACT_TYPES)[number], string>> = {
  mentenanta_multianual: 'Mentenanță multianual',
  individual_deviz: 'Individual cu deviz',
  individual_taxare_inversa: 'Individual cu taxare inversă',
};

export const CONTRACT_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Ciornă',
  activ: 'Activ',
  suspendat: 'Suspendat',
  incheiat: 'Încheiat',
  anulat: 'Anulat',
};

export const COMPONENT_TYPES = ['mentenanta', 'lucrari', 'delta', 'individual'] as const;

export const COMPONENT_TYPE_LABELS: Readonly<Record<(typeof COMPONENT_TYPES)[number], string>> = {
  mentenanta: 'Mentenanță',
  lucrari: 'Lucrări',
  delta: 'Delta',
  individual: 'Individual',
};

export const contractInputSchema = z
  .object({
    companyId: uuidSchema,
    clientId: uuidSchema,
    code: requiredText(40),
    reference: optionalText(120),
    type: z.enum(CONTRACT_TYPES),
    startsOn: businessDateSchema,
    endsOn: businessDateSchema,
    totalValue: optionalMoney,
    monthlyValue: optionalMoney,
    paymentTermDays: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/, 'Scrie un număr de zile.')
      .transform(Number),
    indexationPct: percentSchema,
    deltaThreshold: moneySchema,
    expiryAlertMonths: z
      .string()
      .trim()
      .regex(/^([1-9]|[1-9]\d)$/, 'Scrie un număr de luni, între 1 și 99.')
      .transform(Number),
    ownerPersonId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
    overheadPct: optionalPercentSchema,
    status: z.enum(['draft', 'activ', 'suspendat', 'incheiat', 'anulat']),
  })
  .refine((v) => v.endsOn > v.startsOn, {
    message: 'Data de sfârșit trebuie să fie după cea de început.',
    path: ['endsOn'],
  })
  // Un contract de mentenanta fara abonament lunar nu poate genera ani
  // contractuali, deci n-ar avea nici plafoane, nici marja. Mai bine refuzat
  // aici decat descoperit peste doua luni ca ecranul de Prezentare e gol.
  .refine((v) => v.type !== 'mentenanta_multianual' || v.monthlyValue !== null, {
    message:
      'Contractul de mentenanță are abonament lunar. Fără el nu se pot genera anii contractuali.',
    path: ['monthlyValue'],
  });

export const componentInputSchema = z
  .object({
    contractId: uuidSchema,
    type: z.enum(COMPONENT_TYPES),
    name: requiredText(80),
    budgetCadence: z.enum(['lunar', 'anual']),
  })
  // `is_fill_target` NU e in schema, dinadins: se deriva din tip, in serviciu.
  // Un camp pe care formularul l-ar putea bifa gresit ar insemna o Delta desenata
  // ca limita de cheltuiala — exact inversul sensului ei.
  .refine((v) => v.type !== 'lucrari' || v.budgetCadence === 'anual', {
    message: 'Componenta Lucrări are plafon anual, defalcat pe luni.',
    path: ['budgetCadence'],
  })
  .refine((v) => v.type !== 'delta' || v.budgetCadence === 'lunar', {
    message:
      'Delta se setează lunar, manual. Un plafon anual de Delta nu are sens: ce nu umpli într-o lună se pierde.',
    path: ['budgetCadence'],
  });

/**
 * Plafon de COST — mentenanta, lucrari, individual.
 *
 * `reason` e obligatoriu si la creare, nu doar la modificare. Baza cere motiv
 * scris la UPDATE si DELETE (decizia din 02a: a crea nu e ireversibil), dar
 * verificarea #5 a pasului cere sa fie respinsa si prima setare fara motiv —
 * un plafon nu se pune „ca sa fie”, si cine il pune stie de ce.
 */
export const costCeilingInputSchema = z
  .object({
    componentId: uuidSchema,
    periodId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
    contractYearId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
    allocatedRevenue: optionalMoney,
    costCeiling: moneySchema,
    reason: requiredText(300, 'Modificarea unui plafon cere un motiv scris.'),
  })
  .refine((v) => (v.periodId === null) !== (v.contractYearId === null), {
    message: 'Plafonul e ori lunar, ori anual — nu amândouă și nu niciunul.',
    path: ['periodId'],
  });

/** Plafon de VENIT — doar Delta. Se umple, nu se consuma. */
export const revenueCeilingInputSchema = z.object({
  componentId: uuidSchema,
  periodId: uuidSchema,
  allocatedRevenue: optionalMoney,
  revenueCeiling: moneySchema,
  reason: requiredText(300, 'Modificarea unui plafon cere un motiv scris.'),
});

export type ContractInput = z.input<typeof contractInputSchema>;
export type ComponentInput = z.input<typeof componentInputSchema>;
export type CostCeilingInput = z.input<typeof costCeilingInputSchema>;
export type RevenueCeilingInput = z.input<typeof revenueCeilingInputSchema>;
