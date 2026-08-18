import type {
  CreateInspectionInput,
  SaveInspectionInput,
  ValidateInspectionInput,
} from '@damina/contracts';
import {
  createInspectionInputSchema,
  saveInspectionInputSchema,
  validateInspectionInputSchema,
} from '@damina/contracts';
import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import { inspectionValidationCheck, type InspectionValidationCheck } from '@damina/domain';
import { AppError, Money, uuidv7 } from '@damina/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { translateDbError } from './db-errors';
import { createRequestTx } from './requests';
import { createWorkUnitTx, translateWorkUnitCreationError } from './work-units';

/**
 * Fisa de inspectie (pasul 09, §3.1).
 *
 * Doua lucruri se intampla aici si nicaieri altundeva:
 *
 *   1. **Checklist-ul se incarca din profilul legaturii contract↔obiectiv**, nu
 *      de pe obiectiv (verificarile #1 si #2). Acelasi bazin, alt contract, alt
 *      checklist — si asta e cazul real, nu o subtilitate.
 *   2. **Fiecare NOK isi creeaza iesirea atomic cu salvarea fisei**: cererea de
 *      tip „constatare" sau propunerea de backlog se scriu in ACEEASI tranzactie
 *      cu raspunsul care le-a nascut. O fisa salvata cu un NOK a carui cerere
 *      n-a apucat sa se scrie ar fi exact backlogul gol pe care il repara pasul.
 *
 * Regula 1 a pasului — „nu se valideaza cat timp un NOK n-are iesire" — NU e
 * aici. E un trigger in 0026. Aici e doar oglinda ei, ca ecranul sa spuna CE
 * punct blocheaza inainte ca omul sa apese.
 */

// ── Creare ───────────────────────────────────────────────────────────────────

interface ProfileChecklist {
  readonly checklistId: string;
  readonly version: number;
  readonly code: string;
  readonly name: string;
}

/**
 * Fisele pe care le cere profilul legaturii contract↔obiectiv.
 *
 * Se ia versiunea ACTIVA cea mai mare a fiecarui cod: profilul arata spre o
 * versiune anume, dar o inspectie noua trebuie sa foloseasca ultima varianta a
 * fisei, nu pe cea legata acum doi ani. Versiunea aleasa se ingheata apoi pe
 * `inspections`, si de-acolo nu se mai schimba.
 */
export async function checklistsForContractObjective(
  actor: Actor,
  contractObjectiveId: string,
): Promise<ProfileChecklist[]> {
  return withActor(actor, async (tx) => loadProfileChecklists(tx, contractObjectiveId));
}

async function loadProfileChecklists(
  tx: ActorTx,
  contractObjectiveId: string,
): Promise<ProfileChecklist[]> {
  const rows = await tx
    .select({
      checklistId: schema.checklists.id,
      version: schema.checklists.version,
      code: schema.checklists.code,
      name: schema.checklists.name,
    })
    .from(schema.contractObjectives)
    .innerJoin(
      schema.inspectionProfileItems,
      eq(schema.inspectionProfileItems.profileId, schema.contractObjectives.inspectionProfileId),
    )
    .innerJoin(
      schema.checklists,
      eq(schema.checklists.id, schema.inspectionProfileItems.checklistId),
    )
    .where(eq(schema.contractObjectives.id, contractObjectiveId))
    .orderBy(asc(schema.checklists.code), desc(schema.checklists.version));

  // Un cod, o singura fisa: cea mai noua versiune activa. `orderBy` de mai sus
  // le-a pus deja in ordinea buna, deci prima intalnire castiga.
  const byCode = new Map<string, ProfileChecklist>();
  for (const row of rows) {
    if (!byCode.has(row.code)) {
      byCode.set(row.code, row);
    }
  }
  return [...byCode.values()];
}

/**
 * Deschide o fisa de inspectie: unitatea de lucru (cu codul din serie si
 * folderul generat prin trigger) plus randul de extensie cu checklist-ul.
 */
