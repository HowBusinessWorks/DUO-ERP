import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor, type ActorTx } from '../src/index';
import { SQLSTATE, fieldActor, officeActor, pgMessage, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Regulile pe care le impune BAZA la contracte si plafoane.
 *
 * Aritmetica indexarii nu e aici — e in `@damina/domain`, testata fara Postgres.
 * Aici stau exact lucrurile pe care o functie pura nu le poate garanta: ce
 * accepta si ce refuza schema, cine vede ce coloana, si ce se intampla intr-o
 * luna inchisa.
 */

interface Fixture {
  readonly companyId: string;
  readonly clientId: string;
  readonly contractId: string;
}

/** Un contract complet, cu firma si client proprii, ca testele sa nu se atinga. */
async function makeContract(
  tx: ActorTx,
  overrides: { status?: string; endsOn?: string; expiryAlertMonths?: number } = {},
): Promise<Fixture> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const contractId = uuidv7();
  const tag = contractId.slice(-8);

  await tx.execute(
    sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`,
  );
  await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`);
  await tx.execute(sql`
    insert into app.contracts
      (id, company_id, client_id, code, type, starts_on, ends_on,
       monthly_value, indexation_pct, status, expiry_alert_months)
    values (
      ${contractId}, ${companyId}, ${clientId}, ${`C-${tag}`},
      'mentenanta_multianual', '2026-01-01', ${overrides.endsOn ?? '2029-12-31'},
      50000.00, 0.0500, ${overrides.status ?? 'activ'}, ${overrides.expiryAlertMonths ?? 6}
    )`);

  return { companyId, clientId, contractId };
}

async function makeComponent(
  tx: ActorTx,
  contractId: string,
  type: 'mentenanta' | 'lucrari' | 'delta',
  cadence: 'lunar' | 'anual' = 'lunar',
): Promise<string> {
  const id = uuidv7();
  await tx.execute(sql`
    insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
    values (${id}, ${contractId}, ${type}, ${type}, ${cadence}, ${type === 'delta'})`);
  return id;
}

async function makePeriod(
  tx: ActorTx,
  companyId: string,
  year: number,
  month: number,
): Promise<string> {
  const id = uuidv7();
  await tx.execute(sql`
    insert into app.periods (id, company_id, year, month) values (${id}, ${companyId}, ${year}, ${month})`);
  return id;
}

describe('contracte', () => {
  it('codul de contract e unic pe firma, nu global', async () => {
    const { companyId, clientId } = await withActor(officeActor(), (tx) => makeContract(tx));

    // Alta firma, acelasi cod — trece. Cele 5 firme isi numeroteaza singure.
    const other = await withActor(officeActor(), async (tx) => {
      const otherCompany = uuidv7();
      await tx.execute(
        sql`insert into app.companies (id, name) values (${otherCompany}, ${`Firma ${otherCompany.slice(-6)}`})`,
      );
      const [row] = await tx
        .execute(
          sql`insert into app.contracts
                (id, company_id, client_id, code, type, starts_on, ends_on)
              values (${uuidv7()}, ${otherCompany}, ${clientId}, 'PARTAJAT',
                      'individual_deviz', '2026-01-01', '2026-12-31')
              returning id`,
        )
        .then((result) => result.rows);
      return row;
    });
    expect(other).toBeDefined();

    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on)
            values (${uuidv7()}, ${companyId}, ${clientId}, 'PARTAJAT',
                    'individual_deviz', '2026-01-01', '2026-12-31')`,
      );
    });

    const duplicate = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on)
              values (${uuidv7()}, ${companyId}, ${clientId}, 'PARTAJAT',
                      'individual_deviz', '2027-01-01', '2027-12-31')`,
        );
      }),
    );
    expect(sqlstate(duplicate)).toBe('23505');
  });

  it('un contract nu se poate termina inainte sa inceapa', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const { companyId, clientId } = await makeContract(tx);
        await tx.execute(
          sql`insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on)
              values (${uuidv7()}, ${companyId}, ${clientId}, 'INVERS',
                      'individual_deviz', '2026-12-31', '2026-01-01')`,
        );
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('anii contractuali nu se pot dubla pe acelasi index', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const { contractId } = await makeContract(tx);
        for (const attempt of [1, 2]) {
          await tx.execute(sql`
            insert into app.contract_years
              (id, contract_id, year_index, starts_on, ends_on, monthly_value, indexation_applied_pct)
            values (${uuidv7()}, ${contractId}, 1, '2026-01-01', '2026-12-31',
                    ${50000 * attempt}, 0)`);
        }
      }),
    );
    expect(sqlstate(error)).toBe('23505');
  });
});

