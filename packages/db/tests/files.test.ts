import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeConnections, withActor, type ActorTx } from '../src/index';
import { SQLSTATE, actorFor, fieldActor, officeActor, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Arborele de fisiere, partea pe care o garanteaza BAZA (pasul 07a).
 *
 * Aproape tot ce e aici verifica acelasi lucru dintr-un alt unghi: **arborele nu
 * se construieste din aplicatie**. Se construieste din triggere, la evenimentul
 * de business, in aceeasi tranzactie — deci un import, un script sau o ruta noua
 * il capata fara sa stie ca exista. Testele care par redundante („si dupa
 * promovare?", „si dupa rutare?") sunt exact cazurile in care o implementare in
 * aplicatie s-ar fi rupt.
 */

const companyId = uuidv7();
const clientId = uuidv7();
const contractId = uuidv7();
const objectiveId = uuidv7();
const pmId = uuidv7();
const workerId = uuidv7();
const strangerId = uuidv7();
const subcontractorId = uuidv7();
const subPersonId = uuidv7();

let linkId = '';

beforeAll(async () => {
  await withActor(officeActor('pregatire fixtura arbore'), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name, cui) values (${companyId}, 'Damina Fisiere SRL', ${`RO${companyId.slice(-8)}`})`,
    );
    await tx.execute(
      sql`insert into app.clients (id, name) values (${clientId}, 'Apa Nova Fisiere')`,
    );
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
      values (${contractId}, ${companyId}, ${clientId}, ${`FS-${contractId.slice(-6)}`},
              'mentenanta_multianual', '2026-01-01', '2029-12-31', 'activ')`);
    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`OBF-${objectiveId.slice(-8)}`}, 'Bazin de retentie 7', 'bazin')`);
    await tx.execute(sql`
      insert into app.subcontractors (id, name) values (${subcontractorId}, 'Subantreprenor A')`);
    await tx.execute(sql`
      insert into app.persons (id, persona, category, full_name)
      values (${pmId}, 'office', 'angajat', 'PM fisiere'),
             (${workerId}, 'field', 'sef_santier', 'Sef de santier fisiere'),
             (${strangerId}, 'field', 'sef_santier', 'Sef neasignat')`);
    await tx.execute(sql`
      insert into app.persons (id, persona, category, full_name, subcontractor_id)
      values (${subPersonId}, 'subcontractor', 'subcontractant', 'Om de la A', ${subcontractorId})`);
    // Asignarea pe unitate cere autorizatie SSM valabila (migrarea 0016).
    await tx.execute(sql`
      insert into app.person_authorizations (id, person_id, kind, issued_at, expires_at)
      values (${uuidv7()}, ${workerId}, 'ssm', '2026-01-01', '2027-12-31')`);

    const link = uuidv7();
    await tx.execute(sql`
      insert into app.contract_objectives (id, contract_id, objective_id, valid_from)
      values (${link}, ${contractId}, ${objectiveId}, '2026-01-01')`);
    linkId = link;
  });
});

/** Nodul de sistem cu rolul cerut, cautat asa cum cere Anexa E.3: pe ROL. */
async function nodeByRole(
  tx: ActorTx,
  role: string,
  scope: { workUnitId?: string; contractId?: string; stageId?: string; parentId?: string } = {},
): Promise<{ id: string; name: string; parent_id: string | null } | undefined> {
  const rows = await tx.execute(sql`
    select id, name, parent_id from app.nodes
     where node_role = ${role}::app.node_role
       and deleted_at is null
       and (${scope.workUnitId ?? null}::uuid is null or work_unit_id = ${scope.workUnitId ?? null}::uuid)
       and (${scope.contractId ?? null}::uuid is null or contract_id = ${scope.contractId ?? null}::uuid)
       and (${scope.stageId ?? null}::uuid is null or stage_id = ${scope.stageId ?? null}::uuid)
       and (${scope.parentId ?? null}::uuid is null or parent_id = ${scope.parentId ?? null}::uuid)
       and company_id = ${companyId}`);
  return rows.rows[0] as { id: string; name: string; parent_id: string | null } | undefined;
}

async function childRoles(tx: ActorTx, parentId: string): Promise<string[]> {
  const rows = await tx.execute(sql`
    select node_role::text as role from app.nodes
     where parent_id = ${parentId} and deleted_at is null order by 1`);
  return rows.rows.map((row) => (row as { role: string }).role);
}

interface WorkUnitOptions {
  readonly type?: 'inspectie' | 'interventie' | 'lucrare';
  readonly linkId?: string | null;
}

async function makeWorkUnit(tx: ActorTx, options: WorkUnitOptions = {}): Promise<string> {
  const id = uuidv7();
  await tx.execute(sql`
    insert into app.work_units
      (id, company_id, code, type, name, objective_id, contract_objective_id,
       status, responsible_person_id, starts_on)
    values (
      ${id}, ${companyId}, ${`W-${id.slice(-10)}`}, ${options.type ?? 'lucrare'},
      'Inlocuire pompa', ${objectiveId},
      ${options.linkId === undefined ? linkId : options.linkId},
      'planificata', ${pmId}, '2026-08-03')`);
  return id;
}

describe('arborele se genereaza singur', () => {
  it('firma primeste radacina, Contracte si Activitate', async () => {
    await withActor(officeActor(), async (tx) => {
      const root = await nodeByRole(tx, 'root_company');
      expect(root?.name).toBe('Damina Fisiere SRL');
      expect(root?.parent_id).toBeNull();
      expect(await childRoles(tx, root?.id ?? '')).toStrictEqual([
        'activity_root',
        'contracts_root',
      ]);
    });
  });

  it('contractul primeste folderul lui si cele trei subfoldere fixe', async () => {
    await withActor(officeActor(), async (tx) => {
      const node = await nodeByRole(tx, 'contract', { contractId });
      // Numele e „cod · client": `app.contracts` n-are coloana `name`.
      expect(node?.name).toContain(' · Apa Nova Fisiere');
      expect(await childRoles(tx, node?.id ?? '')).toStrictEqual([
        'activity_root',
        'contract_docs',
        'objectives_root',
      ]);
    });
  });

  it('legarea obiectivului de contract ii face folderul, si il si inregistreaza', async () => {
    await withActor(officeActor(), async (tx) => {
      const node = await nodeByRole(tx, 'objective', { contractId });
      expect(node?.name).toBe('Bazin de retentie 7');
      expect(await childRoles(tx, node?.id ?? '')).toStrictEqual([
        'objective_photos',
        'objective_tech_docs',
      ]);

      const link = await tx.execute(
        sql`select root_node_id from app.contract_objectives where id = ${linkId}`,
      );
      expect((link.rows[0] as { root_node_id: string }).root_node_id).toBe(node?.id);
    });
  });

  it('inspectia primeste doar Fisa si Poze, sub folderul de luna al contractului', async () => {
    await withActor(officeActor(), async (tx) => {
      const workUnitId = await makeWorkUnit(tx, { type: 'inspectie' });
      const node = await nodeByRole(tx, 'work_unit', { workUnitId });
      expect(await childRoles(tx, node?.id ?? '')).toStrictEqual(['photos', 'sheet']);

      // Luna vine din `starts_on`, nu din data de creare a randului.
      const month = await tx.execute(
        sql`select name, contract_id from app.nodes where id = ${node?.parent_id ?? ''}`,
      );
      const row = month.rows[0] as { name: string; contract_id: string };
      expect(row.name).toBe('2026-08');
      expect(row.contract_id).toBe(contractId);

      const stored = await tx.execute(
        sql`select root_node_id from app.work_units where id = ${workUnitId}`,
      );
      expect((stored.rows[0] as { root_node_id: string }).root_node_id).toBe(node?.id);
    });
  });

  it('lucrarea primeste tot setul, inclusiv fazele fixe de poze', async () => {
    await withActor(officeActor(), async (tx) => {
      const workUnitId = await makeWorkUnit(tx, { type: 'lucrare' });
      const node = await nodeByRole(tx, 'work_unit', { workUnitId });
      expect(await childRoles(tx, node?.id ?? '')).toStrictEqual([
        'consumption_notes',
        'estimate',
        'invoices',
        'offers',
        'permits',
        'photos',
        'pv',
        'receptions',
        'sheet',
        'video',
      ]);

      const photos = await nodeByRole(tx, 'photos', { workUnitId });
      const phases = await tx.execute(sql`
        select name from app.nodes where parent_id = ${photos?.id ?? ''} order by name`);
      expect(phases.rows.map((r) => (r as { name: string }).name)).toStrictEqual([
        'După',
        'Înainte',
      ]);
    });
  });

  it('etapa isi adauga folderul de poze, si il redenumeste la reordonare', async () => {
    await withActor(officeActor(), async (tx) => {
      const workUnitId = await makeWorkUnit(tx, { type: 'lucrare' });
      const stageId = uuidv7();
      await tx.execute(sql`
        insert into app.work_stages (id, work_unit_id, position, name)
        values (${stageId}, ${workUnitId}, 1, 'Decopertare')`);

      const photos = await nodeByRole(tx, 'photos', { workUnitId });
      const phase = await nodeByRole(tx, 'photo_phase', { stageId });
      expect(phase?.name).toBe('Etapa 1');
      expect(phase?.parent_id).toBe(photos?.id);

      await tx.execute(sql`update app.work_stages set position = 4 where id = ${stageId}`);
      expect((await nodeByRole(tx, 'photo_phase', { stageId }))?.name).toBe('Etapa 4');
    });
  });
});

describe('ce misca arborele si ce nu', () => {
  /*
   * Verificarea #3 a pasului, si cea mai usor de gresit din tot pasul: o
   * implementare care ar „recrea structura de lucrare" ar produce un al doilea
   * folder, iar pozele facute cat era interventie ar ramane in primul.
   */
  it('promovarea interventiei in lucrare pastreaza acelasi nod si adauga subfoldere', async () => {
    await withActor(officeActor(), async (tx) => {
      const workUnitId = await makeWorkUnit(tx, { type: 'interventie' });
      const before = await nodeByRole(tx, 'work_unit', { workUnitId });
      expect(await childRoles(tx, before?.id ?? '')).toStrictEqual([
        'consumption_notes',
        'photos',
        'sheet',
      ]);

      await tx.execute(sql`update app.work_units set type = 'lucrare' where id = ${workUnitId}`);

      const after = await nodeByRole(tx, 'work_unit', { workUnitId });
      expect(after?.id).toBe(before?.id);
      expect(await childRoles(tx, after?.id ?? '')).toContain('pv');
      expect(await childRoles(tx, after?.id ?? '')).toContain('estimate');
    });
  });

  it('unitatea fara contract sta sub Activitate al firmei, si se muta la rutare', async () => {
    await withActor(officeActor(), async (tx) => {
      const workUnitId = await makeWorkUnit(tx, { type: 'inspectie', linkId: null });
      const before = await nodeByRole(tx, 'work_unit', { workUnitId });
      const monthBefore = await tx.execute(
        sql`select contract_id from app.nodes where id = ${before?.parent_id ?? ''}`,
      );
      expect((monthBefore.rows[0] as { contract_id: string | null }).contract_id).toBeNull();

      await tx.execute(
        sql`update app.work_units set contract_objective_id = ${linkId} where id = ${workUnitId}`,
      );

      const after = await nodeByRole(tx, 'work_unit', { workUnitId });
      // Acelasi nod, alt parinte: mutarea e un `update parent_id`, nu o copiere.
      expect(after?.id).toBe(before?.id);
      expect(after?.parent_id).not.toBe(before?.parent_id);
      const monthAfter = await tx.execute(
        sql`select contract_id from app.nodes where id = ${after?.parent_id ?? ''}`,
      );
      expect((monthAfter.rows[0] as { contract_id: string }).contract_id).toBe(contractId);
    });
  });

  /*
   * Regula 8 din pas. Arborele e construit pe analitica „folosit"; finantarea e
   * „descarcat". Daca folderul s-ar muta odata cu banii, istoricul obiectivului
   * s-ar rupe tacut — si s-ar observa peste luni.
   */
  it('finantarea nu atinge arborele', async () => {
    await withActor(officeActor('finantare de test'), async (tx) => {
      const workUnitId = await makeWorkUnit(tx, { type: 'lucrare' });
      const before = await nodeByRole(tx, 'work_unit', { workUnitId });

      const componentId = uuidv7();
      const periodId = uuidv7();
      await tx.execute(sql`
        insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
        values (${componentId}, ${contractId}, 'delta', ${`Delta ${componentId.slice(-6)}`}, 'lunar', true)`);
      await tx.execute(sql`
        insert into app.periods (id, company_id, year, month)
        values (${periodId}, ${companyId}, 2026, 8)
        on conflict do nothing`);
      const period = await tx.execute(
        sql`select id from app.periods where company_id = ${companyId} and year = 2026 and month = 8`,
      );
      await tx.execute(sql`
        insert into app.funding_allocations
          (id, work_unit_id, contract_id, component_id, period_id, allocated_amount, reason, created_by)
        values (${uuidv7()}, ${workUnitId}, ${contractId}, ${componentId},
                ${(period.rows[0] as { id: string }).id}, 5000.00, 'finantare de test', ${pmId})`);

      const after = await nodeByRole(tx, 'work_unit', { workUnitId });
      expect(after?.id).toBe(before?.id);
      expect(after?.parent_id).toBe(before?.parent_id);
    });
  });
});

describe('folderele de sistem nu se ating', () => {
  it('nu se redenumesc, nu se muta, nu se sterg', async () => {
    const workUnitId = await withActor(officeActor(), async (tx) => makeWorkUnit(tx));
    const photosId = await withActor(
      officeActor(),
      async (tx) => (await nodeByRole(tx, 'photos', { workUnitId }))?.id ?? '',
    );

    // Tinta mutarii e ALT folder decat parintele actual: „muta unde esti deja"
    // nu schimba nimic, deci nici n-ar declansa guard-ul, si testul ar trece
    // fara sa fi verificat nimic.
    const sheetId = await withActor(
      officeActor(),
      async (tx) => (await nodeByRole(tx, 'sheet', { workUnitId }))?.id ?? '',
    );

    for (const [what, statement] of [
      ['redenumire', sql`update app.nodes set name = 'Pozele mele' where id = ${photosId}`],
      ['mutare', sql`update app.nodes set parent_id = ${sheetId} where id = ${photosId}`],
      ['stergere logica', sql`update app.nodes set deleted_at = now(), deleted_by = ${pmId} where id = ${photosId}`],
    ] as const) {
      const error = await rejection(
        withActor(officeActor(), async (tx) => tx.execute(statement)),
      );
      expect(sqlstate(error), what).toBe(SQLSTATE.RESTRICT_VIOLATION);
    }
  });

  it('biroul n-are voie sa stearga fizic un nod — cosul e singura cale', async () => {
    const workUnitId = await withActor(officeActor(), async (tx) => makeWorkUnit(tx));
    const error = await rejection(
      withActor(officeActor(), async (tx) =>
        tx.execute(sql`delete from app.nodes where work_unit_id = ${workUnitId}`),
      ),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });
});

describe('numele in folder', () => {
  it('nu se poate dubla, dar redevine liber la stergere', async () => {
    const workUnitId = await withActor(officeActor(), async (tx) => makeWorkUnit(tx));
    const parentId = await withActor(
      officeActor(),
      async (tx) => (await nodeByRole(tx, 'photos', { workUnitId }))?.id ?? '',
    );

    const firstId = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.nodes (id, parent_id, company_id, kind, name, created_by)
        values (${firstId}, ${parentId}, ${companyId}, 'folder', 'Poze de la client', ${pmId})`);
    });

    const clash = await rejection(
      withActor(officeActor(), async (tx) =>
        tx.execute(sql`
          insert into app.nodes (id, parent_id, company_id, kind, name, created_by)
          values (${uuidv7()}, ${parentId}, ${companyId}, 'folder', 'Poze de la client', ${pmId})`),
      ),
    );
    expect(sqlstate(clash)).toBe(SQLSTATE.UNIQUE_VIOLATION);

    // Stergerea e logica, si totusi elibereaza numele imediat: unicitatea e
    // partiala. Altfel, cine sterge din greseala nu poate recrea pana la
    // golirea cosului — adica 30 de zile.
    await withActor(officeActor(), async (tx) => {
      await tx.execute(
        sql`update app.nodes set deleted_at = now(), deleted_by = ${pmId} where id = ${firstId}`,
      );
      await tx.execute(sql`
        insert into app.nodes (id, parent_id, company_id, kind, name, created_by)
        values (${uuidv7()}, ${parentId}, ${companyId}, 'folder', 'Poze de la client', ${pmId})`);
    });
  });

  it('un folder nu poate deveni propriul lui parinte', async () => {
    const workUnitId = await withActor(officeActor(), async (tx) => makeWorkUnit(tx));
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        const root = await nodeByRole(tx, 'work_unit', { workUnitId });
        const photos = await nodeByRole(tx, 'photos', { workUnitId });
        const mine = uuidv7();
        await tx.execute(sql`
          insert into app.nodes (id, parent_id, company_id, kind, name, created_by)
          values (${mine}, ${photos?.id ?? ''}, ${companyId}, 'folder', 'Al meu', ${pmId})`);
        await tx.execute(
          sql`update app.nodes set parent_id = ${mine} where id = ${root?.id ?? ''}`,
        );
      }),
    );
    // Nodul unitatii e de sistem, deci cade pe guard-ul de mutare inainte sa
    // ajunga la cel de ciclu — si asta e ordinea corecta.
    expect(sqlstate(error)).toBe(SQLSTATE.RESTRICT_VIOLATION);
  });
});

