import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor } from '../src/index';
import { SQLSTATE, actorFor, fieldActor, officeActor, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Cele patru verificari blocante ale pasului 02b.
 *
 * Trei din ele (#1, #2, #3) nu verifica un caz, ci o REGULA peste toata schema:
 * se genereaza singure din `information_schema` si din cataloagele Postgres.
 * Consecinta e cea dorita — o tabela sau o coloana adaugata maine fara politica
 * si fara `revoke` pica build-ul, nu productia.
 */

/** Personele din afara biroului. `app_service` e worker-ul, nu un om. */
const OUTSIDE_OFFICE = [
  { persona: 'field', role: 'app_field' },
  { persona: 'subcontractor', role: 'app_subcontractor' },
  { persona: 'client', role: 'app_client' },
] as const;

const MONEY_PATTERN = '(price|pret|cost|amount|margin|salary)';

describe('#1 izolarea pretului, generata din schema', () => {
  it('nicio coloana de bani nu e vizibila in afara biroului', async () => {
    const leaks = await withActor(officeActor(), async (tx) => {
      // Produsul cartezian coloana × rol, exact ca in enuntul verificarii #1.
      // `has_column_privilege` cu `oid`/`attnum` raspunde si pentru drepturile
      // mostenite prin apartenenta la alt rol, nu doar pentru `grant`-ul direct.
      const result = await tx.execute<{ leak: string }>(sql`
        select format('%s.%s → %s', c.relname, a.attname, r.rolname) as leak
          from pg_class c
          join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          cross join (
            select rolname from pg_roles
             where rolname in ('app_field', 'app_subcontractor', 'app_client')
          ) r
         where c.relnamespace = 'app'::regnamespace
           and c.relkind = 'r'
           and a.attname ~ ${MONEY_PATTERN}
           and has_column_privilege(r.rolname, c.oid, a.attnum, 'select')
         order by 1`);
      return result.rows.map((row) => row.leak);
    });

    expect(leaks).toEqual([]);
  });

  it('exista macar o coloana de bani in schema — altfel testul de mai sus e gol', async () => {
    const count = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n
          from pg_class c
          join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         where c.relnamespace = 'app'::regnamespace and c.relkind = 'r'
           and a.attname ~ ${MONEY_PATTERN}`);
      return result.rows[0]?.n ?? 0;
    });

    // `hourly_salary`, `hourly_cost`, `cost_ceiling` — cel putin.
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it.each(OUTSIDE_OFFICE)('$persona chiar primeste 42501 pe o coloana de bani', async (who) => {
    const error = await rejection(
      withActor(actorFor(who.persona, who.role), async (tx) => {
        await tx.execute(sql`select hourly_cost from app.rate_cards limit 1`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });
});

describe('#2 RLS pe toata schema app', () => {
  it('nicio tabela din app fara row level security', async () => {
    const without = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ relname: string }>(sql`
        select relname from pg_class
         where relnamespace = 'app'::regnamespace and relkind = 'r'
           and not relrowsecurity
         order by relname`);
      return result.rows.map((row) => row.relname);
    });

    expect(without).toEqual([]);
  });

  it('si toate cu `force`, ca nici proprietarul sa nu treaca pe langa', async () => {
    const without = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ relname: string }>(sql`
        select relname from pg_class
         where relnamespace = 'app'::regnamespace and relkind = 'r'
           and not relforcerowsecurity
         order by relname`);
      return result.rows.map((row) => row.relname);
    });

    expect(without).toEqual([]);
  });
});

describe('#3 politici pe fiecare tabela cu RLS', () => {
  it('nicio tabela cu RLS activ si zero politici', async () => {
    const orphans = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ relname: string }>(sql`
        select c.relname from pg_class c
         where c.relnamespace = 'app'::regnamespace and c.relkind = 'r'
           and c.relrowsecurity
           and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
         order by 1`);
      return result.rows.map((row) => row.relname);
    });

    expect(orphans).toEqual([]);
  });
});

describe('#4 filtrarea de randuri pe firma', () => {
  it('app_field vede firma la care are acces si NU o vede pe cealalta', async () => {
    const mine = uuidv7();
    const theirs = uuidv7();

    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.companies (id, name) values (${mine}, ${`A ${mine.slice(-6)}`})`,
      );
      await tx.execute(
        sql`insert into app.companies (id, name) values (${theirs}, ${`B ${theirs.slice(-6)}`})`,
      );
    });

    const seen = await withActor(fieldActor({ companyIds: [mine] }), async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`select id from app.companies where id in (${mine}, ${theirs})`,
      );
      return result.rows.map((row) => row.id);
    });

    // Zero randuri pentru firma straina, NU eroare: un refuz ar spune ca firma
    // exista. Filtrarea de randuri nu are voie sa se simta.
    expect(seen).toEqual([mine]);
  });

  it('contractele altei firme nu exista pentru teren', async () => {
    const companyId = uuidv7();
    const clientId = uuidv7();
    const contractId = uuidv7();
    const tag = contractId.slice(-8);

    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`,
      );
      await tx.execute(
        sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`,
      );
      await tx.execute(sql`
        insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on)
        values (${contractId}, ${companyId}, ${clientId}, ${`R-${tag}`},
                'mentenanta_multianual', '2026-01-01', '2029-12-31')`);
    });

    const asStranger = await withActor(fieldActor({ companyIds: [uuidv7()] }), async (tx) => {
      const result = await tx.execute(
        sql`select code from app.contracts where id = ${contractId}`,
      );
      return result.rows;
    });
    expect(asStranger).toHaveLength(0);

    const asOwner = await withActor(fieldActor({ companyIds: [companyId] }), async (tx) => {
      const result = await tx.execute(
        sql`select code from app.contracts where id = ${contractId}`,
      );
      return result.rows;
    });
    expect(asOwner).toHaveLength(1);
  });
});

describe('izolarea subcontractant ↔ subcontractant', () => {
  it('un subcontractant se vede doar pe sine in nomenclator', async () => {
    const a = uuidv7();
    const b = uuidv7();
    const personId = uuidv7();

    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`insert into app.subcontractors (id, name) values (${a}, 'Alfa SRL')`);
      await tx.execute(sql`insert into app.subcontractors (id, name) values (${b}, 'Beta SRL')`);
      await tx.execute(sql`
        insert into app.persons (id, persona, category, full_name, subcontractor_id)
        values (${personId}, 'subcontractor', 'subcontractant', 'Om de la Alfa', ${a})`);
    });

    const seen = await withActor(
      actorFor('subcontractor', 'app_subcontractor', { personId }),
      async (tx) => {
        const result = await tx.execute<{ id: string }>(
          sql`select id from app.subcontractors where id in (${a}, ${b})`,
        );
        return result.rows.map((row) => row.id);
      },
    );

    // `subcontractor_id` nu e in claim-uri: functia il ia din `app.persons`,
    // unde `check`-ul din 0004 garanteaza ca persona si firma sunt consistente.
    expect(seen).toEqual([a]);
  });
});

describe('jurnalul de audit', () => {
  // Verificarea #19 din pas.
  it('un `financiar` nu poate citi jurnalul, un `admin` da', async () => {
    const financial = actorFor('office', 'app_office', { officeRoles: ['financiar'] });

    const asFinancial = await withActor(financial, async (tx) => {
      const result = await tx.execute(sql`select id from audit.entries limit 5`);
      return result.rows;
    });
    expect(asFinancial).toHaveLength(0);

    const asAdmin = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from audit.entries`,
      );
      return result.rows[0]?.n ?? 0;
    });
    expect(asAdmin).toBeGreaterThan(0);
  });
});
