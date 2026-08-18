import type { OperationInput, OperationMaterialsInput } from '@damina/contracts';
import { operationInputSchema, operationMaterialsInputSchema } from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import { AppError, Money } from '@damina/shared';
import { and, asc, desc, eq, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { sqlstate, SQLSTATE, translateDbError } from './db-errors';

/**
 * Catalogul de operatiuni (pasul 08, §3.2 si §8.5).
 *
 * Doua reguli il tin cinstit:
 *
 *   1. **Manopera NU se scrie de mana.** Se calculeaza aici, la fiecare scriere,
 *      din norma de timp × costul orar al calificarii, luat din tariful in
 *      vigoare AZI. Fara asta, pragul de rutare de 2.000 lei ar depinde de cine
 *      a tastat cifra, nu de operatiune.
 *   2. **Se STOCHEAZA, nu se recalculeaza la citire.** O cerere evaluata azi nu
 *      are voie sa-si schimbe valoarea maine, cand se schimba tariful orar.
 *      Cifrele vechi raman cele cu care s-a luat decizia; cele noi se obtin
 *      re-salvand operatiunea, adica printr-o decizie a cuiva.
 *
 * `operation_actuals` (costul real per echipa) e materializat de un trigger care
 * se ataseaza in pasul 09, la fisele de interventie. Aici se citeste doar —
 * ecranul „realizat vs estimat" e un `SELECT`, nu un raport calculat la cerere.
 */

const DEFAULT_LIMIT = 200;

function like(query: string): string {
  return `%${query.replace(/([%_\\])/g, '\\$1')}%`;
}

export interface OperationRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly category: string | null;
  readonly standardHours: string;
  readonly qualificationId: string;
  readonly qualificationName: string;
  readonly estimatedLabor: string;
  readonly estimatedMaterial: string;
  readonly isActive: boolean;
  /** Cate materiale tipice are declarate. Zero e o informatie, nu o lipsa. */
  readonly materialCount: number;
}

export interface ListOperationsOptions {
  readonly query?: string;
  readonly includeInactive?: boolean;
  readonly limit?: number;
}

export async function listOperations(
  actor: Actor,
  options: ListOperationsOptions = {},
): Promise<OperationRow[]> {
  return withActor(actor, async (tx) => selectOperations(tx, options));
}

async function selectOperations(
  tx: ActorTx,
  options: ListOperationsOptions,
): Promise<OperationRow[]> {
  const conditions = [];
  if (options.includeInactive !== true) {
    conditions.push(eq(schema.operationCatalog.isActive, true));
  }
  if (options.query !== undefined && options.query !== '') {
    const pattern = like(options.query);
    conditions.push(
      or(
        ilike(schema.operationCatalog.code, pattern),
        ilike(schema.operationCatalog.name, pattern),
        ilike(schema.operationCatalog.category, pattern),
      ),
    );
  }

  const materialCount = sql<number>`(
    select count(*)::int from ${schema.operationCatalogMaterials}
    where ${schema.operationCatalogMaterials.operationId} = ${schema.operationCatalog.id}
  )`;

  return tx
    .select({
      id: schema.operationCatalog.id,
      code: schema.operationCatalog.code,
      name: schema.operationCatalog.name,
      category: schema.operationCatalog.category,
      standardHours: schema.operationCatalog.standardHours,
      qualificationId: schema.operationCatalog.qualificationId,
      qualificationName: schema.qualifications.name,
      estimatedLabor: schema.operationCatalog.estimatedLabor,
      estimatedMaterial: schema.operationCatalog.estimatedMaterial,
      isActive: schema.operationCatalog.isActive,
      materialCount,
    })
    .from(schema.operationCatalog)
    .innerJoin(
      schema.qualifications,
      eq(schema.operationCatalog.qualificationId, schema.qualifications.id),
    )
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(schema.operationCatalog.code))
    .limit(options.limit ?? DEFAULT_LIMIT);
}

export async function getOperation(actor: Actor, id: string): Promise<OperationRow> {
  const [row] = await withActor(actor, async (tx) =>
    selectOperations(tx, { includeInactive: true, limit: 1000 }).then((rows) =>
      rows.filter((candidate) => candidate.id === id),
    ),
  );
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Operațiune inexistentă.');
  }
  return row;
}

// ── Manopera, derivata din tariful curent ────────────────────────────────────

/**
 * Costul orar al calificarii, din tariful in vigoare azi.
 *
 * Fara tarif curent operatiunea NU se salveaza: manopera ei ar fi zero, iar o
 * operatiune de zero lei ar trece pragul de mentenanta orice ar contine.
 */
