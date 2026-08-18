import { closeConnections, withActor } from '@damina/db';
import { AppError, uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createRequest, decideRouting, promoteBacklog } from '../src/requests';
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
}

async function ground(): Promise<Ground> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const contractId = uuidv7();
  const componentId = uuidv7();
  const objectiveId = uuidv7();
  const periodId = uuidv7();
  const closedPeriodId = uuidv7();
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
  });

  return { companyId, clientId, contractId, componentId, objectiveId, periodId, closedPeriodId };
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
