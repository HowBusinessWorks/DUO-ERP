import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { contractComponents, contracts } from './contracts';
import { app, locationTypeEnum } from './enums';
import { objectives } from './objectives';
import { persons, subcontractors, suppliers, teams } from './organization';
import { periods } from './periods';
import { products } from './products';
import { workStages, workUnits } from './work-units';

/**
 * Gestiuni, stoc si bonuri de consum — minimul fazei 1 (§17, pasul 09 §3.4).
 *
 * Regula care da forma intregului fisier: **gestiunea e un LOC FIZIC**. Magazie
 * centrala, santier, echipa, subcontractant, unelte, utilaje, consignatie —
 * atat. „Gestiune de contract" nu e o optiune in enum, prin constructie, iar
 * contractul apare exclusiv ca DIMENSIUNE ANALITICA pe documentul de miscare.
 * Daca vreodata apare `contract_id` pe `app.locations`, e greseala.
 *
 * A doua regula: **`stock_movements` e sursa adevarului si e append-only**.
 * `stock_balances` e un rollup intretinut prin trigger, exact ca
 * `component_period_rollup` din pasul 06 — se poate recalcula oricand din
 * miscari, si un job nocturn chiar o face. Corectia unei miscari gresite e o
 * miscare inversa, nu un `update`.
 *
 * A treia: **costul apare in registru abia la consum**, in stadiul `consumat`.
 * Un material mutat dintr-o gestiune in alta nu e o cheltuiala; abia bonul de
 * consum, cu analitica lui completa, scrie in `app.cost_lines`.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Gestiunea. Un loc, cu un tip din lista si — pentru cele care exista fizic pe
 * teren — o adresa si niste coordonate.
 *
 * Cele patru coloane de legatura (`team_id`, `work_unit_id`,
 * `subcontractor_id`, `supplier_id`) nu sunt alternative libere: fiecare tip de
 * gestiune cere exact una dintre ele, si un `check` de mai jos impune perechea.
 * Fara el, o „gestiune de echipa" fara echipa ar fi un depozit anonim in care
 * intra materiale pe care nu le mai poate cere nimeni inapoi.
 */
export const locations = app.table(
  'locations',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    type: locationTypeEnum('type').notNull(),
    name: text('name').notNull(),
    /** Codul scurt de pe documente: `MC-01`, `EC-INST-1`. */
    code: text('code').notNull(),
    parentLocationId: uuid('parent_location_id').references((): AnyPgColumn => locations.id),
    teamId: uuid('team_id').references(() => teams.id),
    workUnitId: uuid('work_unit_id').references(() => workUnits.id),
    subcontractorId: uuid('subcontractor_id').references(() => subcontractors.id),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    address: jsonb('address'),
    geoLat: numeric('geo_lat', { precision: 9, scale: 6 }),
    geoLng: numeric('geo_lng', { precision: 9, scale: 6 }),
    /**
     * Marfa e a altcuiva: consignatia furnizorului, uneltele lasate la un
     * subcontractant. Se vede in stoc, dar nu e a noastra pana la consum.
     */
    isCustody: boolean('is_custody').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique('locations_company_code_unique').on(t.companyId, t.code),
    index('locations_company_type_idx').on(t.companyId, t.type),
    index('locations_team_idx').on(t.teamId),
    check('locations_name_not_blank', sql`length(btrim(${t.name})) > 0`),
    check('locations_code_not_blank', sql`length(btrim(${t.code})) > 0`),
    check('locations_not_own_parent', sql`${t.parentLocationId} is distinct from ${t.id}`),
    /*
     * Tipul si titularul merg impreuna, in ambele sensuri — ca la
     * `work_units_executor_consistent` din 0016. Egalitate, nu implicatie: o
     * gestiune de echipa FARA echipa si una de magazie CU echipa sunt amandoua
     * greseli, si a doua e cea care se descopera tarziu.
     */
    check(
      'locations_holder_matches_type',
      sql`(${t.type} = 'echipa') = (${t.teamId} is not null)
          and (${t.type} = 'santier') = (${t.workUnitId} is not null)
          and (${t.type} = 'subcontractant') = (${t.subcontractorId} is not null)
          and (${t.type} = 'consignatie') = (${t.supplierId} is not null)`,
    ),
    check(
      'locations_geo_pair',
      sql`num_nonnulls(${t.geoLat}, ${t.geoLng}) <> 1`,
    ),
  ],
);

/**
 * Soldul, per gestiune × produs × lot. **Rollup, nu sursa** — intretinut prin
 * trigger din `stock_movements`, ca `component_period_rollup` din pasul 06.
 *
 * `qty_available = qty_physical - qty_reserved` NU se stocheaza: se calculeaza
 * la citire. O a treia coloana ar fi a treia sursa de adevar pentru acelasi
 * numar, si prima care ar ramane in urma.
 *
 * `avg_cost` e CMP-ul **per gestiune**, recalculat la fiecare intrare. Nu per
 * firma: acelasi produs poate intra la preturi diferite in magazia centrala si
 * la echipa, iar un CMP global ar face bonul de consum al echipei sa minta.
 *
 * Cheia naturala e (gestiune, produs, lot), dar `lot_id` e nullabil — produsele
 * fara urmarire pe lot au un singur rand. Unicitatea se impune printr-un index
 * pe expresie, scris in migrare: `coalesce(lot_id, uuid-ul nul)`.
 */