describe('cine vede ce', () => {
  it('terenul vede folderele unitatilor lui si nu le vede pe ale altora', async () => {
    const mine = await withActor(officeActor(), async (tx) => makeWorkUnit(tx));
    const theirs = await withActor(officeActor(), async (tx) => makeWorkUnit(tx));
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.work_unit_assignments (id, work_unit_id, person_id, role)
        values (${uuidv7()}, ${mine}, ${workerId}, 'sef_santier')`);
    });

    await withActor(fieldActor({ personId: workerId, companyIds: [companyId] }), async (tx) => {
      const visible = await tx.execute(sql`
        select work_unit_id from app.nodes
         where work_unit_id in (${mine}, ${theirs}) group by 1`);
      expect(visible.rows.map((r) => (r as { work_unit_id: string }).work_unit_id)).toStrictEqual([
        mine,
      ]);
    });
  });

  /*
   * Verificarile #14 si #15. Subcontractantul NU mosteneste nimic: nici de la
   * contract, nici de la lucrarea pe care o executa. Vede exclusiv ce i s-a dat
   * explicit — si tot ce e sub acel nod.
   */
  it('subcontractantul nu vede nimic fara partajare, si vede subarborele cu ea', async () => {
    const workUnitId = await withActor(officeActor(), async (tx) => makeWorkUnit(tx));
    const { rootId, photosId } = await withActor(officeActor(), async (tx) => ({
      rootId: (await nodeByRole(tx, 'work_unit', { workUnitId }))?.id ?? '',
      photosId: (await nodeByRole(tx, 'photos', { workUnitId }))?.id ?? '',
    }));

    const sub = actorFor('subcontractor', 'app_subcontractor', {
      personId: subPersonId,
      companyIds: [],
    });

    await withActor(sub, async (tx) => {
      const rows = await tx.execute(
        sql`select id from app.nodes where id in (${rootId}, ${photosId})`,
      );
      expect(rows.rows).toHaveLength(0);
    });

    await withActor(officeActor('pachet pentru subantreprenor'), async (tx) => {
      await tx.execute(sql`
        insert into app.node_shares (node_id, subject_type, subject_id, permission, granted_by)
        values (${rootId}, 'subcontractor', ${subcontractorId}, 'read', ${pmId})`);
    });

    await withActor(sub, async (tx) => {
      const rows = await tx.execute(
        sql`select id from app.nodes where id in (${rootId}, ${photosId}) order by id`,
      );
      // Si nodul partajat, si copilul lui: partajarea se mosteneste in jos.
      expect(rows.rows).toHaveLength(2);
    });
  });

  it('partajarea de citire nu da si drept de scriere', async () => {
    const workUnitId = await withActor(officeActor(), async (tx) => makeWorkUnit(tx));
    const rootId = await withActor(
      officeActor(),
      async (tx) => (await nodeByRole(tx, 'work_unit', { workUnitId }))?.id ?? '',
    );
    await withActor(officeActor('pachet de citire'), async (tx) => {
      await tx.execute(sql`
        insert into app.node_shares (node_id, subject_type, subject_id, permission, granted_by)
        values (${rootId}, 'subcontractor', ${subcontractorId}, 'read', ${pmId})`);
    });

    const sub = actorFor('subcontractor', 'app_subcontractor', {
      personId: subPersonId,
      companyIds: [],
    });
    const error = await rejection(
      withActor(sub, async (tx) =>
        tx.execute(sql`
          insert into app.nodes (id, parent_id, company_id, kind, name, created_by)
          values (${uuidv7()}, ${rootId}, ${companyId}, 'folder', 'Ce urc eu', ${subPersonId})`),
      ),
    );
    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });
});
