import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor, type ActorTx } from '../src/index';
import { SQLSTATE, fieldActor, officeActor, pgMessage, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce impune BAZA la unitatea de lucru si la finantare (pasul 05a).
 *
 * Mecanica mutarii nu e aici — e in `@damina/domain`, testata fara Postgres.
 * Aici stau exact lucrurile pe care o functie pura nu le poate garanta: ce
 * refuza schema, ce refuza triggerele, cine vede ce coloana, si ce se intampla
 * cand doi oameni cer un cod in acelasi timp.
 */

const companyId = uuidv7();
const otherCompanyId = uuidv7();
const clientId = uuidv7();
const contractId = uuidv7();
const objectiveId = uuidv7();
const pmId = uuidv7();
/** Are SSM valabil. Poate fi asignat. */
const workerId = uuidv7();
/** Are SSM expirat la finalul lui 2025. Nu poate fi asignat in 2026. */
const expiredWorkerId = uuidv7();

let componentMentenanta = '';
let componentDelta = '';
let periodAugust = '';
let periodSeptember = '';

beforeAll(async () => {
  await withActor(officeActor(), async (tx) => {
    for (const [id, name] of [
      [companyId, 'Damina UL SRL'],
      [otherCompanyId, 'Damina UL Doi SRL'],
    ] as const) {
      await tx.execute(
        sql`insert into app.companies (id, name, cui) values (${id}, ${name}, ${`RO${id.slice(-8)}`})`,
      );
    }

    await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, 'Apa Nova UL')`);
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
      values (${contractId}, ${companyId}, ${clientId}, ${`UL-${contractId.slice(-6)}`},
              'mentenanta_multianual', '2026-01-01', '2029-12-31', 'activ')`);

    componentMentenanta = uuidv7();
    componentDelta = uuidv7();
    await tx.execute(sql`
      insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
      values (${componentMentenanta}, ${contractId}, 'mentenanta', 'Mentenanta', 'lunar', false),
             (${componentDelta}, ${contractId}, 'delta', 'Delta', 'lunar', true)`);

    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`OB-${objectiveId.slice(-8)}`}, 'Statia de pompare 14', 'statie_pompare')`);

    await tx.execute(sql`
      insert into app.persons (id, persona, category, full_name)
      values (${pmId}, 'office', 'angajat', 'PM de test'),
             (${workerId}, 'field', 'sef_santier', 'Sef cu SSM valabil'),
             (${expiredWorkerId}, 'field', 'sef_santier', 'Sef cu SSM expirat')`);

    await tx.execute(sql`
      insert into app.person_authorizations (id, person_id, kind, issued_at, expires_at)
      values (${uuidv7()}, ${workerId}, 'ssm', '2026-01-01', '2027-12-31'),
             (${uuidv7()}, ${expiredWorkerId}, 'ssm', '2025-01-01', '2025-12-31')`);

    periodAugust = uuidv7();
    periodSeptember = uuidv7();
    await tx.execute(sql`
      insert into app.periods (id, company_id, year, month)
      values (${periodAugust}, ${companyId}, 2026, 8),
             (${periodSeptember}, ${companyId}, 2026, 9)`);
  });
});

interface WorkUnitOptions {
  readonly type?: 'inspectie' | 'interventie' | 'lucrare';
  readonly status?: string;
  readonly startsOn?: string;
  readonly responsiblePersonId?: string;
  readonly companyId?: string;
}

async function makeWorkUnit(tx: ActorTx, options: WorkUnitOptions = {}): Promise<string> {
  const id = uuidv7();
  await tx.execute(sql`
    insert into app.work_units
      (id, company_id, code, type, name, objective_id, status, responsible_person_id,
       starts_on, estimated_value, cost_budget)
    values (
      ${id}, ${options.companyId ?? companyId}, ${`X-${id.slice(-10)}`},
      ${options.type ?? 'lucrare'}, 'Inlocuire pompa', ${objectiveId},
      ${options.status ?? 'planificata'},
      ${options.responsiblePersonId ?? pmId}, ${options.startsOn ?? '2026-08-03'},
      12500.00, 9000.00
    )`);
  return id;
}

async function makeAllocation(
  tx: ActorTx,
  workUnitId: string,
  overrides: {
    componentId?: string;
    periodId?: string;
    amount?: string | null;
    pct?: string | null;
    contractId?: string;
  } = {},
): Promise<string> {
  const id = uuidv7();
  // `??` nu se poate folosi pentru suma: `null` e o VALOARE ceruta de teste (o
  // alocare exprimata in procent n-are suma), iar `null ?? '12500.00'` ar da
  // implicitul — adica testul „nici suma, nici procent" ar trimite o suma.
  const amount = overrides.amount === undefined ? '12500.00' : overrides.amount;
  await tx.execute(sql`
    insert into app.funding_allocations
      (id, work_unit_id, contract_id, component_id, period_id,
       allocated_amount, allocated_pct, reason, created_by)
    values (
      ${id}, ${workUnitId}, ${overrides.contractId ?? contractId},
      ${overrides.componentId ?? componentDelta}, ${overrides.periodId ?? periodAugust},
      ${amount}, ${overrides.pct ?? null},
      'finantare initiala de test', ${pmId}
    )`);
  return id;
}

/** Inchide o luna nou-creata. Returneaza id-ul ei. */
async function closedPeriod(year: number, month: number): Promise<string> {
  return withActor(officeActor('inchidere de luna pentru test'), async (tx) => {
    const id = uuidv7();
    await tx.execute(
      sql`insert into app.periods (id, company_id, year, month) values (${id}, ${companyId}, ${year}, ${month})`,
    );
    await tx.execute(
      sql`update app.periods set status = 'closed', closed_at = now(), closed_by = ${pmId} where id = ${id}`,
    );
    return id;
  });
}

describe('unitatea de lucru', () => {
  it('codul e unic pe firma, nu global', async () => {
    const code = `L-${uuidv7().slice(-8)}`;

    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.work_units (id, company_id, code, type, name, objective_id)
        values (${uuidv7()}, ${companyId}, ${code}, 'lucrare', 'Prima', ${objectiveId})`);
    });

    // Alta firma, acelasi cod: trece.
    await expect(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          insert into app.work_units (id, company_id, code, type, name, objective_id)
          values (${uuidv7()}, ${otherCompanyId}, ${code}, 'lucrare', 'A doua', ${objectiveId})`);
      }),
    ).resolves.toBeUndefined();

    // Aceeasi firma, acelasi cod: refuzat.
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          insert into app.work_units (id, company_id, code, type, name, objective_id)
          values (${uuidv7()}, ${companyId}, ${code}, 'interventie', 'A treia', ${objectiveId})`);
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.UNIQUE_VIOLATION);
  });

  it('subcontractare fara firma de subcontractant: refuzata', async () => {
    const missing = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          insert into app.work_units (id, company_id, code, type, name, objective_id, executor_type)
          values (${uuidv7()}, ${companyId}, ${`S-${uuidv7().slice(-8)}`}, 'lucrare', 'Fara firma',
                  ${objectiveId}, 'subcontractant')`);
      }),
    );
    expect(sqlstate(missing)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  // Verificarea #13 a pasului.
  it('trei coduri cerute in paralel: consecutive, fara goluri si fara duplicate', async () => {
    const series = `PL${companyId.slice(-4)}`;

    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.document_series (id, company_id, document_type, series, next_number)
        values (${uuidv7()}, ${companyId}, 'lucrare', ${series}, 1)`);
    });

    const codes = await Promise.all(
      [1, 2, 3].map(() =>
        withActor(officeActor(), async (tx) => {
          const allocated = await tx.execute<{ code: string }>(
            sql`select app.allocate_document_number(${companyId}, 'lucrare', ${series}) as code`,
          );
          const code = allocated.rows[0]?.code ?? '';
          await tx.execute(sql`
            insert into app.work_units (id, company_id, code, type, name, objective_id)
            values (${uuidv7()}, ${companyId}, ${code}, 'lucrare', 'Paralela', ${objectiveId})`);
          return code;
        }),
      ),
    );

    expect([...codes].sort()).toEqual([
      `${series}-000001`,
      `${series}-000002`,
      `${series}-000003`,
    ]);
  });
});

