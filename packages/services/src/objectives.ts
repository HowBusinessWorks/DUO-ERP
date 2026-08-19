import type {
  ChecklistInput,
  ContractObjectiveInput,
  InspectionProfileInput,
  InspectionProfileItemInput,
  ObjectiveInput,
} from '@damina/contracts';
import {
  checklistInputSchema,
  contractObjectiveInputSchema,
  inspectionProfileInputSchema,
  inspectionProfileItemInputSchema,
  objectiveInputSchema,
} from '@damina/contracts';
import { type Actor, schema, withActor } from '@damina/db';
import { AppError, Period } from '@damina/shared';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

/**
 * Obiective, fise de verificare, profile de inspectie.
 *
 * Obiectivele sunt **nomenclator comun** celor 5 firme (regula 4 a pasului):
 * nicio functie de aici nu primeste `companyIds` si niciun query nu filtreaza pe
 * firma. Aceeasi statie de pompare e a grupului, nu a unei firme — iar istoricul
 * ei transversal, ecranul cerut explicit, exista tocmai pentru ca e asa.
 */

const sqlstate = (error: unknown): string | undefined => {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code } = current as Error & { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
    current = current.cause;
  }
  return undefined;
};

const DEFAULT_LIMIT = 500;

function like(query: string): string {
  return `%${query.replace(/([%_\\])/g, '\\$1')}%`;
}

// ── Obiective ────────────────────────────────────────────────────────────────

export type ObjectiveRow = typeof schema.objectives.$inferSelect & {
  /** Pe cate contracte e ACUM. Poate fi mai mult de unul, la firme diferite. */
  readonly activeContractCount: number;
};

export interface ListObjectivesOptions {
  readonly query?: string;
  readonly kind?: string;
  readonly includeInactive?: boolean;
  /** Doar cele cu coordonate — pentru vederea harta. */
  readonly withCoordinatesOnly?: boolean;
  readonly limit?: number;
}

/*
 * `app.objectives.id` scris calificat, nu `${schema.objectives.id}`.
 *
 * Intr-un `select` fara join, drizzle randeaza coloana interpolata ca `"id"`,
 * fara prefix — iar in subinterogare `"id"` se leaga de `contract_objectives`,
 * nu de `objectives`. Conditia devine `co.objective_id = co.id`, mereu falsa,
 * si numarul iese 0 fara nicio eroare. Vezi si `contractSelection`.
 */
const objectiveSelection = {
  objective: schema.objectives,
  activeContractCount: sql<string>`(
    select count(*)::text
      from app.contract_objectives co
     where co.objective_id = app.objectives.id
       and co.valid_from <= current_date
       and (co.valid_to is null or co.valid_to > current_date)
  )`,
};

export async function listObjectives(
  actor: Actor,
  options: ListObjectivesOptions = {},
): Promise<ObjectiveRow[]> {
  const {
    query,
    kind,
    includeInactive = false,
    withCoordinatesOnly = false,
    limit = DEFAULT_LIMIT,
  } = options;

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select(objectiveSelection)
      .from(schema.objectives)
      .where(
        and(
          includeInactive ? undefined : eq(schema.objectives.isActive, true),
          kind === undefined ? undefined : eq(schema.objectives.kind, kind),
          withCoordinatesOnly ? sql`${schema.objectives.geoLat} is not null` : undefined,
          query === undefined || query === ''
            ? undefined
            : or(
                ilike(schema.objectives.code, like(query)),
                ilike(schema.objectives.name, like(query)),
              ),
        ),
      )
      .orderBy(asc(schema.objectives.name))
      .limit(limit);

    return rows.map((row) => ({
      ...row.objective,
      activeContractCount: Number(row.activeContractCount),
    }));
  });
}

export async function getObjective(actor: Actor, id: string): Promise<ObjectiveRow> {
  const row = await withActor(actor, async (tx) => {
    const [found] = await tx
      .select(objectiveSelection)
      .from(schema.objectives)
      .where(eq(schema.objectives.id, id))
      .limit(1);
    return found;
  });

  if (row === undefined) {
    throw AppError.notFound('Obiectivul', id);
  }
  return { ...row.objective, activeContractCount: Number(row.activeContractCount) };
}