export const stockBalances = app.table(
  'stock_balances',
  {
    id: id(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    lotId: uuid('lot_id'),
    qtyPhysical: numeric('qty_physical', { precision: 14, scale: 4 }).notNull().default('0'),
    qtyReserved: numeric('qty_reserved', { precision: 14, scale: 4 }).notNull().default('0'),
    avgCost: numeric('avg_cost', { precision: 14, scale: 4 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_balances_product_idx').on(t.productId),
    check('stock_balances_physical_non_negative', sql`${t.qtyPhysical} >= 0`),
    check('stock_balances_reserved_non_negative', sql`${t.qtyReserved} >= 0`),
    check('stock_balances_avg_cost_non_negative', sql`${t.avgCost} is null or ${t.avgCost} >= 0`),
  ],
);

/**
 * Miscarea de stoc — **sursa adevarului, append-only**.
 *
 * O intrare are `to_location_id`, o iesire are `from_location_id`, un transfer
 * le are pe amandoua. Un rand fara niciuna n-ar muta nimic; `check`-ul de mai
 * jos il respinge.
 *
 * `period_id` se deriva din `effect_date` prin trigger, exact ca la
 * `cost_lines`, si `guard_closed_period` sta pe tabela: o miscare nu se poate
 * scrie intr-o luna raportata deja.
 */
export const stockMovements = app.table(
  'stock_movements',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    /** Derivat din `effect_date`. Aplicatia nu-l scrie — vezi `cost_lines`. */
    periodId: uuid('period_id').references(() => periods.id),
    /** `bon_consum`, `nir`, `transfer`, `inventar`. Text, ca sa creasca in faza 3. */
    documentType: text('document_type').notNull(),
    documentId: uuid('document_id').notNull(),
    documentLineId: uuid('document_line_id'),
    fromLocationId: uuid('from_location_id').references(() => locations.id),
    toLocationId: uuid('to_location_id').references(() => locations.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    lotId: uuid('lot_id'),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }),
    effectDate: date('effect_date').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('stock_movements_document_idx').on(t.documentType, t.documentId),
    index('stock_movements_from_idx').on(t.fromLocationId, t.productId),
    index('stock_movements_to_idx').on(t.toLocationId, t.productId),
    index('stock_movements_period_idx').on(t.periodId),
    // Cantitatea are semn doar prin directie: un minus aici ar insemna „intrare
    // scrisa ca iesire", adica doua feluri de a scrie acelasi lucru.
    check('stock_movements_quantity_positive', sql`${t.quantity} > 0`),
    check('stock_movements_unit_cost_non_negative', sql`${t.unitCost} is null or ${t.unitCost} >= 0`),
    check(
      'stock_movements_has_direction',
      sql`num_nonnulls(${t.fromLocationId}, ${t.toLocationId}) >= 1`,
    ),
    check(
      'stock_movements_not_circular',
      sql`${t.fromLocationId} is distinct from ${t.toLocationId}`,
    ),
  ],
);

/** Starile bonului de consum. `consumat` = a produs cost si a miscat stocul. */
export const CONSUMPTION_NOTE_STATUSES = ['draft', 'consumat', 'anulat'] as const;

export type ConsumptionNoteStatus = (typeof CONSUMPTION_NOTE_STATUSES)[number];

/**
 * Bonul de consum. Documentul care **transforma un material in cheltuiala**.
 *
 * Poarta analitica intreaga — contract, componenta, obiectiv, unitate de lucru,
 * etapa — pentru ca de aici pleaca liniile din registrul de cost, iar o linie de
 * cost fara analitica nu se poate raporta nicaieri. Contractul e o coloana pe
 * DOCUMENT, nu un depozit: gestiunea din care se scoate ramane un loc fizic.
 *
 * Numarul vine din alocatorul gapless (pasul 02), tipul `bon_consum`.
 */
export const consumptionNotes = app.table(
  'consumption_notes',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    series: text('series').notNull(),
    number: text('number').notNull(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    workUnitId: uuid('work_unit_id').references(() => workUnits.id),
    stageId: uuid('stage_id').references(() => workStages.id),
    contractId: uuid('contract_id').references(() => contracts.id),
    componentId: uuid('component_id').references(() => contractComponents.id),
    objectiveId: uuid('objective_id').references(() => objectives.id),
    documentDate: date('document_date').notNull(),
    effectDate: date('effect_date').notNull(),
    /** Derivat din `effect_date`, ca peste tot. */
    periodId: uuid('period_id').references(() => periods.id),
    issuedBy: uuid('issued_by')
      .notNull()
      .references(() => persons.id),
    status: text('status').notNull().default('draft'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('consumption_notes_company_number_unique').on(t.companyId, t.number),
    index('consumption_notes_work_unit_idx').on(t.workUnitId),
    index('consumption_notes_location_idx').on(t.locationId),
    index('consumption_notes_period_idx').on(t.periodId),
    check('consumption_notes_number_not_blank', sql`length(btrim(${t.number})) > 0`),
    check(
      'consumption_notes_status_known',
      sql`${t.status} in ('draft', 'consumat', 'anulat')`,
    ),
    check(
      'consumption_notes_component_has_contract',
      sql`${t.componentId} is null or ${t.contractId} is not null`,
    ),
  ],
);

export const consumptionLines = app.table(
  'consumption_lines',
  {
    id: id(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => consumptionNotes.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    lotId: uuid('lot_id'),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    /** CMP-ul gestiunii la momentul consumului, inghetat pe linie. */
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('consumption_lines_note_idx').on(t.noteId),
    check('consumption_lines_quantity_positive', sql`${t.quantity} > 0`),
    check('consumption_lines_unit_cost_non_negative', sql`${t.unitCost} >= 0`),
  ],
);

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type StockBalance = typeof stockBalances.$inferSelect;
export type StockMovement = typeof stockMovements.$inferSelect;
export type NewStockMovement = typeof stockMovements.$inferInsert;
export type ConsumptionNote = typeof consumptionNotes.$inferSelect;
export type ConsumptionLine = typeof consumptionLines.$inferSelect;