describe('etape', () => {
  // Verificarea #9 a pasului.
  it('etapa pe o inspectie: refuzata de baza', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx, { type: 'inspectie' });
        await tx.execute(sql`
          insert into app.work_stages (id, work_unit_id, position, name)
          values (${uuidv7()}, ${workUnitId}, 1, 'Etapa nepermisa')`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/etapele exista doar pe lucrari/);
  });

  it('etapa pe o interventie: refuzata la fel', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx, { type: 'interventie' });
        await tx.execute(sql`
          insert into app.work_stages (id, work_unit_id, position, name)
          values (${uuidv7()}, ${workUnitId}, 1, 'Etapa nepermisa')`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
  });

  it('etapa pe o lucrare: acceptata', async () => {
    await expect(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx, { type: 'lucrare' });
        await tx.execute(sql`
          insert into app.work_stages (id, work_unit_id, position, name, planned_start, planned_end)
          values (${uuidv7()}, ${workUnitId}, 1, 'Demontare', '2026-08-03', '2026-08-07')`);
      }),
    ).resolves.toBeUndefined();
  });

  // Verificarea #10 a pasului.
  it('etapa cu finalul inaintea inceputului: refuzata de check', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        await tx.execute(sql`
          insert into app.work_stages (id, work_unit_id, position, name, planned_start, planned_end)
          values (${uuidv7()}, ${workUnitId}, 1, 'Inversata', '2026-08-20', '2026-08-10')`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('o lucrare cu etape nu se mai poate intoarce la interventie', async () => {
    const error = await rejection(
      withActor(officeActor('schimbare de tip pentru test'), async (tx) => {
        const workUnitId = await makeWorkUnit(tx, { type: 'lucrare' });
        await tx.execute(sql`
          insert into app.work_stages (id, work_unit_id, position, name)
          values (${uuidv7()}, ${workUnitId}, 1, 'Demontare')`);
        await tx.execute(
          sql`update app.work_units set type = 'interventie' where id = ${workUnitId}`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/are etape/);
  });

  it('promovarea in lucrare pastreaza randul si trece de trigger', async () => {
    const { workUnitId, type } = await withActor(
      officeActor('interventia depaseste pragul, devine lucrare'),
      async (tx) => {
        const id = await makeWorkUnit(tx, { type: 'interventie' });
        await tx.execute(sql`update app.work_units set type = 'lucrare' where id = ${id}`);
        const after = await tx.execute<{ type: string }>(
          sql`select type from app.work_units where id = ${id}`,
        );
        return { workUnitId: id, type: after.rows[0]?.type };
      },
    );

    expect(type).toBe('lucrare');

    // Acelasi id, deci acelasi rand: nimic nu s-a copiat.
    const audited = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute<{ reason: string | null }>(
        sql`select reason from audit.entries
             where table_name = 'app.work_units' and record_id = ${workUnitId}
               and operation = 'update'`,
      );
      return rows.rows;
    });

    expect(audited).toHaveLength(1);
    expect(audited[0]?.reason).toMatch(/depaseste pragul/);
  });
});

describe('asignari', () => {
  // Verificarea #12 a pasului.
  it('persoana cu SSM expirat la `starts_on`: blocata, cu ce si cand in mesaj', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx, { startsOn: '2026-08-03' });
        await tx.execute(sql`
          insert into app.work_unit_assignments (id, work_unit_id, person_id, role)
          values (${uuidv7()}, ${workUnitId}, ${expiredWorkerId}, 'sef_santier')`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    const message = pgMessage(error);
    expect(message).toMatch(/AUTHORIZATION_EXPIRED/);
    expect(message).toMatch(/ssm/);
    // Cand a expirat, nu doar ce lipseste.
    expect(message).toMatch(/31\.12\.2025/);
  });

  it('aceeasi persoana, pe o unitate care incepe cand autorizatia era valabila: acceptata', async () => {
    await expect(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx, { startsOn: '2025-06-01' });
        await tx.execute(sql`
          insert into app.work_unit_assignments (id, work_unit_id, person_id, role)
          values (${uuidv7()}, ${workUnitId}, ${expiredWorkerId}, 'sef_santier')`);
      }),
    ).resolves.toBeUndefined();
  });

  it('persoana fara nicio autorizatie: mesajul spune ca lipseste', async () => {
    const strangerId = uuidv7();
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          insert into app.persons (id, persona, category, full_name)
          values (${strangerId}, 'field', 'sef_santier', 'Fara autorizatii')`);
        const workUnitId = await makeWorkUnit(tx);
        await tx.execute(sql`
          insert into app.work_unit_assignments (id, work_unit_id, person_id, role)
          values (${uuidv7()}, ${workUnitId}, ${strangerId}, 'echipa')`);
      }),
    );

    expect(pgMessage(error)).toMatch(/lipseste/);
  });

  it('acelasi rol, pe intervale suprapuse: refuzat de exclude', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        await tx.execute(sql`
          insert into app.work_unit_assignments (id, work_unit_id, person_id, role, valid_from, valid_to)
          values (${uuidv7()}, ${workUnitId}, ${workerId}, 'sef_santier', '2026-08-01', '2026-08-31')`);
        await tx.execute(sql`
          insert into app.work_unit_assignments (id, work_unit_id, person_id, role, valid_from, valid_to)
          values (${uuidv7()}, ${workUnitId}, ${workerId}, 'sef_santier', '2026-08-15', '2026-09-15')`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.EXCLUSION_VIOLATION);
  });

  it('acelasi om, doua roluri diferite in acelasi timp: permis', async () => {
    await expect(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        await tx.execute(sql`
          insert into app.work_unit_assignments (id, work_unit_id, person_id, role, valid_from)
          values (${uuidv7()}, ${workUnitId}, ${workerId}, 'sef_santier', '2026-08-01'),
                 (${uuidv7()}, ${workUnitId}, ${workerId}, 'inspector', '2026-08-01')`);
      }),
    ).resolves.toBeUndefined();
  });
});

describe('alocari de finantare', () => {
  // Verificarea #1 a pasului, partea de baza de date.
  it('o lucrare finantata din Delta pe trei luni are TREI randuri', async () => {
    const { count, total } = await withActor(officeActor(), async (tx) => {
      const workUnitId = await makeWorkUnit(tx);
      const october = uuidv7();
      await tx.execute(
        sql`insert into app.periods (id, company_id, year, month) values (${october}, ${companyId}, 2026, 10)`,
      );

      for (const [periodId, amount] of [
        [periodAugust, '12500.00'],
        [periodSeptember, '12500.00'],
        [october, '9800.00'],
      ] as const) {
        await makeAllocation(tx, workUnitId, { periodId, amount });
      }

      const rows = await tx.execute<{ count: string; total: string }>(
        sql`select count(*)::text as count, sum(allocated_amount)::text as total
              from app.funding_allocations
             where work_unit_id = ${workUnitId} and status = 'active'`,
      );
      return { count: rows.rows[0]?.count, total: rows.rows[0]?.total };
    });

    expect(count).toBe('3');
    expect(total).toBe('34800.00');
  });

  // Verificarea #2 a pasului.
  it('60% + 50% pe aceeasi unitate si aceeasi luna: refuzat de trigger', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        await makeAllocation(tx, workUnitId, {
          componentId: componentMentenanta,
          amount: null,
          pct: '0.6000',
        });
        await makeAllocation(tx, workUnitId, {
          componentId: componentDelta,
          amount: null,
          pct: '0.5000',
        });
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/110\.00%/);
  });

  it('60% + 40% pe aceeasi luna: acceptat, limita e inclusa', async () => {
    await expect(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        await makeAllocation(tx, workUnitId, {
          componentId: componentMentenanta,
          amount: null,
          pct: '0.6000',
        });
        await makeAllocation(tx, workUnitId, {
          componentId: componentDelta,
          amount: null,
          pct: '0.4000',
        });
      }),
    ).resolves.toBeUndefined();
  });

  // Verificarea #3 a pasului.
  it('alocarea nu se rescrie: se supersedeaza', async () => {
    const workUnitId = await withActor(officeActor(), (tx) => makeWorkUnit(tx));
    const firstId = await withActor(officeActor(), (tx) => makeAllocation(tx, workUnitId));

    // Rescrierea sumei: refuzata.
    const rewrite = await rejection(
      withActor(officeActor('incercare de rescriere'), async (tx) => {
        await tx.execute(
          sql`update app.funding_allocations set allocated_amount = 99999.00 where id = ${firstId}`,
        );
      }),
    );
    expect(sqlstate(rewrite)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(rewrite)).toMatch(/nu se rescrie/);

    // Stergerea: refuzata de GRANT, inaintea trigger-ului. Cele doua straturi
    // spun acelasi lucru dinadins; primul care raspunde e privilegiul.
    const deletion = await rejection(
      withActor(officeActor('incercare de stergere'), async (tx) => {
        await tx.execute(sql`delete from app.funding_allocations where id = ${firstId}`);
      }),
    );
    expect(sqlstate(deletion)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);

    // Drumul corect: alocare noua, cea veche marcata.
    const { statuses } = await withActor(
      officeActor('lucrarea trece de pe mentenanta pe Delta'),
      async (tx) => {
        const secondId = uuidv7();
        await tx.execute(sql`
          insert into app.funding_allocations
            (id, work_unit_id, contract_id, component_id, period_id, allocated_amount, reason, created_by)
          values (${secondId}, ${workUnitId}, ${contractId}, ${componentMentenanta},
                  ${periodAugust}, 12500.00, 'mutare pe mentenanta', ${pmId})`);
        await tx.execute(sql`
          update app.funding_allocations
             set status = 'superseded', superseded_by = ${secondId}
           where id = ${firstId}`);

        const rows = await tx.execute<{ id: string; status: string }>(
          sql`select id, status from app.funding_allocations where work_unit_id = ${workUnitId}`,
        );
        return { statuses: new Map(rows.rows.map((r) => [r.id, r.status])) };
      },
    );

    expect(statuses.get(firstId)).toBe('superseded');
  });

  it('o alocare supersedata nu se reactiveaza', async () => {
    const error = await rejection(
      withActor(officeActor('reactivare'), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        const id = await makeAllocation(tx, workUnitId);
        await tx.execute(
          sql`update app.funding_allocations set status = 'superseded' where id = ${id}`,
        );
        await tx.execute(sql`update app.funding_allocations set status = 'active' where id = ${id}`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/nu se reactiveaza/);
  });

  it('supersedarea fara motiv scris: refuzata de audit', async () => {
    const error = await rejection(
      // Actor FARA motiv, dinadins.
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        const id = await makeAllocation(tx, workUnitId);
        await tx.execute(
          sql`update app.funding_allocations set status = 'superseded' where id = ${id}`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/cere un motiv scris/);
  });

  it('doua alocari ACTIVE pe aceeasi componenta si luna: refuzate de indexul partial', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        await makeAllocation(tx, workUnitId, { amount: '1000.00' });
        await makeAllocation(tx, workUnitId, { amount: '2000.00' });
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.UNIQUE_VIOLATION);
  });

  // Verificarea #16 a pasului: UL creata intr-o luna inchisa.
  it('alocare intr-o luna inchisa: PERIOD_CLOSED', async () => {
    const closed = await closedPeriod(2026, 2);

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        await makeAllocation(tx, workUnitId, { periodId: closed });
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/PERIOD_CLOSED/);
  });

  it('luna alocarii trebuie sa fie a firmei unitatii', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const strangerPeriod = uuidv7();
        await tx.execute(sql`
          insert into app.periods (id, company_id, year, month)
          values (${strangerPeriod}, ${otherCompanyId}, 2026, 8)`);
        const workUnitId = await makeWorkUnit(tx);
        await makeAllocation(tx, workUnitId, { periodId: strangerPeriod });
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/alta firma/);
  });

  it('nici suma, nici procent: refuzat', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        await makeAllocation(tx, workUnitId, { amount: null, pct: null });
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });
});

describe('documente de re-alocare', () => {
  async function makeReallocation(
    tx: ActorTx,
    workUnitId: string,
    overrides: { toPeriodId?: string; periodId?: string } = {},
  ): Promise<string> {
    const id = uuidv7();
    await tx.execute(sql`
      insert into app.reallocation_documents
        (id, company_id, number, period_id, work_unit_id,
         from_contract_id, from_component_id, from_period_id,
         to_contract_id, to_component_id, to_period_id,
         amount, reason, created_by)
      values (
        ${id}, ${companyId}, ${`NRA-${id.slice(-8)}`},
        ${overrides.periodId ?? periodSeptember}, ${workUnitId},
        ${contractId}, ${componentMentenanta}, ${periodAugust},
        ${contractId}, ${componentDelta}, ${overrides.toPeriodId ?? periodSeptember},
        800.00, 'luna august e inchisa, se re-aloca in septembrie', ${pmId}
      )`);
    return id;
  }

  // Verificarea #6 a pasului, partea de baza de date.
  it('documentul se emite si arata ambele capete ale mutarii', async () => {
    const row = await withActor(officeActor(), async (tx) => {
      const workUnitId = await makeWorkUnit(tx);
      const id = await makeReallocation(tx, workUnitId);
      const rows = await tx.execute<{
        from_component_id: string;
        to_component_id: string;
        period_id: string;
        amount: string;
      }>(
        sql`select from_component_id, to_component_id, period_id, amount::text as amount
              from app.reallocation_documents where id = ${id}`,
      );
      return rows.rows[0];
    });

    expect(row?.from_component_id).toBe(componentMentenanta);
    expect(row?.to_component_id).toBe(componentDelta);
    // Se emite in luna curenta, nu in cea din care se muta.
    expect(row?.period_id).toBe(periodSeptember);
    expect(row?.amount).toBe('800.00');
  });

  /*
   * Biroul n-are nici `update`, nici `delete` pe tabela, deci refuzul vine de la
   * PRIVILEGIU, nu de la trigger — si asta e ordinea buna: cel mai ieftin strat
   * raspunde primul. Trigger-ul de imutabilitate acopera cealalta cale de acces,
   * cea a functiilor `security definer`, care ruleaza ca proprietarul tabelei si
   * trec pe langa orice grant.
   */
  it('documentul emis nu se mai modifica si nu se sterge', async () => {
    const documentId = await withActor(officeActor(), async (tx) => {
      const workUnitId = await makeWorkUnit(tx);
      return makeReallocation(tx, workUnitId);
    });

    const update = await rejection(
      withActor(officeActor('corectie'), async (tx) => {
        await tx.execute(
          sql`update app.reallocation_documents set amount = 1.00 where id = ${documentId}`,
        );
      }),
    );
    expect(sqlstate(update)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);

    const deletion = await rejection(
      withActor(officeActor('stergere'), async (tx) => {
        await tx.execute(sql`delete from app.reallocation_documents where id = ${documentId}`);
      }),
    );
    expect(sqlstate(deletion)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });

  it('re-alocarea INTR-O luna inchisa e refuzata', async () => {
    const closed = await closedPeriod(2026, 3);

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        await makeReallocation(tx, workUnitId, { toPeriodId: closed });
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/PERIOD_CLOSED/);
  });

  it('un document care nu muta nimic: refuzat', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const workUnitId = await makeWorkUnit(tx);
        const id = uuidv7();
        await tx.execute(sql`
          insert into app.reallocation_documents
            (id, company_id, number, period_id, work_unit_id,
             from_contract_id, from_component_id, from_period_id,
             to_contract_id, to_component_id, to_period_id,
             amount, reason, created_by)
          values (
            ${id}, ${companyId}, ${`NRA-${id.slice(-8)}`}, ${periodSeptember}, ${workUnitId},
            ${contractId}, ${componentDelta}, ${periodAugust},
            ${contractId}, ${componentDelta}, ${periodAugust},
            800.00, 'nicio mutare', ${pmId}
          )`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });
});

describe('izolarea terenului', () => {
  // Verificarea #17 a pasului.
  it('terenul vede unitatea pe care e asignat si NU vede una neasignata', async () => {
    const { assignedId, strangerId } = await withActor(officeActor(), async (tx) => {
      const assigned = await makeWorkUnit(tx, { responsiblePersonId: pmId });
      const stranger = await makeWorkUnit(tx, { responsiblePersonId: pmId });
      await tx.execute(sql`
        insert into app.work_unit_assignments (id, work_unit_id, person_id, role, valid_from)
        values (${uuidv7()}, ${assigned}, ${workerId}, 'sef_santier', '2026-08-01')`);
      return { assignedId: assigned, strangerId: stranger };
    });

    const visible = await withActor(
      fieldActor({ personId: workerId, companyIds: [companyId] }),
      async (tx) => {
        const rows = await tx.execute<{ id: string }>(
          sql`select id from app.work_units where id in (${assignedId}, ${strangerId})`,
        );
        return rows.rows.map((r) => r.id);
      },
    );

    expect(visible).toEqual([assignedId]);
  });

  it('responsabilul isi vede propria unitate chiar fara rand de asignare', async () => {
    const workUnitId = await withActor(officeActor(), (tx) =>
      makeWorkUnit(tx, { responsiblePersonId: workerId }),
    );

    const visible = await withActor(
      fieldActor({ personId: workerId, companyIds: [companyId] }),
      async (tx) => {
        const rows = await tx.execute<{ id: string }>(
          sql`select id from app.work_units where id = ${workUnitId}`,
        );
        return rows.rows.length;
      },
    );

    expect(visible).toBe(1);
  });

  it('coloanele de bani ale unitatii sunt inaccesibile terenului: 42501', async () => {
    for (const column of ['estimated_value', 'cost_budget'] as const) {
      const error = await rejection(
        withActor(fieldActor({ personId: workerId, companyIds: [companyId] }), async (tx) => {
          await tx.execute(sql`select ${sql.raw(column)} from app.work_units limit 1`);
        }),
      );
      expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
    }
  });

  it('bugetele etapelor sunt inaccesibile terenului: 42501', async () => {
    for (const column of ['material_budget', 'labor_budget'] as const) {
      const error = await rejection(
        withActor(fieldActor({ personId: workerId, companyIds: [companyId] }), async (tx) => {
          await tx.execute(sql`select ${sql.raw(column)} from app.work_stages limit 1`);
        }),
      );
      expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
    }
  });

  it('finantarea si documentele de re-alocare nu se citesc deloc din teren', async () => {
    for (const table of ['funding_allocations', 'reallocation_documents'] as const) {
      const error = await rejection(
        withActor(fieldActor({ personId: workerId, companyIds: [companyId] }), async (tx) => {
          await tx.execute(sql`select id from app.${sql.raw(table)} limit 1`);
        }),
      );
      expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
    }
  });

  it('terenul nu poate scrie in unitatea de lucru', async () => {
    const error = await rejection(
      withActor(fieldActor({ personId: workerId, companyIds: [companyId] }), async (tx) => {
        await tx.execute(sql`
          insert into app.work_units (id, company_id, code, type, name, objective_id)
          values (${uuidv7()}, ${companyId}, ${`F-${uuidv7().slice(-8)}`}, 'inspectie', 'Din teren',
                  ${objectiveId})`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });
});
