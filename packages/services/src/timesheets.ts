import type {
  SaveTimesheetInput,
  SubcontractorAttendanceInput,
  ValidateTimesheetsInput,
} from '@damina/contracts';
import {
  saveTimesheetInputSchema,
  subcontractorAttendanceInputSchema,
  validateTimesheetsInputSchema,
} from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import { rateCardAt, timesheetTotals } from '@damina/domain';
import { AppError, Money, Quantity, uuidv7 } from '@damina/shared';
import { and, asc, between, eq, inArray, sql } from 'drizzle-orm';
import { recordCostTx } from './cost';
import { translateDbError } from './db-errors';

/**
 * Pontajul (pasul 09, §3.3).
 *
 * Cele doua reguli ale pasului se vad direct in cod:
 *
 *   - **ziua se imparte pe mai multe unitati** — `saveTimesheet` primeste LINII,
 *     iar trigger-ul din 0026 verifica totalul, nu linia (verificarile #12, #13);
 *   - **tariful se ingheata la validare** — `validateTimesheets` scrie
 *     `rate_card_id` si `hourly_cost` cu tariful valabil la `work_date`, si de
 *     acolo o schimbare de tarif nu mai atinge costul (#14, #15).
 *
 * Pontajul de subcontractant sta in acelasi fisier, dar nu produce nicio linie
 * de cost — si asta nu e o omisiune, e definitia lui: instrument de control, nu
 * de plata (regula 6).
 */

// ── Completare ───────────────────────────────────────────────────────────────

/**
 * Scrie pontajul unei zile, cu liniile lui. Idempotent pe (persoana, zi):
 * a doua salvare rescrie liniile, nu adauga un al doilea pontaj.
 */