export async function createInspection(
  actor: Actor,
  input: CreateInspectionInput,
): Promise<{ readonly id: string; readonly code: string; readonly checklistId: string }> {
  const values = createInspectionInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const available = await loadProfileChecklists(tx, values.contractObjectiveId);
      if (available.length === 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Legătura contract–obiectiv nu are profil de inspecție, deci nu se știe ce se verifică.',
        );
      }

      const chosen =
        values.checklistId === null
          ? available[0]
          : available.find((c) => c.checklistId === values.checklistId);

      if (chosen === undefined) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Fișa aleasă nu face parte din profilul de inspecție al contractului.',
        );
      }

      const workUnitId = uuidv7();
      const created = await createWorkUnitTx(
        tx,
        actor,
        {
          workUnit: {
            companyId: values.companyId,
            type: 'inspectie',
            name: values.name,
            objectiveId: values.objectiveId,
            contractObjectiveId: values.contractObjectiveId,
            responsiblePersonId: values.responsiblePersonId,
            executorType: 'echipa_proprie',
            executorSubcontractorId: null,
            startsOn: values.performedOn,
            endsOn: null,
            estimatedValue: null,
            costBudget: null,
          },
          series: values.series,
          allocations: [],
          assignments:
            values.performedBy === null
              ? []
              : [
                  {
                    personId: values.performedBy,
                    role: 'inspector',
                    validFrom: values.performedOn,
                    validTo: null,
                  },
                ],
        },
        workUnitId,
      );

      await tx.insert(schema.inspections).values({
        workUnitId,
        checklistId: chosen.checklistId,
        checklistVersion: chosen.version,
        performedOn: values.performedOn,
        performedBy: values.performedBy,
      });

      return { id: workUnitId, code: created.code, checklistId: chosen.checklistId };
    });
  } catch (error) {
    return translateWorkUnitCreationError(error, values.series);
  }
}

// ── Citire ───────────────────────────────────────────────────────────────────

export interface InspectionPointRow {
  readonly itemId: string;
  readonly position: number;
  readonly text: string;
  readonly requiresPhoto: boolean;
  readonly isCritical: boolean;
  readonly answerId: string | null;
  readonly answer: 'ok' | 'nok' | 'na' | null;
  readonly note: string | null;
  readonly photoNodeId: string | null;
  readonly outcome: 'rezolvat_pe_loc' | 'interventie' | 'propunere' | null;
  readonly resolutionNote: string | null;
  readonly estimatedValue: Money | null;
  readonly createdRequestId: string | null;
  readonly backlogProposalId: string | null;
}

export interface InspectionSheet {
  readonly workUnitId: string;
  readonly checklistId: string;
  readonly checklistName: string;
  readonly checklistVersion: number;
  readonly performedOn: string;
  readonly effectDate: string | null;
  readonly validatedAt: Date | null;
  readonly points: readonly InspectionPointRow[];
  readonly check: InspectionValidationCheck;
}

/** Fisa intreaga: punctele checklist-ului cu raspunsurile si iesirile lor. */
export async function getInspectionSheet(
  actor: Actor,
  workUnitId: string,
  options: { readonly withMoney?: boolean } = {},
): Promise<InspectionSheet> {
  const withMoney = options.withMoney ?? true;

  return withActor(actor, async (tx) => {
    const [header] = await tx
      .select({
        workUnitId: schema.inspections.workUnitId,
        checklistId: schema.inspections.checklistId,
        checklistVersion: schema.inspections.checklistVersion,
        checklistName: schema.checklists.name,
        performedOn: schema.inspections.performedOn,
        effectDate: schema.inspections.effectDate,
        validatedAt: schema.inspections.validatedAt,
      })
      .from(schema.inspections)
      .innerJoin(schema.checklists, eq(schema.checklists.id, schema.inspections.checklistId))
      .where(eq(schema.inspections.workUnitId, workUnitId))
      .limit(1);

    if (header === undefined) {
      throw new AppError('NOT_FOUND', 'Fișa de inspecție nu există sau nu e vizibilă.');
    }

    const points = await tx
      .select({
        itemId: schema.checklistItems.id,
        position: schema.checklistItems.position,
        text: schema.checklistItems.text,
        requiresPhoto: schema.checklistItems.requiresPhoto,
        isCritical: schema.checklistItems.isCritical,
        answerId: schema.inspectionAnswers.id,
        answer: schema.inspectionAnswers.answer,
        note: schema.inspectionAnswers.note,
        photoNodeId: schema.inspectionAnswers.photoNodeId,
        outcome: schema.inspectionFindings.outcome,
        resolutionNote: schema.inspectionFindings.resolutionNote,
        estimatedValue: withMoney ? schema.inspectionFindings.estimatedValue : sql<null>`null`,
        createdRequestId: schema.inspectionFindings.createdRequestId,
        backlogProposalId: schema.inspectionFindings.backlogProposalId,
      })
      .from(schema.checklistItems)
      .leftJoin(
        schema.inspectionAnswers,
        and(
          eq(schema.inspectionAnswers.checklistItemId, schema.checklistItems.id),
          eq(schema.inspectionAnswers.workUnitId, workUnitId),
        ),
      )
      .leftJoin(
        schema.inspectionFindings,
        eq(schema.inspectionFindings.answerId, schema.inspectionAnswers.id),
      )
      .where(eq(schema.checklistItems.checklistId, header.checklistId))
      .orderBy(asc(schema.checklistItems.position));

    const rows: InspectionPointRow[] = points.map((p) => ({
      itemId: p.itemId,
      position: p.position,
      text: p.text,
      requiresPhoto: p.requiresPhoto,
      isCritical: p.isCritical,
      answerId: p.answerId,
      answer: p.answer,
      note: p.note,
      photoNodeId: p.photoNodeId,
      outcome: p.outcome,
      resolutionNote: p.resolutionNote,
      estimatedValue: p.estimatedValue === null ? null : Money.fromDb(p.estimatedValue),
      createdRequestId: p.createdRequestId,
      backlogProposalId: p.backlogProposalId,
    }));

    return {
      workUnitId: header.workUnitId,
      checklistId: header.checklistId,
      checklistName: header.checklistName,
      checklistVersion: header.checklistVersion,
      performedOn: header.performedOn,
      effectDate: header.effectDate,
      validatedAt: header.validatedAt,
      points: rows,
      check: inspectionValidationCheck(
        rows.map((r) => ({
          itemId: r.itemId,
          position: r.position,
          text: r.text,
          requiresPhoto: r.requiresPhoto,
        })),
        rows
          .filter((r) => r.answer !== null)
          .map((r) => ({
            itemId: r.itemId,
            answer: r.answer as 'ok' | 'nok' | 'na',
            hasPhoto: r.photoNodeId !== null,
            hasFinding: r.outcome !== null,
          })),
      ),
    };
  });
}

