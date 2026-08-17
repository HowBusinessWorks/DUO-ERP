import { sql } from 'drizzle-orm';
import { check, index, numeric, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contractComponents, contracts } from './contracts';
import { app } from './enums';
import { periods } from './periods';

/**
 * Rollup-uri de plafon — cifra de pe ecran trebuie sa dea (PLAN_TEHNIC §4.7).
 *
 * §8.2 din documentul functional cere ca totalul din spatele unei componente sa
 * dea EXACT cifra de pe banda: „daca nu da, e bug, si trebuie sa se vada". Cerinta
 * asta exclude cache-ul eventual-consistent — un rollup care se aliniaza „in
 * cateva secunde" produce exact ecranul in care doua cifre nu se potrivesc si
 * nimeni nu stie care e cea buna.
 *
 * Solutia: tabela intretinuta prin trigger, in ACEEASI tranzactie cu linia de
 * cost. Costul e un `upsert` pe o tabela mica per linie scrisa; la cateva sute
 * de linii pe zi, invizibil.
 *
 * Rollup-ul e o suma derivata, deci prin definitie poate diverge daca un trigger
 * are un bug. De aceea jobul `rollup.verify` (pasul 06b) recalculeaza nocturn
 * din registru si compara: asa afli in ziua in care apare, nu in luna in care o
 * vezi in factura.
 */

export const componentPeriodRollup = app.table(
  'component_period_rollup',
  {
    componentId: uuid('component_id')
      .notNull()
      .references(() => contractComponents.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id, { onDelete: 'cascade' }),
    /** Stadiul `angajat`: comanda lansata. Coloreaza plafonul de la lansare. */
    committed: numeric('committed', { precision: 14, scale: 2 }).notNull().default('0'),
    received: numeric('received', { precision: 14, scale: 2 }).notNull().default('0'),
    consumed: numeric('consumed', { precision: 14, scale: 2 }).notNull().default('0'),
    invoiced: numeric('invoiced', { precision: 14, scale: 2 }).notNull().default('0'),
    /**
     * Cat s-a „umplut" din componenta, din alocarile ACTIVE de finantare — nu din
     * registrul de cost. E cealalta jumatate a benzii Delta din pasul 04: plafonul
     * spune cat se poate, asta spune cat s-a promis deja.
     */
    allocatedRevenue: numeric('allocated_revenue', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.componentId, t.periodId], name: 'component_period_rollup_pk' }),
    // „Ce s-a intamplat in august, pe toate componentele" — inchiderea de luna si
    // ecranul de marja citesc pe luna, nu pe componenta.
    index('component_period_rollup_period_idx').on(t.periodId),
    /*
     * Sumele pot fi negative: un storno mai mare decat ce s-a inregistrat pana
     * atunci in luna e o corectie legitima, iar un rollup care ar refuza-o ar
     * bloca inregistrarea corectiei in registru — adica ar transforma o tabela
     * derivata intr-o constrangere de business. Nu punem `check (>= 0)`.
     */
  ],
);

/**
 * Regia, recalculata lunar (§22.5, Anexa C.6).
 *
 * Marja bruta iese din `cost_lines` singur; marja neta e bruta plus randul de
 * aici. Fotografie, nu formula aplicata la afisare: procentul de regie se schimba
 * de la an la an, iar marja lui martie 2026 trebuie sa ramana cea calculata cu
 * procentul lui martie 2026, si dupa ce procentul s-a schimbat.
 *
 * Fiecare ecran declara pe care dintre cele doua e construit — se impune prin
 * tipul de retur al use-case-ului, care poarta `margin_basis: 'gross' | 'net'`.
 */
export const overheadSnapshots = app.table(
  'overhead_snapshots',
  {
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id, { onDelete: 'cascade' }),
    /** Fractie, nu procent: 0.1250 = 12,5%. Ca `pct_of_work` din 05a. */
    overheadPct: numeric('overhead_pct', { precision: 6, scale: 4 }).notNull(),
    directCost: numeric('direct_cost', { precision: 14, scale: 2 }).notNull().default('0'),
    overheadAmount: numeric('overhead_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.contractId, t.periodId], name: 'overhead_snapshots_pk' }),
    index('overhead_snapshots_period_idx').on(t.periodId),
    check(
      'overhead_snapshots_pct_range',
      sql`${t.overheadPct} >= 0 and ${t.overheadPct} <= 1`,
    ),
  ],
);

export type ComponentPeriodRollup = typeof componentPeriodRollup.$inferSelect;
export type OverheadSnapshot = typeof overheadSnapshots.$inferSelect;