export async function saveTimesheet(
  actor: Actor,
  input: SaveTimesheetInput,
): Promise<{ readonly id: string; readonly totalHours: Quantity }> {
  const values = saveTimesheetInputSchema.parse(input);

  const totals = timesheetTotals(
    values.lines.map((l) => ({ workUnitId: l.workUnitId, hours: Quantity.fromDb(l.hours) })),
  );
  if (!totals.withinDay) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Ziua are ${totals.total.format()} ore pontate; maximul e 24.`,
    );
  }

  try {
    return await withActor(actor, async (tx) => {
      const [existing] = await tx
        .select({ id: schema.timesheets.id, status: schema.timesheets.status })
        .from(schema.timesheets)
        .where(
          and(
            eq(schema.timesheets.personId, values.personId),
            eq(schema.timesheets.workDate, values.workDate),
          ),
        )
        .for('update')
        .limit(1);

      if (existing?.status === 'validated') {
        throw new AppError('CONFLICT', 'Ziua e validată — pontajul nu se mai schimbă.');
      }

      let timesheetId = existing?.id;
      if (timesheetId === undefined) {
        timesheetId = uuidv7();
        await tx.insert(schema.timesheets).values({
          id: timesheetId,
          personId: values.personId,
          workDate: values.workDate,
          companyId: values.companyId,
          status: 'submitted',
        });
      } else {
        await tx
          .delete(schema.timesheetLines)
          .where(eq(schema.timesheetLines.timesheetId, timesheetId));
        await tx
          .update(schema.timesheets)
          .set({ status: 'submitted' })
          .where(eq(schema.timesheets.id, timesheetId));
      }

      for (const line of values.lines) {
        await tx.insert(schema.timesheetLines).values({
          id: uuidv7(),
          timesheetId,
          workUnitId: line.workUnitId,
          stageId: line.stageId,
          hours: line.hours,
        });
      }

      return { id: timesheetId, totalHours: totals.total };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

// ── Validare ─────────────────────────────────────────────────────────────────

export interface ValidateTimesheetsResult {
  readonly validated: number;
  readonly costLines: number;
  readonly failures: readonly string[];
}

/**
 * Valideaza pontajele alese, fiecare in tranzactia lui.
 *
 * De ce nu toate intr-una singura: ecranul de birou valideaza o saptamana
 * intreaga, adica zeci de zile × oameni. Prima zi fara tarif ar da inapoi si
 * celelalte patruzeci, iar PM-ul ar trebui sa ghiceasca ce a picat. Asa trec
 * cele bune si raman listate cele care nu pot — acelasi tipar ca la validarea in
 * masa a inspectiilor.
 *
 * In interiorul unei zile, insa, e totul sau nimic: orele si liniile de cost pe
 * care le produc nu se despart niciodata.
 */
export async function validateTimesheets(
  actor: Actor,
  input: ValidateTimesheetsInput,
): Promise<ValidateTimesheetsResult> {
  const values = validateTimesheetsInputSchema.parse(input);

  const failures: string[] = [];
  let validated = 0;
  let costLines = 0;

  for (const timesheetId of values.timesheetIds) {
    try {
      costLines += await validateOneTimesheet(actor, timesheetId, values.effectDate);
      validated += 1;
    } catch (error) {
      failures.push(
        `${timesheetId}: ${error instanceof AppError ? error.message : 'eroare necunoscută'}`,
      );
    }
  }

  return { validated, costLines, failures };
}

async function validateOneTimesheet(
  actor: Actor,
  timesheetId: string,
  effectDateOverride: string | null,
): Promise<number> {
  try {
    return await withActor(actor, async (tx) => {
      // Lock si join in doua interogari: `for update` nu accepta nume calificate
      // pe schema, iar fara `of` ar bloca si randul din `app.persons`.
      const [sheet] = await tx
        .select({
          id: schema.timesheets.id,
          personId: schema.timesheets.personId,
          companyId: schema.timesheets.companyId,
          workDate: schema.timesheets.workDate,
          status: schema.timesheets.status,
        })
        .from(schema.timesheets)
        .where(eq(schema.timesheets.id, timesheetId))
        .for('update')
        .limit(1);

      if (sheet === undefined) {
        throw new AppError('NOT_FOUND', 'Pontajul nu există sau nu e vizibil.');
      }
      if (sheet.status === 'validated') {
        throw new AppError('CONFLICT', 'Pontajul e deja validat.');
      }

      const [person] = await tx
        .select({ qualificationId: schema.persons.qualificationId })
        .from(schema.persons)
        .where(eq(schema.persons.id, sheet.personId))
        .limit(1);

      const qualificationId = person?.qualificationId ?? null;
      if (qualificationId === null) {
        throw new AppError('VALIDATION_FAILED', 'Persoana nu are calificare, deci nici tarif.');
      }

      // Tariful valabil la ZIUA pontata, nu cel curent (verificarea #14).
      const card = rateCardAt(await loadRateCards(tx, qualificationId), qualificationId, sheet.workDate);
      if (card === null) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Nu există tarif valabil la ${sheet.workDate} pentru calificarea persoanei.`,
        );
      }

      const lines = await tx
        .select({
          id: schema.timesheetLines.id,
          workUnitId: schema.timesheetLines.workUnitId,
          stageId: schema.timesheetLines.stageId,
          hours: schema.timesheetLines.hours,
          objectiveId: schema.workUnits.objectiveId,
        })
        .from(schema.timesheetLines)
        .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.timesheetLines.workUnitId))
        .where(eq(schema.timesheetLines.timesheetId, timesheetId));

      if (lines.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'Pontajul n-are nicio linie.');
      }

      const effectDate = effectDateOverride ?? sheet.workDate;

      for (const line of lines) {
        const funding = await fundingOf(tx, line.workUnitId);
        const hours = Quantity.fromDb(line.hours);
        const amount = card.hourlyCost.mul(hours.toDbString());

        // Tariful se INGHEATA pe linie: de aici incolo, o schimbare de rate card
        // nu mai poate rescrie costul deja inregistrat (verificarea #15).
        await tx
          .update(schema.timesheetLines)
          .set({ rateCardId: card.id, hourlyCost: card.hourlyCost.toDbString() })
          .where(eq(schema.timesheetLines.id, line.id));

        await recordCostTx(tx, actor, {
          companyId: sheet.companyId,
          documentDate: sheet.workDate,
          effectDate,
          usedContractId: funding?.contractId ?? null,
          usedComponentId: funding?.componentId ?? null,
          objectiveId: line.objectiveId,
          workUnitId: line.workUnitId,
          stageId: line.stageId,
          chargedContractId: null,
          chargedComponentId: null,
          expenseType: 'manopera_proprie',
          productId: null,
          qualificationId,
          quantity: hours.toDbString(),
          uom: 'oră',
          amount: amount.toDbString(),
          stage: 'consumat',
          documentType: 'pontaj',
          documentId: timesheetId,
          documentLineId: line.id,
          supplierId: null,
          subcontractorId: null,
        });
      }

      await tx
        .update(schema.timesheets)
        .set({ status: 'validated', validatedAt: new Date(), validatedBy: actor.personId })
        .where(eq(schema.timesheets.id, timesheetId));

      return lines.length;
    });
  } catch (error) {
    return translateDbError(error);
  }
}