export async function createObjective(
  actor: Actor,
  input: ObjectiveInput,
): Promise<{ id: string }> {
  const values = objectiveInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.objectives)
        .values(values)
        .returning({ id: schema.objectives.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Obiectivul nu a putut fi salvat.');
      }
      return row;
    });
  } catch (error) {
    if (sqlstate(error) === '23505') {
      throw new AppError('CONFLICT', `Există deja un obiectiv cu codul ${values.code}.`);
    }
    throw error;
  }
}

export async function updateObjective(
  actor: Actor,
  id: string,
  input: ObjectiveInput,
): Promise<{ id: string }> {
  const values = objectiveInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .update(schema.objectives)
        .set(values)
        .where(eq(schema.objectives.id, id))
        .returning({ id: schema.objectives.id });
      if (row === undefined) {
        throw AppError.notFound('Obiectivul', id);
      }
      return row;
    });
  } catch (error) {
    if (sqlstate(error) === '23505') {
      throw new AppError('CONFLICT', `Există deja un obiectiv cu codul ${values.code}.`);
    }
    throw error;
  }
}

// ── Legatura contract ↔ obiectiv ─────────────────────────────────────────────

export type ContractObjectiveRow = typeof schema.contractObjectives.$inferSelect & {
  readonly objectiveCode: string;
  readonly objectiveName: string;
  readonly objectiveKind: string;
  readonly profileName: string | null;
  readonly isCurrent: boolean;
};

export async function listContractObjectives(
  actor: Actor,
  contractId: string,
  options: { readonly onlyCurrent?: boolean } = {},
): Promise<ContractObjectiveRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        link: schema.contractObjectives,
        objectiveCode: schema.objectives.code,
        objectiveName: schema.objectives.name,
        objectiveKind: schema.objectives.kind,
        profileName: schema.inspectionProfiles.name,
      })
      .from(schema.contractObjectives)
      .innerJoin(schema.objectives, eq(schema.contractObjectives.objectiveId, schema.objectives.id))
      .leftJoin(
        schema.inspectionProfiles,
        eq(schema.contractObjectives.inspectionProfileId, schema.inspectionProfiles.id),
      )
      .where(
        and(
          eq(schema.contractObjectives.contractId, contractId),
          options.onlyCurrent === true
            ? sql`${schema.contractObjectives.validFrom} <= current_date
                  and (${schema.contractObjectives.validTo} is null
                       or ${schema.contractObjectives.validTo} > current_date)`
            : undefined,
        ),
      )
      .orderBy(asc(schema.objectives.name));

    const today = new Date().toISOString().slice(0, 10);
    return rows.map((row) => ({
      ...row.link,
      objectiveCode: row.objectiveCode,
      objectiveName: row.objectiveName,
      objectiveKind: row.objectiveKind,
      profileName: row.profileName,
      isCurrent:
        row.link.validFrom <= today && (row.link.validTo === null || row.link.validTo > today),
    }));
  });
}

/**
 * Leaga un obiectiv de un contract.
 *
 * Suprapunerea pe ACELASI contract e refuzata de constrangerea `exclude`
 * (23P01) — verificarea #10. Acelasi obiectiv la doua contracte diferite in
 * acelasi timp trece, si trebuie sa treaca: e cazul real (verificarea #11).
 */
export async function linkObjective(
  actor: Actor,
  input: ContractObjectiveInput,
): Promise<{ id: string }> {
  const values = contractObjectiveInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.contractObjectives)
        .values(values)
        .returning({ id: schema.contractObjectives.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Legătura nu a putut fi salvată.');
      }
      return row;
    });
  } catch (error) {
    if (sqlstate(error) === '23P01') {
      throw new AppError(
        'CONFLICT',
        'Obiectivul e deja pe contractul ăsta în perioada asta. Închide întâi legătura veche — istoricul rămâne.',
      );
    }
    throw error;
  }
}

/**
 * Scoate un obiectiv din contract, cu data si cu MOTIV.
 *
 * Nu se sterge randul: mutarea unui obiectiv intre contracte muta bani, iar
 * istoricul lui trebuie sa arate ca a fost acolo. Se inchide intervalul.
 */