// ── Salvare ──────────────────────────────────────────────────────────────────

export interface SaveInspectionResult {
  readonly createdRequestIds: readonly string[];
  readonly createdProposalIds: readonly string[];
}

/**
 * Salveaza raspunsurile si, atomic cu ele, iesirile punctelor NOK.
 *
 * Raspunsurile se REESCRIU (sterge tot, insereaza tot) — cu ele si constatarile,
 * prin `on delete cascade`. Ce NU se sterge: cererile si propunerile deja
 * nascute din constatari. O cerere de tip „constatare" e un document care si-a
 * inceput viata proprie in inbox; a o sterge fiindca cineva a reschimbat un
 * raspuns ar face-o sa dispara de sub ochii celui care o tria.
 *
 * Consecinta, si e cea corecta: un punct trecut din NOK in OK isi pierde
 * legatura, dar cererea ramane si se anuleaza explicit, din modulul Cereri.
 */
export async function saveInspection(
  actor: Actor,
  input: SaveInspectionInput,
): Promise<SaveInspectionResult> {
  const values = saveInspectionInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const [context] = await tx
        .select({
          companyId: schema.workUnits.companyId,
          objectiveId: schema.workUnits.objectiveId,
          contractObjectiveId: schema.workUnits.contractObjectiveId,
          contractId: schema.contractObjectives.contractId,
          validatedAt: schema.inspections.validatedAt,
          title: schema.workUnits.name,
        })
        .from(schema.inspections)
        .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.inspections.workUnitId))
        .leftJoin(
          schema.contractObjectives,
          eq(schema.contractObjectives.id, schema.workUnits.contractObjectiveId),
        )
        .where(eq(schema.inspections.workUnitId, values.workUnitId))
        .for('update')
        .limit(1);

      if (context === undefined) {
        throw new AppError('NOT_FOUND', 'Fișa de inspecție nu există sau nu e vizibilă.');
      }
      if (context.validatedAt !== null) {
        throw new AppError('CONFLICT', 'Fișa e validată — nu se mai completează.');
      }

      await tx
        .delete(schema.inspectionAnswers)
        .where(eq(schema.inspectionAnswers.workUnitId, values.workUnitId));

      const createdRequestIds: string[] = [];
      const createdProposalIds: string[] = [];

      for (const answer of values.answers) {
        const answerId = uuidv7();
        await tx.insert(schema.inspectionAnswers).values({
          id: answerId,
          workUnitId: values.workUnitId,
          checklistItemId: answer.checklistItemId,
          answer: answer.answer,
          note: answer.note,
          photoNodeId: answer.photoNodeId,
        });

        if (answer.finding === undefined) {
          continue;
        }

        const finding = answer.finding;
        let createdRequestId: string | null = null;
        let backlogProposalId: string | null = null;

        if (finding.outcome === 'interventie') {
          const request = await createRequestTx(tx, actor, {
            companyId: context.companyId,
            type: 'constatare_inspectie',
            source: 'fisa_inspectie',
            objectiveId: context.objectiveId,
            contractId: context.contractId ?? '',
            contractObjectiveId: context.contractObjectiveId ?? '',
            title: `Constatare — ${context.title}`,
            description: finding.resolutionNote ?? undefined,
            estimatedValue: finding.estimatedValue ?? '',
            slaDueAt: '',
          });
          createdRequestId = request.id;
          createdRequestIds.push(request.id);
        }

        if (finding.outcome === 'propunere') {
          if (context.contractId === null) {
            throw new AppError(
              'VALIDATION_FAILED',
              'O propunere de backlog are nevoie de contract — inspecția nu e legată de unul.',
            );
          }
          /*
           * Propunerea are nevoie de o cerere: `backlog_proposals.request_id` e
           * `not null`, si asta e corect — backlogul e o coada de CERERI amanate,
           * iar o propunere fara cerere n-ar putea fi nici triata, nici promovata
           * prin `promoteBacklog`. Deci constatarea naste si aici o cerere, doar
           * ca ea intra direct in backlog, nu in inbox.
           */
          const request = await createRequestTx(tx, actor, {
            companyId: context.companyId,
            type: 'constatare_inspectie',
            source: 'fisa_inspectie',
            objectiveId: context.objectiveId,
            contractId: context.contractId,
            contractObjectiveId: context.contractObjectiveId ?? '',
            title: `Propunere — ${context.title}`,
            description: finding.resolutionNote ?? undefined,
            estimatedValue: finding.estimatedValue ?? '',
            slaDueAt: '',
          });
          await tx
            .update(schema.requests)
            .set({ status: 'in_backlog' })
            .where(eq(schema.requests.id, request.id));

          backlogProposalId = uuidv7();
          await tx.insert(schema.backlogProposals).values({
            id: backlogProposalId,
            requestId: request.id,
            objectiveId: context.objectiveId,
            contractId: context.contractId,
            title: `Propunere — ${context.title}`,
            estimatedValue: finding.estimatedValue ?? '0',
            // Verificarea #5: propunerea nascuta din inspectie se vede ca atare
            // in backlog, si arata inapoi spre fisa prin `source_inspection_id`.
            sourceKind: 'inspectie',
            sourceInspectionId: values.workUnitId,
            validUntil: finding.validUntil,
          });
          createdProposalIds.push(backlogProposalId);
        }

        await tx.insert(schema.inspectionFindings).values({
          id: uuidv7(),
          workUnitId: values.workUnitId,
          answerId,
          outcome: finding.outcome,
          resolutionNote: finding.resolutionNote,
          estimatedValue: finding.estimatedValue,
          createdRequestId,
          backlogProposalId,
        });
      }

      return { createdRequestIds, createdProposalIds };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