async function loadRateCards(
  tx: ActorTx,
  qualificationId: string,
): Promise<
  {
    id: string;
    qualificationId: string;
    validFrom: string;
    validTo: string | null;
    hourlyCost: Money;
  }[]
> {
  const rows = await tx
    .select({
      id: schema.rateCards.id,
      qualificationId: schema.rateCards.qualificationId,
      validFrom: schema.rateCards.validFrom,
      validTo: schema.rateCards.validTo,
      hourlyCost: schema.rateCards.hourlyCost,
    })
    .from(schema.rateCards)
    .where(eq(schema.rateCards.qualificationId, qualificationId));

  return rows.map((row) => ({ ...row, hourlyCost: Money.fromDb(row.hourlyCost) }));
}

/** Analitica „descarcat" a unei unitati: alocarea ei activa. */
async function fundingOf(
  tx: ActorTx,
  workUnitId: string,
): Promise<{ readonly contractId: string; readonly componentId: string } | null> {
  const [row] = await tx
    .select({
      contractId: schema.fundingAllocations.contractId,
      componentId: schema.fundingAllocations.componentId,
    })
    .from(schema.fundingAllocations)
    .where(
      and(
        eq(schema.fundingAllocations.workUnitId, workUnitId),
        eq(schema.fundingAllocations.status, 'active'),
      ),
    )
    .orderBy(asc(schema.fundingAllocations.createdAt))
    .limit(1);

  return row ?? null;
}

// ── Citire: saptamana de birou ───────────────────────────────────────────────

export interface TimesheetLineRow {
  readonly id: string;
  readonly workUnitId: string;
  readonly workUnitCode: string;
  readonly workUnitName: string;
  readonly stageId: string | null;
  readonly hours: Quantity;
}

export interface TimesheetRow {
  readonly id: string;
  readonly personId: string;
  readonly personName: string;
  readonly workDate: string;
  readonly status: string;
  readonly totalHours: Quantity;
  readonly lines: readonly TimesheetLineRow[];
}

export interface TimesheetWeek {
  readonly sheets: readonly TimesheetRow[];
  /** Totaluri pe om si pe unitate — cele doua cerute explicit de §3.3. */
  readonly byPerson: ReadonlyMap<string, Quantity>;
  readonly byWorkUnit: ReadonlyMap<string, Quantity>;
}

export async function listTimesheetWeek(
  actor: Actor,
  options: {
    readonly companyIds: readonly string[];
    readonly from: string;
    readonly to: string;
    readonly personId?: string;
  },
): Promise<TimesheetWeek> {
  if (options.companyIds.length === 0) {
    return { sheets: [], byPerson: new Map(), byWorkUnit: new Map() };
  }

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: schema.timesheets.id,
        personId: schema.timesheets.personId,
        personName: schema.persons.fullName,
        workDate: schema.timesheets.workDate,
        status: schema.timesheets.status,
        lineId: schema.timesheetLines.id,
        workUnitId: schema.timesheetLines.workUnitId,
        workUnitCode: schema.workUnits.code,
        workUnitName: schema.workUnits.name,
        stageId: schema.timesheetLines.stageId,
        hours: schema.timesheetLines.hours,
      })
      .from(schema.timesheets)
      .innerJoin(schema.persons, eq(schema.persons.id, schema.timesheets.personId))
      .leftJoin(schema.timesheetLines, eq(schema.timesheetLines.timesheetId, schema.timesheets.id))
      .leftJoin(schema.workUnits, eq(schema.workUnits.id, schema.timesheetLines.workUnitId))
      .where(
        and(
          inArray(schema.timesheets.companyId, [...options.companyIds]),
          between(schema.timesheets.workDate, options.from, options.to),
          options.personId === undefined
            ? undefined
            : eq(schema.timesheets.personId, options.personId),
        ),
      )
      .orderBy(asc(schema.persons.fullName), asc(schema.timesheets.workDate));

    const sheets = new Map<string, { header: Omit<TimesheetRow, 'lines' | 'totalHours'>; lines: TimesheetLineRow[] }>();
    const byPerson = new Map<string, Quantity>();
    const byWorkUnit = new Map<string, Quantity>();

    for (const row of rows) {
      let entry = sheets.get(row.id);
      if (entry === undefined) {
        entry = {
          header: {
            id: row.id,
            personId: row.personId,
            personName: row.personName,
            workDate: row.workDate,
            status: row.status,
          },
          lines: [],
        };
        sheets.set(row.id, entry);
      }
      if (row.lineId === null || row.workUnitId === null || row.hours === null) {
        continue;
      }
      const hours = Quantity.fromDb(row.hours);
      entry.lines.push({
        id: row.lineId,
        workUnitId: row.workUnitId,
        workUnitCode: row.workUnitCode ?? '',
        workUnitName: row.workUnitName ?? '',
        stageId: row.stageId,
        hours,
      });
      byPerson.set(row.personId, (byPerson.get(row.personId) ?? Quantity.ZERO).add(hours));
      byWorkUnit.set(row.workUnitId, (byWorkUnit.get(row.workUnitId) ?? Quantity.ZERO).add(hours));
    }

    return {
      sheets: [...sheets.values()].map((entry) => ({
        ...entry.header,
        lines: entry.lines,
        totalHours: Quantity.sum(entry.lines.map((l) => l.hours)),
      })),
      byPerson,
      byWorkUnit,
    };
  });
}