export async function unlinkObjective(
  actor: Actor,
  linkId: string,
  validTo: string,
  reason: string,
): Promise<{ id: string }> {
  if (reason.trim() === '') {
    throw new AppError(
      'VALIDATION_FAILED',
      'Scoaterea unui obiectiv din contract cere un motiv scris.',
    );
  }

  return withActor({ ...actor, reason }, async (tx) => {
    const [row] = await tx
      .update(schema.contractObjectives)
      .set({ validTo })
      .where(eq(schema.contractObjectives.id, linkId))
      .returning({ id: schema.contractObjectives.id });
    if (row === undefined) {
      throw AppError.notFound('Legătura', linkId);
    }
    return row;
  });
}

/** Schimba profilul de inspectie AL LEGATURII, nu al obiectivului (regula 3). */
export async function setInspectionProfile(
  actor: Actor,
  linkId: string,
  profileId: string | null,
  reason: string,
): Promise<{ id: string }> {
  return withActor({ ...actor, reason }, async (tx) => {
    const [row] = await tx
      .update(schema.contractObjectives)
      .set({ inspectionProfileId: profileId })
      .where(eq(schema.contractObjectives.id, linkId))
      .returning({ id: schema.contractObjectives.id });
    if (row === undefined) {
      throw AppError.notFound('Legătura', linkId);
    }
    return row;
  });
}

// ── Fise si profile ──────────────────────────────────────────────────────────

export type ChecklistRow = typeof schema.checklists.$inferSelect & {
  readonly itemCount: number;
};

export async function listChecklists(actor: Actor): Promise<ChecklistRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        checklist: schema.checklists,
        itemCount: sql<string>`(
          select count(*)::text from app.checklist_items i
           where i.checklist_id = app.checklists.id
        )`,
      })
      .from(schema.checklists)
      .orderBy(asc(schema.checklists.name), asc(schema.checklists.version));

    return rows.map((row) => ({ ...row.checklist, itemCount: Number(row.itemCount) }));
  });
}

export async function createChecklist(
  actor: Actor,
  input: ChecklistInput,
): Promise<{ id: string }> {
  const values = checklistInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.checklists)
        .values(values)
        .returning({ id: schema.checklists.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Fișa nu a putut fi salvată.');
      }
      return row;
    });
  } catch (error) {
    if (sqlstate(error) === '23505') {
      throw new AppError(
        'CONFLICT',
        `Există deja o fișă cu codul ${values.code} în versiunea asta.`,
      );
    }
    throw error;
  }
}

export type InspectionProfileRow = typeof schema.inspectionProfiles.$inferSelect & {
  readonly items: readonly {
    readonly checklistId: string;
    readonly checklistName: string;
    readonly frequencyMonths: number;
  }[];
};

export async function listInspectionProfiles(actor: Actor): Promise<InspectionProfileRow[]> {
  return withActor(actor, async (tx) => {
    const profiles = await tx
      .select()
      .from(schema.inspectionProfiles)
      .orderBy(asc(schema.inspectionProfiles.name));

    if (profiles.length === 0) {
      return [];
    }

    const items = await tx
      .select({
        profileId: schema.inspectionProfileItems.profileId,
        checklistId: schema.inspectionProfileItems.checklistId,
        checklistName: schema.checklists.name,
        frequencyMonths: schema.inspectionProfileItems.frequencyMonths,
        contractObjectiveId: schema.contractObjectives.id,
      })
      .from(schema.inspectionProfileItems)
      .innerJoin(
        schema.checklists,
        eq(schema.inspectionProfileItems.checklistId, schema.checklists.id),
      )
      .where(
        inArray(
          schema.inspectionProfileItems.profileId,
          profiles.map((profile) => profile.id),
        ),
      )
      .orderBy(asc(schema.inspectionProfileItems.frequencyMonths));

    return profiles.map((profile) => ({
      ...profile,
      items: items
        .filter((item) => item.profileId === profile.id)
        .map(({ checklistId, checklistName, frequencyMonths }) => ({
          checklistId,
          checklistName,
          frequencyMonths,
        })),
    }));
  });
}

export async function createInspectionProfile(
  actor: Actor,
  input: InspectionProfileInput,
): Promise<{ id: string }> {
  const values = inspectionProfileInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.inspectionProfiles)
        .values(values)
        .returning({ id: schema.inspectionProfiles.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Profilul nu a putut fi salvat.');
      }
      return row;
    });
  } catch (error) {
    if (sqlstate(error) === '23505') {
      throw new AppError('CONFLICT', `Există deja un profil cu numele „${String(input.name)}”.`);
    }
    throw error;
  }
}

