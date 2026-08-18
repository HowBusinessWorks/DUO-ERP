import { schema, withActor, type Actor } from '@damina/db';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

/**
 * Felia de date a terenului (pasul 10, §3.1).
 *
 * **Sub ~2 MB comprimat**, si asta nu e o tinta de performanta: e ce incape pe
 * un telefon cu semnal prost, intr-un interval in care omul nu renunta. De aceea
 * felia nu e „baza mea filtrata", ci un raspuns la o intrebare ingusta — *ce am
 * eu de facut acum* — cu fereastra temporala inclusa in query, nu in interfata.
 *
 * **Zero lei, la nivel de date.** Nu se cere nicio coloana de bani, nicaieri:
 * nici `unit_cost` de pe materiale, nici `avg_cost` de pe stoc, nici costul
 * estimat al operatiunii. Nu ascunse la afisare — necerute. Un `select` care
 * le-ar cere ar cadea oricum cu 42501, dar felia n-are voie sa depinda de asta:
 * poarta e in interogare, plasa e in grant.
 */

export interface FieldSnapshot {
  /** Momentul in care s-a citit felia. Devine cursorul dispozitivului. */
  readonly takenAt: string;
  readonly workUnits: readonly FieldWorkUnit[];
  readonly stages: readonly FieldStage[];
  readonly checklists: readonly FieldChecklist[];
  readonly stock: readonly FieldStockLine[];
  readonly people: readonly FieldPerson[];
  /** Seriile pe care le poate folosi terenul, per firma. */
  readonly series: readonly FieldSeries[];
}

export interface FieldWorkUnit {
  readonly id: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly status: string;
  readonly objectiveId: string;
  readonly objectiveName: string;
  readonly objectiveCode: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  /** Gestiunea echipei, cand unitatea are echipa. Gol = fara gestiune. */
  readonly locationId: string;
  /** Doar pentru inspectii: ce checklist s-a inghetat pe fisa. */
  readonly checklistId: string | null;
  readonly performedOn: string | null;
  readonly validated: boolean;
}

export interface FieldStage {
  readonly id: string;
  readonly workUnitId: string;
  readonly name: string;
}

export interface FieldChecklistItem {
  readonly id: string;
  readonly position: number;
  readonly text: string;
  readonly requiresPhoto: boolean;
  readonly isCritical: boolean;
}

export interface FieldChecklist {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly version: number;
  readonly items: readonly FieldChecklistItem[];
}

export interface FieldStockLine {
  readonly locationId: string;
  readonly locationName: string;
  readonly productId: string;
  readonly productCode: string;
  readonly productName: string;
  readonly uom: string;
  /** Disponibil, ca sir. **Fara CMP** — nu se cere coloana. */
  readonly available: string;
}

export interface FieldPerson {
  readonly id: string;
  readonly fullName: string;
}

export interface FieldSeries {
  readonly companyId: string;
  readonly documentType: string;
  readonly series: string;
}

/**
 * Fereastra temporala a feliei, in zile.
 *
 * Unitatile active intra oricum; asta taie coada de istorie. 30 de zile acopera
 * luna in curs si inceputul celei trecute — adica exact intervalul in care mai
 * are cineva ceva de corectat pe teren.
 */
const WINDOW_DAYS = 30;

/**
 * Citeste felia omului conectat.
 *
 * `since` nu filtreaza inca: felia e mica si se reciteste intreaga, iar un
 * delta pe sase tabele cu stergeri ar fi cerut tombstones peste tot. Cand felia
 * va creste destul cat sa conteze, aici se adauga filtrarea — cursorul exista
 * deja si se plimba corect intre client si server.
 */
