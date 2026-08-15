import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor } from '../src/index';
import { SQLSTATE, officeActor, pgMessage, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

const companyId = uuidv7();
const closerId = uuidv7();

/** Deschide o luna si o inchide. Intoarce id-ul perioadei. */
async function closedPeriod(year: number, month: number): Promise<string> {
  return withActor(officeActor('inchidere de luna pentru test'), async (tx) => {
    const opened = await tx.execute<{ id: string }>(
      sql`insert into app.periods (id, company_id, year, month)
          values (${uuidv7()}, ${companyId}, ${year}, ${month})
          returning id`,
    );
    const periodId = opened.rows[0]?.id;
    if (periodId === undefined) {
      throw new Error('Perioada nu a fost creata.');
    }

    await tx.execute(
      sql`update app.periods
             set status = 'closed', closed_at = now(), closed_by = ${closerId}
           where id = ${periodId}`,
    );
    return periodId;
  });
}

beforeAll(async () => {
  await withActor(officeActor(), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name, cui)
          values (${companyId}, 'Damina Perioade SRL', ${`RO${companyId.slice(-8)}`})`,
    );
    await tx.execute(
      sql`insert into app.persons (id, persona, category, full_name)
          values (${closerId}, 'office', 'angajat', 'Financiar')`,
    );
  });
});

describe('perioade', () => {
  // Verificarea #5 din Pasul 02.
  it('scrierea intr-o luna inchisa e refuzata cu PERIOD_CLOSED', async () => {
    const periodId = await closedPeriod(2026, 1);

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`insert into app.period_close_checks (id, period_id, check_key)
              values (${uuidv7()}, ${periodId}, 'facturi_emise')`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/PERIOD_CLOSED/);
    expect(pgMessage(error)).toMatch(/01\/2026/);
  });

  it('scrierea intr-o luna deschisa trece', async () => {
    const periodId = await withActor(officeActor(), async (tx) => {
      const opened = await tx.execute<{ id: string }>(
        sql`insert into app.periods (id, company_id, year, month)
            values (${uuidv7()}, ${companyId}, 2026, 2)
            returning id`,
      );
      return opened.rows[0]?.id;
    });

    const key = await withActor(officeActor(), async (tx) => {
      const inserted = await tx.execute<{ check_key: string }>(
        sql`insert into app.period_close_checks (id, period_id, check_key)
            values (${uuidv7()}, ${periodId}, 'facturi_emise')
            returning check_key`,
      );
      return inserted.rows[0]?.check_key;
    });

    expect(key).toBe('facturi_emise');
  });

  // Verificarea #6 din Pasul 02.
  it('usa de avarie deschide luna si lasa motivul in audit', async () => {
    const periodId = await closedPeriod(2026, 3);
    const reason = 'corectie ANAF pe factura 4712';

    const checkId = await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`select app.allow_closed_period_writes(${reason})`);

      const id = uuidv7();
      await tx.execute(
        sql`insert into app.period_close_checks (id, period_id, check_key)
            values (${id}, ${periodId}, 'corectie_manuala')`,
      );
      return id;
    });

    const entry = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ reason: string | null; operation: string }>(
        sql`select reason, operation from audit.entries
             where table_name = 'app.period_close_checks' and record_id = ${checkId}`,
      );
      return result.rows[0];
    });

    // Nu doar ca a trecut: a lasat urma, cu motivul dat la usa.
    expect(entry?.operation).toBe('insert');
    expect(entry?.reason).toBe(reason);
  });

  it('usa de avarie refuza sa se deschida fara motiv', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`select app.allow_closed_period_writes('   ')`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/VALIDATION_FAILED/);
  });

  it('deschiderea nu se scurge intre tranzactii', async () => {
    const periodId = await closedPeriod(2026, 4);

    // Prima tranzactie deschide usa si scrie.
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`select app.allow_closed_period_writes('prima tranzactie')`);
      await tx.execute(
        sql`insert into app.period_close_checks (id, period_id, check_key)
            values (${uuidv7()}, ${periodId}, 'prima')`,
      );
    });

    // A doua refoloseste aceeasi conexiune din pool. Daca setarea ar fi fost de
    // sesiune si nu de tranzactie, ar trece si ea — si luna inchisa n-ar mai
    // insemna nimic.
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`insert into app.period_close_checks (id, period_id, check_key)
              values (${uuidv7()}, ${periodId}, 'a_doua')`,
        );
      }),
    );

    expect(pgMessage(error)).toMatch(/PERIOD_CLOSED/);
  });

  it('period_of creeaza luna daca lipseste si o refoloseste dupa', async () => {
    const first = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`select app.period_of(${companyId}, '2026-11-20'::date) as id`,
      );
      return result.rows[0]?.id;
    });

    const second = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`select app.period_of(${companyId}, '2026-11-02'::date) as id`,
      );
      return result.rows[0]?.id;
    });

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('o luna nu poate fi marcata inchisa fara autor', async () => {
    const periodId = await withActor(officeActor(), async (tx) => {
      const opened = await tx.execute<{ id: string }>(
        sql`insert into app.periods (id, company_id, year, month)
            values (${uuidv7()}, ${companyId}, 2026, 5)
            returning id`,
      );
      return opened.rows[0]?.id;
    });

    const error = await rejection(
      withActor(officeActor('inchid luna'), async (tx) => {
        await tx.execute(sql`update app.periods set status = 'closed' where id = ${periodId}`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });
});
