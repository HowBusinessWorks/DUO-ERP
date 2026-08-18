import { closeConnections, withActor } from '@damina/db';
import { AppError, uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createRequest,
  decideRouting,
  evaluateRequest,
  promoteBacklog,
} from '../src/requests';
import { officeActor, rejection } from './helpers';
import { TEST_PERSON_ID } from './global-setup';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce verifica fisierul asta: regula 2 din pasul 08 — decizia de rutare creeaza
 * atomic UL + alocare + legatura, sau nu creeaza nimic (verificarile #10, #11,
 * #12). Si ca promovarea din backlog creeaza toate UL-urile intr-o singura
 * tranzactie (#15).
 */

interface Ground {
  readonly companyId: string;
  readonly clientId: string;
  readonly contractId: string;
  readonly componentId: string;
  readonly objectiveId: string;
  readonly periodId: string;
  readonly closedPeriodId: string;
  /** Al doilea contract, cu componenta lui — pentru testele de scurgere intre contracte. */
  readonly otherContractId: string;
  readonly otherComponentId: string;
  /** Catalogul: o operatiune activa si una dezactivata. */
  readonly operationId: string;
  readonly inactiveOperationId: string;
}

async function ground(): Promise<Ground> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const contractId = uuidv7();
  const componentId = uuidv7();
  const objectiveId = uuidv7();
  const periodId = uuidv7();
  const closedPeriodId = uuidv7();
  const otherContractId = uuidv7();
  const otherComponentId = uuidv7();
  const qualificationId = uuidv7();
  const operationId = uuidv7();
  const inactiveOperationId = uuidv7();
  const tag = companyId.slice(-8);
  const now = new Date();

  await withActor(officeActor('pregatire teren de test'), async (tx) => {
    await tx.execute(sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`);
    await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`);
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
      values (${contractId}, ${companyId}, ${clientId}, ${`C-${tag}`},
              'mentenanta_multianual', '2020-01-01', '2035-12-31', 'activ')`);
    await tx.execute(sql`
      insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
      values (${componentId}, ${contractId}, 'delta', 'Delta', 'lunar', true)`);
    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`OB-${tag}`}, 'Statia de pompare', 'statie_pompare')`);
    await tx.execute(sql`
      insert into app.periods (id, company_id, year, month)
      values (${periodId}, ${companyId}, ${now.getUTCFullYear()}, ${now.getUTCMonth() + 1}),
             (${closedPeriodId}, ${companyId}, 2020, 6)`);
    await tx.execute(sql`
      update app.periods set status = 'closed', closed_at = now(), closed_by = ${TEST_PERSON_ID}
       where id = ${closedPeriodId}`);
    await tx.execute(sql`
      insert into app.document_series (id, company_id, document_type, series, next_number)
      values (${uuidv7()}, ${companyId}, 'lucrare', 'TL', 1)`);

    // Al doilea contract, la ACEEASI firma: asa testul de scurgere intre
    // contracte nu poate trece din intamplare prin scoping-ul de firma.
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
      values (${otherContractId}, ${companyId}, ${clientId}, ${`CB-${tag}`},
              'mentenanta_multianual', '2020-01-01', '2035-12-31', 'activ')`);
    await tx.execute(sql`
      insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
      values (${otherComponentId}, ${otherContractId}, 'delta', 'Delta B', 'lunar', true)`);

    await tx.execute(sql`
      insert into app.qualifications (id, code, name)
      values (${qualificationId}, ${`Q-${tag}`}, 'Instalator')`);
    await tx.execute(sql`
      insert into app.operation_catalog
        (id, code, name, standard_hours, qualification_id, estimated_labor, estimated_material, is_active)
      values (${operationId}, ${`OP-${tag}`}, 'Inlocuire garnitura', 2, ${qualificationId}, '400.00', '100.00', true),
             (${inactiveOperationId}, ${`OPX-${tag}`}, 'Operatiune scoasa', 2, ${qualificationId}, '900.00', '0.00', false)`);
  });

  return {
    companyId,
    clientId,
    contractId,
    componentId,
    objectiveId,
    periodId,
    closedPeriodId,
    otherContractId,
    otherComponentId,
    operationId,
    inactiveOperationId,
  };
}

/** Pune plafonul de venit al Deltei pe luna data. */
async function setDeltaCeiling(base: Ground, componentId: string, amount: string): Promise<void> {
  await withActor(officeActor('plafon de test'), async (tx) => {
    await tx.execute(sql`
      insert into app.component_ceilings (id, component_id, period_id, revenue_ceiling, set_by)
      values (${uuidv7()}, ${componentId}, ${base.periodId}, ${amount}, ${TEST_PERSON_ID})`);
  });
}

/** Amana o cerere in backlog si intoarce id-ul propunerii. */
async function backlogged(
  base: Ground,
  title: string,
  value: string,
  contractId = base.contractId,
): Promise<string> {
  const { id: requestId } = await createRequest(
    officeActor(),
    requestInput(base, { type: 'propunere_interna', title, estimatedValue: value }),
  );
  const { backlogProposalId } = await decideRouting(officeActor('amanare de test'), {
    requestId,
    choice: 'amanata_backlog',
    systemProposal: 'amanata_backlog',
    reason: 'test',
    backlog: {
      objectiveId: base.objectiveId,
      contractId,
      title,
      estimatedValue: value,
      validUntil: '',
    },
  });
  if (backlogProposalId === null) {
    throw new Error('propunerea de backlog n-a fost creata');
  }
  return backlogProposalId;
}

function creationFor(base: Ground, periodId: string) {
  return {
    workUnit: {
      companyId: base.companyId,
      type: 'lucrare' as const,
      name: 'Inlocuire pompa SP-14',
      objectiveId: base.objectiveId,
      contractObjectiveId: '',
      responsiblePersonId: '',
      executorType: 'echipa_proprie' as const,
      executorSubcontractorId: '',
      startsOn: '',
      endsOn: '',
      estimatedValue: '3400.00',
      costBudget: '',
    },
    allocations: [
      {
        contractId: base.contractId,
        componentId: base.componentId,
        periodId,
        allocatedAmount: '3400.00',
        allocatedPct: '',
        reason: 'decizie de rutare — test',
      },
    ],
    assignments: [],
    series: 'TL',
  };
}

function requestInput(base: Ground, overrides: Record<string, unknown> = {}) {
  return {
    companyId: base.companyId,
    type: 'tichet_client' as const,
    source: 'manual' as const,
    objectiveId: base.objectiveId,
    contractId: '',
    contractObjectiveId: '',
    title: 'Pompa nu porneste',
    estimatedValue: '',
    slaDueAt: '',
    ...overrides,
  };
}

describe('createRequest + decideRouting', () => {
  it('creeaza atomic UL + alocare + legatura, si marcheaza cererea decisa (#10)', async () => {
    const base = await ground();
    const { id: requestId } = await createRequest(
      officeActor(),
      requestInput(base, { estimatedValue: '3400.00' }),
    );

    const { workUnitId } = await decideRouting(officeActor('decizie de test'), {
      requestId,
      choice: 'lucrare_delta',
      systemProposal: 'lucrare_delta',
      reason: 'incape in Delta lunii',
      creation: creationFor(base, base.periodId),
    });

    expect(workUnitId).not.toBeNull();

    await withActor(officeActor(), async (tx) => {
      const wu = await tx.execute<{ status: string; source_request_id: string }>(
        sql`select status, source_request_id from app.work_units where id = ${workUnitId}`,
      );
      expect(wu.rows[0]?.status).toBe('draft');
      expect(wu.rows[0]?.source_request_id).toBe(requestId);

      const req = await tx.execute<{ status: string }>(
        sql`select status from app.requests where id = ${requestId}`,
      );
      expect(req.rows[0]?.status).toBe('decisa');

      const decisions = await tx.execute<{ choice: string; system_proposal: string; reason: string }>(
        sql`select choice, system_proposal, reason from app.request_decisions where request_id = ${requestId}`,
      );
      expect(decisions.rows).toHaveLength(1);
      expect(decisions.rows[0]?.choice).toBe('lucrare_delta');
      expect(decisions.rows[0]?.system_proposal).toBe('lucrare_delta');
    });
  });

  it('nu creeaza nimic cand alocarea eșueaza — luna inchisa (#11)', async () => {
    const base = await ground();
    const { id: requestId } = await createRequest(
      officeActor(),
      requestInput(base, { title: 'Cerere pe luna inchisa' }),
    );

    const error = await rejection(
      decideRouting(officeActor('decizie de test'), {
        requestId,
        choice: 'lucrare_delta',
        systemProposal: 'lucrare_delta',
        reason: 'test de rollback',
        creation: creationFor(base, base.closedPeriodId),
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('PERIOD_CLOSED');

    await withActor(officeActor(), async (tx) => {
      const wu = await tx.execute(sql`select 1 from app.work_units where source_request_id = ${requestId}`);
      expect(wu.rows).toHaveLength(0);
      const req = await tx.execute<{ status: string }>(
        sql`select status from app.requests where id = ${requestId}`,
      );
      // Statusul ramane cel de dinainte de decizie — nimic nu s-a schimbat.
      expect(req.rows[0]?.status).toBe('neprocesata');
    });
  });

  it('amanarea creeaza o propunere de backlog si trece cererea in_backlog (#13)', async () => {
    const base = await ground();
    const { id: requestId } = await createRequest(
      officeActor(),
      requestInput(base, { type: 'propunere_interna', title: 'Reparatie amanata', estimatedValue: '1800.00' }),
    );

    const { backlogProposalId } = await decideRouting(officeActor('amanare de test'), {
      requestId,
      choice: 'amanata_backlog',
      systemProposal: 'amanata_backlog',
      reason: 'nu e urgenta',
      backlog: {
        objectiveId: base.objectiveId,
        contractId: base.contractId,
        title: 'Reparatie amanata',
        estimatedValue: '1800.00',
        validUntil: '',
      },
    });
    expect(backlogProposalId).not.toBeNull();

    await withActor(officeActor(), async (tx) => {
      const req = await tx.execute<{ status: string }>(
        sql`select status from app.requests where id = ${requestId}`,
      );
      expect(req.rows[0]?.status).toBe('in_backlog');
    });
  });
});

describe('promoteBacklog', () => {
  it('promoveaza mai multe propuneri intr-o singura tranzactie (#15)', async () => {
    const base = await ground();
    const proposalIds: string[] = [];

    for (const title of ['Capac cămin C12', 'Tencuială hol']) {
      const { id: requestId } = await createRequest(
        officeActor(),
        requestInput(base, { type: 'propunere_interna', title, estimatedValue: '1800.00' }),
      );
      const { backlogProposalId } = await decideRouting(officeActor('amanare de test'), {
        requestId,
        choice: 'amanata_backlog',
        systemProposal: 'amanata_backlog',
        reason: 'test de promovare',
        backlog: {
          objectiveId: base.objectiveId,
          contractId: base.contractId,
          title,
          estimatedValue: '1800.00',
          validUntil: '',
        },
      });
      if (backlogProposalId !== null) {
        proposalIds.push(backlogProposalId);
      }
    }

    const { workUnitIds } = await promoteBacklog(officeActor('promovare de test'), {
      proposalIds,
      series: 'TL',
      contractId: base.contractId,
      componentId: base.componentId,
      periodId: base.periodId,
      reason: 'umplere Delta',
    });

    expect(workUnitIds).toHaveLength(2);

    await withActor(officeActor(), async (tx) => {
      const promoted = await tx.execute<{ status: string }>(
        sql`select status from app.backlog_proposals where id in ${proposalIds}`,
      );
      expect(promoted.rows.every((r) => r.status === 'promoted')).toBe(true);
    });
  });
});

/**
 * Regresiile din review-ul 08a. Fiecare test de aici a fost, inainte, un drum
 * pe care banii se cheltuiau de doua ori sau din plafonul altcuiva.
 */
describe('decideRouting — precondițiile cererii (B5, B6)', () => {
  it('nu se poate decide de două ori aceeași cerere', async () => {
    const base = await ground();
    const { id: requestId } = await createRequest(
      officeActor(),
      requestInput(base, { estimatedValue: '3400.00' }),
    );

    await decideRouting(officeActor('prima decizie'), {
      requestId,
      choice: 'lucrare_delta',
      systemProposal: 'lucrare_delta',
      reason: 'incape in Delta',
      creation: creationFor(base, base.periodId),
    });

    const error = await rejection(
      decideRouting(officeActor('a doua decizie'), {
        requestId,
        choice: 'lucrare_delta',
        systemProposal: 'lucrare_delta',
        reason: 'inca o data',
        creation: creationFor(base, base.periodId),
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');

    // Al doilea UL n-a fost creat: plafonul s-a cheltuit o singura data.
    await withActor(officeActor(), async (tx) => {
      const wu = await tx.execute(
        sql`select 1 from app.work_units where source_request_id = ${requestId}`,
      );
      expect(wu.rows).toHaveLength(1);
    });
  });

  it('unitatea nu poate fi creată la altă firmă decât cererea', async () => {
    const base = await ground();
    const other = await ground();
    const { id: requestId } = await createRequest(officeActor(), requestInput(base));

    const creation = creationFor(base, base.periodId);
    const error = await rejection(
      decideRouting(officeActor('decizie pe firma gresita'), {
        requestId,
        choice: 'lucrare_delta',
        systemProposal: 'lucrare_delta',
        reason: 'test de firma',
        creation: {
          ...creation,
          workUnit: { ...creation.workUnit, companyId: other.companyId },
        },
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });

  /*
   * B5: inainte, `decideRouting` isi scria singura insert-urile de unitate si
   * pierdea regula asta — o interventie decisa din rutare ramanea fara nicio
   * finantare. Acum trece prin `createWorkUnitTx`, adica prin acelasi drum ca
   * `createWorkUnit`.
   */
  it('o intervenție fără alocare e refuzată și din rutare, nu doar din creare', async () => {
    const base = await ground();
    const { id: requestId } = await createRequest(officeActor(), requestInput(base));

    const creation = creationFor(base, base.periodId);
    const error = await rejection(
      decideRouting(officeActor('interventie fara finantare'), {
        requestId,
        choice: 'interventie_mentenanta',
        systemProposal: 'interventie_mentenanta',
        reason: 'sub prag',
        creation: {
          ...creation,
          workUnit: { ...creation.workUnit, type: 'interventie' as const },
          allocations: [],
        },
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });
});

describe('evaluateRequest — precondiții și catalog (I3, I6)', () => {
  it('cererea inexistentă e 404, nu succes tăcut pe zero rânduri', async () => {
    const error = await rejection(evaluateRequest(officeActor(), uuidv7(), []));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('NOT_FOUND');
  });

  it('o cerere deja decisă nu mai poate fi evaluată', async () => {
    const base = await ground();
    const { id: requestId } = await createRequest(
      officeActor(),
      requestInput(base, { estimatedValue: '3400.00' }),
    );
    await decideRouting(officeActor('decizie'), {
      requestId,
      choice: 'lucrare_delta',
      systemProposal: 'lucrare_delta',
      reason: 'incape in Delta',
      creation: creationFor(base, base.periodId),
    });

    const error = await rejection(
      evaluateRequest(officeActor(), requestId, [{ operationId: base.operationId, quantity: '1' }]),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
  });

  it('operațiunea activă se evaluează, cea dezactivată nu', async () => {
    const base = await ground();
    const { id: requestId } = await createRequest(officeActor(), requestInput(base));

    const { estimatedValue } = await evaluateRequest(officeActor(), requestId, [
      { operationId: base.operationId, quantity: '2' },
    ]);
    expect(estimatedValue.toString()).toBe('1000.00');

    const error = await rejection(
      evaluateRequest(officeActor(), requestId, [
        { operationId: base.inactiveOperationId, quantity: '1' },
      ]),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('NOT_FOUND');
  });
});

describe('promoteBacklog — contract, plafon, cursă (B2, B3, B4, I2)', () => {
  it('nu promovează propuneri ale altui contract', async () => {
    const base = await ground();
    const foreign = await backlogged(base, 'Lucrare a contractului B', '1800.00', base.otherContractId);

    const error = await rejection(
      promoteBacklog(officeActor('promovare gresita'), {
        proposalIds: [foreign],
        series: 'TL',
        contractId: base.contractId,
        componentId: base.componentId,
        periodId: base.periodId,
        reason: 'umplere Delta',
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
  });

  it('componenta trebuie să fie a contractului din care se plătește', async () => {
    const base = await ground();
    const proposalId = await backlogged(base, 'Capac cămin', '1800.00');

    const error = await rejection(
      promoteBacklog(officeActor('componenta straina'), {
        proposalIds: [proposalId],
        series: 'TL',
        contractId: base.contractId,
        componentId: base.otherComponentId,
        periodId: base.periodId,
        reason: 'umplere Delta',
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });
});

describe('promoteBacklog — plafonul lunii (B4, B2, I2)', () => {
  // Verificarea #16: avertisment explicit cu suma depasita, nu blocaj tacut.
  it('depășirea de plafon spune cu cât, și trece doar cu confirmare explicită', async () => {
    const base = await ground();
    await setDeltaCeiling(base, base.componentId, '2000.00');
    const proposalId = await backlogged(base, 'Peste plafon', '3500.00');

    const error = await rejection(
      promoteBacklog(officeActor('promovare peste plafon'), {
        proposalIds: [proposalId],
        series: 'TL',
        contractId: base.contractId,
        componentId: base.componentId,
        periodId: base.periodId,
        reason: 'umplere Delta',
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
    expect((error as AppError).payload['over']).toBe('1500.00');

    const { workUnitIds } = await promoteBacklog(officeActor('depasire asumata'), {
      proposalIds: [proposalId],
      series: 'TL',
      contractId: base.contractId,
      componentId: base.componentId,
      periodId: base.periodId,
      reason: 'clientul a acceptat depasirea in scris',
      acceptOverCeiling: true,
    });
    expect(workUnitIds).toHaveLength(1);

    // I2: valoarea propunerii ramane si pe unitate, nu doar pe alocare.
    await withActor(officeActor(), async (tx) => {
      const wu = await tx.execute<{ estimated_value: string }>(
        sql`select estimated_value from app.work_units where id = ${workUnitIds[0]}`,
      );
      expect(wu.rows[0]?.estimated_value).toBe('3500.00');
    });
  });

  it('propunerea deja promovată nu se mai promovează a doua oară', async () => {
    const base = await ground();
    const proposalId = await backlogged(base, 'Tencuială hol', '1800.00');
    const input = {
      proposalIds: [proposalId],
      series: 'TL',
      contractId: base.contractId,
      componentId: base.componentId,
      periodId: base.periodId,
      reason: 'umplere Delta',
    };

    await promoteBacklog(officeActor('prima promovare'), input);
    const error = await rejection(promoteBacklog(officeActor('a doua promovare'), input));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');

    await withActor(officeActor(), async (tx) => {
      const allocations = await tx.execute(
        sql`select 1 from app.funding_allocations where component_id = ${base.componentId}`,
      );
      expect(allocations.rows).toHaveLength(1);
    });
  });
});
