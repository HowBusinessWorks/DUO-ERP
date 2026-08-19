import {
  adoptAsInternalInputSchema,
  createDevizInputSchema,
  devizCategoryInputSchema,
  devizLineInputSchema,
  freezeDevizInputSchema,
  listNormedArticlesInputSchema,
  mapDevizLinesInputSchema,
  moveDevizLineInputSchema,
  normedArticleInputSchema,
  saveAsNormedArticleInputSchema,
  unmapDevizLinesInputSchema,
  updateDevizLineInputSchema,
  updateDevizMarkupInputSchema,
  type AdoptAsInternalInput,
  type CreateDevizInput,
  type DevizCategoryInput,
  type DevizLineInput,
  type FreezeDevizInput,
  type ListNormedArticlesInput,
  type MapDevizLinesInput,
  type MoveDevizLineInput,
  type NormedArticleInput,
  type SaveAsNormedArticleInput,
  type UnmapDevizLinesInput,
  type UpdateDevizLineInput,
  type UpdateDevizMarkupInput,
} from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import {
  deriveOneToOne,
  explodeNormedArticle,
  rollupDeviz,
  validateMapping,
  type DevizRollup,
  type MappingCheck,
  type NormedComponentKind,
} from '@damina/domain';
import { AppError, Money, Quantity, uuidv7 } from '@damina/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { translateDbError } from './db-errors';

/**
 * Devizul si biblioteca de articole normate (pasul 11).
 *
 * **Doua devize, un singur modul.** Cel client e oferta si se versioneaza; cel
 * intern e al PM-ului, nu ajunge niciodata la client si nu se versioneaza
 * (§8.1). Diferenta nu e un `if` raspandit prin cod: e in `kind`, si fiecare
 * loc care se comporta altfel o spune pe fata.
 *
 * Ce NU e aici, si e dinadins:
 *
 *  - **niciun drept de citire pentru teren sau subcontractant.** Nu exista
 *    varianta „fara preturi" a acestor use-case-uri, fiindca nu exista ecran
 *    care s-o ceara: seful de santier nu vede devizul deloc (§10.3), iar
 *    subcontractantul vede pachetul lui, la pasul 12. Apararea e in grant-uri
 *    (`0040`), nu aici;
 *  - **niciun calcul de total scris a doua oara.** Totalul liniei il pune
 *    triggerul din baza, totalul devizului il calculeaza `rollupDeviz` din
 *    domeniu. Un al treilea loc ar diverge la prima rotunjire.
 */

// ── Citire ───────────────────────────────────────────────────────────────────

export interface DevizHead {
  readonly id: string;
  readonly workUnitId: string;
  readonly companyId: string;
  readonly kind: 'client' | 'intern';
  readonly status: string;
  readonly indirectPct: string | null;
  readonly profitPct: string | null;
}

export interface DevizCategoryRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly position: number;
  readonly name: string;
}

export interface DevizLineRow {
  readonly id: string;
  readonly categoryId: string | null;
  readonly position: number;
  readonly code: string | null;
  readonly name: string;
  readonly uom: string;
  readonly quantity: string;
  readonly stageId: string | null;
  readonly normedArticleId: string | null;
  readonly unitPrice: string;
  readonly materialCost: string;
  readonly laborCost: string;
  readonly equipmentCost: string;
  readonly transportCost: string;
  readonly total: string;
}

export interface DevizView {
  readonly head: DevizHead;
  readonly categories: readonly DevizCategoryRow[];
  readonly lines: readonly DevizLineRow[];
  readonly totals: DevizTotals;
}

/** Totalurile, ca siruri: ies din serviciu spre ecran, nu spre alt calcul. */
export interface DevizTotals {
  readonly direct: string;
  readonly material: string;
  readonly labor: string;
  readonly equipment: string;
  readonly transport: string;
  readonly indirect: string;
  readonly profit: string;
  readonly total: string;
  readonly categories: readonly {
    readonly categoryId: string;
    readonly parentId: string | null;
    readonly own: string;
    readonly direct: string;
  }[];
  readonly uncategorizedLineCount: number;
}

