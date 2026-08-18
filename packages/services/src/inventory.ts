import type { CreateConsumptionNoteInput, CreateLocationInput } from '@damina/contracts';
import { createConsumptionNoteInputSchema, createLocationInputSchema } from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import { AppError, Money, Quantity, uuidv7 } from '@damina/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { recordCostTx } from './cost';
import { translateDbError } from './db-errors';

/**
 * Gestiuni, stoc si bonuri de consum (pasul 09, §3.4).
 *
 * Ce NU face serviciul, si e important: **nu tine el soldul**. Scrie o miscare
 * in `app.stock_movements`, iar trigger-ul din 0026 actualizeaza
 * `stock_balances`, verifica disponibilul si recalculeaza CMP-ul. Un serviciu
 * care ar scadea soldul cu mana lui ar fi a doua sursa de adevar, iar un import
 * sau un script viitor ar ocoli-o fara sa stie.
 *
 * Ce face: compune tranzactia. `issueConsumptionNoteTx` emite bonul, miscarile
 * SI liniile de cost pe o tranzactie deja deschisa — de aceea validarea unei
 * fise de interventie poate fi „totul sau nimic" (regula 8).
 */

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

// ── Gestiuni ─────────────────────────────────────────────────────────────────

export type LocationRow = typeof schema.locations.$inferSelect;

export interface ListLocationsOptions {
  readonly companyIds: readonly string[];
  readonly type?: string;
  readonly includeInactive?: boolean;
}

export async function listLocations(
  actor: Actor,
  options: ListLocationsOptions,
): Promise<LocationRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.locations)
      .where(
        and(
          inArray(schema.locations.companyId, [...options.companyIds]),
          options.type === undefined
            ? undefined
            : eq(schema.locations.type, options.type as LocationRow['type']),
          options.includeInactive === true ? undefined : eq(schema.locations.isActive, true),
        ),
      )
      .orderBy(asc(schema.locations.type), asc(schema.locations.name)),
  );
}

/**
 * Creeaza o gestiune. Verificarea #16 a pasului trece pe aici, si trece
 * negativ: nu exista drum prin care sa iasa o „gestiune de contract", fiindca
 * `type` e un enum de sapte valori fizice si niciuna nu e asta.
 */
