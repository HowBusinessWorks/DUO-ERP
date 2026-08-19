import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  numeric,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { app, budgetCadenceEnum, componentTypeEnum, contractTypeEnum } from './enums';
import { clients, persons } from './organization';
import { periods } from './periods';

/**
 * Motorul de bani al firmei (Anexa C.3).
 *
 * Regula centrala a pasului, si singura care nu se negociaza: **cele TREI
 * numere sunt separate si nu se confunda niciodata** — nici in baza, nici pe
 * ecran, nici in numele variabilelor:
 *
 *   `allocated_revenue` — cat INCASAM pe componenta asta;
 *   `cost_ceiling`      — cat avem VOIE sa cheltuim;
 *   consumul real       — cat s-a cheltuit efectiv (rollup, pasul 06).
 *
 * A doua regula, la fel de contraintuitiva: **Delta e tinta de umplere, nu
 * limita de consum.** Are `revenue_ceiling` (venit disponibil), nu
 * `cost_ceiling`, iar ce nu se umple pana la finalul lunii e venit pierdut
 * definitiv. De aceea are coloana proprie si `is_fill_target`.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Starile unui contract. Text cu `check`, nu enum: lista e a noastra si se
 * schimba mai des decat merita o migrare de tip. */
export const CONTRACT_STATUSES = ['draft', 'activ', 'suspendat', 'incheiat', 'anulat'] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const contracts = app.table(
  'contracts',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    /** Codul din vorbirea curenta: „4700”. Unic pe firma, nu global. */
    code: text('code').notNull(),
    /** Numarul si data actului semnat, asa cum apar pe hartie. */
    reference: text('reference'),
    type: contractTypeEnum('type').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    totalValue: numeric('total_value', { precision: 14, scale: 2 }),
    /** Abonamentul lunar al ANULUI 1. Anii urmatori stau in `contract_years`. */
    monthlyValue: numeric('monthly_value', { precision: 14, scale: 2 }),
    paymentTermDays: smallint('payment_term_days').notNull().default(70),
    /**
     * Indexarea anuala. Fractie, nu multiplicator: 0.0500 = 5%.
     *
     * **Poate fi 0**, si contractele cu 0 se degradeaza cel mai repede — de aceea
     * lista le marcheaza vizual distinct. Valoarea de aici e doar cea propusa la
     * generarea anilor; ce s-a aplicat efectiv se istoricizeaza pe fiecare an.
     */
    indexationPct: numeric('indexation_pct', { precision: 6, scale: 4 })
      .notNull()
      .default('0.0500'),
    /** Peste pragul asta, o interventie de mentenanta trece pe Delta. */
    deltaThreshold: numeric('delta_threshold', { precision: 14, scale: 2 })
      .notNull()
      .default('2000.00'),
    expiryAlertMonths: smallint('expiry_alert_months').notNull().default(6),
    /** PM-ul: proprietarul de P&L al contractului. */
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    /** Regia, pentru marja neta. Null inseamna „nu se calculeaza marja neta”. */
    overheadPct: numeric('overhead_pct', { precision: 6, scale: 4 }),
    status: text('status').notNull().default('draft'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('contracts_company_code_unique').on(t.companyId, t.code),
    // Scanul zilnic de expirare intreaba „ce contracte active se termina in
    // urmatoarele N luni”. Indexul e exact pe intrebarea aia.
    index('contracts_expiry_idx')
      .on(t.endsOn)
      .where(sql`status = 'activ'`),
    index('contracts_company_status_idx').on(t.companyId, t.status),
    index('contracts_client_idx').on(t.clientId),
    check('contracts_code_not_blank', sql`length(btrim(${t.code})) > 0`),
    check('contracts_period_valid', sql`${t.endsOn} > ${t.startsOn}`),
    check(
      'contracts_status_known',
      sql`${t.status} in ('draft', 'activ', 'suspendat', 'incheiat', 'anulat')`,
    ),
    check('contracts_indexation_non_negative', sql`${t.indexationPct} >= 0`),
    check('contracts_delta_threshold_non_negative', sql`${t.deltaThreshold} >= 0`),
    check(
      'contracts_total_value_non_negative',
      sql`${t.totalValue} is null or ${t.totalValue} >= 0`,
    ),
    check(
      'contracts_monthly_value_non_negative',
      sql`${t.monthlyValue} is null or ${t.monthlyValue} >= 0`,
    ),
    check('contracts_expiry_alert_positive', sql`${t.expiryAlertMonths} > 0`),
  ],
);

/**
 * Anii contractuali, cu indexarea ISTORICIZATA.
 *
 * Nu se recalculeaza niciodata din valoarea curenta a contractului: un an in
 * care s-a aplicat 0% pentru ca asa s-a negociat trebuie sa ramana 0% si peste
 * trei ani, chiar daca intre timp `contracts.indexation_pct` s-a schimbat.
 * Rescrierea retroactiva a unui an ar muta marja unei luni deja raportate.
 */