describe('componente', () => {
  // Verificarea #3 din pasul 04.
  it('Delta are is_fill_target true; mentenanta si lucrari il au false', async () => {
    const types = await withActor(officeActor(), async (tx) => {
      const { contractId } = await makeContract(tx);
      await makeComponent(tx, contractId, 'mentenanta');
      await makeComponent(tx, contractId, 'lucrari', 'anual');
      await makeComponent(tx, contractId, 'delta');

      const result = await tx.execute(
        sql`select type::text as type, is_fill_target
              from app.contract_components
             where contract_id = ${contractId}
             order by type::text`,
      );
      return result.rows as { type: string; is_fill_target: boolean }[];
    });

    expect(types).toEqual([
      { type: 'delta', is_fill_target: true },
      { type: 'lucrari', is_fill_target: false },
      { type: 'mentenanta', is_fill_target: false },
    ]);
  });

  // Verificarea #4: is_fill_target = true pe Mentenanta e respins de DB.
  it('is_fill_target pe mentenanta e refuzat', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const { contractId } = await makeContract(tx);
        await tx.execute(sql`
          insert into app.contract_components
            (id, contract_id, type, name, budget_cadence, is_fill_target)
          values (${uuidv7()}, ${contractId}, 'mentenanta', 'Mentenanta', 'lunar', true)`);
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('o Delta cu is_fill_target false e la fel de refuzata — egalitate, nu implicatie', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const { contractId } = await makeContract(tx);
        await tx.execute(sql`
          insert into app.contract_components
            (id, contract_id, type, name, budget_cadence, is_fill_target)
          values (${uuidv7()}, ${contractId}, 'delta', 'Delta', 'lunar', false)`);
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('un contract nu poate avea doua componente de acelasi tip', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const { contractId } = await makeContract(tx);
        await makeComponent(tx, contractId, 'lucrari', 'anual');
        await makeComponent(tx, contractId, 'lucrari', 'anual');
      }),
    );
    expect(sqlstate(error)).toBe('23505');
  });
});