export async function addProfileItem(
  actor: Actor,
  input: InspectionProfileItemInput,
): Promise<{ id: string }> {
  const values = inspectionProfileItemInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.inspectionProfileItems)
        .values(values)
        .returning({ id: schema.inspectionProfileItems.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Fișa nu a putut fi adăugată în profil.');
      }
      return row;
    });
  } catch (error) {
    if (sqlstate(error) === '23505') {
      throw new AppError(
        'CONFLICT',
        'Fișa e deja în profil. Schimbă-i frecvența în loc s-o adaugi din nou.',
      );
    }
    throw error;
  }
}

// ── Acoperire inspectii (§3.6) ───────────────────────────────────────────────

export interface CoverageRow {
  readonly objectiveId: string;
  readonly objectiveCode: string;
  readonly objectiveName: string;
  readonly profileName: string | null;
  readonly checklistId: string | null;
  readonly checklistName: string | null;
  readonly frequencyMonths: number | null;
  /** Cate inspectii de tipul asta ar fi trebuit facute in luna analizata. */
  readonly due: number;
  /** Cate s-au facut efectiv in luna, dupa data EXECUTIEI. */
  readonly done: number;
  /** Ultima inspectie de tipul asta, oricand. `null` = niciodata. */
  readonly lastPerformedOn: string | null;
  /** Unitatea ultimei inspectii, ca ecranul sa poata trimite la ea. */
  readonly lastWorkUnitId: string | null;
}

export interface CoverageReport {
  readonly year: number;
  readonly month: number;
  readonly objectiveCount: number;
  readonly dueTotal: number;
  readonly doneTotal: number;
  readonly rows: readonly CoverageRow[];
  /**
   * Ce inseamna cifrele. Regula 6 a pasului: orice ecran cu cifre declara pe ce
   * analitica e construit.
   *
   * „Datorat" vine din profil, „facut" din fisele de teren — si se numara dupa
   * **data executiei**, nu dupa luna de raportare. O inspectie facuta pe 31
   * martie si validata in aprilie a fost totusi facuta in martie; acoperirea
   * masoara terenul, nu contabilitatea.
   */
  readonly basis: 'profil de inspectie · fise de teren, dupa data executiei';
}

/**
 * Acoperirea inspectiilor pe un contract, intr-o luna.
 *
 * Masoara fara sa harțuiasca: **nu produce nicio notificare catre teren**
 * (§3.6). E o vedere de birou din care cineva poate decide sa asigneze o
 * restanta — decizia e a omului, nu a sistemului.
 *
 * „Datorat” se calculeaza din frecventa profilului: o fisa trimestriala e
 * datorata in lunile in care cade multiplul frecventei, numarate de la intrarea
 * obiectivului in contract. Asa un profil trimestrial nu apare ca restanta in
 * fiecare luna, ci o data la trei.
 */