export async function pullFieldSnapshot(actor: Actor): Promise<FieldSnapshot> {
  return withActor(actor, async (tx) => {
    const takenAt = new Date().toISOString();

    /*
     * Unitatile mele: cele pe care sunt asignat sau responsabil. RLS-ul ar
     * intoarce oricum doar atat — dar felia o spune explicit, ca sa nu depinda
     * de o politica pe care o poate schimba alt pas.
     */
    const units = await tx
      .select({
        id: schema.workUnits.id,
        companyId: schema.workUnits.companyId,
        code: schema.workUnits.code,
        name: schema.workUnits.name,
        type: schema.workUnits.type,
        status: schema.workUnits.status,
        objectiveId: schema.workUnits.objectiveId,
        objectiveName: schema.objectives.name,
        objectiveCode: schema.objectives.code,
        startsOn: schema.workUnits.startsOn,
        endsOn: schema.workUnits.endsOn,
        checklistId: schema.inspections.checklistId,
        inspectionPerformedOn: schema.inspections.performedOn,
        inspectionValidatedAt: schema.inspections.validatedAt,
        interventionPerformedOn: schema.interventions.performedOn,
        interventionValidatedAt: schema.interventions.validatedAt,
        teamLocationId: schema.locations.id,
      })
      .from(schema.workUnits)
      .innerJoin(schema.objectives, eq(schema.objectives.id, schema.workUnits.objectiveId))
      .leftJoin(schema.inspections, eq(schema.inspections.workUnitId, schema.workUnits.id))
      .leftJoin(schema.interventions, eq(schema.interventions.workUnitId, schema.workUnits.id))
      .leftJoin(
        schema.locations,
        and(
          eq(schema.locations.teamId, schema.interventions.teamId),
          eq(schema.locations.isActive, true),
        ),
      )
      .where(
        and(
          sql`${schema.workUnits.status} not in ('inchisa', 'anulata')`,
          or(
            isNull(schema.workUnits.startsOn),
            sql`${schema.workUnits.startsOn} >= current_date - make_interval(days => ${WINDOW_DAYS})`,
          ),
        ),
      )
      .orderBy(asc(schema.workUnits.startsOn), asc(schema.workUnits.code))
      .limit(500);

    const unitIds = units.map((unit) => unit.id);

    const stages =
      unitIds.length === 0
        ? []
        : await tx
            .select({
              id: schema.workStages.id,
              workUnitId: schema.workStages.workUnitId,
              name: schema.workStages.name,
            })
            .from(schema.workStages)
            .where(inArray(schema.workStages.workUnitId, unitIds))
            .orderBy(asc(schema.workStages.createdAt));

    // Doar checklist-urile de care are nevoie: cele inghetate pe inspectiile
    // mele. Nomenclatorul intreg ar fi fost felia altcuiva.
    const checklistIds = [
      ...new Set(units.map((unit) => unit.checklistId).filter((id): id is string => id !== null)),
    ];

    const checklists =
      checklistIds.length === 0
        ? []
        : await tx
            .select({
              id: schema.checklists.id,
              code: schema.checklists.code,
              name: schema.checklists.name,
              version: schema.checklists.version,
            })
            .from(schema.checklists)
            .where(inArray(schema.checklists.id, checklistIds));

    const items =
      checklistIds.length === 0
        ? []
        : await tx
            .select({
              id: schema.checklistItems.id,
              checklistId: schema.checklistItems.checklistId,
              position: schema.checklistItems.position,
              text: schema.checklistItems.text,
              requiresPhoto: schema.checklistItems.requiresPhoto,
              isCritical: schema.checklistItems.isCritical,
            })
            .from(schema.checklistItems)
            .where(inArray(schema.checklistItems.checklistId, checklistIds))
            .orderBy(asc(schema.checklistItems.position));

    const companyIds = [...new Set(units.map((unit) => unit.companyId))];

    /*
     * Stocul: doar gestiunile de ECHIPA, si fara CMP. Magazia centrala n-are ce
     * cauta pe telefonul unui om care consuma din lada lui.
     */
    const stock =
      companyIds.length === 0
        ? []
        : await tx
            .select({
              locationId: schema.stockBalances.locationId,
              locationName: schema.locations.name,
              productId: schema.stockBalances.productId,
              productCode: schema.products.code,
              productName: schema.products.name,
              uom: schema.products.uom,
              available: sql<string>`(${schema.stockBalances.qtyPhysical} - ${schema.stockBalances.qtyReserved})::text`,
            })
            .from(schema.stockBalances)
            .innerJoin(schema.locations, eq(schema.locations.id, schema.stockBalances.locationId))
            .innerJoin(schema.products, eq(schema.products.id, schema.stockBalances.productId))
            .where(
              and(
                inArray(schema.locations.companyId, companyIds),
                eq(schema.locations.type, 'echipa'),
                eq(schema.locations.isActive, true),
                sql`${schema.stockBalances.qtyPhysical} > ${schema.stockBalances.qtyReserved}`,
              ),
            )
            .orderBy(asc(schema.locations.name), asc(schema.products.name))
            .limit(1000);

    // Oamenii de pontat: colegii de teren din firmele mele.
    const people =
      companyIds.length === 0
        ? []
        : await tx
            .selectDistinct({
              id: schema.persons.id,
              fullName: schema.persons.fullName,
            })
            .from(schema.persons)
            .innerJoin(
              schema.personCompanyAccess,
              eq(schema.personCompanyAccess.personId, schema.persons.id),
            )
            .where(
              and(
                inArray(schema.personCompanyAccess.companyId, companyIds),
                eq(schema.persons.isActive, true),
                eq(schema.persons.persona, 'field'),
              ),
            )
            .orderBy(asc(schema.persons.fullName))
            .limit(300);

    const series =
      companyIds.length === 0
        ? []
        : await tx
            .select({
              companyId: schema.documentSeries.companyId,
              documentType: sql<string>`${schema.documentSeries.documentType}::text`,
              series: schema.documentSeries.series,
            })
            .from(schema.documentSeries)
            .where(inArray(schema.documentSeries.companyId, companyIds));

    const itemsByChecklist = new Map<string, FieldChecklistItem[]>();
    for (const item of items) {
      const list = itemsByChecklist.get(item.checklistId) ?? [];
      list.push({
        id: item.id,
        position: item.position,
        text: item.text,
        requiresPhoto: item.requiresPhoto,
        isCritical: item.isCritical,
      });
      itemsByChecklist.set(item.checklistId, list);
    }

    return {
      takenAt,
      workUnits: units.map((unit) => ({
        id: unit.id,
        companyId: unit.companyId,
        code: unit.code,
        name: unit.name,
        type: unit.type,
        status: unit.status,
        objectiveId: unit.objectiveId,
        objectiveName: unit.objectiveName,
        objectiveCode: unit.objectiveCode,
        startsOn: unit.startsOn,
        endsOn: unit.endsOn,
        locationId: unit.teamLocationId ?? '',
        checklistId: unit.checklistId,
        performedOn: unit.inspectionPerformedOn ?? unit.interventionPerformedOn,
        validated:
          unit.inspectionValidatedAt !== null || unit.interventionValidatedAt !== null,
      })),
      stages,
      checklists: checklists.map((checklist) => ({
        ...checklist,
        items: itemsByChecklist.get(checklist.id) ?? [],
      })),
      stock,
      people,
      series,
    };
  });
}
