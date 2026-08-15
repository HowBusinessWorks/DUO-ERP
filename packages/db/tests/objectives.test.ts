import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor, type ActorTx } from '../src/index';
import { SQLSTATE, fieldActor, officeActor, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

async function makeObjective(tx: ActorTx, kind = 'statie_pompare'): Promise<string> {
  const id = uuidv7();
  await tx.execute(sql`
    insert into app.objectives (id, code, name, kind)
    values (${id}, ${`OB-${id.slice(-8)}`}, ${`Obiectiv ${id.slice(-4)}`}, ${kind})`);
  return id;
}

async function makeContract(tx: ActorTx): Promise<string> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const contractId = uuidv7();
  const tag = contractId.slice(-8);

  await tx.execute(sql`insert into app.companies (id, name) values (${companyId}, ${`F ${tag}`})`);
  await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, ${`C ${tag}`})`);
  await tx.execute(sql`
    insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
    values (${contractId}, ${companyId}, ${clientId}, ${`K-${tag}`},
            'mentenanta_multianual', '2026-01-01', '2029-12-31', 'activ')`);
  return contractId;
}

describe('obiective — nomenclator comun', () => {
  it('nu au coloana company_id, intentionat (regula 4)', async () => {
    const columns = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(sql`
        select column_name from information_schema.columns
         where table_schema = 'app' and table_name = 'objectives'`);
      return (result.rows as { column_name: string }[]).map((row) => row.column_name);
    });

    expect(columns).not.toContain('company_id');
    expect(columns).toContain('geo_lat');
  });

  it('codul e unic indiferent de scris', async () => {
    const code = `SP-${uuidv7().slice(-6)}`;

    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.objectives (id, code, name, kind)
            values (${uuidv7()}, ${code}, 'Statia 14', 'statie_pompare')`,
      );
    });

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`insert into app.objectives (id, code, name, kind)
              values (${uuidv7()}, ${code.toLowerCase()}, 'statia 14', 'statie_pompare')`,
        );
      }),
    );
    expect(sqlstate(error)).toBe('23505');
  });

  it('o coordonata singura e refuzata — un pin are nevoie de amandoua', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          insert into app.objectives (id, code, name, kind, geo_lat)
          values (${uuidv7()}, ${`GEO-${uuidv7().slice(-6)}`}, 'Fara longitudine', 'bazin', 44.43)`);
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('coordonatele in afara intervalului sunt refuzate', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          insert into app.objectives (id, code, name, kind, geo_lat, geo_lng)
          values (${uuidv7()}, ${`GEO-${uuidv7().slice(-6)}`}, 'Undeva', 'bazin', 91.0, 26.1)`);
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('terenul citeste obiectivele — nu poarta bani', async () => {
    const objectiveId = await withActor(officeActor(), (tx) => makeObjective(tx));
    const rows = await withActor(fieldActor(), async (tx) => {
      const result = await tx.execute(sql`select * from app.objectives where id = ${objectiveId}`);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });
});