describe('plafoane — cele trei numere nu se amesteca', () => {
  it('Delta refuza plafon de cost', async () => {
    const error = await rejection(
      withActor(officeActor('test'), async (tx) => {
        const { companyId, contractId } = await makeContract(tx);
        const delta = await makeComponent(tx, contractId, 'delta');
        const periodId = await makePeriod(tx, companyId, 2026, 3);
        await tx.execute(sql`
          insert into app.component_ceilings (id, component_id, period_id, cost_ceiling)
          values (${uuidv7()}, ${delta}, ${periodId}, 5000.00)`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toContain('Delta nu are plafon de cost');
  });

  it('mentenanta refuza plafon de venit', async () => {
    const error = await rejection(
      withActor(officeActor('test'), async (tx) => {
        const { companyId, contractId } = await makeContract(tx);
        const maintenance = await makeComponent(tx, contractId, 'mentenanta');
        const periodId = await makePeriod(tx, companyId, 2026, 3);
        await tx.execute(sql`
          insert into app.component_ceilings (id, component_id, period_id, revenue_ceiling)
          values (${uuidv7()}, ${maintenance}, ${periodId}, 5000.00)`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toContain('doar Delta are plafon de venit');
  });

  it('un plafon e ori lunar, ori anual — nu amandoua si nu niciunul', async () => {
    const neither = await rejection(
      withActor(officeActor('test'), async (tx) => {
        const { contractId } = await makeContract(tx);
        const component = await makeComponent(tx, contractId, 'mentenanta');
        await tx.execute(sql`
          insert into app.component_ceilings (id, component_id, cost_ceiling)
          values (${uuidv7()}, ${component}, 1000.00)`);
      }),
    );
    expect(sqlstate(neither)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('doua plafoane anuale pe aceeasi componenta sunt refuzate (nulls not distinct)', async () => {
    const error = await rejection(
      withActor(officeActor('test'), async (tx) => {
        const { contractId } = await makeContract(tx);
        const component = await makeComponent(tx, contractId, 'lucrari', 'anual');
        const yearId = uuidv7();
        await tx.execute(sql`
          insert into app.contract_years
            (id, contract_id, year_index, starts_on, ends_on, monthly_value, indexation_applied_pct)
          values (${yearId}, ${contractId}, 1, '2026-01-01', '2026-12-31', 50000.00, 0)`);

        for (const value of [100000, 120000]) {
          await tx.execute(sql`
            insert into app.component_ceilings (id, component_id, contract_year_id, cost_ceiling)
            values (${uuidv7()}, ${component}, ${yearId}, ${value})`);
        }
      }),
    );
    expect(sqlstate(error)).toBe('23505');
  });

  // Verificarea #5: modificarea unui plafon fara motiv e respinsa.
  it('modificarea unui plafon fara motiv e respinsa; cu motiv lasa rand in audit', async () => {
    const setup = await withActor(officeActor(), async (tx) => {
      const { companyId, contractId } = await makeContract(tx);
      const component = await makeComponent(tx, contractId, 'mentenanta');
      const periodId = await makePeriod(tx, companyId, 2026, 4);
      const ceilingId = uuidv7();
      await tx.execute(sql`
        insert into app.component_ceilings (id, component_id, period_id, cost_ceiling)
        values (${ceilingId}, ${component}, ${periodId}, 40000.00)`);
      return { ceilingId };
    });

    const withoutReason = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`update app.component_ceilings set cost_ceiling = 45000.00 where id = ${setup.ceilingId}`,
        );
      }),
    );
    expect(sqlstate(withoutReason)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(withoutReason)).toContain('motiv scris');

    const entries = await withActor(
      officeActor('plafon marit dupa negocierea din 12 martie'),
      async (tx) => {
        await tx.execute(
          sql`update app.component_ceilings set cost_ceiling = 45000.00 where id = ${setup.ceilingId}`,
        );
        const result = await tx.execute(
          sql`select reason, changed from audit.entries
               where table_name = 'app.component_ceilings'
                 and record_id = ${setup.ceilingId}
                 and operation = 'update'`,
        );
        return result.rows as { reason: string; changed: Record<string, unknown> }[];
      },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.reason).toBe('plafon marit dupa negocierea din 12 martie');
    expect(Object.keys(entries[0]?.changed ?? {})).toContain('cost_ceiling');
  });

  // Verificarea #6: plafon pe o luna inchisa.
  it('plafonul unei luni inchise nu se poate modifica', async () => {
    const setup = await withActor(officeActor(), async (tx) => {
      const { companyId, contractId } = await makeContract(tx);
      const component = await makeComponent(tx, contractId, 'mentenanta');
      const periodId = await makePeriod(tx, companyId, 2026, 1);
      const ceilingId = uuidv7();
      await tx.execute(sql`
        insert into app.component_ceilings (id, component_id, period_id, cost_ceiling)
        values (${ceilingId}, ${component}, ${periodId}, 40000.00)`);
      return { companyId, component, periodId, ceilingId };
    });

    await withActor(officeActor('inchidere de luna'), async (tx) => {
      const person = uuidv7();
      await tx.execute(sql`
        insert into app.persons (id, persona, category, full_name)
        values (${person}, 'office', 'angajat', 'Inchizator')`);
      await tx.execute(sql`
        update app.periods
           set status = 'closed', closed_at = now(), closed_by = ${person}
         where id = ${setup.periodId}`);
    });

    const blocked = await rejection(
      withActor(officeActor('incerc oricum'), async (tx) => {
        await tx.execute(
          sql`update app.component_ceilings set cost_ceiling = 99999.00 where id = ${setup.ceilingId}`,
        );
      }),
    );

    expect(sqlstate(blocked)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(blocked)).toContain('PERIOD_CLOSED');
    expect(pgMessage(blocked)).toContain('01/2026');

    // Usa de avarie: cu motiv scris, trece — si motivul ajunge singur in audit.
    const rescued = await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`select app.allow_closed_period_writes('corectie ceruta de auditor, 14.02')`,
      );
      await tx.execute(
        sql`update app.component_ceilings set cost_ceiling = 41000.00 where id = ${setup.ceilingId}`,
      );
      const result = await tx.execute(
        sql`select reason from audit.entries
             where record_id = ${setup.ceilingId} and operation = 'update'
             order by occurred_at desc limit 1`,
      );
      return result.rows as { reason: string }[];
    });

    expect(rescued[0]?.reason).toBe('corectie ceruta de auditor, 14.02');
  });

  it('un plafon ANUAL nu e blocat de luna inchisa — nu apartine unei luni', async () => {
    // `officeActor` cu motiv: inchiderea unei luni e auditata cu motiv obligatoriu.
    const value = await withActor(officeActor('inchidere de luna'), async (tx) => {
      const { companyId, contractId } = await makeContract(tx);
      const component = await makeComponent(tx, contractId, 'lucrari', 'anual');
      const periodId = await makePeriod(tx, companyId, 2026, 2);
      const person = uuidv7();
      await tx.execute(sql`
        insert into app.persons (id, persona, category, full_name)
        values (${person}, 'office', 'angajat', 'Inchizator')`);
      await tx.execute(sql`
        update app.periods set status = 'closed', closed_at = now(), closed_by = ${person}
         where id = ${periodId}`);

      const yearId = uuidv7();
      await tx.execute(sql`
        insert into app.contract_years
          (id, contract_id, year_index, starts_on, ends_on, monthly_value, indexation_applied_pct)
        values (${yearId}, ${contractId}, 1, '2026-01-01', '2026-12-31', 50000.00, 0)`);
      await tx.execute(sql`
        insert into app.component_ceilings (id, component_id, contract_year_id, cost_ceiling)
        values (${uuidv7()}, ${component}, ${yearId}, 600000.00)`);

      const result = await tx.execute(
        sql`select cost_ceiling from app.component_ceilings where contract_year_id = ${yearId}`,
      );
      return result.rows as { cost_ceiling: string }[];
    });

    expect(value[0]?.cost_ceiling).toBe('600000.00');
  });
});

// Verificarea #15 din pasul 04 — izolarea pretului, la nivel de coloana.
describe('izolarea pretului pe contracte', () => {
  it('app_field citeste contractul, dar nu si valorile lui', async () => {
    const { companyId, contractId } = await withActor(officeActor(), (tx) => makeContract(tx));

    // Coloanele fara bani: trec.
    const visible = await withActor(fieldActor({ companyIds: [companyId] }), async (tx) => {
      const result = await tx.execute(
        sql`select code, starts_on, ends_on, status from app.contracts where id = ${contractId}`,
      );
      return result.rows as { code: string }[];
    });
    expect(visible).toHaveLength(1);

    // Fiecare coloana comerciala, refuzata individual. `select *` cade pe prima.
    for (const column of [
      'total_value',
      'monthly_value',
      'indexation_pct',
      'delta_threshold',
      'overhead_pct',
    ]) {
      const error = await rejection(
        withActor(fieldActor(), async (tx) => {
          await tx.execute(sql`select ${sql.raw(column)} from app.contracts where id = ${contractId}`);
        }),
      );
      expect(sqlstate(error), `coloana ${column} ar trebui refuzata`).toBe(
        SQLSTATE.INSUFFICIENT_PRIVILEGE,
      );
    }

    const star = await rejection(
      withActor(fieldActor(), async (tx) => {
        await tx.execute(sql`select * from app.contracts where id = ${contractId}`);
      }),
    );
    expect(sqlstate(star)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });

  it('app_field nu atinge deloc anii contractuali si plafoanele', async () => {
    for (const table of ['contract_years', 'component_ceilings']) {
      const error = await rejection(
        withActor(fieldActor(), async (tx) => {
          await tx.execute(sql`select count(*) from ${sql.raw(`app.${table}`)}`);
        }),
      );
      expect(sqlstate(error), table).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
    }
  });

  it('app_field vede componentele — structura, nu bani', async () => {
    const rows = await withActor(officeActor(), (tx) => makeContract(tx)).then(
      async ({ companyId, contractId }) => {
        await withActor(officeActor(), (tx) => makeComponent(tx, contractId, 'delta'));
        return withActor(fieldActor({ companyIds: [companyId] }), async (tx) => {
          const result = await tx.execute(
            sql`select name from app.contract_components where contract_id = ${contractId}`,
          );
          return result.rows;
        });
      },
    );
    expect(rows).toHaveLength(1);
  });

  it('app_field nu poate scrie in contracts', async () => {
    const { contractId } = await withActor(officeActor(), (tx) => makeContract(tx));
    const error = await rejection(
      withActor(fieldActor(), async (tx) => {
        await tx.execute(sql`update app.contracts set status = 'anulat' where id = ${contractId}`);
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });
});

// Reparatia din 0009, verificata pe cele trei tabele afectate.
describe('audit pe tabele cu cheie compusa', () => {
  it('person_company_access se poate insera si lasa urma in jurnal', async () => {
    const entries = await withActor(officeActor(), async (tx) => {
      const companyId = uuidv7();
      const personId = uuidv7();
      await tx.execute(
        sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${companyId.slice(-6)}`})`,
      );
      await tx.execute(sql`
        insert into app.persons (id, persona, category, full_name)
        values (${personId}, 'office', 'angajat', 'Legatura')`);
      await tx.execute(
        sql`insert into app.person_company_access (person_id, company_id) values (${personId}, ${companyId})`,
      );

      const result = await tx.execute(sql`
        select changed from audit.entries
         where table_name = 'app.person_company_access' and operation = 'insert'
           and changed -> 'person_id' ->> 'new' = ${personId}`);
      return result.rows as { changed: Record<string, { new: string }> }[];
    });

    expect(entries).toHaveLength(1);
  });

  it('person_office_roles si team_members la fel', async () => {
    const counts = await withActor(officeActor(), async (tx) => {
      const companyId = uuidv7();
      const personId = uuidv7();
      const teamId = uuidv7();
      await tx.execute(
        sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${companyId.slice(-6)}`})`,
      );
      await tx.execute(sql`
        insert into app.persons (id, persona, category, full_name)
        values (${personId}, 'office', 'angajat', 'Rolar')`);
      await tx.execute(
        sql`insert into app.person_office_roles (person_id, role) values (${personId}, 'pm')`,
      );
      await tx.execute(
        sql`insert into app.teams (id, company_id, name) values (${teamId}, ${companyId}, 'Echipa 1')`,
      );
      await tx.execute(sql`
        insert into app.team_members (team_id, person_id, valid_from)
        values (${teamId}, ${personId}, '2026-01-01')`);

      const result = await tx.execute(sql`
        select count(*)::int as n from audit.entries
         where table_name in ('app.person_office_roles', 'app.team_members')`);
      return result.rows as { n: number }[];
    });

    expect(counts[0]?.n).toBeGreaterThanOrEqual(2);
  });
});
