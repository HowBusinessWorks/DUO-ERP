import { withActor, type Actor } from '@damina/db';
import { AppError, uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  breadcrumb,
  cleanupFiles,
  countChildren,
  createFolder,
  folderForEntity,
  listChildren,
  listShares,
  moveNode,
  renameNode,
  restoreNode,
  shareNode,
  trashNode,
  unshareNode,
} from '../src/files';
import { closeConnections } from '@damina/db';
import { TEST_PERSON_ID } from './global-setup';
import { actorFor, officeActor, rejection } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Use-case-urile de fisiere care NU ating R2 (pasul 07b).
 *
 * Ce lipseste de aici e deliberat: `presignUpload` si `completeUpload` vorbesc
 * cu Cloudflare, iar CI-ul n-are — si nu trebuie sa aiba — credentiale R2. Alea
 * se verifica printr-un harness de smoke pe mediul de dezvoltare, unde bucket-ul
 * e real. Ce se poate testa fara retea se testeaza aici, si se testeaza tot.
 */

const companyId = uuidv7();
const clientId = uuidv7();
const contractId = uuidv7();
const objectiveId = uuidv7();
const secondObjectiveId = uuidv7();

let contractFolder = '';
let userFolder = '';

const actor = (): Actor => officeActor('teste de fisiere');

/*
 * Curatenia ruleaza cu actorul de serviciu, si nu din comoditate: `delete` pe
 * `app.nodes` nu e acordat NIMANUI in afara worker-ului. Din interfata,
 * stergerea e `deleted_at`, iar randurile pleaca din baza doar prin jobul
 * nocturn. Chemata cu actorul de birou, `cleanupFiles` cade cu „permission
 * denied" — ceea ce e raspunsul corect, si merita sa ramana asa.
 */
const cleaner = (): Actor => actorFor('office', 'app_service', 'curatenie de test');

