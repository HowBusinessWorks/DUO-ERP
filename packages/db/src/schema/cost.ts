import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  numeric,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { contractComponents, contracts } from './contracts';
import { app, costDocumentTypeEnum, costStageEnum, expenseTypeEnum } from './enums';
import { objectives } from './objectives';
import { persons, qualifications, subcontractors, suppliers } from './organization';
import { periods } from './periods';
import { products } from './products';
import { workStages, workUnits } from './work-units';

/**
 * Registrul de cost — UN SINGUR registru, nu cate o tabela per fel de cheltuiala
 * (§11, PLAN_TEHNIC §4.6).
 *
 * Fiecare linie raspunde la sase intrebari: cand · unde · cine plateste · ce ·
 * cat · de unde. Toate rapoartele de bani din ERP sunt filtre pe tabela asta:
 * consumul unei componente, costul unei lucrari, istoricul unui obiectiv, marja
 * unui contract, estimat vs realizat.
 *
 * Trei reguli care se rateaza cel mai des, si unde se vede fiecare aici:
 *
 *   1. **Doua analitici pe fiecare linie, nu una.** `used_*` spune unde s-a
 *      consumat fizic si nu se schimba NICIODATA; `charged_*` spune cine
 *      plateste si se rescrie la mutarea finantarii. Cu o singura analitica, ori
 *      istoricul obiectivului e fals, ori raportul de plafon e fals.
 *   2. **Append-only.** `update` si `delete` nu se acorda nimanui: corectia se
 *      face prin linie de storno, ca in contabilitate. Singura exceptie e
 *      rescrierea analiticei „descarcat" la mutarea finantarii pe luna deschisa,
 *      printr-o functie `security definer` care scrie obligatoriu in audit.
 *   3. **`period_id` se deriva din `effect_date`**, prin trigger. Aplicatia nu-l
 *      scrie. `effect_date` ≠ `document_date` dinadins: o fisa facuta pe 28
 *      iulie si validata pe 3 august se raporteaza in luna clientului.
 */

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const costLines = app.table(
  'cost_lines',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),

    // ── CAND ────────────────────────────────────────────────────────────────
    /** Data de pe hartie. Nu se schimba niciodata, nici la re-alocare. */
    documentDate: date('document_date').notNull(),
    /** Luna de raportare. Poate diferi de data documentului — asta e rostul ei. */
    effectDate: date('effect_date').notNull(),
    /**
     * Derivat din `effect_date` + `company_id` printr-un trigger `before insert`.
     * Nullabil in Drizzle, `not null` in baza: coloana se completeaza inainte de
     * a fi verificata, iar aplicatia n-o scrie niciodata. Regula 3 din pas.
     */
    periodId: uuid('period_id').references(() => periods.id),

    // ── UNDE (analitica „folosit") ──────────────────────────────────────────
    usedContractId: uuid('used_contract_id').references(() => contracts.id),
    usedComponentId: uuid('used_component_id').references(() => contractComponents.id),
    objectiveId: uuid('objective_id').references(() => objectives.id),
    workUnitId: uuid('work_unit_id').references(() => workUnits.id),
    /** Obligatoriu daca UL-ul e lucrare — trigger, fiindca depinde de tipul lui. */
    stageId: uuid('stage_id').references(() => workStages.id),

    // ── CINE PLATESTE (analitica „descarcat") ───────────────────────────────
    /**
     * Obligatoriu pentru orice stadiu in afara de `angajat` — vezi `check`-ul de
     * mai jos. La angajare se stie ce se comanda inainte sa se stie pe ce buget
     * cade; de la receptie incolo, nu mai e scuza.
     */
    chargedContractId: uuid('charged_contract_id').references(() => contracts.id),
    chargedComponentId: uuid('charged_component_id').references(() => contractComponents.id),

    // ── CE ──────────────────────────────────────────────────────────────────
    expenseType: expenseTypeEnum('expense_type').notNull(),
    productId: uuid('product_id').references(() => products.id),
    qualificationId: uuid('qualification_id').references(() => qualifications.id),

    // ── CAT ─────────────────────────────────────────────────────────────────
    quantity: numeric('quantity', { precision: 14, scale: 4 }),
    uom: text('uom'),
    /**
     * Semnul are inteles: o linie de storno e negativa, si de aceea NU exista
     * `check (amount >= 0)`. Corectia unei sume gresite e o linie in minus, nu un
     * `update` — regula 1 din pas.
     */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    stage: costStageEnum('stage').notNull(),

    // ── DE UNDE ─────────────────────────────────────────────────────────────
    /**
     * Fara pereche document + id, cifra nu se poate desface pana la sursa
     * (principiul I3). Ambele `not null`, pe fiecare linie, fara exceptii.
     */
    documentType: costDocumentTypeEnum('document_type').notNull(),
    documentId: uuid('document_id').notNull(),
    documentLineId: uuid('document_line_id'),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    subcontractorId: uuid('subcontractor_id').references(() => subcontractors.id),

    // ── RE-ALOCARE ──────────────────────────────────────────────────────────
    /** Linia stornata sau mutata din care s-a nascut asta. */
    reallocationOfId: uuid('reallocation_of_id').references((): AnyPgColumn => costLines.id),
    /**
     * Marcheaza cele doua linii emise de un document de re-alocare pe luna
     * INCHISA: minus pe componenta veche, plus pe cea noua. Steag separat de
     * `reallocation_of_id`, pentru ca si un storno obisnuit arata spre linia pe
     * care o corecteaza fara sa fie re-alocare.
     */
    isReallocation: boolean('is_reallocation').notNull().default(false),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => persons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /*
     * Indecsii sunt proiectati din intrebarile reale de la §11, nu inventati.
     * Fiecare are in comentariu ecranul care il foloseste; unul fara ecran ar fi
     * un index de intretinut degeaba la fiecare scriere.
     */

    // Ecranul de plafon si banda de componenta: „cat s-a consumat pe Mentenanta
    // in august". `include` se adauga de mana in migrare — Drizzle nu-l exprima.
    index('cost_lines_charged_idx').on(t.chargedContractId, t.chargedComponentId, t.effectDate),
    // Costul unei unitati de lucru, desfacut pe fel de cheltuiala.
    index('cost_lines_work_unit_idx').on(t.workUnitId, t.expenseType),
    // Istoricul obiectivului — pe analitica „folosit", cu total anual.
    index('cost_lines_objective_idx').on(t.objectiveId, t.effectDate),
    // Drill-down invers: de la document la liniile pe care le-a produs.
    index('cost_lines_document_idx').on(t.documentType, t.documentId),
    // „Cat am angajat dar inca n-am consumat" — partial, ca sa nu creasca cu tot
    // registrul: stadiul `angajat` e o stare trecatoare, nu majoritatea liniilor.
    index('cost_lines_committed_idx')
      .on(t.companyId, t.stage)
      .where(sql`stage = 'angajat'`),
    /*
     * Indexul de reconciliere, si e cel elegant: contine EXACT anomaliile.
     * Raportul „folosit ≠ descarcat" (§12) devine un scan pe un index in care nu
     * intra nicio linie normala, pentru ca pe liniile normale cele doua analitici
     * sunt egale.
     */
    index('cost_lines_reconciliation_idx')
      .on(t.usedContractId)
      .where(sql`used_contract_id is distinct from charged_contract_id`),
    // Blocarea lunii inchise si recalcularea rollup-urilor citesc pe luna.
    index('cost_lines_period_idx').on(t.periodId),

    /*
     * Analitica „descarcat" e obligatorie de la `receptionat` incolo (regula 2
     * din pas). La `angajat` se stie ce se comanda inainte sa se stie pe ce
     * buget cade; o comanda lansata nu asteapta decizia de rutare.
     */
    check(
      'cost_lines_charged_required',
      sql`${t.stage} = 'angajat' or ${t.chargedContractId} is not null`,
    ),
    // Cantitatea si unitatea de masura merg impreuna: „14" fara „m" nu spune
    // nimic, iar „m" fara cifra nu spune nici atat. Ambele sau niciuna.
    check('cost_lines_quantity_pair', sql`num_nonnulls(${t.quantity}, ${t.uom}) <> 1`),
    check('cost_lines_uom_not_blank', sql`${t.uom} is null or length(btrim(${t.uom})) > 0`),
    // Componenta apartine contractului de pe aceeasi analitica — verificat in
    // migrare, prin trigger. Aici doar perechea: componenta fara contract n-are
    // cum sa fie verificata, deci n-are voie sa existe.
    check(
      'cost_lines_used_component_has_contract',
      sql`${t.usedComponentId} is null or ${t.usedContractId} is not null`,
    ),
    check(
      'cost_lines_charged_component_has_contract',
      sql`${t.chargedComponentId} is null or ${t.chargedContractId} is not null`,
    ),
    check('cost_lines_not_reallocation_of_self', sql`${t.reallocationOfId} is distinct from ${t.id}`),
  ],
);

export type CostLine = typeof costLines.$inferSelect;
export type NewCostLine = typeof costLines.$inferInsert;
