import { closeConnections, withActor } from '../src/index';
import type { Actor } from '../src/index';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@damina/shared';
import { afterAll, describe, expect, it } from 'vitest';

const officeActor: Actor = {
  personId: uuidv7(),
  persona: 'office',
  pgRole: 'app_office',
  // `admin`: de la 0011, crearea unei firme e rezervata administratorului.
  claims: { office_roles: ['admin'] },
};

afterAll(async () => {
  await closeConnections();
});

/**
 * Codul SQLSTATE real al unei erori venite prin Drizzle.
 *
 * Drizzle imbraca erorile driverului intr-un `DrizzleQueryError` al carui mesaj
 * e doar "Failed query: ...", deci potrivirea pe text nu functioneaza. Codul din
 * `cause` e si mai bun decat textul original: nu depinde de `lc_messages`.
 */
function sqlstate(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code } = current as Error & { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
    current = current.cause;
  }
  return undefined;
}

/**
 * Enumerarile din PLAN_TEHNIC Anexa C.0, toate. Verificarea #4 din Pasul 01.
 *
 * Lista e exhaustiva, nu un subset: un enum in plus in baza pica testul la fel
 * ca unul lipsa. Cand un pas adauga tipuri noi, se adauga si aici.
 */
const EXPECTED_ENUMS = [
  'allocation_status',
  // adaugate in pasul 02a
  'audit_op',
  'numbered_document_type',
  // adaugat in pasul 03
  'alert_severity',
  'budget_cadence',
  'checklist_answer',
  'component_type',
  'contract_type',
  'cost_document_type',
  'cost_stage',
  'executor_type',
  'expense_type',
  'file_state',
  'finding_outcome',
  'geo_source',
  'location_type',
  'node_kind',
  'node_role',
  'office_role',
  'period_status',
  'persona',
  'person_category',
  'request_source',
  'request_status',
  'request_type',
  'routing_choice',
  'share_permission',
  'share_subject_type',
  'work_unit_status',
  'work_unit_type',
];

describe('schema', () => {
  // Verificarea #3 din Pasul 01.
  it('are schemele app, audit si jobs, iar public e gol', async () => {
    const { schemas, publicTables } = await withActor(officeActor, async (tx) => {
      const s = await tx.execute<{ nspname: string }>(
        sql`select nspname from pg_namespace where nspname in ('app','audit','jobs','public') order by nspname`,
      );
      const p = await tx.execute<{ count: string }>(
        sql`select count(*)::text as count from pg_tables where schemaname = 'public'`,
      );
      return { schemas: s.rows.map((r) => r.nspname), publicTables: p.rows[0]?.count };
    });

    expect(schemas).toEqual(['app', 'audit', 'jobs', 'public']);
    expect(publicTables).toBe('0');
  });

  // Verificarea #4 din Pasul 01.
  it('are toate tipurile enumerate din Anexa C.0', async () => {
    const found = await withActor(officeActor, async (tx) => {
      const result = await tx.execute<{ typname: string }>(
        sql`select typname from pg_type
            where typnamespace = 'app'::regnamespace and typtype = 'e'`,
      );
      return result.rows.map((r) => r.typname);
    });

    // Sortarea se face in JS, nu in SQL: `order by typname` depinde de colatia
    // bazei, iar aceea difera intre containerul de test si Supabase. In `C`,
    // "person_category" vine inaintea lui "persona"; in `en_US`, invers.
    expect([...found].sort()).toEqual([...EXPECTED_ENUMS].sort());
  });

  // Verificarea #5 din Pasul 01.
  it('are cele sase roluri de aplicatie', async () => {
    const roles = await withActor(officeActor, async (tx) => {
      const result = await tx.execute<{ rolname: string }>(
        sql`select rolname from pg_roles
            where rolname like 'app\\_%'
            order by rolname`,
      );
      return result.rows.map((r) => r.rolname);
    });

    expect(roles).toEqual([
      'app_client',
      'app_field',
      'app_office',
      'app_runtime',
      'app_service',
      'app_subcontractor',
    ]);
  });

  it('app_runtime nu mosteneste privilegiile persona fara SET ROLE', async () => {
    const inherits = await withActor(officeActor, async (tx) => {
      const result = await tx.execute<{ rolinherit: boolean }>(
        sql`select rolinherit from pg_roles where rolname = 'app_runtime'`,
      );
      return result.rows[0]?.rolinherit;
    });

    expect(inherits).toBe(false);
  });

  it('scrie si citeste o firma prin withActor', async () => {
    const id = uuidv7();
    const cui = `RO${String(Date.now()).slice(-8)}`;

    const name = await withActor(officeActor, async (tx) => {
      await tx.execute(
        sql`insert into app.companies (id, name, cui) values (${id}, ${'Damina Construct SRL'}, ${cui})`,
      );
      const result = await tx.execute<{ name: string }>(
        sql`select name from app.companies where id = ${id}`,
      );
      return result.rows[0]?.name;
    });

    expect(name).toBe('Damina Construct SRL');
  });

  it('app_field nu poate scrie in companies', async () => {
    const fieldActor: Actor = {
      personId: uuidv7(),
      persona: 'field',
      pgRole: 'app_field',
      claims: {},
    };

    const error = await withActor(fieldActor, async (tx) => {
      await tx.execute(
        sql`insert into app.companies (id, name) values (${uuidv7()}, 'Nu are voie')`,
      );
    }).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error, 'app_field a reusit sa scrie in app.companies').toBeInstanceOf(Error);
    // 42501 = insufficient_privilege. Verificam codul, nu mesajul, ca sa nu
    // trecem din greseala pe o alta eroare (de exemplu o constrangere incalcata).
    expect(sqlstate(error)).toBe('42501');
  });
});