export async function getInspectionCoverage(
  actor: Actor,
  contractId: string,
  year: number,
  month: number,
): Promise<CoverageReport> {
  const period = Period.of(year, month);
  const monthStart = period.firstDay();
  const monthEnd = period.lastDay();

  const rows = await withActor(actor, async (tx) =>
    tx
      .select({
        objectiveId: schema.objectives.id,
        objectiveCode: schema.objectives.code,
        objectiveName: schema.objectives.name,
        validFrom: schema.contractObjectives.validFrom,
        profileName: schema.inspectionProfiles.name,
        checklistId: schema.inspectionProfileItems.checklistId,
        checklistName: schema.checklists.name,
        frequencyMonths: schema.inspectionProfileItems.frequencyMonths,
        contractObjectiveId: schema.contractObjectives.id,
      })
      .from(schema.contractObjectives)
      .innerJoin(schema.objectives, eq(schema.contractObjectives.objectiveId, schema.objectives.id))
      .leftJoin(
        schema.inspectionProfiles,
        eq(schema.contractObjectives.inspectionProfileId, schema.inspectionProfiles.id),
      )
      .leftJoin(
        schema.inspectionProfileItems,
        eq(schema.inspectionProfileItems.profileId, schema.inspectionProfiles.id),
      )
      .leftJoin(
        schema.checklists,
        eq(schema.inspectionProfileItems.checklistId, schema.checklists.id),
      )
      .where(
        and(
          eq(schema.contractObjectives.contractId, contractId),
          // Obiectivul trebuie sa fi fost in contract in luna analizata.
          sql`${schema.contractObjectives.validFrom} <= ${monthEnd}`,
          sql`(${schema.contractObjectives.validTo} is null
               or ${schema.contractObjectives.validTo} > ${monthStart})`,
        ),
      )
      .orderBy(asc(schema.objectives.name), asc(schema.checklists.name)),
  );

  /*
   * Inspectiile REALE ale contractului, o singura interogare pentru tot
   * raportul. Alternativa — cate un `count` pe fiecare rand — ar fi insemnat
   * cateva sute de interogari pentru un contract cu 200 de obiective, si
   * ecranul asta se deschide o data pe luna, de toata lumea, in aceeasi zi.
   *
   * Se numara dupa `performed_on`, nu dupa `effect_date`: acoperirea masoara ce
   * s-a facut pe teren in luna, iar o fisa facuta pe 31 si validata pe 3 a fost
   * facuta tot atunci. Din acelasi motiv intra si fisele nevalidate — omul a
   * fost acolo; ca hartia n-a ajuns inca la birou e alta problema.
   */
  const performed = await withActor(actor, async (tx) =>
    tx
      .select({
        contractObjectiveId: schema.workUnits.contractObjectiveId,
        checklistId: schema.inspections.checklistId,
        workUnitId: schema.inspections.workUnitId,
        performedOn: schema.inspections.performedOn,
      })
      .from(schema.inspections)
      .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.inspections.workUnitId))
      .where(
        and(
          inArray(
            schema.workUnits.contractObjectiveId,
            rows.map((row) => row.contractObjectiveId),
          ),
          sql`${schema.workUnits.status} <> 'anulata'`,
        ),
      )
      .orderBy(asc(schema.inspections.performedOn)),
  );

  const key = (contractObjectiveId: string | null, checklistId: string | null): string =>
    `${contractObjectiveId ?? '-'}|${checklistId}`;

  const doneInMonth = new Map<string, number>();
  const lastOne = new Map<string, { performedOn: string; workUnitId: string }>();
  for (const row of performed) {
    const cell = key(row.contractObjectiveId, row.checklistId);
    if (row.performedOn >= monthStart && row.performedOn <= monthEnd) {
      doneInMonth.set(cell, (doneInMonth.get(cell) ?? 0) + 1);
    }
    // Randurile vin crescator dupa data, deci ultima scriere e cea mai recenta.
    lastOne.set(cell, { performedOn: row.performedOn, workUnitId: row.workUnitId });
  }

  const target = Period.of(year, month);
  const coverage: CoverageRow[] = rows.map((row) => {
    if (row.frequencyMonths === null) {
      return {
        objectiveId: row.objectiveId,
        objectiveCode: row.objectiveCode,
        objectiveName: row.objectiveName,
        profileName: row.profileName,
        checklistId: null,
        checklistName: null,
        frequencyMonths: null,
        due: 0,
        done: 0,
        lastPerformedOn: null,
        lastWorkUnitId: null,
      };
    }

    const entry = Period.fromKey(row.validFrom.slice(0, 7));
    const elapsed = target.diff(entry);
    const due = elapsed >= 0 && elapsed % row.frequencyMonths === 0 ? 1 : 0;
    const cell = key(row.contractObjectiveId, row.checklistId);
    const last = lastOne.get(cell);

    return {
      objectiveId: row.objectiveId,
      objectiveCode: row.objectiveCode,
      objectiveName: row.objectiveName,
      profileName: row.profileName,
      checklistId: row.checklistId,
      checklistName: row.checklistName,
      frequencyMonths: row.frequencyMonths,
      due,
      done: doneInMonth.get(cell) ?? 0,
      lastPerformedOn: last?.performedOn ?? null,
      lastWorkUnitId: last?.workUnitId ?? null,
    };
  });

  return {
    year,
    month,
    objectiveCount: new Set(coverage.map((row) => row.objectiveId)).size,
    dueTotal: coverage.reduce((sum, row) => sum + row.due, 0),
    doneTotal: coverage.reduce((sum, row) => sum + row.done, 0),
    rows: coverage,
    basis: 'profil de inspectie · fise de teren, dupa data executiei',
  };
}
