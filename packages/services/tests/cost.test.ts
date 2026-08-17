import { closeConnections, withActor } from '@damina/db';
import { AppError, uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  costBreakdown,
  listCostLines,
  listReconciliation,
  recordCost,
  stornoCost,
  verifyRollups,
} from '../src/cost';
import { readIntegrityMetrics } from '../src/cost-integrity';
import {
  closePeriod,
  evaluatePeriodClose,
  reopenPeriod,
  startClosing,
} from '../src/period-close';
import { createWorkUnit, moveFunding } from '../src/work-units';
import { TEST_PERSON_ID } from './global-setup';
import { officeActor, rejection } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce verifica fisierul asta, si testele din `packages/db` nu pot: comportamentul
 * use-case-urilor de cost. Ca storno-ul se calculeaza singur din linia gresita,
 * ca mutarea finantarii duce costurile cu ea, ca inchiderea chiar se opreste in
 * checklist, si ca redeschiderea cere motiv.
 */

const SERIES_BY_TYPE = {
  lucrare: 'CL',
  interventie: 'CIV',
  inspectie: 'CI',
} as const;

interface Ground {
  readonly companyId: string;
  readonly contractId: string;
  readonly objectiveId: string;
  readonly mentenanta: string;
  readonly delta: string;
  readonly currentPeriod: string;
  readonly openPast: string;
  readonly closedPast: string;
}

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
      sql`insert into app.companies (id, name) values (${companyId}, ${`Firma cost ${tag}`})`,
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
    await tx.execute(sql`
      insert into app.periods (id, company_id, year, month)
      values (${currentPeriod}, ${companyId}, ${now.getUTCFullYear()}, ${now.getUTCMonth() + 1}),
             (${openPast}, ${companyId}, 2020, 5),
             (${closedPast}, ${companyId}, 2020, 6)`);
    await tx.execute(sql`
      update app.periods set status = 'closed', closed_at = now(), closed_by = ${TEST_PERSON_ID}
       where id = ${closedPast}`);
    await tx.execute(sql`
      insert into app.document_series (id, company_id, document_type, series, next_number)
      values (${uuidv7()}, ${companyId}, 'lucrare', ${SERIES_BY_TYPE.lucrare}, 1),
             (${uuidv7()}, ${companyId}, 'interventie', ${SERIES_BY_TYPE.interventie}, 1),
             (${uuidv7()}, ${companyId}, 'inspectie', ${SERIES_BY_TYPE.inspectie}, 1),
             (${uuidv7()}, ${companyId}, 'nota_realocare', 'NRA', 1)`);
  });

  return {
    companyId,
    contractId,
    objectiveId,
    mentenanta,
    delta,
    currentPeriod,
    openPast,
    closedPast,
  };
}

/**
 * O interventie finantata dintr-o componenta, intr-o luna.
 *
 * `closeAfter` inchide luna DUPA ce alocarea exista — exact ordinea din
 * realitate, si singura posibila: o alocare scrisa direct intr-o luna inchisa e
 * refuzata de trigger (verificarea #16 a pasului 05).
 */
async function interventionOn(
  base: Ground,
  componentId: string,
  periodId: string,
  closeAfter = false,
): Promise<{ workUnitId: string; allocationId: string }> {
  const created = await createWorkUnit(officeActor('creare pentru test'), {
    workUnit: {
      companyId: base.companyId,
      type: 'interventie',
      name: 'Remediere avarie',
      objectiveId: base.objectiveId,
      contractObjectiveId: '',
      responsiblePersonId: TEST_PERSON_ID,
      executorType: 'echipa_proprie',
      executorSubcontractorId: '',
      startsOn: '2020-05-04',
      endsOn: '',
      estimatedValue: '2000.00',
      costBudget: '1500.00',
    },
    allocations: [
      {
        contractId: base.contractId,
        componentId,
        periodId,
        allocatedAmount: '2000.00',
        allocatedPct: '',
        reason: 'finantare initiala',
      },
    ],
    assignments: [],
    series: SERIES_BY_TYPE.interventie,
  });

  const allocations = await withActor(officeActor(), async (tx) => {
    const rows = await tx.execute(sql`
      select id from app.funding_allocations
       where work_unit_id = ${created.id} and status = 'active'`);
    return rows.rows as { id: string }[];
  });

  if (closeAfter) {
    await withActor(officeActor('inchidere de luna pentru test'), async (tx) => {
      await tx.execute(sql`
        update app.periods set status = 'closed', closed_at = now(), closed_by = ${TEST_PERSON_ID}
         where id = ${periodId}`);
    });
  }

  return { workUnitId: created.id, allocationId: allocations[0]?.id ?? '' };
}