async function currentHourlyCost(tx: ActorTx, qualificationId: string): Promise<Money> {
  const today = new Date().toISOString().slice(0, 10);
  const [rate] = await tx
    .select({ hourlyCost: schema.rateCards.hourlyCost })
    .from(schema.rateCards)
    .where(
      and(
        eq(schema.rateCards.qualificationId, qualificationId),
        lte(schema.rateCards.validFrom, today),
        or(isNull(schema.rateCards.validTo), sql`${schema.rateCards.validTo} >= ${today}`),
      ),
    )
    .orderBy(desc(schema.rateCards.validFrom))
    .limit(1);

  if (rate?.hourlyCost === null || rate === undefined) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Calificarea nu are tarif în vigoare azi. Manopera operațiunii se calculează din tarif — pune-l întâi în Tarife.',
    );
  }
  return Money.fromDb(rate.hourlyCost);
}

/** `id` explicit doar pentru seed si teste — ecranul nu-l trimite niciodata. */
export async function createOperation(
  actor: Actor,
  input: OperationInput,
  id?: string,
): Promise<{ readonly id: string }> {
  const values = operationInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const hourly = await currentHourlyCost(tx, values.qualificationId);
      const [created] = await tx
        .insert(schema.operationCatalog)
        .values({
          ...(id === undefined ? {} : { id }),
          code: values.code,
          name: values.name,
          category: values.category,
          standardHours: values.standardHours,
          qualificationId: values.qualificationId,
          estimatedLabor: hourly.mul(Number(values.standardHours)).toDbString(),
          estimatedMaterial: values.estimatedMaterial,
          isActive: values.isActive,
        })
        .returning({ id: schema.operationCatalog.id });
      return { id: created!.id };
    });
  } catch (error) {
    return translateOperationError(error, values.code);
  }
}

export async function updateOperation(
  actor: Actor,
  id: string,
  input: OperationInput,
): Promise<{ readonly id: string }> {
  const values = operationInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const hourly = await currentHourlyCost(tx, values.qualificationId);
      const updated = await tx
        .update(schema.operationCatalog)
        .set({
          code: values.code,
          name: values.name,
          category: values.category,
          standardHours: values.standardHours,
          qualificationId: values.qualificationId,
          estimatedLabor: hourly.mul(Number(values.standardHours)).toDbString(),
          estimatedMaterial: values.estimatedMaterial,
          isActive: values.isActive,
        })
        .where(eq(schema.operationCatalog.id, id))
        .returning({ id: schema.operationCatalog.id });

      if (updated.length === 0) {
        throw new AppError('NOT_FOUND', 'Operațiune inexistentă.');
      }
      return { id };
    });
  } catch (error) {
    return translateOperationError(error, values.code);
  }
}

/**
 * Codul unic e singura violare pe care catalogul o poate produce, deci se
 * traduce dupa SQLSTATE, nu dupa textul erorii: `DrizzleQueryError` ambaleaza
 * mesajul Postgres si o potrivire pe text n-ar prinde niciodata constrangerea.
 */
function translateOperationError(error: unknown, code: string): never {
  if (AppError.is(error)) {
    throw error;
  }
  if (sqlstate(error) === SQLSTATE.UNIQUE_VIOLATION) {
    throw new AppError('CONFLICT', `Codul „${code}” e deja folosit de altă operațiune.`);
  }
  return translateDbError(error);
}

// ── Materialele tipice ───────────────────────────────────────────────────────

export interface OperationMaterialRow {
  readonly productId: string;
  readonly productCode: string;
  readonly productName: string;
  readonly uom: string;
  readonly quantity: string;
}

export async function listOperationMaterials(
  actor: Actor,
  operationId: string,
): Promise<OperationMaterialRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        productId: schema.operationCatalogMaterials.productId,
        productCode: schema.products.code,
        productName: schema.products.name,
        uom: schema.products.uom,
        quantity: schema.operationCatalogMaterials.quantity,
      })
      .from(schema.operationCatalogMaterials)
      .innerJoin(schema.products, eq(schema.operationCatalogMaterials.productId, schema.products.id))
      .where(eq(schema.operationCatalogMaterials.operationId, operationId))
      .orderBy(asc(schema.products.code)),
  );
}

/**
 * Inlocuieste lista de materiale tipice a unei operatiuni, dintr-o bucata.
 *
 * Lista e CANTITATIVA, nu valorica, si nu atinge `estimated_material`: nu exista
 * inca un pret de referinta per produs in baza (preturile vin cu aprovizionarea,
 * faza 3), iar o suma calculata dintr-un pret inventat ar arata la fel de sigura
 * ca una reala. Pana atunci, materialul estimat e o cifra scrisa de om pe
 * operatiune, iar lista spune DIN CE e facuta — cine o citeste vede exact cat
 * se stie si cat nu.
 */