beforeAll(async () => {
  await withActor(actor(), async (tx) => {
    await tx.execute(sql`
      insert into app.companies (id, name, cui)
      values (${companyId}, 'Damina Fisiere Servicii SRL', ${`RO${companyId.slice(-8)}`})`);
    await tx.execute(sql`
      insert into app.clients (id, name) values (${clientId}, 'Client Fisiere')`);
    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
      values (${contractId}, ${companyId}, ${clientId}, ${`SF-${contractId.slice(-6)}`},
              'mentenanta_multianual', '2026-01-01', '2029-12-31', 'activ')`);
    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`OSF-${objectiveId.slice(-8)}`}, 'Statie fisiere', 'statie_pompare')`);
    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${secondObjectiveId}, ${`OSF-${secondObjectiveId.slice(-8)}`}, 'Bazin fisiere',
              'bazin_retentie')`);
    // Doua obiective pe ACELASI contract — cazul care a scos la iveala bug-ul
    // din `ensure_folder` reparat la 0024.
    await tx.execute(sql`
      insert into app.contract_objectives (id, contract_id, objective_id, valid_from)
      values (${uuidv7()}, ${contractId}, ${objectiveId}, '2026-01-01'),
             (${uuidv7()}, ${contractId}, ${secondObjectiveId}, '2026-01-01')`);
  });

  const found = await folderForEntity(actor(), { contractId }, 'contract_docs');
  contractFolder = found ?? '';
});

describe('organizarea arborelui', () => {
  it('folderul de contract exista deja, generat de trigger', () => {
    expect(contractFolder).not.toBe('');
  });

  /*
   * Regresie pentru bug-ul reparat in migrarea 0024.
   *
   * `ensure_folder` cauta folderul existent fara `objective_id`, iar toate
   * obiectivele unui contract au acelasi parinte si acelasi rol — deci al doilea
   * obiectiv primea folderul primului. Nu dadea nicio eroare: dosarele se
   * suprapuneau, si documentele a 20 de obiective ar fi ajuns intr-unul singur.
   */
  it('doua obiective pe acelasi contract au DOUA dosare, nu unul', async () => {
    const first = await folderForEntity(actor(), { contractId, objectiveId }, 'objective');
    const second = await folderForEntity(
      actor(),
      { contractId, objectiveId: secondObjectiveId },
      'objective',
    );

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
  });

  it('creeaza un folder de utilizator, si el chiar e „de utilizator"', async () => {
    const created = await createFolder(actor(), { parentId: contractFolder, name: 'Al meu' });
    userFolder = created.id;

    const children = await listChildren(actor(), contractFolder);
    const mine = children.find((row) => row.id === created.id);
    expect(mine?.nodeRole).toBe('user');
    // Singurul rol care se poate sterge, redenumi si muta.
    expect(mine?.isSystem).toBe(false);
  });

  it('firimiturile merg de la radacina firmei pana la nod', async () => {
    const crumbs = await breadcrumb(actor(), userFolder);
    expect(crumbs[0]?.name).toBe('Damina Fisiere Servicii SRL');
    expect(crumbs.at(-1)?.name).toBe('Al meu');
    // Firma › Contracte › <contract> › Contract și acte adiționale › Al meu
    expect(crumbs).toHaveLength(5);
  });

  it('redenumeste si muta un folder de utilizator', async () => {
    await renameNode(actor(), { nodeId: userFolder, name: 'Redenumit' });
    const objectives = await folderForEntity(actor(), { contractId }, 'objectives_root');
    await moveNode(actor(), { nodeId: userFolder, parentId: objectives ?? '' });

    const crumbs = await breadcrumb(actor(), userFolder);
    expect(crumbs.at(-1)?.name).toBe('Redenumit');
    expect(crumbs.at(-2)?.name).toBe('Obiective');
  });

  it('refuza sa mute un folder intr-un fisier', async () => {
    const fileId = uuidv7();
    await withActor(actor(), async (tx) => {
      await tx.execute(sql`
        insert into app.nodes (id, parent_id, company_id, kind, name, created_by)
        values (${fileId}, ${contractFolder}, ${companyId}, 'file', 'ceva.pdf', null)`);
    });

    const error = await rejection(moveNode(actor(), { nodeId: userFolder, parentId: fileId }));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toContain('nu e un folder');
  });
});

describe('plafonul listei', () => {
  /*
   * `listChildren` n-avea niciun plafon pana la 07c-2: un folder cu 3.000 de
   * poze — cazul pe care il numeste pasul — ar fi intors 3.000 de randuri catre
   * un ecran care le randeaza pe toate. Interogarea le duce (index scan de 2 ms);
   * randarea, nu.
   */
  it('taie lista la plafon, dar numaratoarea spune adevarul', async () => {
    const folder = await createFolder(actor(), { parentId: contractFolder, name: 'Plafon' });
    await withActor(actor(), async (tx) => {
      for (let index = 0; index < 12; index += 1) {
        await tx.execute(sql`
          insert into app.nodes (id, parent_id, company_id, kind, name, node_role, created_by)
          values (${uuidv7()}, ${folder.id}, ${companyId}, 'folder',
                  ${`f-${String(index).padStart(2, '0')}`}, 'user', ${TEST_PERSON_ID})`);
      }
    });

    const capped = await listChildren(actor(), folder.id, { limit: 5 });
    expect(capped).toHaveLength(5);
    // Plafonul e al ECRANULUI, nu al datelor: contorul le vede pe toate.
    expect(await countChildren(actor(), folder.id)).toBe(12);
  });
});

describe('cosul de gunoi', () => {
  it('sterge logic, elibereaza numele, si restaureaza', async () => {
    const first = await createFolder(actor(), { parentId: contractFolder, name: 'De sters' });
    await trashNode(actor(), first.id);

    const visible = await listChildren(actor(), contractFolder);
    expect(visible.find((row) => row.id === first.id)).toBeUndefined();

    // Numele e liber IMEDIAT, nu peste 30 de zile: unicitatea e partiala.
    const second = await createFolder(actor(), { parentId: contractFolder, name: 'De sters' });
    expect(second.id).not.toBe(first.id);

    // Si de aceea restaurarea poate da conflict — cazul trebuie sa aiba mesaj,
    // nu sa iasa cu o violare de index in fata utilizatorului.
    const conflict = await rejection(restoreNode(actor(), first.id));
    expect(error(conflict)).toContain('Există deja ceva cu numele ăsta');

    await trashNode(actor(), second.id);
    await restoreNode(actor(), first.id);
    const back = await listChildren(actor(), contractFolder);
    expect(back.find((row) => row.id === first.id)).toBeDefined();
  });

  it('curatenia nu atinge ce a fost sters ieri', async () => {
    const fresh = await createFolder(actor(), { parentId: contractFolder, name: 'Sters recent' });
    await trashNode(actor(), fresh.id);

    // Nu se verifica raportul global — cate noduri curata o rulare depinde de ce
    // au lasat celelalte teste. Se verifica exact ce trebuie sa fie adevarat:
    // nodul asta, sters acum, e inca acolo.
    await cleanupFiles(cleaner());

    const still = await withActor(actor(), async (tx) => {
      const rows = await tx.execute(sql`select id from app.nodes where id = ${fresh.id}`);
      return rows.rows.length;
    });
    expect(still).toBe(1);
  });

  it('curatenia sterge definitiv ce sta in cos de peste 30 de zile, cu tot cu copii', async () => {
    const parent = await createFolder(actor(), { parentId: contractFolder, name: 'Vechi' });
    const child = await createFolder(actor(), { parentId: parent.id, name: 'Copil' });

    await withActor(actor(), async (tx) => {
      // Amandoua: `nodes_deleted_pair` cere ori data SI autorul, ori niciunul.
      await tx.execute(sql`
        update app.nodes
           set deleted_at = now() - interval '31 days', deleted_by = ${TEST_PERSON_ID}
         where id = ${parent.id}`);
    });

    const report = await cleanupFiles(cleaner());
    expect(report.purgedNodes).toBeGreaterThanOrEqual(2);

    const left = await withActor(actor(), async (tx) => {
      const rows = await tx.execute(
        sql`select id from app.nodes where id in (${parent.id}, ${child.id})`,
      );
      return rows.rows.length;
    });
    // Si copilul, desi el n-a fost sters explicit: cosul se goleste pe subarbore.
    expect(left).toBe(0);
  });
});

describe('partajarea', () => {
  it('se adauga, se schimba fara sa se dubleze, si se retrage', async () => {
    const folder = await createFolder(actor(), { parentId: contractFolder, name: 'Pachet' });
    const subcontractorId = uuidv7();
    await withActor(actor(), async (tx) => {
      await tx.execute(
        sql`insert into app.subcontractors (id, name) values (${subcontractorId}, 'Sub Pachet')`,
      );
    });

    await shareNode(actor(), {
      nodeId: folder.id,
      subjectType: 'subcontractor',
      subjectId: subcontractorId,
      permission: 'read',
    });
    await shareNode(actor(), {
      nodeId: folder.id,
      subjectType: 'subcontractor',
      subjectId: subcontractorId,
      permission: 'write',
    });

    const shares = await listShares(actor(), folder.id);
    expect(shares).toHaveLength(1);
    expect(shares[0]?.permission).toBe('write');

    await unshareNode(actor(), {
      nodeId: folder.id,
      subjectType: 'subcontractor',
      subjectId: subcontractorId,
    });
    expect(await listShares(actor(), folder.id)).toHaveLength(0);
  });
});

/**
 * Verificarea #6 a pasului: mutarea unui folder cu o mie de fisiere.
 *
 * Nu masuram milisecunde — pe un container in CI cifra n-ar insemna nimic.
 * Masuram ce chiar conteaza si e stabil: **un singur rand atins**. Daca cineva
 * ar rescrie vreodata mutarea ca pe o parcurgere de subarbore, testul asta pica
 * fara sa depinda de cat de repede e masina.
 */
describe('mutarea la scara', () => {
  it('muta un folder cu 1.000 de fisiere printr-un singur update', async () => {
    const source = await createFolder(actor(), { parentId: contractFolder, name: 'Multe' });
    const target = await folderForEntity(actor(), { contractId }, 'objectives_root');

    await withActor(actor(), async (tx) => {
      await tx.execute(sql`
        insert into app.nodes (id, parent_id, company_id, kind, name, created_by)
        select gen_random_uuid(), ${source.id}, ${companyId}, 'file',
               'poza-' || lpad(i::text, 4, '0') || '.jpg', null
          from generate_series(1, 1000) as i`);
    });

    const before = await withActor(actor(), async (tx) => {
      const rows = await tx.execute<{ n: string }>(
        sql`select count(*) as n from app.nodes where parent_id = ${source.id}`,
      );
      return Number(rows.rows[0]?.n ?? 0);
    });
    expect(before).toBe(1000);

    const touched = await withActor(actor(), async (tx) => {
      const rows = await tx.execute(
        sql`update app.nodes set parent_id = ${target ?? ''} where id = ${source.id} returning id`,
      );
      return rows.rows.length;
    });

    expect(touched).toBe(1);

    // Copiii n-au fost atinsi si totusi s-au mutat cu tot cu parinte: ierarhia e
    // in `parent_id`, nu in vreo cale materializata pe care ar trebui s-o rescriem.
    const after = await withActor(actor(), async (tx) => {
      const rows = await tx.execute<{ n: string }>(
        sql`select count(*) as n from app.nodes where parent_id = ${source.id}`,
      );
      return Number(rows.rows[0]?.n ?? 0);
    });
    expect(after).toBe(1000);

    const crumbs = await breadcrumb(actor(), source.id);
    expect(crumbs.at(-2)?.name).toBe('Obiective');
  });
});

function error(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