async function loadHead(tx: ActorTx, devizId: string): Promise<DevizHead> {
  const [row] = await tx
    .select({
      id: schema.devize.id,
      workUnitId: schema.devize.workUnitId,
      companyId: schema.devize.companyId,
      kind: schema.devize.kind,
      status: schema.devize.status,
      indirectPct: schema.devize.indirectPct,
      profitPct: schema.devize.profitPct,
    })
    .from(schema.devize)
    .where(eq(schema.devize.id, devizId))
    .limit(1);

  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Devizul nu există sau nu-ți e vizibil.');
  }
  return { ...row, kind: row.kind as 'client' | 'intern' };
}

async function loadCategories(tx: ActorTx, devizId: string): Promise<DevizCategoryRow[]> {
  return tx
    .select({
      id: schema.devizCategories.id,
      parentId: schema.devizCategories.parentId,
      position: schema.devizCategories.position,
      name: schema.devizCategories.name,
    })
    .from(schema.devizCategories)
    .where(eq(schema.devizCategories.devizId, devizId))
    .orderBy(schema.devizCategories.position);
}

async function loadLines(tx: ActorTx, devizId: string): Promise<DevizLineRow[]> {
  return tx
    .select({
      id: schema.devizLines.id,
      categoryId: schema.devizLines.categoryId,
      position: schema.devizLines.position,
      code: schema.devizLines.code,
      name: schema.devizLines.name,
      uom: schema.devizLines.uom,
      quantity: schema.devizLines.quantity,
      stageId: schema.devizLines.stageId,
      normedArticleId: schema.devizLines.normedArticleId,
      unitPrice: schema.devizLines.unitPrice,
      materialCost: schema.devizLines.materialCost,
      laborCost: schema.devizLines.laborCost,
      equipmentCost: schema.devizLines.equipmentCost,
      transportCost: schema.devizLines.transportCost,
      total: schema.devizLines.total,
    })
    .from(schema.devizLines)
    .where(eq(schema.devizLines.devizId, devizId))
    .orderBy(schema.devizLines.position);
}

function computeTotals(
  head: DevizHead,
  categories: readonly DevizCategoryRow[],
  lines: readonly DevizLineRow[],
): DevizRollup {
  return rollupDeviz({
    lines: lines.map((line) => ({
      id: line.id,
      categoryId: line.categoryId,
      quantity: Quantity.fromDb(line.quantity),
      unitPrice: Money.fromDb(line.unitPrice),
      materialCost: Money.fromDb(line.materialCost),
      laborCost: Money.fromDb(line.laborCost),
      equipmentCost: Money.fromDb(line.equipmentCost),
      transportCost: Money.fromDb(line.transportCost),
    })),
    categories: categories.map((category) => ({ id: category.id, parentId: category.parentId })),
    indirectPct: head.indirectPct,
    profitPct: head.profitPct,
  });
}

const asTotals = (rollup: DevizRollup): DevizTotals => ({
  direct: rollup.direct.toDbString(),
  material: rollup.material.toDbString(),
  labor: rollup.labor.toDbString(),
  equipment: rollup.equipment.toDbString(),
  transport: rollup.transport.toDbString(),
  indirect: rollup.indirect.toDbString(),
  profit: rollup.profit.toDbString(),
  total: rollup.total.toDbString(),
  categories: rollup.categories.map((category) => ({
    categoryId: category.categoryId,
    parentId: category.parentId,
    own: category.own.toDbString(),
    direct: category.direct.toDbString(),
  })),
  uncategorizedLineCount: rollup.uncategorizedLineCount,
});

/** Devizul intreg, cu totalurile calculate din domeniu. */
export async function readDeviz(actor: Actor, devizId: string): Promise<DevizView> {
  return withActor(actor, async (tx) => {
    const head = await loadHead(tx, devizId);
    const [categories, lines] = await Promise.all([
      loadCategories(tx, devizId),
      loadLines(tx, devizId),
    ]);
    return { head, categories, lines, totals: asTotals(computeTotals(head, categories, lines)) };
  });
}

/** Devizele unei lucrari: cel client, cel intern, sau niciunul. */
export async function listDevizeForWorkUnit(
  actor: Actor,
  workUnitId: string,
): Promise<readonly DevizHead[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.devize.id,
        workUnitId: schema.devize.workUnitId,
        companyId: schema.devize.companyId,
        kind: schema.devize.kind,
        status: schema.devize.status,
        indirectPct: schema.devize.indirectPct,
        profitPct: schema.devize.profitPct,
      })
      .from(schema.devize)
      .where(eq(schema.devize.workUnitId, workUnitId));
    return rows.map((row) => ({ ...row, kind: row.kind as 'client' | 'intern' }));
  });
}