export async function createLocation(
  actor: Actor,
  input: CreateLocationInput,
): Promise<{ readonly id: string }> {
  const values = createLocationInputSchema.parse(input);
  const id = uuidv7();

  try {
    return await withActor(actor, async (tx) => {
      await tx.insert(schema.locations).values({
        id,
        companyId: values.companyId,
        type: values.type,
        name: values.name,
        code: values.code,
        parentLocationId: values.parentLocationId,
        teamId: values.teamId,
        workUnitId: values.workUnitId,
        subcontractorId: values.subcontractorId,
        supplierId: values.supplierId,
        address:
          values.addressText === undefined || values.addressText === ''
            ? null
            : { text: values.addressText },
        isCustody: values.isCustody,
      });
      return { id };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

// ── Stoc ─────────────────────────────────────────────────────────────────────

export interface StockRow {
  readonly locationId: string;
  readonly locationName: string;
  readonly locationType: string;
  readonly productId: string;
  readonly productCode: string;
  readonly productName: string;
  readonly uom: string;
  readonly lotId: string | null;
  /** Cele trei coloane ale ecranului (verificarea #17). */
  readonly physical: Quantity;
  readonly reserved: Quantity;
  readonly available: Quantity;
  /** `null` pentru cine n-are dreptul la bani — coloana nici nu e ceruta atunci. */
  readonly avgCost: Money | null;
}

export interface ListStockOptions {
  readonly companyIds: readonly string[];
  readonly locationId?: string;
  readonly locationType?: string;
  readonly productId?: string;
  /** Fals pentru teren: `avg_cost` nu-i e acordata, deci nici nu se cere. */
  readonly withCost?: boolean;
}

/**
 * Stocul, cu **trei coloane: fizic / rezervat / disponibil**.
 *
 * Disponibilul se calculeaza aici, la citire, si nu exista ca a treia coloana in
 * baza — comentariul din schema spune de ce: ar fi a treia sursa de adevar
 * pentru acelasi numar, si prima care ar ramane in urma.
 */
export async function listStock(actor: Actor, options: ListStockOptions): Promise<StockRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }
  const withCost = options.withCost ?? true;

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        locationId: schema.stockBalances.locationId,
        locationName: schema.locations.name,
        locationType: schema.locations.type,
        productId: schema.stockBalances.productId,
        productCode: schema.products.code,
        productName: schema.products.name,
        uom: schema.products.uom,
        lotId: schema.stockBalances.lotId,
        physical: schema.stockBalances.qtyPhysical,
        reserved: schema.stockBalances.qtyReserved,
        // Coloana se cere DOAR daca apelantul are voie s-o vada. Cerand-o oricum
        // si ascunzand-o in UI, un `select` al terenului ar cadea cu „permission
        // denied for column avg_cost" — adica ecranul ar parea stricat.
        avgCost: withCost ? schema.stockBalances.avgCost : sql<null>`null`,
      })
      .from(schema.stockBalances)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.stockBalances.locationId))
      .innerJoin(schema.products, eq(schema.products.id, schema.stockBalances.productId))
      .where(
        and(
          inArray(schema.locations.companyId, [...options.companyIds]),
          options.locationId === undefined
            ? undefined
            : eq(schema.stockBalances.locationId, options.locationId),
          options.locationType === undefined
            ? undefined
            : eq(schema.locations.type, options.locationType as LocationRow['type']),
          options.productId === undefined
            ? undefined
            : eq(schema.stockBalances.productId, options.productId),
        ),
      )
      .orderBy(asc(schema.locations.name), asc(schema.products.name));

    return rows.map((row) => {
      const physical = Quantity.fromDb(row.physical);
      const reserved = Quantity.fromDb(row.reserved);
      return {
        locationId: row.locationId,
        locationName: row.locationName,
        locationType: row.locationType,
        productId: row.productId,
        productCode: row.productCode,
        productName: row.productName,
        uom: row.uom,
        lotId: row.lotId,
        physical,
        reserved,
        available: physical.sub(reserved),
        avgCost: row.avgCost === null ? null : Money.fromDb(row.avgCost),
      };
    });
  });
}

/** CMP-ul unei pozitii de stoc, citit inainte de a o consuma. */
async function unitCostOf(
  tx: ActorTx,
  locationId: string,
  productId: string,
  lotId: string | null,
): Promise<Money> {
  const [row] = await tx
    .select({ avgCost: schema.stockBalances.avgCost })
    .from(schema.stockBalances)
    .where(
      and(
        eq(schema.stockBalances.locationId, locationId),
        eq(schema.stockBalances.productId, productId),
        lotId === null ? isNull(schema.stockBalances.lotId) : eq(schema.stockBalances.lotId, lotId),
      ),
    )
    .limit(1);

  // Lipsa randului nu se trateaza aici: miscarea de stoc va cadea imediat cu
  // `STOCK_INSUFFICIENT`, care spune si cat e disponibilul. Un mesaj propriu
  // aici ar fi al doilea mesaj pentru aceeasi cauza.
  return Money.fromDb(row?.avgCost);
}

// ── Bonul de consum ──────────────────────────────────────────────────────────

export interface ConsumptionLineValues {
  readonly productId: string;
  readonly lotId: string | null;
  readonly quantity: string;
}

export interface IssueConsumptionNoteValues {
  readonly companyId: string;
  readonly series: string;
  readonly locationId: string;
  readonly workUnitId: string | null;
  readonly stageId: string | null;
  readonly contractId: string | null;
  readonly componentId: string | null;
  readonly objectiveId: string | null;
  readonly documentDate: string;
  readonly effectDate: string;
  readonly lines: readonly ConsumptionLineValues[];
}

export interface IssuedConsumptionNote {
  readonly id: string;
  readonly number: string;
  readonly total: Money;
  /** Cost unitar inghetat, pe produs × lot — ca sa-l poata scrie si apelantul. */
  readonly unitCosts: ReadonlyMap<string, Money>;
}

/** Cheia din `unitCosts`: produsul plus lotul, cu UUID-ul nul pentru „fara lot". */
export function unitCostKey(productId: string, lotId: string | null): string {
  return `${productId}:${lotId ?? NIL_UUID}`;
}