describe('legatura contract ↔ obiectiv', () => {
  // Verificarea #10.
  it('doua legaturi suprapuse pe ACELASI contract sunt refuzate', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const contractId = await makeContract(tx);
        const objectiveId = await makeObjective(tx);

        await tx.execute(sql`
          insert into app.contract_objectives (id, contract_id, objective_id, valid_from, valid_to)
          values (${uuidv7()}, ${contractId}, ${objectiveId}, '2026-01-01', '2027-01-01')`);
        await tx.execute(sql`
          insert into app.contract_objectives (id, contract_id, objective_id, valid_from, valid_to)
          values (${uuidv7()}, ${contractId}, ${objectiveId}, '2026-06-01', null)`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.EXCLUSION_VIOLATION);
  });

  it('reintrarea exact la data iesirii e permisa — intervalul e deschis la dreapta', async () => {
    const count = await withActor(officeActor(), async (tx) => {
      const contractId = await makeContract(tx);
      const objectiveId = await makeObjective(tx);

      await tx.execute(sql`
        insert into app.contract_objectives (id, contract_id, objective_id, valid_from, valid_to)
        values (${uuidv7()}, ${contractId}, ${objectiveId}, '2026-01-01', '2026-07-01')`);
      await tx.execute(sql`
        insert into app.contract_objectives (id, contract_id, objective_id, valid_from, valid_to)
        values (${uuidv7()}, ${contractId}, ${objectiveId}, '2026-07-01', null)`);

      const result = await tx.execute(sql`
        select count(*)::int as n from app.contract_objectives where contract_id = ${contractId}`);
      return (result.rows as { n: number }[])[0]?.n;
    });

    expect(count).toBe(2);
  });

  // Verificarea #11: acelasi obiectiv, doua contracte, simultan — cazul REAL.
  it('acelasi obiectiv la doua contracte in acelasi timp, cu profile diferite', async () => {
    const rows = await withActor(officeActor(), async (tx) => {
      const objectiveId = await makeObjective(tx);
      const first = await makeContract(tx);
      const second = await makeContract(tx);

      const lunar = uuidv7();
      const trimestrial = uuidv7();
      await tx.execute(
        sql`insert into app.inspection_profiles (id, name) values (${lunar}, ${`Lunar ${lunar.slice(-6)}`})`,
      );
      await tx.execute(
        sql`insert into app.inspection_profiles (id, name) values (${trimestrial}, ${`Trim ${trimestrial.slice(-6)}`})`,
      );

      await tx.execute(sql`
        insert into app.contract_objectives
          (id, contract_id, objective_id, valid_from, inspection_profile_id)
        values (${uuidv7()}, ${first}, ${objectiveId}, '2026-01-01', ${lunar})`);
      await tx.execute(sql`
        insert into app.contract_objectives
          (id, contract_id, objective_id, valid_from, inspection_profile_id)
        values (${uuidv7()}, ${second}, ${objectiveId}, '2026-01-01', ${trimestrial})`);

      const result = await tx.execute(sql`
        select p.id as profile_id from app.contract_objectives co
          join app.inspection_profiles p on p.id = co.inspection_profile_id
         where co.objective_id = ${objectiveId}`);
      return result.rows as { profile_id: string }[];
    });

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.profile_id)).size).toBe(2);
  });

  it('scoaterea unui obiectiv din contract cere motiv scris', async () => {
    const linkId = await withActor(officeActor(), async (tx) => {
      const contractId = await makeContract(tx);
      const objectiveId = await makeObjective(tx);
      const id = uuidv7();
      await tx.execute(sql`
        insert into app.contract_objectives (id, contract_id, objective_id, valid_from)
        values (${id}, ${contractId}, ${objectiveId}, '2026-01-01')`);
      return id;
    });

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`update app.contract_objectives set valid_to = '2026-09-01' where id = ${linkId}`,
        );
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);

    const ok = await withActor(officeActor('obiectivul trece pe contractul 4800'), async (tx) => {
      const result = await tx.execute(
        sql`update app.contract_objectives set valid_to = '2026-09-01'
             where id = ${linkId} returning valid_to`,
      );
      return result.rows as { valid_to: string }[];
    });
    expect(ok[0]?.valid_to).toBe('2026-09-01');
  });
});

describe('fise si profile de inspectie', () => {
  it('fisele sunt versionate: acelasi cod, versiuni diferite', async () => {
    const versions = await withActor(officeActor(), async (tx) => {
      const code = `FIS-${uuidv7().slice(-6)}`;
      for (const version of [1, 2]) {
        await tx.execute(sql`
          insert into app.checklists (id, code, name, version)
          values (${uuidv7()}, ${code}, ${`Fisa v${version}`}, ${version})`);
      }
      const result = await tx.execute(
        sql`select version from app.checklists where code = ${code} order by version`,
      );
      return (result.rows as { version: number }[]).map((row) => row.version);
    });

    expect(versions).toEqual([1, 2]);
  });

  it('aceeasi versiune de doua ori e refuzata', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const code = `FIS-${uuidv7().slice(-6)}`;
        for (let i = 0; i < 2; i += 1) {
          await tx.execute(sql`
            insert into app.checklists (id, code, name, version)
            values (${uuidv7()}, ${code}, 'Fisa', 1)`);
        }
      }),
    );
    expect(sqlstate(error)).toBe('23505');
  });

  it('frecventa unei fise in profil e intre 1 si 60 de luni', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const profileId = uuidv7();
        const checklistId = uuidv7();
        await tx.execute(
          sql`insert into app.inspection_profiles (id, name) values (${profileId}, ${`P ${profileId.slice(-6)}`})`,
        );
        await tx.execute(sql`
          insert into app.checklists (id, code, name) values (${checklistId}, ${`F-${checklistId.slice(-6)}`}, 'Fisa')`);
        await tx.execute(sql`
          insert into app.inspection_profile_items (id, profile_id, checklist_id, frequency_months)
          values (${uuidv7()}, ${profileId}, ${checklistId}, 0)`);
      }),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('punctele unei fise nu pot avea aceeasi pozitie', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const checklistId = uuidv7();
        await tx.execute(sql`
          insert into app.checklists (id, code, name) values (${checklistId}, ${`F-${checklistId.slice(-6)}`}, 'Fisa')`);
        for (let i = 0; i < 2; i += 1) {
          await tx.execute(sql`
            insert into app.checklist_items (id, checklist_id, position, text)
            values (${uuidv7()}, ${checklistId}, 1, 'Verifica pompa')`);
        }
      }),
    );
    expect(sqlstate(error)).toBe('23505');
  });
});