// ── Capul devizului ──────────────────────────────────────────────────────────

/**
 * Creeaza devizul unei lucrari.
 *
 * Indirectele si profitul se refuza pe `intern` **si aici, si in baza**, si nu
 * e redundanta degeaba: `check`-ul din `0040` apara datele de orice cale de
 * scriere, iar validarea de aici da omului o propozitie in romana in loc de un
 * `23514` pe care ecranul nu-l poate traduce.
 */
export async function createDeviz(
  actor: Actor,
  input: CreateDevizInput,
): Promise<{ readonly id: string }> {
  const values = createDevizInputSchema.parse(input);

  if (values.kind === 'intern' && (values.indirectPct != null || values.profitPct != null)) {
    throw AppError.validation({
      indirectPct:
        'Devizul intern n-are indirecte și profit: e cost direct. Ele se pun pe devizul client.',
    });
  }

  const id = uuidv7();

  try {
    await withActor(actor, async (tx) => {
      const [workUnit] = await tx
        .select({ id: schema.workUnits.id, companyId: schema.workUnits.companyId })
        .from(schema.workUnits)
        .where(eq(schema.workUnits.id, values.workUnitId))
        .limit(1);

      if (workUnit === undefined) {
        throw new AppError('NOT_FOUND', 'Lucrarea nu există sau nu-ți e vizibilă.');
      }

      await tx.insert(schema.devize).values({
        id,
        workUnitId: values.workUnitId,
        companyId: workUnit.companyId,
        kind: values.kind,
        indirectPct: values.indirectPct ?? null,
        profitPct: values.profitPct ?? null,
        createdBy: actor.personId,
      });
    });
  } catch (error) {
    if (AppError.is(error)) {
      throw error;
    }
    return translateDbError(error);
  }

  return { id };
}

/** Indirectele si profitul, pe devizul client. Pe cel intern, refuzate. */
export async function updateDevizMarkup(
  actor: Actor,
  input: UpdateDevizMarkupInput,
): Promise<void> {
  const values = updateDevizMarkupInputSchema.parse(input);

  await withActor(actor, async (tx) => {
    const head = await loadHead(tx, values.devizId);
    if (head.kind !== 'client') {
      throw AppError.validation({
        indirectPct:
          'Devizul intern n-are indirecte și profit: e cost direct. Ele se pun pe devizul client.',
      });
    }

    await tx
      .update(schema.devize)
      .set({ indirectPct: values.indirectPct, profitPct: values.profitPct })
      .where(eq(schema.devize.id, values.devizId));
  });
}

// ── Categorii si linii ───────────────────────────────────────────────────────

export async function addDevizCategory(
  actor: Actor,
  input: DevizCategoryInput,
): Promise<{ readonly id: string }> {
  const values = devizCategoryInputSchema.parse(input);
  const id = uuidv7();

  try {
    await withActor(actor, async (tx) => {
      await tx.insert(schema.devizCategories).values({
        id,
        devizId: values.devizId,
        parentId: values.parentId ?? null,
        position: values.position,
        name: values.name,
      });
    });
  } catch (error) {
    return translateDbError(error);
  }

  return { id };
}

export async function addDevizLine(
  actor: Actor,
  input: DevizLineInput,
): Promise<{ readonly id: string }> {
  const values = devizLineInputSchema.parse(input);
  const id = uuidv7();

  try {
    await withActor(actor, async (tx) => {
      await tx.insert(schema.devizLines).values({
        id,
        devizId: values.devizId,
        categoryId: values.categoryId ?? null,
        position: values.position,
        code: values.code ?? null,
        name: values.name,
        uom: values.uom,
        quantity: values.quantity,
        stageId: values.stageId ?? null,
        normedArticleId: values.normedArticleId ?? null,
        unitPrice: values.unitPrice ?? '0',
        materialCost: values.materialCost ?? '0',
        laborCost: values.laborCost ?? '0',
        equipmentCost: values.equipmentCost ?? '0',
        transportCost: values.transportCost ?? '0',
      });
    });
  } catch (error) {
    return translateDbError(error);
  }

  return { id };
}