/**
 * Emite bonul de consum pe o tranzactie DEJA deschisa: document, linii, miscari
 * de stoc si linii de cost `consumat`.
 *
 * Ordinea nu e intamplatoare:
 *
 *   1. **CMP-ul se citeste inaintea miscarii.** O iesire nu schimba costul mediu,
 *      dar citirea de dupa ar fi o citire dintr-un rand pe care tocmai l-am
 *      modificat — fragila la prima schimbare de trigger.
 *   2. **Miscarea de stoc vine inaintea liniei de cost.** Daca stocul nu ajunge,
 *      trigger-ul opreste tot acolo, si nu ramane nici bon, nici cost
 *      (verificarile #9 si #11).
 *   3. **Numarul se cere cat mai tarziu** — ca la `createWorkUnitTx`: lock-ul de
 *      pe randul de serie se tine cat mai putin.
 */
export async function issueConsumptionNoteTx(
  tx: ActorTx,
  actor: Actor,
  values: IssueConsumptionNoteValues,
): Promise<IssuedConsumptionNote> {
  if (values.lines.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'Bonul de consum are nevoie de cel puțin o linie.');
  }

  const unitCosts = new Map<string, Money>();
  for (const line of values.lines) {
    unitCosts.set(
      unitCostKey(line.productId, line.lotId),
      await unitCostOf(tx, values.locationId, line.productId, line.lotId),
    );
  }

  const numberRows = await tx.execute<{ number: string }>(
    sql`select app.allocate_document_number(
          ${values.companyId}, 'bon_consum'::app.numbered_document_type, ${values.series}
        ) as number`,
  );
  const number = numberRows.rows[0]?.number;
  if (number === undefined) {
    throw new AppError('NOT_FOUND', `Seria ${values.series} nu e definită la firma asta.`);
  }

  const noteId = uuidv7();
  await tx.insert(schema.consumptionNotes).values({
    id: noteId,
    companyId: values.companyId,
    series: values.series,
    number,
    locationId: values.locationId,
    workUnitId: values.workUnitId,
    stageId: values.stageId,
    contractId: values.contractId,
    componentId: values.componentId,
    objectiveId: values.objectiveId,
    documentDate: values.documentDate,
    effectDate: values.effectDate,
    issuedBy: actor.personId,
    status: 'consumat',
  });

  let total = Money.ZERO;

  for (const line of values.lines) {
    const unitCost = unitCosts.get(unitCostKey(line.productId, line.lotId)) ?? Money.ZERO;
    const quantity = Quantity.fromDb(line.quantity);
    const amount = unitCost.mul(quantity.toDbString());
    total = total.add(amount);

    const lineId = uuidv7();
    await tx.insert(schema.consumptionLines).values({
      id: lineId,
      noteId,
      productId: line.productId,
      lotId: line.lotId,
      quantity: quantity.toDbString(),
      unitCost: unitCost.toDbString(),
    });

    await tx.insert(schema.stockMovements).values({
      id: uuidv7(),
      companyId: values.companyId,
      documentType: 'bon_consum',
      documentId: noteId,
      documentLineId: lineId,
      fromLocationId: values.locationId,
      toLocationId: null,
      productId: line.productId,
      lotId: line.lotId,
      quantity: quantity.toDbString(),
      unitCost: unitCost.toDbString(),
      effectDate: values.effectDate,
      createdBy: actor.personId,
    });

    const [product] = await tx
      .select({ uom: schema.products.uom })
      .from(schema.products)
      .where(eq(schema.products.id, line.productId))
      .limit(1);

    await recordCostTx(tx, actor, {
      companyId: values.companyId,
      documentDate: values.documentDate,
      effectDate: values.effectDate,
      usedContractId: values.contractId,
      usedComponentId: values.componentId,
      objectiveId: values.objectiveId,
      workUnitId: values.workUnitId,
      stageId: values.stageId,
      chargedContractId: null,
      chargedComponentId: null,
      expenseType: 'material',
      productId: line.productId,
      qualificationId: null,
      quantity: quantity.toDbString(),
      uom: product?.uom ?? 'buc',
      amount: amount.toDbString(),
      stage: 'consumat',
      documentType: 'bon_consum',
      documentId: noteId,
      documentLineId: lineId,
      supplierId: null,
      subcontractorId: null,
    });
  }

  return { id: noteId, number, total, unitCosts };
}

