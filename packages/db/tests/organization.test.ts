import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor } from '../src/index';
import { SQLSTATE, officeActor, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

describe('organizatie', () => {
  // Verificarea #10 din Pasul 02.
  it('rate_cards: doua intervale suprapuse pe aceeasi calificare sunt refuzate', async () => {
    const qualificationId = uuidv7();

    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.qualifications (id, code, name)
            values (${qualificationId}, ${`el-${qualificationId.slice(-8)}`}, 'Electrician')`,
      );
      await tx.execute(
        sql`insert into app.rate_cards
              (id, qualification_id, valid_from, valid_to, hourly_salary,
               tax_coefficient, unproductivity_coefficient)
            values (${uuidv7()}, ${qualificationId}, '2026-01-01', '2026-07-01',
                    30.00, 0.4500, 0.1500)`,
      );
    });

    // Se suprapune cu primul interval pe iunie.
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`insert into app.rate_cards
                (id, qualification_id, valid_from, valid_to, hourly_salary,
                 tax_coefficient, unproductivity_coefficient)
              values (${uuidv7()}, ${qualificationId}, '2026-06-01', null,
                      34.00, 0.4500, 0.1500)`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.EXCLUSION_VIOLATION);
  });

  it('rate_cards: un interval care incepe exact unde se termina altul e permis', async () => {
    const qualificationId = uuidv7();

    // `daterange(..., '[)')` e deschis la dreapta, deci 01.07 nu mai apartine
    // primului interval. Fara asta, istoricizarea ar fi imposibila.
    const both = await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.qualifications (id, code, name)
            values (${qualificationId}, ${`zid-${qualificationId.slice(-8)}`}, 'Zidar')`,
      );
      await tx.execute(
        sql`insert into app.rate_cards
              (id, qualification_id, valid_from, valid_to, hourly_salary,
               tax_coefficient, unproductivity_coefficient)
            values (${uuidv7()}, ${qualificationId}, '2026-01-01', '2026-07-01',
                    30.00, 0.4500, 0.1500)`,
      );
      await tx.execute(
        sql`insert into app.rate_cards
              (id, qualification_id, valid_from, valid_to, hourly_salary,
               tax_coefficient, unproductivity_coefficient)
            values (${uuidv7()}, ${qualificationId}, '2026-07-01', null,
                    34.00, 0.4500, 0.1500)`,
      );

      const result = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from app.rate_cards
             where qualification_id = ${qualificationId}`,
      );
      return result.rows[0]?.count;
    });

    expect(both).toBe('2');
  });

  it('rate_cards: hourly_cost aplica taxele pe salariu si neproductivitatea peste ele', async () => {
    const qualificationId = uuidv7();

    const cost = await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.qualifications (id, code, name)
            values (${qualificationId}, ${`ins-${qualificationId.slice(-8)}`}, 'Instalator')`,
      );
      const inserted = await tx.execute<{ hourly_cost: string }>(
        sql`insert into app.rate_cards
              (id, qualification_id, valid_from, hourly_salary,
               tax_coefficient, unproductivity_coefficient)
            values (${uuidv7()}, ${qualificationId}, '2026-01-01', 30.00, 0.4500, 0.1500)
            returning hourly_cost`,
      );
      return inserted.rows[0]?.hourly_cost;
    });

    // 30 * 1.45 * 1.15 = 50.025, rotunjit la 50.03.
    expect(cost).toBe('50.03');
  });

  // Verificarea #11 din Pasul 02.
  it('persons: persona subcontractor fara subcontractor_id e refuzata', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`insert into app.persons (id, persona, category, full_name)
              values (${uuidv7()}, 'subcontractor', 'subcontractant', 'Fara firma')`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('persons: o persona de birou legata de un subcontractant e refuzata', async () => {
    // Constrangerea e o egalitate, nu o implicatie. Daca ar fi fost doar
    // "subcontractor cere firma", un utilizator de birou legat din greseala de
    // un subcontractant ar fi trecut — si ar fi capatat vizibilitatea lui.
    const subcontractorId = uuidv7();

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`insert into app.subcontractors (id, name) values (${subcontractorId}, 'Sanitare SRL')`,
        );
        await tx.execute(
          sql`insert into app.persons (id, persona, category, full_name, subcontractor_id)
              values (${uuidv7()}, 'office', 'angajat', 'Om de birou', ${subcontractorId})`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('assert_authorizations_valid: autorizatia expirata blocheaza, cea valabila nu', async () => {
    const personId = uuidv7();

    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.persons (id, persona, category, full_name)
            values (${personId}, 'field', 'sef_santier', 'Sef de santier')`,
      );
      await tx.execute(
        sql`insert into app.person_authorizations (id, person_id, kind, issued_at, expires_at)
            values (${uuidv7()}, ${personId}, 'ssm', '2025-01-01', '2025-12-31')`,
      );
    });

    const expired = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`select app.assert_authorizations_valid(${personId}, array['ssm'], '2026-08-15'::date)`,
        );
      }),
    );
    expect(sqlstate(expired)).toBe(SQLSTATE.RAISED);

    // Aceeasi autorizatie, la o data la care era valabila.
    await expect(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`select app.assert_authorizations_valid(${personId}, array['ssm'], '2025-06-01'::date)`,
        );
      }),
    ).resolves.toBeUndefined();
  });
});
