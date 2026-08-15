import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor, withServiceActor } from '../src/index';
import { SQLSTATE, fieldActor, officeActor, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/** O firma proaspata, ca testele sa nu se vada intre ele. */
async function makeCompany(): Promise<string> {
  const id = uuidv7();
  await withActor(officeActor(), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name, cui)
          values (${id}, ${`Test ${id.slice(-8)}`}, ${`RO${id.slice(-8)}`})`,
    );
  });
  return id;
}

async function makePerson(): Promise<string> {
  const id = uuidv7();
  await withActor(officeActor(), async (tx) => {
    await tx.execute(
      sql`insert into app.persons (id, persona, category, full_name, email)
          values (${id}, 'office', 'angajat', 'Test Persoana', ${`t${id.slice(-10)}@damina.test`})`,
    );
  });
  return id;
}

describe('alerte', () => {
  // Verificarea #9 din Pasul 03.
  it('doua alerte identice pe acelasi scope dau un singur rand deschis', async () => {
    const companyId = await makeCompany();
    const scopeId = uuidv7();

    const insert = (): Promise<unknown> =>
      withServiceActor('test', async (tx) => {
        await tx.execute(
          sql`insert into app.alerts (id, company_id, scope_type, scope_id, kind, severity, title)
              values (${uuidv7()}, ${companyId}, 'contract', ${scopeId}, 'buget_80',
                      'warning', 'Buget la 80%')`,
        );
      });

    await insert();
    const error = await rejection(insert());

    // 23505 = unique_violation. Indexul unic PARTIAL e cel care raspunde.
    expect(sqlstate(error)).toBe('23505');
  });

  it('dupa rezolvare, aceeasi alerta poate fi ridicata din nou', async () => {
    const companyId = await makeCompany();
    const scopeId = uuidv7();
    const firstId = uuidv7();

    await withServiceActor('test', async (tx) => {
      await tx.execute(
        sql`insert into app.alerts (id, company_id, scope_type, scope_id, kind, title)
            values (${firstId}, ${companyId}, 'work_unit', ${scopeId}, 'delta_sub_prag', 'Delta sub prag')`,
      );
      await tx.execute(sql`update app.alerts set resolved_at = now() where id = ${firstId}`);
      // Conditia a reaparut luna urmatoare. Istoricul ramane intreg: doua randuri,
      // unul inchis si unul deschis.
      await tx.execute(
        sql`insert into app.alerts (id, company_id, scope_type, scope_id, kind, title)
            values (${uuidv7()}, ${companyId}, 'work_unit', ${scopeId}, 'delta_sub_prag', 'Delta sub prag')`,
      );
    });

    const rows = await withActor(officeActor(), async (tx) => {
      const r = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from app.alerts where scope_id = ${scopeId}`,
      );
      return r.rows[0]?.count;
    });

    expect(rows).toBe('2');
  });
});

describe('coada de lucru', () => {
  // Verificarea #8 din Pasul 03, partea de baza de date. Partea de Realtime se
  // verifica in aplicatie.
  it('numara doar randurile nerezolvate, si scade cand se rezolva', async () => {
    const companyId = await makeCompany();
    const personId = await makePerson();

    const open = async (): Promise<string | undefined> =>
      withActor(officeActor(), async (tx) => {
        const r = await tx.execute<{ count: string }>(
          sql`select count(*)::text as count from app.work_queue_items
              where person_id = ${personId} and resolved_at is null`,
        );
        return r.rows[0]?.count;
      });

    const itemId = uuidv7();
    await withServiceActor('test', async (tx) => {
      await tx.execute(
        sql`insert into app.work_queue_items
              (id, person_id, company_id, kind, entity_type, entity_id, title, href)
            values (${itemId}, ${personId}, ${companyId}, 'sl_de_aprobat', 'situatie_lucrari',
                    ${uuidv7()}, 'SL-0012 de aprobat', '/bani/situatii')`,
      );
    });

    expect(await open()).toBe('1');

    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`update app.work_queue_items set resolved_at = now() where id = ${itemId}`);
    });

    expect(await open()).toBe('0');
  });

  it('terenul nu poate insera in coada de lucru', async () => {
    // Cine produce randuri de coada e sistemul. Un utilizator care si-ar putea
    // insera propriile sarcini si le-ar putea si sterge.
    const error = await rejection(
      withActor(fieldActor(), async (tx) => {
        await tx.execute(
          sql`insert into app.work_queue_items
                (id, person_id, company_id, kind, entity_type, entity_id, title, href)
              values (${uuidv7()}, ${uuidv7()}, ${uuidv7()}, 'x', 'y', ${uuidv7()}, 't', '/')`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });
});

describe('produse', () => {
  it('codul e unic indiferent de scris si de spatii', async () => {
    const code = `CIM-${uuidv7().slice(-6)}`;

    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.products (id, code, name, uom)
            values (${uuidv7()}, ${code}, 'Ciment Portland 42.5R', 'kg')`,
      );
    });

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`insert into app.products (id, code, name, uom)
              values (${uuidv7()}, ${`  ${code.toLowerCase()}  `}, 'Ciment (duplicat)', 'kg')`,
        );
      }),
    );

    expect(sqlstate(error)).toBe('23505');
  });

  it('terenul citeste nomenclatorul, dar nu il modifica', async () => {
    const productId = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.products (id, code, name, uom)
            values (${productId}, ${`P-${productId.slice(-6)}`}, 'Cot PVC 110', 'buc')`,
      );
    });

    const visible = await withActor(fieldActor(), async (tx) => {
      const r = await tx.execute<{ name: string }>(
        sql`select name from app.products where id = ${productId}`,
      );
      return r.rows[0]?.name;
    });
    expect(visible).toBe('Cot PVC 110');

    const error = await rejection(
      withActor(fieldActor(), async (tx) => {
        await tx.execute(sql`update app.products set name = 'furat' where id = ${productId}`);
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });

  it('modificarea unui produs ajunge in audit, cu motiv', async () => {
    const productId = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.products (id, code, name, uom)
            values (${productId}, ${`A-${productId.slice(-6)}`}, 'Nume vechi', 'buc')`,
      );
    });

    await withActor(officeActor('corectie de nomenclator'), async (tx) => {
      await tx.execute(sql`update app.products set name = 'Nume nou' where id = ${productId}`);
    });

    const entry = await withActor(officeActor(), async (tx) => {
      const r = await tx.execute<{
        operation: string;
        changed: Record<string, unknown>;
        reason: string;
      }>(
        // `table_name` e scris cu schema: trigger-ul din 0007 il compune ca
        // `format('%s.%s', tg_table_schema, tg_table_name)`. Testul cauta
        // 'products' de la pasul 03 incoace, deci nu gasea nimic niciodata.
        sql`select operation, changed, reason from audit.entries
            where table_name = 'app.products' and record_id = ${productId} and operation = 'update'`,
      );
      return r.rows[0];
    });

    expect(entry?.operation).toBe('update');
    expect(Object.keys(entry?.changed ?? {})).toEqual(['name']);
    expect(entry?.reason).toBe('corectie de nomenclator');
  });
});
