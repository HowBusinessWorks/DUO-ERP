import { closeConnections, withActor } from '@damina/db';
import { AppError, Money, uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  allocateFunding,
  closeWorkUnit,
  createStage,
  createWorkUnit,
  getClosingChecklist,
  getStageOverview,
  getWorkUnit,
  listAllocations,
  listReallocationDocuments,
  listStages,
  listWorkUnits,
  moveFunding,
  previewFundingMove,
  promoteToLucrare,
  reorderStages,
} from '../src/work-units';
import { officeActor, rejection } from './helpers';
import { TEST_PERSON_ID } from './global-setup';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce verifica fisierul asta, si testele din `packages/db` nu pot: comportamentul
 * use-case-urilor. Ca promovarea pastreaza id-ul si codul, ca mutarea pe luna
 * deschisa supersedeaza iar pe luna inchisa emite document, ca istoricul
 * obiectivului nu se clinteste, si ca inchiderea chiar se opreste in checklist.
 */

/**
 * O serie PE FIECARE TIP, cu litere distincte.
 *
 * Contorul din `app.document_series` e per (firma, tip de document, serie), iar
 * codul unitatii e unic pe (firma, cod). Deci doua tipuri care ar folosi acelasi
 * text de serie ar produce amandoua `TL-000001` si al doilea ar cadea. Seed-ul
 * face la fel: `L`, `IV`, `I`.
 */
const SERIES_BY_TYPE = {
  lucrare: 'TL',
  interventie: 'TIV',
  inspectie: 'TI',
} as const;

interface Ground {
  readonly companyId: string;
  readonly clientId: string;
  readonly contractId: string;
  readonly objectiveId: string;
  readonly mentenanta: string;
  readonly delta: string;
  /** Luna curenta, mereu deschisa. */
  readonly currentPeriod: string;
  /** O luna trecuta, deschisa. */
  readonly openPast: string;
  /** O luna trecuta, INCHISA. */
  readonly closedPast: string;
}

/** Firma, contract cu doua componente, obiectiv, trei luni si o serie de coduri. */
async function ground(): Promise<Ground> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const contractId = uuidv7();
  const objectiveId = uuidv7();
  const mentenanta = uuidv7();
  const delta = uuidv7();
  const currentPeriod = uuidv7();
  const openPast = uuidv7();
  const closedPast = uuidv7();
  const tag = companyId.slice(-8);
  const now = new Date();

  await withActor(officeActor('pregatire teren de test'), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`,
    );
    await tx.execute(
      sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`,
    );
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
      values (${contractId}, ${companyId}, ${clientId}, ${`C-${tag}`},
              'mentenanta_multianual', '2020-01-01', '2035-12-31', 'activ')`);
    await tx.execute(sql`
      insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
      values (${mentenanta}, ${contractId}, 'mentenanta', 'Mentenanta', 'lunar', false),
             (${delta}, ${contractId}, 'delta', 'Delta', 'lunar', true)`);
    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`OB-${tag}`}, 'Statia de pompare', 'statie_pompare')`);

    // Luna curenta se ia din ceas: `moveFunding` o cauta acolo, iar un test cu
    // luna fixa ar pica singur la prima zi a lunii urmatoare.
    await tx.execute(sql`
      insert into app.periods (id, company_id, year, month)
      values (${currentPeriod}, ${companyId}, ${now.getUTCFullYear()}, ${now.getUTCMonth() + 1}),
             (${openPast}, ${companyId}, 2020, 5),
             (${closedPast}, ${companyId}, 2020, 6)`);
    await tx.execute(sql`
      update app.periods set status = 'closed', closed_at = now(), closed_by = ${TEST_PERSON_ID}
       where id = ${closedPast}`);

    // Doua serii: codurile unitatilor si numerele documentelor de re-alocare.
    await tx.execute(sql`
      insert into app.document_series (id, company_id, document_type, series, next_number)
      values (${uuidv7()}, ${companyId}, 'lucrare', ${SERIES_BY_TYPE.lucrare}, 1),
             (${uuidv7()}, ${companyId}, 'interventie', ${SERIES_BY_TYPE.interventie}, 1),
             (${uuidv7()}, ${companyId}, 'inspectie', ${SERIES_BY_TYPE.inspectie}, 1),
             (${uuidv7()}, ${companyId}, 'nota_realocare', 'NRA', 1)`);
  });

  return {
    companyId,
    clientId,
    contractId,
    objectiveId,
    mentenanta,
    delta,
    currentPeriod,
    openPast,
    closedPast,
  };
}

