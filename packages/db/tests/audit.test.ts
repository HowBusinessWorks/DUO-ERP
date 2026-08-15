import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor } from '../src/index';
import { SQLSTATE, fieldActor, officeActor, pgMessage, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

interface AuditRow extends Record<string, unknown> {
  readonly actor_id: string | null;
  readonly persona: string | null;
  readonly operation: string;
  readonly changed: Record<string, { old: unknown; new: unknown }>;
  readonly reason: string | null;
}

async function entriesFor(table: string, recordId: string): Promise<AuditRow[]> {
  return withActor(officeActor(), async (tx) => {
    const result = await tx.execute<AuditRow>(
      sql`select actor_id, persona, operation, changed, reason
            from audit.entries
           where table_name = ${table} and record_id = ${recordId}
           order by occurred_at, id`,
    );
    return result.rows;
  });
}

describe('audit', () => {
  // Verificarea #8 din Pasul 02.
  it('un update lasa in jurnal DOAR campul modificat', async () => {
    const clientId = uuidv7();
    const actor = officeActor();

    await withActor(actor, async (tx) => {
      await tx.execute(
        sql`insert into app.clients (id, name, cui, payment_term_days)
            values (${clientId}, 'Apa Nova', 'RO12345678', 70)`,
      );
    });

    await withActor(actor, async (tx) => {
      await tx.execute(sql`update app.clients set payment_term_days = 45 where id = ${clientId}`);
    });

    const rows = await entriesFor('app.clients', clientId);
    expect(rows).toHaveLength(2);

    const [created, updated] = rows;
    expect(created?.operation).toBe('insert');
    expect(updated?.operation).toBe('update');

    // Nu "randul contine campul modificat" — ci "randul contine NUMAI campul
    // modificat". Diferenta face jurnalul citibil.
    expect(Object.keys(updated?.changed ?? {})).toEqual(['payment_term_days']);
    expect(updated?.changed['payment_term_days']).toEqual({ old: 70, new: 45 });
  });

  it('jurnalul retine cine a facut modificarea si din ce persona', async () => {
    const clientId = uuidv7();
    const actor = officeActor();

    await withActor(actor, async (tx) => {
      await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, 'Veolia')`);
    });

    const rows = await entriesFor('app.clients', clientId);
    expect(rows[0]?.actor_id).toBe(actor.personId);
    // `persona` vine din `request.jwt.claims`, pe care `withActor` il completeaza
    // singur din actor — nu depinde de ce a pus apelantul in claims.
    expect(rows[0]?.persona).toBe('office');
  });

  it('un update care nu schimba nimic nu produce rand de jurnal', async () => {
    const clientId = uuidv7();
    const actor = officeActor();

    await withActor(actor, async (tx) => {
      await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, 'Enel')`);
    });

    await withActor(actor, async (tx) => {
      await tx.execute(sql`update app.clients set name = 'Enel' where id = ${clientId}`);
    });

    const rows = await entriesFor('app.clients', clientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.operation).toBe('insert');
  });

  it('jurnalul prinde si trecerea unui camp catre null', async () => {
    const clientId = uuidv7();
    const actor = officeActor();

    await withActor(actor, async (tx) => {
      await tx.execute(
        sql`insert into app.clients (id, name, cui) values (${clientId}, 'Distrigaz', 'RO999')`,
      );
      await tx.execute(sql`update app.clients set cui = null where id = ${clientId}`);
    });

    const rows = await entriesFor('app.clients', clientId);
    const updated = rows.find((r) => r.operation === 'update');
    expect(updated?.changed['cui']).toEqual({ old: 'RO999', new: null });
  });

  // Verificarea #9 din Pasul 02.
  it('modificarea unui tarif fara motiv scris e refuzata', async () => {
    const qualificationId = uuidv7();
    const rateCardId = uuidv7();

    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.qualifications (id, code, name)
            values (${qualificationId}, ${`dul-${qualificationId.slice(-8)}`}, 'Dulgher')`,
      );
      await tx.execute(
        sql`insert into app.rate_cards
              (id, qualification_id, valid_from, hourly_salary,
               tax_coefficient, unproductivity_coefficient)
            values (${rateCardId}, ${qualificationId}, '2026-01-01', 30.00, 0.4500, 0.1500)`,
      );
    });

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`update app.rate_cards set valid_to = '2026-09-01' where id = ${rateCardId}`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/VALIDATION_FAILED/);
  });

  it('aceeasi modificare trece cu motiv scris, si motivul ajunge in jurnal', async () => {
    const qualificationId = uuidv7();
    const rateCardId = uuidv7();
    const reason = 'renegociere colectiva august 2026';

    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.qualifications (id, code, name)
            values (${qualificationId}, ${`sud-${qualificationId.slice(-8)}`}, 'Sudor')`,
      );
      await tx.execute(
        sql`insert into app.rate_cards
              (id, qualification_id, valid_from, hourly_salary,
               tax_coefficient, unproductivity_coefficient)
            values (${rateCardId}, ${qualificationId}, '2026-01-01', 30.00, 0.4500, 0.1500)`,
      );
    });

    await withActor(officeActor(reason), async (tx) => {
      await tx.execute(
        sql`update app.rate_cards set valid_to = '2026-09-01' where id = ${rateCardId}`,
      );
    });

    const rows = await entriesFor('app.rate_cards', rateCardId);
    const updated = rows.find((r) => r.operation === 'update');
    expect(updated?.reason).toBe(reason);
  });

  it('terenul nu poate citi jurnalul', async () => {
    const error = await rejection(
      withActor(fieldActor(), async (tx) => {
        await tx.execute(sql`select id from audit.entries limit 1`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });

  it('nimeni nu poate scrie direct in jurnal', async () => {
    // Singura cale catre `audit.entries` e trigger-ul. Daca s-ar putea insera
    // direct, jurnalul ar putea fi fabricat — si nu ar mai fi jurnal.
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`insert into audit.entries (table_name, record_id, operation, changed)
              values ('app.clients', ${uuidv7()}, 'update', '{}'::jsonb)`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });
});