export async function setOperationMaterials(
  actor: Actor,
  input: OperationMaterialsInput,
): Promise<{ readonly id: string; readonly lines: number }> {
  const values = operationMaterialsInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const [operation] = await tx
        .select({ id: schema.operationCatalog.id })
        .from(schema.operationCatalog)
        .where(eq(schema.operationCatalog.id, values.operationId))
        .for('update');
      if (operation === undefined) {
        throw new AppError('NOT_FOUND', 'Operațiune inexistentă.');
      }

      await tx
        .delete(schema.operationCatalogMaterials)
        .where(eq(schema.operationCatalogMaterials.operationId, values.operationId));

      if (values.lines.length > 0) {
        await tx.insert(schema.operationCatalogMaterials).values(
          values.lines.map((line) => ({
            operationId: values.operationId,
            productId: line.productId,
            quantity: line.quantity,
          })),
        );
      }

      return { id: values.operationId, lines: values.lines.length };
    });
  } catch (error) {
    if (AppError.is(error)) {
      throw error;
    }
    return translateDbError(error);
  }
}

// ── Realizat vs estimat, pe echipe (verificarea #22) ─────────────────────────

export interface OperationActualRow {
  readonly teamId: string;
  readonly teamName: string;
  readonly executions: number;
  readonly avgRealCost: Money | null;
  readonly avgEstimatedCost: Money | null;
  /** Abaterea procentuala fata de estimat. `null` cand lipseste un termen. */
  readonly deviationPercent: number | null;
}

export interface OperationActualsReport {
  readonly executions: number;
  readonly avgRealCost: Money | null;
  readonly avgEstimatedCost: Money | null;
  readonly deviationPercent: number | null;
  readonly teams: readonly OperationActualRow[];
}

/**
 * Costul real mediu al unei operatiuni, total si pe echipe.
 *
 * Media generala se calculeaza PONDERAT cu numarul de executii, nu ca medie a
 * mediilor: o echipa cu doua executii n-are voie sa traga media la fel de tare
 * ca una cu douazeci.
 */
export async function operationActuals(
  actor: Actor,
  operationId: string,
): Promise<OperationActualsReport> {
  const rows = await withActor(actor, async (tx) =>
    tx
      .select({
        teamId: schema.operationActuals.teamId,
        teamName: schema.teams.name,
        executions: schema.operationActuals.executions,
        avgRealCost: schema.operationActuals.avgRealCost,
        avgEstimatedCost: schema.operationActuals.avgEstimatedCost,
      })
      .from(schema.operationActuals)
      .innerJoin(schema.teams, eq(schema.operationActuals.teamId, schema.teams.id))
      .where(eq(schema.operationActuals.operationId, operationId)),
  );

  // Acelasi (operatiune, echipa) apare pe mai multe luni. Ecranul cere per
  // echipa, deci lunile se aduna aici, ponderat cu executiile fiecareia.
  const byTeam = new Map<string, { name: string; executions: number; real: Money; est: Money }>();
  for (const row of rows) {
    const current = byTeam.get(row.teamId) ?? {
      name: row.teamName,
      executions: 0,
      real: Money.ZERO,
      est: Money.ZERO,
    };
    byTeam.set(row.teamId, {
      name: current.name,
      executions: current.executions + row.executions,
      real: current.real.add(Money.fromDb(row.avgRealCost).mul(row.executions)),
      est: current.est.add(Money.fromDb(row.avgEstimatedCost).mul(row.executions)),
    });
  }

  const teams: OperationActualRow[] = [...byTeam.entries()]
    .map(([teamId, entry]) => {
      const avgReal = entry.executions === 0 ? null : entry.real.div(entry.executions);
      const avgEst = entry.executions === 0 ? null : entry.est.div(entry.executions);
      return {
        teamId,
        teamName: entry.name,
        executions: entry.executions,
        avgRealCost: avgReal,
        avgEstimatedCost: avgEst,
        deviationPercent: deviation(avgReal, avgEst),
      };
    })
    .sort((a, b) => b.executions - a.executions);

  const executions = teams.reduce((sum, team) => sum + team.executions, 0);
  const totalReal = Money.sum([...byTeam.values()].map((entry) => entry.real));
  const totalEst = Money.sum([...byTeam.values()].map((entry) => entry.est));
  const avgRealCost = executions === 0 ? null : totalReal.div(executions);
  const avgEstimatedCost = executions === 0 ? null : totalEst.div(executions);

  return {
    executions,
    avgRealCost,
    avgEstimatedCost,
    deviationPercent: deviation(avgRealCost, avgEstimatedCost),
    teams,
  };
}

function deviation(real: Money | null, estimated: Money | null): number | null {
  if (real === null || estimated === null || estimated.isZero()) {
    return null;
  }
  return (
    Math.round(((real.toUnsafeNumber() - estimated.toUnsafeNumber()) / estimated.toUnsafeNumber()) *
      1000) / 10
  );
}