// ── Prezenta subcontractantilor ──────────────────────────────────────────────

/**
 * **Instrument de control, nu de plata** (regula 6). Nu produce linie de cost,
 * si nici nu are unde: tabela n-are tarif si n-o sa aiba. Subcontractantul se
 * plateste pe situatie de lucrari; cifra asta e cea cu care se confrunta ea.
 */
export async function declareSubcontractorAttendance(
  actor: Actor,
  input: SubcontractorAttendanceInput,
): Promise<{ readonly id: string }> {
  const values = subcontractorAttendanceInputSchema.parse(input);
  const id = uuidv7();

  try {
    return await withActor(actor, async (tx) => {
      await tx
        .insert(schema.subcontractorAttendance)
        .values({
          id,
          workUnitId: values.workUnitId,
          subcontractorId: values.subcontractorId,
          workDate: values.workDate,
          headcount: values.headcount,
          declaredBy: actor.personId,
        })
        .onConflictDoUpdate({
          target: [
            schema.subcontractorAttendance.workUnitId,
            schema.subcontractorAttendance.subcontractorId,
            schema.subcontractorAttendance.workDate,
          ],
          set: { headcount: values.headcount, declaredBy: actor.personId },
        });
      return { id };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

export async function listSubcontractorAttendance(
  actor: Actor,
  workUnitId: string,
): Promise<
  {
    readonly id: string;
    readonly subcontractorId: string;
    readonly subcontractorName: string;
    readonly workDate: string;
    readonly headcount: number;
  }[]
> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: schema.subcontractorAttendance.id,
        subcontractorId: schema.subcontractorAttendance.subcontractorId,
        subcontractorName: schema.subcontractors.name,
        workDate: schema.subcontractorAttendance.workDate,
        headcount: schema.subcontractorAttendance.headcount,
      })
      .from(schema.subcontractorAttendance)
      .innerJoin(
        schema.subcontractors,
        eq(schema.subcontractors.id, schema.subcontractorAttendance.subcontractorId),
      )
      .where(eq(schema.subcontractorAttendance.workUnitId, workUnitId))
      .orderBy(asc(schema.subcontractorAttendance.workDate)),
  );
}

/** Pontajele nevalidate din interval — ecranul de validare saptamanala. */
export async function listUnvalidatedTimesheets(
  actor: Actor,
  options: { readonly companyIds: readonly string[]; readonly from: string; readonly to: string },
): Promise<{ readonly id: string; readonly personName: string; readonly workDate: string }[]> {
  if (options.companyIds.length === 0) {
    return [];
  }
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: schema.timesheets.id,
        personName: schema.persons.fullName,
        workDate: schema.timesheets.workDate,
      })
      .from(schema.timesheets)
      .innerJoin(schema.persons, eq(schema.persons.id, schema.timesheets.personId))
      .where(
        and(
          inArray(schema.timesheets.companyId, [...options.companyIds]),
          between(schema.timesheets.workDate, options.from, options.to),
          sql`${schema.timesheets.status} <> 'validated'`,
        ),
      )
      .orderBy(asc(schema.persons.fullName), asc(schema.timesheets.workDate)),
  );
}