/** Bonul emis manual, din gestiunea echipei. Aceeasi mecanica, tranzactia lui. */
export async function createConsumptionNote(
  actor: Actor,
  input: CreateConsumptionNoteInput,
): Promise<IssuedConsumptionNote> {
  const values = createConsumptionNoteInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) =>
      issueConsumptionNoteTx(tx, actor, {
        companyId: values.companyId,
        series: values.series,
        locationId: values.locationId,
        workUnitId: values.workUnitId,
        stageId: values.stageId,
        contractId: values.contractId,
        componentId: values.componentId,
        objectiveId: values.objectiveId,
        documentDate: values.documentDate,
        effectDate: values.effectDate,
        lines: values.lines,
      }),
    );
  } catch (error) {
    return translateDbError(error);
  }
}

export type ConsumptionNoteRow = typeof schema.consumptionNotes.$inferSelect & {
  readonly locationName: string;
};

export async function listConsumptionNotes(
  actor: Actor,
  options: { readonly companyIds: readonly string[]; readonly workUnitId?: string },
): Promise<ConsumptionNoteRow[]> {
  if (options.companyIds.length === 0) {
    return [];
  }
  return withActor(actor, async (tx) =>
    tx
      .select({
        ...getConsumptionNoteColumns(),
        locationName: schema.locations.name,
      })
      .from(schema.consumptionNotes)
      .innerJoin(schema.locations, eq(schema.locations.id, schema.consumptionNotes.locationId))
      .where(
        and(
          inArray(schema.consumptionNotes.companyId, [...options.companyIds]),
          options.workUnitId === undefined
            ? undefined
            : eq(schema.consumptionNotes.workUnitId, options.workUnitId),
        ),
      )
      .orderBy(asc(schema.consumptionNotes.documentDate)),
  );
}

function getConsumptionNoteColumns() {
  return {
    id: schema.consumptionNotes.id,
    companyId: schema.consumptionNotes.companyId,
    series: schema.consumptionNotes.series,
    number: schema.consumptionNotes.number,
    locationId: schema.consumptionNotes.locationId,
    workUnitId: schema.consumptionNotes.workUnitId,
    stageId: schema.consumptionNotes.stageId,
    contractId: schema.consumptionNotes.contractId,
    componentId: schema.consumptionNotes.componentId,
    objectiveId: schema.consumptionNotes.objectiveId,
    documentDate: schema.consumptionNotes.documentDate,
    effectDate: schema.consumptionNotes.effectDate,
    periodId: schema.consumptionNotes.periodId,
    issuedBy: schema.consumptionNotes.issuedBy,
    status: schema.consumptionNotes.status,
    createdAt: schema.consumptionNotes.createdAt,
  };
}

// ── Verificarea nocturna a soldurilor ────────────────────────────────────────

export interface StockDivergence {
  readonly locationId: string;
  readonly locationName: string;
  readonly productId: string;
  readonly productName: string;
  readonly lotId: string | null;
  readonly stored: Quantity;
  readonly computed: Quantity;
  readonly difference: Quantity;
}

/**
 * Recalculeaza soldurile din miscari si le compara cu cele stocate
 * (verificarea #18). Un rand pe fiecare divergenta, cu produsul, gestiunea si
 * diferenta — restul (alerta, jurnalul) e treaba jobului care o cheama.
 */
export async function verifyStockBalances(actor: Actor): Promise<StockDivergence[]> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute<{
      location_id: string;
      location_name: string;
      product_id: string;
      product_name: string;
      lot_id: string | null;
      stored: string;
      computed: string;
      difference: string;
    }>(sql`
      select v.location_id, l.name as location_name,
             v.product_id, p.name as product_name,
             v.lot_id, v.stored, v.computed, v.difference
        from app.verify_stock_balances() v
        join app.locations l on l.id = v.location_id
        join app.products p on p.id = v.product_id
       order by l.name, p.name
    `);

    return result.rows.map((row) => ({
      locationId: row.location_id,
      locationName: row.location_name,
      productId: row.product_id,
      productName: row.product_name,
      lotId: row.lot_id,
      stored: Quantity.fromDb(row.stored),
      computed: Quantity.fromDb(row.computed),
      difference: Quantity.fromDb(row.difference),
    }));
  });
}