// ── Validare ─────────────────────────────────────────────────────────────────

/**
 * Validarea de birou. Aici — si numai aici — se seteaza `effect_date`
 * (regula 2 din pas, verificarea #7).
 *
 * Verificarile care conteaza nu sunt scrise aici: trigger-ul din 0026 refuza
 * `validated_at` cat timp exista un NOK fara iesire sau un punct fara poza. Ce
 * face serviciul e sa duca mesajul lui la om.
 */
export async function validateInspection(
  actor: Actor,
  input: ValidateInspectionInput,
): Promise<{ readonly effectDate: string }> {
  const values = validateInspectionInputSchema.parse(input);

  try {
    return await withActor(actor, async (tx) => {
      const updated = await tx
        .update(schema.inspections)
        .set({
          effectDate: values.effectDate,
          validatedAt: new Date(),
          validatedBy: actor.personId,
        })
        .where(
          and(
            eq(schema.inspections.workUnitId, values.workUnitId),
            sql`${schema.inspections.validatedAt} is null`,
          ),
        )
        .returning({ effectDate: schema.inspections.effectDate });

      const row = updated[0];
      if (row === undefined || row.effectDate === null) {
        throw new AppError('CONFLICT', 'Fișa nu există, nu e vizibilă sau e deja validată.');
      }

      // Fisa validata inchide si unitatea: inspectia nu mai are ce sa produca.
      await tx
        .update(schema.workUnits)
        .set({ status: 'finalizata' })
        .where(eq(schema.workUnits.id, values.workUnitId));

      return { effectDate: row.effectDate };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/** Validarea in masa, de la sfarsit de luna (§3.6). Fiecare fisa, tranzactia ei. */
export async function validateInspections(
  actor: Actor,
  workUnitIds: readonly string[],
  effectDate: string,
): Promise<{ readonly validated: number; readonly failures: readonly string[] }> {
  const failures: string[] = [];
  let validated = 0;

  for (const workUnitId of workUnitIds) {
    try {
      await validateInspection(actor, { workUnitId, effectDate });
      validated += 1;
    } catch (error) {
      // Validarea in masa nu se opreste la prima fisa care nu poate: PM-ul vrea
      // sa le treaca pe cele bune si sa vada lista celor ramase, nu sa reia de
      // fiecare data de la inceput.
      failures.push(
        `${workUnitId}: ${error instanceof AppError ? error.message : 'eroare necunoscută'}`,
      );
    }
  }

  return { validated, failures };
}

// ── Acoperirea inspectiilor ──────────────────────────────────────────────────

export interface InspectionCoverageRow {
  readonly objectiveId: string;
  readonly objectiveName: string;
  readonly checklistCode: string | null;
  readonly checklistName: string | null;
  readonly lastInspectedOn: string | null;
  readonly inspectedThisMonth: boolean;
}

export interface InspectionCoverage {
  readonly rows: readonly InspectionCoverageRow[];
  readonly covered: number;
  readonly total: number;
}

/**
 * „Din N obiective, câte au fost inspectate luna asta" (verificarea #20).
 *
 * **Fara notificari catre teren**, dinadins: ecranul masoara, nu haituieste. Un
 * raport care trimite si mesaje devine, in doua saptamani, un raport pe care
 * nimeni nu-l mai deschide fiindca stie ce scrie in el.
 */
export async function inspectionCoverage(
  actor: Actor,
  options: {
    readonly companyIds: readonly string[];
    readonly monthStart: string;
    readonly monthEnd: string;
  },
): Promise<InspectionCoverage> {
  if (options.companyIds.length === 0) {
    return { rows: [], covered: 0, total: 0 };
  }

  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{
      objective_id: string;
      objective_name: string;
      checklist_code: string | null;
      checklist_name: string | null;
      last_inspected_on: string | null;
      inspected_this_month: boolean;
    }>(sql`
      select o.id as objective_id,
             o.name as objective_name,
             cl.code as checklist_code,
             cl.name as checklist_name,
             max(i.performed_on)::text as last_inspected_on,
             bool_or(i.performed_on between ${options.monthStart}::date and ${options.monthEnd}::date)
               as inspected_this_month
        from app.contract_objectives co
        join app.objectives o on o.id = co.objective_id
        join app.contracts c on c.id = co.contract_id
        left join app.inspection_profile_items pi on pi.profile_id = co.inspection_profile_id
        left join app.checklists cl on cl.id = pi.checklist_id
        left join app.work_units wu
          on wu.contract_objective_id = co.id and wu.type = 'inspectie'
        left join app.inspections i
          on i.work_unit_id = wu.id and (cl.id is null or i.checklist_id = cl.id)
       where c.company_id in ${[...options.companyIds]}
         and (co.valid_to is null or co.valid_to >= ${options.monthStart}::date)
       group by o.id, o.name, cl.code, cl.name
       order by o.name, cl.code
    `);

    const mapped = rows.rows.map((row) => ({
      objectiveId: row.objective_id,
      objectiveName: row.objective_name,
      checklistCode: row.checklist_code,
      checklistName: row.checklist_name,
      lastInspectedOn: row.last_inspected_on,
      inspectedThisMonth: row.inspected_this_month === true,
    }));

    return {
      rows: mapped,
      covered: mapped.filter((r) => r.inspectedThisMonth).length,
      total: mapped.length,
    };
  });
}

/** Fisele nevalidate ale lunii — ecranul de validare in masa (§3.6). */
export async function listUnvalidatedInspections(
  actor: Actor,
  companyIds: readonly string[],
): Promise<
  {
    readonly workUnitId: string;
    readonly code: string;
    readonly name: string;
    readonly performedOn: string;
  }[]
> {
  if (companyIds.length === 0) {
    return [];
  }
  return withActor(actor, async (tx) =>
    tx
      .select({
        workUnitId: schema.inspections.workUnitId,
        code: schema.workUnits.code,
        name: schema.workUnits.name,
        performedOn: schema.inspections.performedOn,
      })
      .from(schema.inspections)
      .innerJoin(schema.workUnits, eq(schema.workUnits.id, schema.inspections.workUnitId))
      .where(
        and(
          inArray(schema.workUnits.companyId, [...companyIds]),
          sql`${schema.inspections.validatedAt} is null`,
        ),
      )
      .orderBy(asc(schema.inspections.performedOn)),
  );
}