/**
 * Modifica o pozitie. Doar campurile trimise se ating.
 *
 * `total` si, pe devizul intern, `unit_price` lipsesc din lista dinadins: le
 * calculeaza triggerul din baza. Un serviciu care le-ar scrie ar fi a doua
 * sursa de adevar pentru acelasi numar.
 */
export async function updateDevizLine(actor: Actor, input: UpdateDevizLineInput): Promise<void> {
  const values = updateDevizLineInputSchema.parse(input);
  const { lineId, devizId: _ignored, ...rest } = values;

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      patch[key] = value;
    }
  }

  if (Object.keys(patch).length === 0) {
    return;
  }

  try {
    await withActor(actor, async (tx) => {
      await tx.update(schema.devizLines).set(patch).where(eq(schema.devizLines.id, lineId));
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/** Muta linia sub alta operatiune, sau in alta pozitie. */
export async function moveDevizLine(actor: Actor, input: MoveDevizLineInput): Promise<void> {
  const values = moveDevizLineInputSchema.parse(input);

  try {
    await withActor(actor, async (tx) => {
      await tx
        .update(schema.devizLines)
        .set({ categoryId: values.categoryId, position: values.position })
        .where(eq(schema.devizLines.id, values.lineId));
    });
  } catch (error) {
    return translateDbError(error);
  }
}

export async function deleteDevizLine(actor: Actor, lineId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.delete(schema.devizLines).where(eq(schema.devizLines.id, lineId));
  });
}

// ── Inghetarea devizului client ──────────────────────────────────────────────

export interface FrozenVersion {
  readonly versionId: string;
  readonly version: number;
  readonly total: string;
}

/**
 * Ingheata devizul client si produce versiunea urmatoare.
 *
 * **Singura operatie ireversibila a pasului**, deci cere motiv scris — ca
 * plafoanele de la 04. Devizul RAMANE editabil dupa inghet: modificarea de
 * maine nu atinge versiunea de azi, ci produce versiunea de poimaine. Asta e
 * chiar verificarea #7, si e alt lucru decat „documentul se blocheaza".
 */
export async function freezeClientDeviz(
  actor: Actor,
  input: FreezeDevizInput,
): Promise<FrozenVersion> {
  const values = freezeDevizInputSchema.parse(input);
  const versionId = uuidv7();

  return withActor(actor, async (tx) => {
    const head = await loadHead(tx, values.devizId);
    if (head.kind !== 'client') {
      throw AppError.validation({
        devizId: 'Devizul intern nu se îngheață: e document intern, fără versiuni oficiale.',
      });
    }

    const [categories, lines] = await Promise.all([
      loadCategories(tx, values.devizId),
      loadLines(tx, values.devizId),
    ]);

    if (lines.length === 0) {
      throw AppError.validation({ devizId: 'Devizul n-are nicio poziție de înghețat.' });
    }

    const [previous] = await tx
      .select({ version: sql<number>`coalesce(max(${schema.devizVersions.version}), 0)` })
      .from(schema.devizVersions)
      .where(eq(schema.devizVersions.devizId, values.devizId));

    const version = (previous?.version ?? 0) + 1;
    const totals = computeTotals(head, categories, lines);

    await tx.insert(schema.devizVersions).values({
      id: versionId,
      devizId: values.devizId,
      version,
      // Copia continutului, nu o legatura catre randurile vii: peste un an,
      // versiunea trebuie sa spuna ce s-a trimis, nu ce e acum.
      lines: { categories, lines },
      total: totals.total.toDbString(),
      indirectPct: head.indirectPct,
      profitPct: head.profitPct,
      reason: values.reason,
      frozenBy: actor.personId,
    });

    return { versionId, version, total: totals.total.toDbString() };
  });
}

// ── „Preia ca deviz intern" ──────────────────────────────────────────────────

export interface AdoptResult {
  readonly devizId: string;
  readonly lineCount: number;
  readonly mappingCount: number;
}

/**
 * Cloneaza devizul client ca deviz intern, cu mapare 1:1.
 *
 * **Totul intr-o singura tranzactie** (verificarea #4): un deviz intern creat
 * fara maparile lui ar arata exact ca unul mapat corect, doar ca situatiile de
 * lucrari n-ar mai urca nicaieri — si s-ar afla la pasul 14, peste doua sesiuni.
 *
 * Costurile pornesc de la zero, nu de la pretul ofertat. Motivul e scris pe
 * `deriveOneToOne`, in domeniu: un cost gol se vede ca gol, unul copiat trece
 * drept estimare.
 */
export async function adoptAsInternal(
  actor: Actor,
  input: AdoptAsInternalInput,
): Promise<AdoptResult> {
  const values = adoptAsInternalInputSchema.parse(input);

  return withActor(actor, async (tx) => {
    const existing = await tx
      .select({
        id: schema.devize.id,
        kind: schema.devize.kind,
        companyId: schema.devize.companyId,
      })
      .from(schema.devize)
      .where(eq(schema.devize.workUnitId, values.workUnitId));

    const client = existing.find((row) => row.kind === 'client');
    if (client === undefined) {
      throw new AppError('NOT_FOUND', 'Lucrarea n-are deviz client de preluat.');
    }
    if (existing.some((row) => row.kind === 'intern')) {
      throw new AppError(
        'CONFLICT',
        'Lucrarea are deja un deviz intern. Preluarea l-ar suprascrie.',
      );
    }

    const [categories, lines] = await Promise.all([
      loadCategories(tx, client.id),
      loadLines(tx, client.id),
    ]);

    const internId = uuidv7();
    await tx.insert(schema.devize).values({
      id: internId,
      workUnitId: values.workUnitId,
      companyId: client.companyId,
      kind: 'intern',
      createdBy: actor.personId,
    });

    // Categoriile se copiaza pastrand ierarhia: intai nivelul 1, apoi copiii,
    // ca `parent_id` sa arate catre randul deja scris in devizul nou.
    const categoryMap = new Map<string, string>();
    for (const category of categories.filter((c) => c.parentId === null)) {
      const newId = uuidv7();
      categoryMap.set(category.id, newId);
      await tx.insert(schema.devizCategories).values({
        id: newId,
        devizId: internId,
        parentId: null,
        position: category.position,
        name: category.name,
      });
    }
    for (const category of categories.filter((c) => c.parentId !== null)) {
      const newId = uuidv7();
      categoryMap.set(category.id, newId);
      await tx.insert(schema.devizCategories).values({
        id: newId,
        devizId: internId,
        parentId: categoryMap.get(category.parentId ?? '') ?? null,
        position: category.position,
        name: category.name,
      });
    }

    const drafts = deriveOneToOne(
      lines.map((line) => ({
        id: line.id,
        categoryId: line.categoryId,
        code: line.code,
        name: line.name,
        uom: line.uom,
        quantity: Quantity.fromDb(line.quantity),
        stageId: line.stageId,
        position: line.position,
      })),
    );

    for (const draft of drafts) {
      const internLineId = uuidv7();
      await tx.insert(schema.devizLines).values({
        id: internLineId,
        devizId: internId,
        categoryId:
          draft.categoryId === null ? null : (categoryMap.get(draft.categoryId) ?? null),
        position: draft.position,
        code: draft.code,
        name: draft.name,
        uom: draft.uom,
        quantity: draft.quantity.toDbString(),
        stageId: draft.stageId,
      });
      await tx.insert(schema.devizLineMappings).values({
        id: uuidv7(),
        clientLineId: draft.clientLineId,
        internLineId,
        coefficient: draft.coefficient.toDbString(),
      });
    }

    return { devizId: internId, lineCount: drafts.length, mappingCount: drafts.length };
  });
}

// ── Maparea N:M ──────────────────────────────────────────────────────────────

export async function mapDevizLines(actor: Actor, input: MapDevizLinesInput): Promise<void> {
  const values = mapDevizLinesInputSchema.parse(input);

  try {
    await withActor(actor, async (tx) => {
      for (const pair of values.pairs) {
        await tx
          .insert(schema.devizLineMappings)
          .values({
            id: uuidv7(),
            clientLineId: pair.clientLineId,
            internLineId: pair.internLineId,
            coefficient: pair.coefficient,
          })
          .onConflictDoUpdate({
            target: [
              schema.devizLineMappings.clientLineId,
              schema.devizLineMappings.internLineId,
            ],
            set: { coefficient: pair.coefficient },
          });
      }
    });
  } catch (error) {
    return translateDbError(error);
  }
}

export async function unmapDevizLines(actor: Actor, input: UnmapDevizLinesInput): Promise<void> {
  const values = unmapDevizLinesInputSchema.parse(input);

  await withActor(actor, async (tx) => {
    await tx
      .delete(schema.devizLineMappings)
      .where(inArray(schema.devizLineMappings.id, values.mappingIds));
  });
}

/**
 * Ce lipseste din maparea unei lucrari. **Raporteaza, nu blocheaza** (regula 6).
 *
 * Blocajul apare abia la pasul 14, cand din mapare se deriva situatia de lucrari
 * catre client si o pozitie interna nemapata ar insemna sa facturezi mai putin
 * decat ai executat.
 */
export async function checkDevizMapping(
  actor: Actor,
  workUnitId: string,
): Promise<MappingCheck> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({ id: schema.devizLines.id, kind: schema.devize.kind })
      .from(schema.devizLines)
      .innerJoin(schema.devize, eq(schema.devize.id, schema.devizLines.devizId))
      .where(eq(schema.devize.workUnitId, workUnitId));

    const clientLineIds = rows.filter((r) => r.kind === 'client').map((r) => r.id);
    const internLineIds = rows.filter((r) => r.kind === 'intern').map((r) => r.id);

    const mappings =
      clientLineIds.length === 0
        ? []
        : await tx
            .select({
              clientLineId: schema.devizLineMappings.clientLineId,
              internLineId: schema.devizLineMappings.internLineId,
              coefficient: schema.devizLineMappings.coefficient,
            })
            .from(schema.devizLineMappings)
            .where(inArray(schema.devizLineMappings.clientLineId, clientLineIds));

    return validateMapping(
      clientLineIds,
      internLineIds,
      mappings.map((m) => ({
        clientLineId: m.clientLineId,
        internLineId: m.internLineId,
        coefficient: Quantity.fromDb(m.coefficient),
      })),
    );
  });
}

