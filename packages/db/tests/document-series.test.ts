import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor } from '../src/index';
import { SQLSTATE, officeActor, pgMessage, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

const companyId = uuidv7();
const SERIES = 'DAM';

beforeAll(async () => {
  await withActor(officeActor(), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name, cui)
          values (${companyId}, 'Damina Serii SRL', ${`RO${companyId.slice(-8)}`})`,
    );
    await tx.execute(
      sql`insert into app.document_series (id, company_id, document_type, series)
          values (${uuidv7()}, ${companyId}, 'factura', ${SERIES})`,
    );
  });
});

async function allocate(): Promise<string> {
  return withActor(officeActor(), async (tx) => {
    const result = await tx.execute<{ n: string }>(
      sql`select app.allocate_document_number(
            ${companyId}, 'factura'::app.numbered_document_type, ${SERIES}
          ) as n`,
    );
    const value = result.rows[0]?.n;
    if (value === undefined) {
      throw new Error('Alocatorul nu a intors un numar.');
    }
    return value;
  });
}

/** "DAM-000042" → 42 */
function numberOf(document: string): number {
  return Number(document.split('-')[1]);
}

describe('serii de documente', () => {
  // Verificarea #7 din Pasul 02.
  it('100 de alocari in paralel dau numerele 1-100, fara goluri si fara duplicate', async () => {
    const documents = await Promise.all(Array.from({ length: 100 }, () => allocate()));

    const numbers = documents.map(numberOf).sort((a, b) => a - b);

    expect(new Set(documents).size).toBe(100);
    expect(numbers).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('numarul se intoarce daca tranzactia esueaza', async () => {
    // Asta e intreg motivul pentru care nu folosim `sequence`: un sequence ar
    // fi lasat un gol aici, iar documentele fiscale nu au voie sa aiba goluri.
    const before = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ next_number: number }>(
        sql`select next_number from app.document_series
             where company_id = ${companyId} and series = ${SERIES}`,
      );
      return result.rows[0]?.next_number;
    });

    await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`select app.allocate_document_number(
                ${companyId}, 'factura'::app.numbered_document_type, ${SERIES}
              )`,
        );
        throw new Error('Documentul nu s-a putut salva.');
      }),
    );

    const after = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ next_number: number }>(
        sql`select next_number from app.document_series
             where company_id = ${companyId} and series = ${SERIES}`,
      );
      return result.rows[0]?.next_number;
    });

    expect(after).toBe(before);
  });

  it('o serie nedefinita e refuzata, nu inventata', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`select app.allocate_document_number(
                ${companyId}, 'nir'::app.numbered_document_type, 'NU-EXISTA'
              )`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toMatch(/NOT_FOUND/);
  });

  it('next_number nu poate fi impins pe alta cale decat alocatorul', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`update app.document_series set next_number = 5000
               where company_id = ${companyId} and series = ${SERIES}`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });
});