function workUnitInput(
  base: Ground,
  overrides: Partial<{
    type: 'inspectie' | 'interventie' | 'lucrare';
    startsOn: string;
    endsOn: string;
    estimatedValue: string;
  }> = {},
) {
  return {
    companyId: base.companyId,
    type: overrides.type ?? ('lucrare' as const),
    name: 'Inlocuire pompa SP-14',
    objectiveId: base.objectiveId,
    contractObjectiveId: '',
    responsiblePersonId: TEST_PERSON_ID,
    executorType: 'echipa_proprie' as const,
    executorSubcontractorId: '',
    startsOn: overrides.startsOn ?? '2020-05-04',
    endsOn: overrides.endsOn ?? '',
    estimatedValue: overrides.estimatedValue ?? '34800.00',
    costBudget: '25000.00',
  };
}

function allocationInput(base: Ground, periodId: string, amount: string, componentId?: string) {
  return {
    contractId: base.contractId,
    componentId: componentId ?? base.delta,
    periodId,
    allocatedAmount: amount,
    allocatedPct: '',
    reason: 'finantare din Delta',
  };
}

describe('createWorkUnit', () => {
  // Verificarea #1 a pasului, prin use-case.
  it('creeaza unitatea, codul din serie si trei alocari, intr-o tranzactie', async () => {
    const base = await ground();
    const third = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.periods (id, company_id, year, month)
        values (${third}, ${base.companyId}, 2020, 7)`);
    });

    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base),
      allocations: [
        allocationInput(base, base.openPast, '12500.00'),
        allocationInput(base, base.currentPeriod, '12500.00'),
        allocationInput(base, third, '9800.00'),
      ],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });

    expect(created.code).toBe(`${SERIES_BY_TYPE.lucrare}-000001`);

    const row = await getWorkUnit(officeActor(), created.id);
    expect(row.allocationCount).toBe(3);
    expect(row.allocatedTotal.toDbString()).toBe('34800.00');
    expect(row.fundingLabel).toBe('Delta');
    // Registrul de cost vine la pasul 06: consumul e zero, dar exista.
    expect(row.consumed.toDbString()).toBe('0.00');
  });

  it('codurile ies consecutive, fara goluri', async () => {
    const base = await ground();
    const codes: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await createWorkUnit(officeActor(), {
        workUnit: workUnitInput(base),
        allocations: [],
        series: SERIES_BY_TYPE.lucrare,
        assignments: [],
      });
      codes.push(created.code);
    }

    expect(codes).toEqual([
      `${SERIES_BY_TYPE.lucrare}-000001`,
      `${SERIES_BY_TYPE.lucrare}-000002`,
      `${SERIES_BY_TYPE.lucrare}-000003`,
    ]);
  });

  // Verificarea #16 a pasului, prin use-case: tranzactia cade INTREAGA.
  it('luna inchisa: PERIOD_CLOSED, si unitatea nu ramane creata', async () => {
    const base = await ground();

    const error = await rejection(
      createWorkUnit(officeActor(), {
        workUnit: workUnitInput(base),
        allocations: [allocationInput(base, base.closedPast, '1000.00')],
        assignments: [],
        series: SERIES_BY_TYPE.lucrare,
      }),
    );

    expect(AppError.is(error)).toBe(true);
    expect((error as AppError).code).toBe('PERIOD_CLOSED');

    // Nimic nu s-a scris: codul alocat din serie s-a intors cu rollback-ul.
    const rows = await listWorkUnits(officeActor(), { companyIds: [base.companyId] });
    expect(rows).toHaveLength(0);
  });

  it('o interventie fara finantare e refuzata inainte de baza', async () => {
    const base = await ground();

    const error = await rejection(
      createWorkUnit(officeActor(), {
        workUnit: workUnitInput(base, { type: 'interventie' }),
        allocations: [],
        assignments: [],
        series: SERIES_BY_TYPE.interventie,
      }),
    );

    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });

  /*
   * Gasit la primul CI al lui 05b: contorul de serie e per (firma, TIP, serie),
   * dar codul e unic pe (firma, cod). Doua tipuri cu acelasi text de serie produc
   * amandoua `X-000001`, si al doilea cade — cu un mesaj care trebuie sa spuna
   * cauza, nu simptomul.
   */
  it('doua tipuri cu aceeasi serie: CONFLICT care spune ca seria e partajata', async () => {
    const base = await ground();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.document_series (id, company_id, document_type, series, next_number)
        values (${uuidv7()}, ${base.companyId}, 'inspectie', ${SERIES_BY_TYPE.lucrare}, 1)`);
    });

    await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base),
      allocations: [],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });

    const error = await rejection(
      createWorkUnit(officeActor(), {
        workUnit: workUnitInput(base, { type: 'inspectie' }),
        allocations: [],
        assignments: [],
        series: SERIES_BY_TYPE.lucrare,
      }),
    );

    expect((error as AppError).code).toBe('CONFLICT');
    expect((error as AppError).message).toMatch(/seria lui/);
  });

  it('seria inexistenta: NOT_FOUND cu mesaj despre serie', async () => {
    const base = await ground();

    const error = await rejection(
      createWorkUnit(officeActor(), {
        workUnit: workUnitInput(base),
        allocations: [],
        assignments: [],
        series: 'NU-EXISTA',
      }),
    );

    expect((error as AppError).code).toBe('NOT_FOUND');
  });

  it('asignarea unei persoane fara SSM valabil opreste toata crearea', async () => {
    const base = await ground();
    const worker = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.persons (id, persona, category, full_name)
        values (${worker}, 'field', 'sef_santier', 'Sef fara autorizatie')`);
    });

    const error = await rejection(
      createWorkUnit(officeActor(), {
        workUnit: workUnitInput(base),
        allocations: [],
        assignments: [{ personId: worker, role: 'sef_santier', validFrom: '', validTo: '' }],
        series: SERIES_BY_TYPE.lucrare,
      }),
    );

    expect((error as AppError).code).toBe('AUTHORIZATION_EXPIRED');
    expect(await listWorkUnits(officeActor(), { companyIds: [base.companyId] })).toHaveLength(0);
  });
});

describe('promoteToLucrare', () => {
  // Verificarea #4 a pasului.
  it('pastreaza id-ul si codul, schimba tipul, si lasa motivul in audit', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base, { type: 'interventie' }),
      allocations: [allocationInput(base, base.openPast, '800.00', base.mentenanta)],
      assignments: [],
      series: SERIES_BY_TYPE.interventie,
    });

    // Ceva atasat de unitate, ca sa se vada ca nu s-a copiat nimic: alocarea.
    const before = await listAllocations(officeActor(), created.id);

    const promoted = await promoteToLucrare(officeActor(), {
      workUnitId: created.id,
      reason: 'interventia depaseste pragul de 2.000 lei',
    });

    expect(promoted.id).toBe(created.id);

    const after = await getWorkUnit(officeActor(), created.id);
    expect(after.type).toBe('lucrare');
    expect(after.code).toBe(created.code);
    // Finantarea a ramas neatinsa: acelasi rand, nu o copie.
    expect(await listAllocations(officeActor(), created.id)).toHaveLength(before.length);

    const audited = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute<{ reason: string | null }>(
        sql`select reason from audit.entries
             where table_name = 'app.work_units' and record_id = ${created.id}
               and operation = 'update'`,
      );
      return rows.rows;
    });
    expect(audited).toHaveLength(1);
    expect(audited[0]?.reason).toMatch(/depaseste pragul/);
  });

  it('o lucrare nu se promoveaza a doua oara', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base),
      allocations: [],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });

    const error = await rejection(
      promoteToLucrare(officeActor(), { workUnitId: created.id, reason: 'inca o data' }),
    );
    expect((error as AppError).code).toBe('CONFLICT');
    expect((error as AppError).message).toMatch(/deja lucrare/);
  });

  it('o inspectie nu devine lucrare', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base, { type: 'inspectie' }),
      allocations: [],
      assignments: [],
      series: SERIES_BY_TYPE.inspectie,
    });

    const error = await rejection(
      promoteToLucrare(officeActor(), { workUnitId: created.id, reason: 'as vrea' }),
    );
    expect((error as AppError).message).toMatch(/inspec/i);
  });

  it('fara motiv scris: refuzat de schema, nu de baza', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base, { type: 'interventie' }),
      allocations: [allocationInput(base, base.openPast, '800.00')],
      assignments: [],
      series: SERIES_BY_TYPE.interventie,
    });

    await expect(
      promoteToLucrare(officeActor(), { workUnitId: created.id, reason: '   ' }),
    ).rejects.toThrow();
  });
});

describe('moveFunding', () => {
  /**
   * O interventie finantata dintr-o luna, cu opțiunea de a inchide luna DUPA.
   *
   * Ordinea conteaza si e chiar ordinea din realitate: aloci in august, august se
   * inchide, iar mutarea vine in septembrie. O alocare scrisa direct intr-o luna
   * deja inchisa e refuzata de `guard_closed_period` — asta e verificarea #16, nu
   * o piedica de harness.
   */
  async function funded(base: Ground, periodId: string, closeAfter = false) {
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base, { type: 'interventie' }),
      allocations: [allocationInput(base, periodId, '800.00', base.mentenanta)],
      assignments: [],
      series: SERIES_BY_TYPE.interventie,
    });
    const [allocation] = await listAllocations(officeActor(), created.id);
    if (allocation === undefined) {
      throw new Error('alocarea de test lipseste');
    }

    if (closeAfter) {
      await withActor(officeActor('inchidere de luna pentru test'), async (tx) => {
        await tx.execute(
          sql`update app.periods
                 set status = 'closed', closed_at = now(), closed_by = ${TEST_PERSON_ID}
               where id = ${periodId}`,
        );
      });
    }

    return { workUnitId: created.id, allocationId: allocation.id };
  }

  // Verificarea #5 a pasului.
  it('luna deschisa: alocarea noua e activa, cea veche supersedata', async () => {
    const base = await ground();
    const { workUnitId, allocationId } = await funded(base, base.openPast);

    const preview = await previewFundingMove(officeActor(), allocationId);
    expect(preview.kind).toBe('rewrite-charged-analytics');
    expect(preview.periodIsClosed).toBe(false);
    expect(preview.amount.toDbString()).toBe('800.00');

    const result = await moveFunding(officeActor(), {
      workUnitId,
      allocationId,
      toContractId: base.contractId,
      toComponentId: base.delta,
      toPeriodId: base.openPast,
      reason: 'trece pe Delta, e peste pragul de mentenanta',
    });

    expect(result.kind).toBe('rewrite-charged-analytics');
    expect(result.supersededAllocationId).toBe(allocationId);
    expect(result.reallocationDocumentId).toBeNull();

    const allocations = await listAllocations(officeActor(), workUnitId);
    const byId = new Map(allocations.map((row) => [row.id, row]));
    expect(byId.get(allocationId)?.status).toBe('superseded');
    expect(byId.get(allocationId)?.supersededBy).toBe(result.newAllocationId);
    expect(byId.get(result.newAllocationId)?.status).toBe('active');
    expect(byId.get(result.newAllocationId)?.componentName).toBe('Delta');
    // Suma nu se schimba la mutare: se muta, nu se recalculeaza.
    expect(byId.get(result.newAllocationId)?.allocatedAmount).toBe('800.00');
  });

  // Verificarea #6 a pasului.
  it('luna inchisa: document de re-alocare in luna CURENTA, alocarea veche neatinsa', async () => {
    const base = await ground();
    // Alocarea se face cat luna e deschisa, apoi luna se inchide. Exact ordinea
    // din realitate — si singura posibila, pentru ca o alocare scrisa direct
    // intr-o luna inchisa e refuzata de trigger.
    const { workUnitId, allocationId } = await funded(base, base.openPast, true);

    const preview = await previewFundingMove(officeActor(), allocationId);
    expect(preview.kind).toBe('reallocation-document');
    expect(preview.periodIsClosed).toBe(true);

    const result = await moveFunding(officeActor(), {
      workUnitId,
      allocationId,
      toContractId: base.contractId,
      toComponentId: base.delta,
      toPeriodId: base.currentPeriod,
      reason: 'luna e inchisa, se re-aloca in luna curenta',
    });

    expect(result.kind).toBe('reallocation-document');
    expect(result.reallocationNumber).toBe('NRA-000001');
    // Luna raportata nu se rescrie: alocarea veche ramane ACTIVA acolo.
    expect(result.supersededAllocationId).toBeNull();

    const allocations = await listAllocations(officeActor(), workUnitId);
    expect(allocations.find((row) => row.id === allocationId)?.status).toBe('active');
    expect(allocations.find((row) => row.id === result.newAllocationId)?.periodId).toBe(
      base.currentPeriod,
    );

    // Verificarea #15: lista lunii arata ambele capete si pe cine a decis.
    const documents = await listReallocationDocuments(officeActor(), {
      companyIds: [base.companyId],
      periodId: base.currentPeriod,
    });
    expect(documents).toHaveLength(1);
    expect(documents[0]?.fromComponentName).toBe('Mentenanta');
    expect(documents[0]?.toComponentName).toBe('Delta');
    expect(documents[0]?.amount).toBe('800.00');
    expect(documents[0]?.reason).toMatch(/luna e inchisa/);
    expect(documents[0]?.createdByName).not.toBeNull();
  });

  // Verificarea #7 a pasului.
  it('fara motiv scris: nu se salveaza nimic', async () => {
    const base = await ground();
    const { workUnitId, allocationId } = await funded(base, base.openPast);

    await expect(
      moveFunding(officeActor(), {
        workUnitId,
        allocationId,
        toContractId: base.contractId,
        toComponentId: base.delta,
        toPeriodId: base.openPast,
        reason: '  ',
      }),
    ).rejects.toThrow();

    const allocations = await listAllocations(officeActor(), workUnitId);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]?.status).toBe('active');
  });

  // Verificarea #8 a pasului: istoricul obiectivului e sacru.
  it('dupa mutare, unitatea sta pe ACELASI obiectiv, cu acelasi cod', async () => {
    const base = await ground();
    const { workUnitId, allocationId } = await funded(base, base.openPast);
    const before = await getWorkUnit(officeActor(), workUnitId);

    await moveFunding(officeActor(), {
      workUnitId,
      allocationId,
      toContractId: base.contractId,
      toComponentId: base.delta,
      toPeriodId: base.openPast,
      reason: 'mutare pe Delta',
    });

    const after = await getWorkUnit(officeActor(), workUnitId);
    expect(after.objectiveId).toBe(before.objectiveId);
    expect(after.code).toBe(before.code);
    expect(after.startsOn).toBe(before.startsOn);
    // Istoricul obiectivului e chiar lista unitatilor lui: neschimbata la numar.
    const history = await listWorkUnits(officeActor(), {
      companyIds: [base.companyId],
      objectiveId: base.objectiveId,
    });
    expect(history).toHaveLength(1);
  });

  it('mutarea pe aceeasi componenta si luna: refuzata de domain', async () => {
    const base = await ground();
    const { workUnitId, allocationId } = await funded(base, base.openPast);

    const error = await rejection(
      moveFunding(officeActor(), {
        workUnitId,
        allocationId,
        toContractId: base.contractId,
        toComponentId: base.mentenanta,
        toPeriodId: base.openPast,
        reason: 'nicio schimbare',
      }),
    );
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });

  it('o alocare deja supersedata nu se mai muta', async () => {
    const base = await ground();
    const { workUnitId, allocationId } = await funded(base, base.openPast);
    await moveFunding(officeActor(), {
      workUnitId,
      allocationId,
      toContractId: base.contractId,
      toComponentId: base.delta,
      toPeriodId: base.openPast,
      reason: 'prima mutare',
    });

    const error = await rejection(
      moveFunding(officeActor(), {
        workUnitId,
        allocationId,
        toContractId: base.contractId,
        toComponentId: base.mentenanta,
        toPeriodId: base.currentPeriod,
        reason: 'a doua mutare, pe randul vechi',
      }),
    );
    expect((error as AppError).code).toBe('CONFLICT');
  });

  it('mutarea INTR-O luna inchisa e refuzata de baza', async () => {
    const base = await ground();
    const { workUnitId, allocationId } = await funded(base, base.openPast);

    const error = await rejection(
      moveFunding(officeActor(), {
        workUnitId,
        allocationId,
        toContractId: base.contractId,
        toComponentId: base.delta,
        toPeriodId: base.closedPast,
        reason: 'in luna inchisa',
      }),
    );
    expect((error as AppError).code).toBe('PERIOD_CLOSED');
  });
});

describe('alocari suplimentare', () => {
  it('a doua alocare activa pe aceeasi componenta si luna: CONFLICT cu mesaj', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base),
      allocations: [allocationInput(base, base.openPast, '1000.00')],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });

    const error = await rejection(
      allocateFunding(officeActor(), created.id, allocationInput(base, base.openPast, '2000.00')),
    );
    expect((error as AppError).code).toBe('CONFLICT');
    expect((error as AppError).message).toMatch(/nu o dubla/);
  });

  it('procentele active peste 100% pe aceeasi luna: VALIDATION_FAILED din trigger', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base),
      allocations: [],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });

    await allocateFunding(officeActor(), created.id, {
      contractId: base.contractId,
      componentId: base.mentenanta,
      periodId: base.openPast,
      allocatedAmount: '',
      allocatedPct: '60',
      reason: 'sase zecimi din mentenanta',
    });

    const error = await rejection(
      allocateFunding(officeActor(), created.id, {
        contractId: base.contractId,
        componentId: base.delta,
        periodId: base.openPast,
        allocatedAmount: '',
        allocatedPct: '50',
        reason: 'jumatate din Delta',
      }),
    );
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect((error as AppError).message).toMatch(/110\.00%/);
  });
});

describe('etape', () => {
  async function lucrare(base: Ground) {
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base),
      allocations: [],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });
    return created.id;
  }

  it('pozitiile se dau in tranzactie, consecutiv', async () => {
    const base = await ground();
    const workUnitId = await lucrare(base);

    for (const name of ['Demontare', 'Montaj', 'Probe']) {
      await createStage(officeActor(), {
        workUnitId,
        name,
        plannedStart: '',
        plannedEnd: '',
        materialBudget: '',
        laborBudget: '',
        pctOfWork: '',
      });
    }

    const stages = await listStages(officeActor(), workUnitId);
    expect(stages.map((stage) => stage.position)).toEqual([1, 2, 3]);
    expect(stages.map((stage) => stage.name)).toEqual(['Demontare', 'Montaj', 'Probe']);
  });

  // Verificarea #9 a pasului, prin use-case.
  it('etapa pe o inspectie: VALIDATION_FAILED, cu mesajul din baza', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base, { type: 'inspectie' }),
      allocations: [],
      assignments: [],
      series: SERIES_BY_TYPE.inspectie,
    });

    const error = await rejection(
      createStage(officeActor(), {
        workUnitId: created.id,
        name: 'Etapa nepermisa',
        plannedStart: '',
        plannedEnd: '',
        materialBudget: '',
        laborBudget: '',
        pctOfWork: '',
      }),
    );
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect((error as AppError).message).toMatch(/doar pe lucrari/);
  });

  it('reordonarea rescrie pozitiile 1..n', async () => {
    const base = await ground();
    const workUnitId = await lucrare(base);
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C']) {
      const stage = await createStage(officeActor(), {
        workUnitId,
        name,
        plannedStart: '',
        plannedEnd: '',
        materialBudget: '',
        laborBudget: '',
        pctOfWork: '',
      });
      ids.push(stage.id);
    }

    const [first, second, third] = ids;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('etapele de test lipsesc');
    }

    await reorderStages(officeActor(), { workUnitId, stageIds: [third, first, second] });

    const stages = await listStages(officeActor(), workUnitId);
    expect(stages.map((stage) => stage.name)).toEqual(['C', 'A', 'B']);
    expect(stages.map((stage) => stage.position)).toEqual([1, 2, 3]);
  });

  it('reordonarea cu o etapa lipsa e refuzata', async () => {
    const base = await ground();
    const workUnitId = await lucrare(base);
    const stage = await createStage(officeActor(), {
      workUnitId,
      name: 'Singura',
      plannedStart: '',
      plannedEnd: '',
      materialBudget: '',
      laborBudget: '',
      pctOfWork: '',
    });

    const error = await rejection(
      reorderStages(officeActor(), { workUnitId, stageIds: [stage.id, uuidv7()] }),
    );
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });

  it('progresul fizic numara etapele incheiate', async () => {
    const base = await ground();
    const workUnitId = await lucrare(base);
    const ids: string[] = [];
    for (const name of ['A', 'B']) {
      const stage = await createStage(officeActor(), {
        workUnitId,
        name,
        plannedStart: '2020-05-01',
        plannedEnd: '2020-05-10',
        materialBudget: '',
        laborBudget: '',
        pctOfWork: '',
      });
      ids.push(stage.id);
    }

    await withActor(officeActor('inchidere de etapa'), async (tx) => {
      await tx.execute(
        sql`update app.work_stages set actual_start = '2020-05-01', actual_end = '2020-05-09'
             where id = ${ids[0] ?? ''}`,
      );
    });

    const overview = await getStageOverview(officeActor(), workUnitId);
    expect(overview.progress.percent).toBe(50);
    expect(overview.progress.completedStages).toBe(1);
    expect(overview.schedule.coherent).toBe(true);
  });
});

describe('inchidere', () => {
  // Verificarea #19 a pasului.
  it('checklist-ul blocheaza, si spune exact ce lipseste', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base),
      allocations: [],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });
    await createStage(officeActor(), {
      workUnitId: created.id,
      name: 'Neincheiata',
      plannedStart: '',
      plannedEnd: '',
      materialBudget: '',
      laborBudget: '',
      pctOfWork: '',
    });

    const checklist = await getClosingChecklist(officeActor(), created.id);
    expect(checklist.canClose).toBe(false);

    const byCode = new Map(checklist.items.map((item) => [item.code, item]));
    // Fara finantare, fara data de final, cu o etapa neincheiata.
    expect(byCode.get('funding')?.state).toBe('blocking');
    expect(byCode.get('end_date')?.state).toBe('blocking');
    expect(byCode.get('stages')?.state).toBe('blocking');
    // Randurile modulelor viitoare EXISTA, dezactivate — nu lipsesc.
    expect(byCode.get('material_return')?.state).toBe('pending_module');
    expect(byCode.get('pv_receptie')?.state).toBe('pending_module');
    // Fiecare rand blocant are unde sa trimita omul.
    for (const item of checklist.items) {
      if (item.state === 'blocking') {
        expect(item.href).not.toBeNull();
      }
    }

    const error = await rejection(
      closeWorkUnit(officeActor(), { workUnitId: created.id, reason: 'gata' }),
    );
    expect((error as AppError).code).toBe('CONFLICT');
  });

  it('cu toate randurile rezolvate, unitatea se inchide si isi noteaza autorul', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base, { endsOn: '2020-05-30' }),
      allocations: [allocationInput(base, base.openPast, '12500.00')],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });

    const checklist = await getClosingChecklist(officeActor(), created.id);
    expect(checklist.canClose).toBe(true);

    await closeWorkUnit(officeActor(), {
      workUnitId: created.id,
      reason: 'lucrarea e recepționată',
    });

    const closed = await getWorkUnit(officeActor(), created.id);
    expect(closed.status).toBe('inchisa');
    expect(closed.closedBy).toBe(TEST_PERSON_ID);
    expect(closed.closedAt).not.toBeNull();
  });

  it('o unitate inchisa nu se inchide a doua oara', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base, { endsOn: '2020-05-30' }),
      allocations: [allocationInput(base, base.openPast, '500.00')],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });
    await closeWorkUnit(officeActor(), { workUnitId: created.id, reason: 'gata' });

    const error = await rejection(
      closeWorkUnit(officeActor(), { workUnitId: created.id, reason: 'inca o data' }),
    );
    expect((error as AppError).code).toBe('CONFLICT');
  });

  it('inspectia se inchide fara finantare', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base, { type: 'inspectie', endsOn: '2020-05-06' }),
      allocations: [],
      assignments: [],
      series: SERIES_BY_TYPE.inspectie,
    });

    const checklist = await getClosingChecklist(officeActor(), created.id);
    expect(checklist.canClose).toBe(true);
  });
});

describe('listWorkUnits', () => {
  it('filtreaza pe componenta prin alocarile active, fara sa dubleze randul', async () => {
    const base = await ground();
    const created = await createWorkUnit(officeActor(), {
      workUnit: workUnitInput(base),
      allocations: [
        allocationInput(base, base.openPast, '12500.00'),
        allocationInput(base, base.currentPeriod, '12500.00'),
      ],
      assignments: [],
      series: SERIES_BY_TYPE.lucrare,
    });
    expect(created.id).not.toBe('');

    // Doua alocari pe aceeasi componenta: lista trebuie sa arate UN rand.
    const onDelta = await listWorkUnits(officeActor(), {
      companyIds: [base.companyId],
      componentId: base.delta,
    });
    expect(onDelta).toHaveLength(1);

    const onMentenanta = await listWorkUnits(officeActor(), {
      companyIds: [base.companyId],
      componentId: base.mentenanta,
    });
    expect(onMentenanta).toHaveLength(0);
  });

  it('verificarea #14: suma valorilor unitatilor finantate din componenta', async () => {
    const base = await ground();
    for (const amount of ['1000.00', '2500.00']) {
      await createWorkUnit(officeActor(), {
        workUnit: workUnitInput(base, { estimatedValue: amount }),
        allocations: [allocationInput(base, base.openPast, amount)],
        assignments: [],
        series: SERIES_BY_TYPE.lucrare,
      });
    }

    const rows = await listWorkUnits(officeActor(), {
      companyIds: [base.companyId],
      componentId: base.delta,
      periodId: base.openPast,
    });

    expect(rows).toHaveLength(2);
    // Cifra de pe banda componentei trebuie sa dea EXACT suma unitatilor ei.
    expect(Money.sum(rows.map((row) => row.allocatedTotal)).toDbString()).toBe('3500.00');
  });

  it('firmele goale nu inseamna „toate”', async () => {
    expect(await listWorkUnits(officeActor(), { companyIds: [] })).toEqual([]);
  });

  it('filtrul de tip separa cele trei tipuri', async () => {
    const base = await ground();
    for (const type of ['inspectie', 'lucrare'] as const) {
      await createWorkUnit(officeActor(), {
        workUnit: workUnitInput(base, { type }),
        allocations: [],
        assignments: [],
        series: SERIES_BY_TYPE[type],
      });
    }

    const inspections = await listWorkUnits(officeActor(), {
      companyIds: [base.companyId],
      types: ['inspectie'],
    });
    expect(inspections).toHaveLength(1);
    expect(inspections[0]?.type).toBe('inspectie');
  });
});