// ── Biblioteca de articole normate ───────────────────────────────────────────

export async function createNormedArticle(
  actor: Actor,
  input: NormedArticleInput,
): Promise<{ readonly id: string }> {
  const values = normedArticleInputSchema.parse(input);
  const id = uuidv7();

  try {
    await withActor(actor, async (tx) => {
      await tx.insert(schema.normedArticles).values({
        id,
        companyId: values.companyId,
        code: values.code,
        name: values.name,
        uom: values.uom,
        createdBy: actor.personId,
      });

      await tx.insert(schema.normedArticleComponents).values(
        values.components.map((component) => ({
          id: uuidv7(),
          articleId: id,
          kind: component.kind,
          productId: component.productId ?? null,
          qualificationId: component.qualificationId ?? null,
          position: component.position,
          quantityPerUom: component.quantityPerUom,
          normHours: component.normHours ?? null,
        })),
      );
    });
  } catch (error) {
    return translateDbError(error);
  }

  return { id };
}

/** Cele patru feluri de cost ale unei linii, in ordinea in care se citesc. */
const COST_KINDS: readonly (readonly [NormedComponentKind, keyof DevizLineRow])[] = [
  ['material', 'materialCost'],
  ['manopera', 'laborCost'],
  ['utilaj', 'equipmentCost'],
  ['transport', 'transportCost'],
];