export const contractYears = app.table(
  'contract_years',
  {
    id: id(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    /** 1..N. Aniversarea, nu anul calendaristic. */
    yearIndex: smallint('year_index').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    /** Abonamentul lunar al anului, deja indexat. */
    monthlyValue: numeric('monthly_value', { precision: 14, scale: 2 }).notNull(),
    /** Cat s-a aplicat efectiv la trecerea in anul asta. 0 pe primul an. */
    indexationAppliedPct: numeric('indexation_applied_pct', { precision: 6, scale: 4 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('contract_years_contract_index_unique').on(t.contractId, t.yearIndex),
    check('contract_years_index_range', sql`${t.yearIndex} between 1 and 20`),
    check('contract_years_period_valid', sql`${t.endsOn} > ${t.startsOn}`),
    check('contract_years_monthly_value_non_negative', sql`${t.monthlyValue} >= 0`),
  ],
);

/**
 * Componentele contractului: Mentenanta, Lucrari, Delta (sau Individual, la
 * contractele punctuale). Fiecare cu regula ei de buget.
 */
export const contractComponents = app.table(
  'contract_components',
  {
    id: id(),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    type: componentTypeEnum('type').notNull(),
    name: text('name').notNull(),
    budgetCadence: budgetCadenceEnum('budget_cadence').notNull(),
    /**
     * Inverseaza sensul gauge-ului: la Delta bara **se umple**, nu se goleste.
     *
     * `check`-ul e o EGALITATE, nu o implicatie: Delta il cere, orice alta
     * componenta il interzice. Verificarea #4 a pasului trece pe ramura a doua,
     * dar prima e la fel de importanta — o Delta cu `false` ar fi desenata ca o
     * limita de cheltuiala, si atunci omul ar incerca sa n-o depaseasca exact
     * cand ar trebui s-o umple.
     */
    isFillTarget: boolean('is_fill_target').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('contract_components_contract_type_unique').on(t.contractId, t.type),
    check('contract_components_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check(
      'contract_components_fill_target_only_delta',
      sql`${t.isFillTarget} = (${t.type} = 'delta')`,
    ),
  ],
);

/**
 * Plafoanele — locul in care cele trei numere stau alaturi FARA sa se amestece.
 *
 * Un rand e ori lunar (`period_id`), ori anual (`contract_year_id`), niciodata
 * ambele si niciodata niciunul. Componenta Lucrari are si rand anual (planul), si
 * randuri lunare (defalcarea); ele nu se aduna intre ele, si de asta nu au voie
 * sa stea in acelasi rand.
 *
 * Ce coloana de plafon se completeaza depinde de TIPUL componentei, pe care
 * randul nu-l poarta — regula e impusa de trigger, in migrare.
 */
export const componentCeilings = app.table(
  'component_ceilings',
  {
    id: id(),
    componentId: uuid('component_id')
      .notNull()
      .references(() => contractComponents.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').references(() => periods.id),
    contractYearId: uuid('contract_year_id').references(() => contractYears.id, {
      onDelete: 'cascade',
    }),
    /** Venit alocat. Cat incasam. Nu e plafon si nu se compara cu consumul. */
    allocatedRevenue: numeric('allocated_revenue', { precision: 14, scale: 2 }),
    /** Plafon de COST: mentenanta si lucrari. Cat avem voie sa cheltuim. */
    costCeiling: numeric('cost_ceiling', { precision: 14, scale: 2 }),
    /** Plafon de VENIT: DOAR Delta. Cat avem voie sa umplem, setat manual. */
    revenueCeiling: numeric('revenue_ceiling', { precision: 14, scale: 2 }),
    setBy: uuid('set_by').references(() => persons.id),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // `nulls not distinct`: fara el, doua randuri anuale pe aceeasi componenta
    // ar trece amandoua, pentru ca `period_id` null nu se compara cu null.
    unique('component_ceilings_scope_unique')
      .on(t.componentId, t.periodId, t.contractYearId)
      .nullsNotDistinct(),
    index('component_ceilings_period_idx').on(t.periodId),
    check(
      'component_ceilings_one_scope',
      sql`num_nonnulls(${t.periodId}, ${t.contractYearId}) = 1`,
    ),
    check(
      'component_ceilings_allocated_revenue_non_negative',
      sql`${t.allocatedRevenue} is null or ${t.allocatedRevenue} >= 0`,
    ),
    check(
      'component_ceilings_cost_ceiling_non_negative',
      sql`${t.costCeiling} is null or ${t.costCeiling} >= 0`,
    ),
    check(
      'component_ceilings_revenue_ceiling_non_negative',
      sql`${t.revenueCeiling} is null or ${t.revenueCeiling} >= 0`,
    ),
  ],
);

export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
export type ContractYear = typeof contractYears.$inferSelect;
export type NewContractYear = typeof contractYears.$inferInsert;
export type ContractComponent = typeof contractComponents.$inferSelect;
export type NewContractComponent = typeof contractComponents.$inferInsert;
export type ComponentCeiling = typeof componentCeilings.$inferSelect;
export type NewComponentCeiling = typeof componentCeilings.$inferInsert;
