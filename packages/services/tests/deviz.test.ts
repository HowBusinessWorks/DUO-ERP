import { closeConnections, withActor } from '@damina/db';
import { AppError, uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  addDevizCategory,
  addDevizLine,
  adoptAsInternal,
  checkDevizMapping,
  createDeviz,
  createNormedArticle,
  freezeClientDeviz,
  listNormedArticles,
  mapDevizLines,
  putNormedArticleIntoDeviz,
  readDeviz,
  saveAsNormedArticle,
  updateDevizLine,
  updateDevizMarkup,
} from '../src/deviz';
import { TEST_PERSON_ID } from './global-setup';
import { actorFor, officeActor, pgMessage, rejection } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Pasul 11a — verificarile 1-13 si 20, pe date reale.
 *
 * Regula casei care a platit de treisprezece ori: fiecare use-case se ruleaza
 * pe date reale, din rolul restrans, INAINTE sa existe ecranul. Aici rolul
 * restrans e `app_office` cu un rol de business fara drept financiar (`pm`) si
 * cu firmele din claim — plus `app_field` si `app_subcontractor`, care nu
 * trebuie sa poata citi absolut nimic.
 */

interface Ground {
  readonly companyId: string;
  readonly workUnitId: string;
}

async function ground(): Promise<Ground> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const objectiveId = uuidv7();
  const workUnitId = uuidv7();
  const tag = companyId.slice(-8);

  await withActor(officeActor('pregatire teren de test'), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`,
    );
    await tx.execute(
      sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`,
    );
    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`OB-${tag}`}, 'Stație de pompare', 'statie_pompare')`);
    await tx.execute(sql`
      insert into app.work_units (id, company_id, code, type, name, objective_id, status, responsible_person_id)
      values (${workUnitId}, ${companyId}, ${`L-${tag}`}, 'lucrare', ${`Lucrarea ${tag}`},
              ${objectiveId}, 'in_executie', ${TEST_PERSON_ID})`);
  });

  return { companyId, workUnitId };
}

/** Rolul restrans al pasului: PM, cu firmele lui, fara drept financiar. */
const pmActor = (companyIds: readonly string[], reason?: string) =>
  actorFor('office', 'app_office', reason, { office_roles: ['pm'], company_ids: companyIds });

async function clientDeviz(base: Ground): Promise<string> {
  const { id } = await createDeviz(pmActor([base.companyId]), {
    workUnitId: base.workUnitId,
    kind: 'client',
  });
  return id;
}

describe('#1 totalurile devizului', () => {
  it('3 categorii x 2 operatiuni x 4 pozitii: totalul da cu suma liniilor, la ban', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const devizId = await clientDeviz(base);

    let position = 0;
    let expected = 0;

    for (let c = 1; c <= 3; c += 1) {
      const { id: categoryId } = await addDevizCategory(actor, {
        devizId,
        name: `Categoria ${String(c)}`,
        position: c,
      });

      for (let o = 1; o <= 2; o += 1) {
        const { id: operationId } = await addDevizCategory(actor, {
          devizId,
          parentId: categoryId,
          name: `Operațiunea ${String(c)}.${String(o)}`,
          position: o,
        });

        for (let l = 1; l <= 4; l += 1) {
          position += 1;
          // Cantitati si preturi cu zecimale, ca rotunjirea sa aiba ce strica.
          const quantity = 1.25 * l;
          const unitPrice = 10.33 * o + c;
          expected += Math.round(quantity * unitPrice * 100) / 100;

          await addDevizLine(actor, {
            devizId,
            categoryId: operationId,
            position,
            name: `Poziția ${String(position)}`,
            uom: 'mp',
            quantity: quantity.toFixed(4),
            unitPrice: unitPrice.toFixed(2),
          });
        }
      }
    }

    const view = await readDeviz(actor, devizId);

    expect(view.lines).toHaveLength(24);
    expect(view.totals.direct).toBe(expected.toFixed(2));
    expect(view.totals.total).toBe(expected.toFixed(2));

    // Subtotalul unei categorii = suma celor doua operatiuni ale ei.
    const categories = view.totals.categories.filter((c) => c.parentId === null);
    expect(categories).toHaveLength(3);
    const sum = categories.reduce((acc, c) => acc + Number(c.direct), 0);
    expect(sum.toFixed(2)).toBe(expected.toFixed(2));
  });
});

describe('#2 si #3 indirectele si profitul', () => {
  it('8% si 12% se compun, in ordinea indirecte -> profit', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const devizId = await clientDeviz(base);

    await addDevizLine(actor, {
      devizId,
      position: 1,
      name: 'Poziție unică',
      uom: 'buc',
      quantity: '1',
      unitPrice: '100000',
    });

    await updateDevizMarkup(actor, { devizId, indirectPct: '0.08', profitPct: '0.12' });

    const view = await readDeviz(actor, devizId);
    expect(view.totals.indirect).toBe('8000.00');
    expect(view.totals.profit).toBe('12960.00');
    expect(view.totals.total).toBe('120960.00');
  });

  it('pe devizul intern, indirectele sunt refuzate de serviciu, cu mesaj in romana', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const { id: internId } = await createDeviz(actor, {
      workUnitId: base.workUnitId,
      kind: 'intern',
    });

    const error = await rejection(
      updateDevizMarkup(actor, { devizId: internId, indirectPct: '0.08', profitPct: '' }),
    );

    expect(AppError.is(error)).toBe(true);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify((error as AppError).payload)).toContain('cost direct');
  });

  it('si de check-ul din baza, cand cineva scrie direct in tabela', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const { id: internId } = await createDeviz(actor, {
      workUnitId: base.workUnitId,
      kind: 'intern',
    });

    const error = await rejection(
      withActor(actor, async (tx) => {
        await tx.execute(sql`update app.devize set indirect_pct = 0.08 where id = ${internId}`);
      }),
    );

    expect(pgMessage(error)).toContain('devize_intern_has_no_markup');
  });
});

describe('#4 preia ca deviz intern', () => {
  it('12 pozitii dau 12 linii interne si 12 mapari cu coeficient 1', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const devizId = await clientDeviz(base);

    const { id: categoryId } = await addDevizCategory(actor, {
      devizId,
      name: 'Structură',
      position: 1,
    });

    for (let i = 1; i <= 12; i += 1) {
      await addDevizLine(actor, {
        devizId,
        categoryId,
        position: i,
        name: `Poziția ${String(i)}`,
        uom: 'mp',
        quantity: '10',
        unitPrice: '25',
      });
    }

    const result = await adoptAsInternal(actor, { workUnitId: base.workUnitId });

    expect(result.lineCount).toBe(12);
    expect(result.mappingCount).toBe(12);

    const check = await checkDevizMapping(actor, base.workUnitId);
    expect(check.isComplete).toBe(true);

    // Costurile pornesc de la zero: pretul clientului contine profit, si copiat
    // in coloana de cost ar face marja sa arate ca zero, dar CALCULATA.
    const intern = await readDeviz(actor, result.devizId);
    expect(intern.totals.direct).toBe('0.00');
    expect(intern.lines).toHaveLength(12);
  });

  it('a doua preluare e refuzata, nu suprascrie', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const devizId = await clientDeviz(base);
    await addDevizLine(actor, {
      devizId,
      position: 1,
      name: 'Poziția 1',
      uom: 'mp',
      quantity: '1',
      unitPrice: '1',
    });

    await adoptAsInternal(actor, { workUnitId: base.workUnitId });
    const error = await rejection(adoptAsInternal(actor, { workUnitId: base.workUnitId }));

    expect((error as AppError).code).toBe('CONFLICT');
  });
});

describe('#5 si #6 maparea N:M', () => {
  it('o pozitie client sparta in trei, cu 0,5 / 0,3 / 0,2, e completa', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const clientId = await clientDeviz(base);
    const { id: internId } = await createDeviz(actor, {
      workUnitId: base.workUnitId,
      kind: 'intern',
    });

    const { id: clientLineId } = await addDevizLine(actor, {
      devizId: clientId,
      position: 1,
      name: 'Hidroizolație',
      uom: 'mp',
      quantity: '340',
      unitPrice: '55',
    });

    const internLineIds: string[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const { id } = await addDevizLine(actor, {
        devizId: internId,
        position: i,
        name: `Componenta ${String(i)}`,
        uom: 'mp',
        quantity: '340',
        materialCost: '10',
        laborCost: '5',
      });
      internLineIds.push(id);
    }

    await mapDevizLines(actor, {
      pairs: [
        { clientLineId, internLineId: internLineIds[0] ?? '', coefficient: '0.5' },
        { clientLineId, internLineId: internLineIds[1] ?? '', coefficient: '0.3' },
        { clientLineId, internLineId: internLineIds[2] ?? '', coefficient: '0.2' },
      ],
    });

    const check = await checkDevizMapping(actor, base.workUnitId);
    expect(check.isComplete).toBe(true);
    expect(check.coefficientProblems).toEqual([]);
  });

  it('o pozitie client nemapata se raporteaza, dar salvarea merge (regula 6)', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const clientId = await clientDeviz(base);

    const { id: mapped } = await addDevizLine(actor, {
      devizId: clientId,
      position: 1,
      name: 'Mapată',
      uom: 'mp',
      quantity: '1',
      unitPrice: '10',
    });
    await addDevizLine(actor, {
      devizId: clientId,
      position: 2,
      name: 'Nemapată',
      uom: 'mp',
      quantity: '1',
      unitPrice: '10',
    });

    const { id: internId } = await createDeviz(actor, {
      workUnitId: base.workUnitId,
      kind: 'intern',
    });
    const { id: internLineId } = await addDevizLine(actor, {
      devizId: internId,
      position: 1,
      name: 'Cost',
      uom: 'mp',
      quantity: '1',
      materialCost: '4',
    });

    await mapDevizLines(actor, {
      pairs: [{ clientLineId: mapped, internLineId, coefficient: '1' }],
    });

    const check = await checkDevizMapping(actor, base.workUnitId);
    expect(check.uncoveredClientLineIds).toHaveLength(1);
    expect(check.isComplete).toBe(false);

    // Salvarea merge mai departe: o mapare incompleta e stare de lucru normala.
    await expect(
      addDevizLine(actor, {
        devizId: clientId,
        position: 3,
        name: 'Încă una',
        uom: 'mp',
        quantity: '1',
        unitPrice: '10',
      }),
    ).resolves.toBeDefined();
  });
});

describe('#7 si #8 inghetarea', () => {
  it('modificarea de dupa inghet produce versiunea 2, iar versiunea 1 ramane cum era', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId], 'ofertă trimisă clientului');
    const devizId = await clientDeviz(base);

    const { id: lineId } = await addDevizLine(actor, {
      devizId,
      position: 1,
      name: 'Poziția 1',
      uom: 'mp',
      quantity: '100',
      unitPrice: '10',
    });

    const first = await freezeClientDeviz(actor, {
      devizId,
      reason: 'oferta trimisă clientului pe 19 august',
    });
    expect(first.version).toBe(1);
    expect(first.total).toBe('1000.00');

    await updateDevizLine(actor, { lineId, unitPrice: '12' });

    const second = await freezeClientDeviz(actor, {
      devizId,
      reason: 'client a cerut altă cantitate',
    });
    expect(second.version).toBe(2);
    expect(second.total).toBe('1200.00');

    const versions = await withActor(actor, async (tx) => {
      const result = await tx.execute<{ version: number; total: string }>(sql`
        select version, total from app.deviz_versions
         where deviz_id = ${devizId} order by version`);
      return result.rows;
    });

    expect(versions.map((v) => v.total)).toEqual(['1000.00', '1200.00']);
  });

  it('fara motiv scris, inghetarea e respinsa', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const devizId = await clientDeviz(base);
    await addDevizLine(actor, {
      devizId,
      position: 1,
      name: 'Poziția 1',
      uom: 'mp',
      quantity: '1',
      unitPrice: '1',
    });

    await expect(freezeClientDeviz(actor, { devizId, reason: '' })).rejects.toThrow();
  });

  it('devizul intern nu se ingheata', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const { id: internId } = await createDeviz(actor, {
      workUnitId: base.workUnitId,
      kind: 'intern',
    });

    const error = await rejection(
      freezeClientDeviz(actor, { devizId: internId, reason: 'de ce nu' }),
    );
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
  });
});

describe('#9 si #10 izolarea pretului', () => {
  it.each([
    ['field', 'app_field'] as const,
    ['subcontractor', 'app_subcontractor'] as const,
  ])('%s primeste 42501 pe app.deviz_lines, nu rand gol', async (persona, role) => {
    const error = await rejection(
      withActor(actorFor(persona, role), async (tx) => {
        await tx.execute(sql`select unit_price from app.deviz_lines limit 1`);
      }),
    );

    const code = (() => {
      let current: unknown = error;
      while (current instanceof Error) {
        const { code: c } = current as Error & { code?: unknown };
        if (typeof c === 'string') {
          return c;
        }
        current = current.cause;
      }
      return undefined;
    })();

    expect(code).toBe('42501');
  });
});

describe('#12, #13 si #16 biblioteca de articole normate', () => {
  it('un articol cu 3 componente, pus cu cantitatea 20, da 3 linii cu cantitatile inmultite', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const { id: internId } = await createDeviz(actor, {
      workUnitId: base.workUnitId,
      kind: 'intern',
    });

    const { id: articleId } = await createNormedArticle(actor, {
      companyId: base.companyId,
      code: `HZ-${base.companyId.slice(-6)}`,
      name: 'Hidroizolație bituminoasă',
      uom: 'mp',
      components: [
        { kind: 'material', position: 1, quantityPerUom: '2.4' },
        { kind: 'manopera', position: 2, quantityPerUom: '0.35', normHours: '0.35' },
        { kind: 'utilaj', position: 3, quantityPerUom: '0.1' },
      ],
    });

    const { lineIds } = await putNormedArticleIntoDeviz(actor, {
      devizId: internId,
      articleId,
      quantity: '20',
    });

    expect(lineIds).toHaveLength(3);

    const view = await readDeviz(actor, internId);
    expect(view.lines.map((l) => l.quantity)).toEqual(['48.0000', '7.0000', '2.0000']);
    expect(view.lines.every((l) => l.normedArticleId === articleId)).toBe(true);
  });

  it('biblioteca arata de cate ori a fost folosit articolul si in ce lucrari', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const { id: internId } = await createDeviz(actor, {
      workUnitId: base.workUnitId,
      kind: 'intern',
    });

    const { id: articleId } = await createNormedArticle(actor, {
      companyId: base.companyId,
      code: `AR-${base.companyId.slice(-6)}`,
      name: 'Articol de probă',
      uom: 'mp',
      components: [{ kind: 'material', position: 1, quantityPerUom: '1' }],
    });

    await putNormedArticleIntoDeviz(actor, { devizId: internId, articleId, quantity: '3' });

    const articles = await listNormedArticles(actor, { companyId: base.companyId });
    const article = articles.find((a) => a.id === articleId);

    expect(article?.usageCount).toBe(1);
    expect(article?.componentCount).toBe(1);
    expect(article?.workUnits.map((w) => w.id)).toEqual([base.workUnitId]);
  });

  it('o pozitie se salveaza ca articol normat, cu componentele deduse din linie', async () => {
    const base = await ground();
    const actor = pmActor([base.companyId]);
    const { id: internId } = await createDeviz(actor, {
      workUnitId: base.workUnitId,
      kind: 'intern',
    });

    const { id: lineId } = await addDevizLine(actor, {
      devizId: internId,
      position: 1,
      name: 'Turnare beton',
      uom: 'mc',
      quantity: '12',
      materialCost: '300',
      laborCost: '80',
    });

    const code = `BT-${base.companyId.slice(-6)}`;
    const { id: articleId } = await saveAsNormedArticle(actor, { lineId, code });

    const articles = await listNormedArticles(actor, { companyId: base.companyId });
    const article = articles.find((a) => a.id === articleId);

    expect(article?.code).toBe(code);
    expect(article?.name).toBe('Turnare beton');
    // Material si manopera au valoare pe linie, utilaj si transport nu.
    expect(article?.componentCount).toBe(2);
    // Linia poarta de acum articolul: din legatura asta se numara folosirile.
    expect(article?.usageCount).toBe(1);
  });
});

describe('#20 RLS pe firma', () => {
  it('devizul unei lucrari din alta firma nu se vede', async () => {
    const base = await ground();
    const owner = pmActor([base.companyId]);
    const devizId = await clientDeviz(base);

    const stranger = pmActor([uuidv7()]);
    const error = await rejection(readDeviz(stranger, devizId));

    expect((error as AppError).code).toBe('NOT_FOUND');

    // Iar proprietarul il vede — altfel testul de mai sus ar fi trecut degeaba.
    await expect(readDeviz(owner, devizId)).resolves.toBeDefined();
  });
});