/**
 * „Salveaza pozitia ca articol normat" — drumul prin care biblioteca creste.
 *
 * Componentele se deduc din felurile de cost care au valoare pe linie, cu
 * cantitatea 1 pe unitatea de masura a articolului. Legatura catre nomenclator
 * si norma de timp raman goale: linia nu le are de unde sti, iar devizistul le
 * completeaza cand trece prin biblioteca. Un articol incomplet e mai bun decat
 * unul inexistent — asta e chiar pariul din §3.2.
 */
export async function saveAsNormedArticle(
  actor: Actor,
  input: SaveAsNormedArticleInput,
): Promise<{ readonly id: string }> {
  const values = saveAsNormedArticleInputSchema.parse(input);
  const articleId = uuidv7();

  try {
    await withActor(actor, async (tx) => {
      const [line] = await tx
        .select({
          id: schema.devizLines.id,
          name: schema.devizLines.name,
          uom: schema.devizLines.uom,
          companyId: schema.devize.companyId,
          materialCost: schema.devizLines.materialCost,
          laborCost: schema.devizLines.laborCost,
          equipmentCost: schema.devizLines.equipmentCost,
          transportCost: schema.devizLines.transportCost,
        })
        .from(schema.devizLines)
        .innerJoin(schema.devize, eq(schema.devize.id, schema.devizLines.devizId))
        .where(eq(schema.devizLines.id, values.lineId))
        .limit(1);

      if (line === undefined) {
        throw new AppError('NOT_FOUND', 'Poziția nu există sau nu-ți e vizibilă.');
      }

      await tx.insert(schema.normedArticles).values({
        id: articleId,
        companyId: line.companyId,
        code: values.code,
        name: line.name,
        uom: line.uom,
        createdBy: actor.personId,
      });

      const components = COST_KINDS.filter(
        ([, column]) => !Money.fromDb(line[column as keyof typeof line] as string).isZero(),
      ).map(([kind], index) => ({
        id: uuidv7(),
        articleId,
        kind,
        position: index + 1,
        quantityPerUom: '1',
      }));

      // O linie fara niciun cost completat da un articol cu o componenta de
      // material: structura minima pe care devizistul o poate corecta. Un
      // articol fara nicio componenta n-ar putea fi explodat inapoi in deviz.
      await tx.insert(schema.normedArticleComponents).values(
        components.length > 0
          ? components
          : [{ id: uuidv7(), articleId, kind: 'material', position: 1, quantityPerUom: '1' }],
      );

      await tx
        .update(schema.devizLines)
        .set({ normedArticleId: articleId })
        .where(eq(schema.devizLines.id, values.lineId));
    });
  } catch (error) {
    if (AppError.is(error)) {
      throw error;
    }
    return translateDbError(error);
  }

  return { id: articleId };
}