function costInput(
  base: Ground,
  workUnitId: string,
  overrides: Partial<{
    amount: string;
    stage: 'angajat' | 'receptionat' | 'consumat' | 'facturat';
    effectDate: string;
    chargedComponentId: string;
    chargedContractId: string;
  }> = {},
) {
  return {
    companyId: base.companyId,
    documentDate: overrides.effectDate ?? '2020-05-04',
    effectDate: overrides.effectDate ?? '2020-05-04',
    usedContractId: base.contractId,
    usedComponentId: base.mentenanta,
    objectiveId: base.objectiveId,
    workUnitId,
    stageId: '',
    chargedContractId: overrides.chargedContractId ?? '',
    chargedComponentId: overrides.chargedComponentId ?? '',
    expenseType: 'material' as const,
    productId: '',
    qualificationId: '',
    quantity: '3',
    uom: 'buc',
    amount: overrides.amount ?? '800.00',
    stage: overrides.stage ?? ('consumat' as const),
    documentType: 'bon_consum' as const,
    documentId: uuidv7(),
    documentLineId: '',
    supplierId: '',
    subcontractorId: '',
  };
}

describe('recordCost', () => {
  it('face cele doua analitici egale cand apelantul nu le desparte', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);

    const { costLineId, periodId } = await recordCost(
      officeActor(),
      costInput(base, workUnitId),
    );

    expect(periodId).toBe(base.openPast);

    const row = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select used_component_id, charged_component_id from app.cost_lines where id = ${costLineId}`);
      return rows.rows[0] as { used_component_id: string; charged_component_id: string };
    });

    // Implicit sunt egale (§12). Cine le desparte o face explicit.
    expect(row.charged_component_id).toBe(row.used_component_id);
    expect(row.charged_component_id).toBe(base.mentenanta);
  });

  it('luna vine din data de efect, nu din ce crede apelantul', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);

    // Document din aprilie, efect in mai: raportarea e a lunii clientului.
    const { periodId } = await recordCost(officeActor(), {
      ...costInput(base, workUnitId),
      documentDate: '2020-04-28',
      effectDate: '2020-05-02',
    });

    expect(periodId).toBe(base.openPast);
  });

  it('o linie in luna inchisa e refuzata cu PERIOD_CLOSED', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);

    const error = await rejection(
      recordCost(officeActor(), {
        ...costInput(base, workUnitId),
        documentDate: '2020-06-10',
        effectDate: '2020-06-10',
      }),
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('PERIOD_CLOSED');
  });
});

describe('stornoCost', () => {
  it('inverseaza suma singur, si amandoua liniile raman vizibile', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);

    const { costLineId } = await recordCost(
      officeActor(),
      costInput(base, workUnitId, { amount: '2500.00' }),
    );

    const storno = await stornoCost(officeActor(), {
      costLineId,
      reason: 'suma trecuta gresit de pe bon',
    });

    const rows = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(sql`
        select amount, quantity, reallocation_of_id
          from app.cost_lines where work_unit_id = ${workUnitId} order by amount`);
      return result.rows as { amount: string; quantity: string; reallocation_of_id: string | null }[];
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.amount).toBe('-2500.00');
    // Si cantitatea se inverseaza: altfel „cate bucati" ar aduna bucatile
    // stornate peste cele reale, desi banii s-ar fi anulat.
    expect(rows[0]?.quantity).toBe('-3.0000');
    expect(rows[0]?.reallocation_of_id).toBe(costLineId);
    expect(rows[1]?.amount).toBe('2500.00');
    expect(storno.costLineId).not.toBe(costLineId);

    // Rollup-ul se intoarce la zero, in aceeasi tranzactie cu liniile.
    const rollup = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(sql`
        select consumed from app.component_period_rollup
         where component_id = ${base.mentenanta} and period_id = ${base.openPast}`);
      return (result.rows[0] as { consumed: string } | undefined)?.consumed;
    });

    expect(rollup).toBe('0.00');
  });

  it('storno-ul unui storno e refuzat — corectia se face pe linia originala', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);
    const { costLineId } = await recordCost(officeActor(), costInput(base, workUnitId));
    const storno = await stornoCost(officeActor(), { costLineId, reason: 'gresit' });

    const error = await rejection(
      stornoCost(officeActor(), { costLineId: storno.costLineId, reason: 'si asta' }),
    );

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
  });
});

describe('#13 mutarea finantarii duce costurile cu ea', () => {
  it('luna deschisa: analitica „descarcat" se rescrie, „folosit" ramane', async () => {
    const base = await ground();
    const { workUnitId, allocationId } = await interventionOn(
      base,
      base.mentenanta,
      base.openPast,
    );

    const { costLineId } = await recordCost(
      officeActor(),
      costInput(base, workUnitId, { amount: '800.00' }),
    );

    const result = await moveFunding(officeActor(), {
      workUnitId,
      allocationId,
      toContractId: base.contractId,
      toComponentId: base.delta,
      toPeriodId: base.openPast,
      reason: 'a depasit pragul, trece pe Delta',
    });

    expect(result.kind).toBe('rewrite-charged-analytics');
    expect(result.rechargedCostLines).toBe(1);

    const row = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select used_component_id, charged_component_id, document_date
          from app.cost_lines where id = ${costLineId}`);
      return rows.rows[0] as { used_component_id: string; charged_component_id: string };
    });

    expect(row.charged_component_id).toBe(base.delta);
    // Istoricul obiectivului e sacru: „folosit" nu se clinteste.
    expect(row.used_component_id).toBe(base.mentenanta);

    const rollups = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select component_id, consumed from app.component_period_rollup
         where period_id = ${base.openPast} order by consumed`);
      return rows.rows as { component_id: string; consumed: string }[];
    });

    // Ambele componente s-au miscat, in aceeasi tranzactie.
    expect(rollups.find((row) => row.component_id === base.mentenanta)?.consumed).toBe('0.00');
    expect(rollups.find((row) => row.component_id === base.delta)?.consumed).toBe('800.00');
  });

  it('#14 luna inchisa: liniile raman datate in luna lor, apare documentul', async () => {
    const base = await ground();
    const { workUnitId, allocationId } = await interventionOn(
      base,
      base.mentenanta,
      base.openPast,
      true,
    );

    const result = await moveFunding(officeActor(), {
      workUnitId,
      allocationId,
      toContractId: base.contractId,
      toComponentId: base.delta,
      toPeriodId: base.currentPeriod,
      reason: 'raportul lunii e deja trimis',
    });

    expect(result.kind).toBe('reallocation-document');
    expect(result.reallocationNumber).toMatch(/^NRA-\d{6}$/);
    // Nicio linie rescrisa: o luna raportata nu se atinge.
    expect(result.rechargedCostLines).toBe(0);
  });

  it('#15 linia mutata pe alt contract intra in reconciliere', async () => {
    const base = await ground();
    const { workUnitId, allocationId } = await interventionOn(
      base,
      base.mentenanta,
      base.openPast,
    );

    // Al doilea contract al aceleiasi firme, cu componenta lui.
    const contractDoi = uuidv7();
    const componentDoi = uuidv7();
    await withActor(officeActor('al doilea contract'), async (tx) => {
      await tx.execute(sql`
        insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
        select ${contractDoi}, company_id, client_id, ${`C2-${contractDoi.slice(-6)}`},
               'individual_deviz', '2020-01-01', '2035-12-31', 'activ'
          from app.contracts where id = ${base.contractId}`);
      await tx.execute(sql`
        insert into app.contract_components (id, contract_id, type, name, budget_cadence)
        values (${componentDoi}, ${contractDoi}, 'individual', 'Individual', 'lunar')`);
    });

    await recordCost(officeActor(), costInput(base, workUnitId, { amount: '640.00' }));

    await moveFunding(officeActor(), {
      workUnitId,
      allocationId,
      toContractId: contractDoi,
      toComponentId: componentDoi,
      toPeriodId: base.openPast,
      reason: 'se factureaza pe contractul individual',
    });

    const anomalies = await listReconciliation(officeActor(), {
      companyIds: [base.companyId],
      periodId: base.openPast,
    });

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.chargedContractCode).toBe(`C2-${contractDoi.slice(-6)}`);
  });
});

describe('citiri', () => {
  it('desface costul pe fel de cheltuiala si pe stadiu', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);

    await recordCost(officeActor(), costInput(base, workUnitId, { amount: '100.00' }));
    await recordCost(
      officeActor(),
      costInput(base, workUnitId, { amount: '250.00', stage: 'angajat' }),
    );

    const breakdown = await costBreakdown(officeActor(), { workUnitId });

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]?.expenseType).toBe('material');
    expect(breakdown[0]?.consumed.toDbString()).toBe('100.00');
    expect(breakdown[0]?.committed.toDbString()).toBe('250.00');
  });

  it('pagineaza cu cursor, nu cu OFFSET', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);

    for (let index = 0; index < 5; index += 1) {
      await recordCost(
        officeActor(),
        costInput(base, workUnitId, { amount: `${String(index + 1)}00.00` }),
      );
    }

    const first = await listCostLines(officeActor(), { workUnitId, limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listCostLines(officeActor(), {
      workUnitId,
      limit: 2,
      cursorEffectDate: first.nextCursor?.effectDate,
      cursorId: first.nextCursor?.id,
    });

    expect(second.rows).toHaveLength(2);
    // Paginile nu se suprapun: cursorul e strict, nu „de la randul N".
    const ids = new Set([...first.rows, ...second.rows].map((row) => row.id));
    expect(ids.size).toBe(4);
  });

  it('rollup_verify nu gaseste nimic pe date scrise normal', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);
    await recordCost(officeActor(), costInput(base, workUnitId));

    const divergences = await verifyRollups(officeActor(), base.openPast);
    expect(divergences).toEqual([]);
  });

  it('metricile de integritate sunt zero pe o baza sanatoasa', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);
    await recordCost(officeActor(), costInput(base, workUnitId));

    const metrics = await readIntegrityMetrics(officeActor());

    expect(metrics.linesWithoutAnalytics).toBe(0);
    expect(metrics.divergentRollups).toBe(0);
  });
});

describe('#16, #17, #18 inchiderea de luna', () => {
  it('checklist-ul are un rand pentru fiecare verificare, si spune ce asteapta', async () => {
    const base = await ground();
    const state = await evaluatePeriodClose(officeActor(), base.openPast);

    expect(state.status).toBe('open');
    expect(state.checks.length).toBeGreaterThanOrEqual(9);

    // Modulele care nu exista inca se declara cinstit, nu dau „✓" pe gratis.
    const pontaje = state.checks.find((check) => check.checkKey === 'pontaje_validate');
    expect(pontaje?.status).toBe('pending_module');
    expect(pontaje?.pendingModule).toBe('pasul 09');
  });

  it('#16 un rand blocat opreste inchiderea, cu contor si cu lista', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);

    // O comanda lansata si neajunsa la receptie: plafonul lunii arata ocupat cu
    // bani care poate nu s-au cheltuit. Exact ce trebuie lamurit inainte de
    // inchidere.
    await recordCost(
      officeActor(),
      costInput(base, workUnitId, { amount: '1200.00', stage: 'angajat' }),
    );

    const state = await evaluatePeriodClose(officeActor(), base.openPast);
    const check = state.checks.find((row) => row.checkKey === 'costuri_angajate_deschise');

    expect(check?.status).toBe('blocked');
    expect(check?.blockingCount).toBe(1);
    // Randul nebifat spune CE e de rezolvat, si duce acolo — nu doar „nu merge".
    expect(check?.detail?.items[0]?.label).toContain('1200.00');
    expect(check?.detail?.items[0]?.href).toBeTruthy();
    expect(state.canClose).toBe(false);

    // Si butonul inactiv nu e singura aparare: regula se aplica din nou aici.
    const error = await rejection(closePeriod(officeActor(), base.openPast, 'hai sa inchidem'));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });

  it('eliberata, comanda nu mai blocheaza — si luna se inchide', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);

    const angajat = await recordCost(
      officeActor(),
      costInput(base, workUnitId, { amount: '1200.00', stage: 'angajat' }),
    );

    /*
     * Comanda anulata nu se sterge din registru: se elibereaza cu o linie egala
     * si opusa, pe acelasi stadiu. Cele doua se aduna la zero pe acelasi
     * document, deci comanda e inchisa — desi ambele linii raman vizibile.
     */
    await stornoCost(officeActor(), { costLineId: angajat.costLineId, reason: 'comanda anulata' });

    const state = await evaluatePeriodClose(officeActor(), base.openPast);
    expect(
      state.checks.find((row) => row.checkKey === 'costuri_angajate_deschise')?.status,
    ).toBe('ok');
    expect(state.canClose).toBe(true);

    const closed = await closePeriod(officeActor(), base.openPast, 'toate comenzile lămurite');
    expect(closed.status).toBe('closed');
  });

  it('#17 inchiderea cere motiv, blocheaza scrierile si lasa urma', async () => {
    const base = await ground();
    const { workUnitId } = await interventionOn(base, base.mentenanta, base.openPast);

    await startClosing(officeActor(), base.openPast);
    const closed = await closePeriod(officeActor(), base.openPast, 'raport trimis clientului');

    expect(closed.status).toBe('closed');

    // Orice scriere ulterioara in luna aia esueaza.
    const error = await rejection(recordCost(officeActor(), costInput(base, workUnitId)));
    expect((error as AppError).code).toBe('PERIOD_CLOSED');

    const audited = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select reason from audit.entries
         where table_name = 'app.periods' and record_id = ${base.openPast}
           and reason is not null order by occurred_at desc limit 1`);
      return (rows.rows[0] as { reason: string } | undefined)?.reason;
    });

    expect(audited).toBe('raport trimis clientului');
  });

  it('inchiderea fara motiv e refuzata', async () => {
    const base = await ground();
    const error = await rejection(closePeriod(officeActor(), base.openPast, '   '));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });

  it('#18 redeschiderea fara motiv e blocata; cu motiv, trece si se vede', async () => {
    const base = await ground();
    await startClosing(officeActor(), base.openPast);
    await closePeriod(officeActor(), base.openPast, 'inchidere pentru test');

    const refuz = await rejection(reopenPeriod(officeActor(), base.openPast, ''));
    expect((refuz as AppError).code).toBe('VALIDATION_FAILED');

    const reopened = await reopenPeriod(
      officeActor(),
      base.openPast,
      'factura a venit cu o zi mai tarziu',
    );
    expect(reopened.status).toBe('open');
  });
});