export interface NormedArticleUsage {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly uom: string;
  readonly isActive: boolean;
  readonly componentCount: number;
  /** De cate ori a fost folosit — numarul de linii de deviz care-l poarta. */
  readonly usageCount: number;
  /** In ce lucrari. Cifra si lista sunt argumentul pentru care se intretine. */
  readonly workUnits: readonly { readonly id: string; readonly code: string; readonly name: string }[];
}

interface UsageRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  uom: string;
  is_active: boolean;
  component_count: number;
  usage_count: number;
  work_units: readonly { id: string; code: string; name: string }[];
}

/**
 * Biblioteca, cu numarul de folosiri si lucrarile in care apare (§17).
 *
 * **Se calculeaza, nu se tine ca si contor.** Un contor denormalizat se
 * desincronizeaza tacut la prima stergere de linie, iar asta e chiar cifra care
 * justifica intretinerea bibliotecii: daca minte, nimeni n-o mai foloseste ca
 * argument, si biblioteca moare.
 */
export async function listNormedArticles(
  actor: Actor,
  input: ListNormedArticlesInput,
): Promise<readonly NormedArticleUsage[]> {
  const values = listNormedArticlesInputSchema.parse(input);
  const search = values.search === undefined || values.search === '' ? null : `%${values.search}%`;

  return withActor(actor, async (tx) => {
    const result = await tx.execute<UsageRow>(sql`
      select a.id,
             a.code,
             a.name,
             a.uom,
             a.is_active,
             (select count(*)::int from app.normed_article_components c where c.article_id = a.id)
               as component_count,
             count(l.id)::int as usage_count,
             coalesce(
               jsonb_agg(distinct jsonb_build_object('id', wu.id, 'code', wu.code, 'name', wu.name))
                 filter (where wu.id is not null),
               '[]'::jsonb
             ) as work_units
        from app.normed_articles a
        left join app.deviz_lines l on l.normed_article_id = a.id
        left join app.devize d on d.id = l.deviz_id
        left join app.work_units wu on wu.id = d.work_unit_id
       where a.company_id = ${values.companyId}
         and (${values.includeInactive ?? false} or a.is_active)
         and (${search}::text is null or a.code ilike ${search} or a.name ilike ${search})
       group by a.id
       order by a.code`);

    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      uom: row.uom,
      isActive: row.is_active,
      componentCount: row.component_count,
      usageCount: row.usage_count,
      workUnits: row.work_units,
    }));
  });
}

export interface PutNormedArticleInput {
  readonly devizId: string;
  readonly articleId: string;
  readonly quantity: string;
  readonly categoryId?: string | null;
  readonly startPosition?: number;
}

/**
 * Pune un articol normat in deviz: o linie per componenta.
 *
 * Preturile raman zero — vin din nomenclator si din `rate_cards`, si le
 * completeaza devizistul sau, mai tarziu, importatorul de preturi. Ce conteaza
 * acum e ca `normed_article_id` ramane pe fiecare linie: din el se calculeaza
 * „de cate ori a fost folosit articolul", cifra din §17.
 */
export async function putNormedArticleIntoDeviz(
  actor: Actor,
  input: PutNormedArticleInput,
): Promise<{ readonly lineIds: readonly string[] }> {
  const quantity = Quantity.of(input.quantity);

  return withActor(actor, async (tx) => {
    const [article] = await tx
      .select({
        id: schema.normedArticles.id,
        code: schema.normedArticles.code,
        name: schema.normedArticles.name,
        uom: schema.normedArticles.uom,
      })
      .from(schema.normedArticles)
      .where(eq(schema.normedArticles.id, input.articleId))
      .limit(1);

    if (article === undefined) {
      throw new AppError('NOT_FOUND', 'Articolul normat nu există sau nu-ți e vizibil.');
    }

    const components = await tx
      .select({
        id: schema.normedArticleComponents.id,
        kind: schema.normedArticleComponents.kind,
        productId: schema.normedArticleComponents.productId,
        qualificationId: schema.normedArticleComponents.qualificationId,
        position: schema.normedArticleComponents.position,
        quantityPerUom: schema.normedArticleComponents.quantityPerUom,
        normHours: schema.normedArticleComponents.normHours,
      })
      .from(schema.normedArticleComponents)
      .where(eq(schema.normedArticleComponents.articleId, input.articleId));

    const [last] = await tx
      .select({ position: sql<number>`coalesce(max(${schema.devizLines.position}), 0)` })
      .from(schema.devizLines)
      .where(eq(schema.devizLines.devizId, input.devizId));

    const offset = input.startPosition ?? (last?.position ?? 0);

    const exploded = explodeNormedArticle(
      article,
      components.map((component) => ({
        id: component.id,
        kind: component.kind as NormedComponentKind,
        productId: component.productId,
        qualificationId: component.qualificationId,
        label: component.kind,
        uom: component.kind === 'manopera' ? 'ore' : article.uom,
        quantityPerUom: Quantity.fromDb(component.quantityPerUom),
        normHours: component.normHours === null ? null : Quantity.fromDb(component.normHours),
        position: component.position,
      })),
      quantity,
    );

    const lineIds: string[] = [];
    for (const line of exploded) {
      const lineId = uuidv7();
      lineIds.push(lineId);
      await tx.insert(schema.devizLines).values({
        id: lineId,
        devizId: input.devizId,
        categoryId: input.categoryId ?? null,
        position: offset + line.position,
        code: line.code,
        name: line.name,
        uom: line.uom,
        quantity: line.quantity.toDbString(),
        normedArticleId: article.id,
      });
    }

    return { lineIds };
  });
}

/** Sabloanele de deviz, pe tip de obiectiv. */
export async function listDevizTemplates(
  actor: Actor,
  companyId: string,
  objectiveKind?: string,
): Promise<readonly { readonly id: string; readonly name: string; readonly sourceDevizId: string }[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: schema.devizTemplates.id,
        name: schema.devizTemplates.name,
        sourceDevizId: schema.devizTemplates.sourceDevizId,
      })
      .from(schema.devizTemplates)
      .where(
        objectiveKind === undefined
          ? and(
              eq(schema.devizTemplates.companyId, companyId),
              eq(schema.devizTemplates.isActive, true),
            )
          : and(
              eq(schema.devizTemplates.companyId, companyId),
              eq(schema.devizTemplates.isActive, true),
              eq(schema.devizTemplates.objectiveKind, objectiveKind),
            ),
      ),
  );
}
