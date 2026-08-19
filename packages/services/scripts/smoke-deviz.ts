import { closeConnections, withActor, type Actor } from '@damina/db';
import { uuidv7, type AppError } from '@damina/shared';
import { sql } from 'drizzle-orm';
/*
 * Singurul loc din afara lui `packages/db` care deschide o conexiune proprie, si
 * doar pentru curatenia de dupa proba: stergerea cere superuser (un trigger
 * apara folderele generate automat), iar `withActor` da, prin definitie, un rol
 * de aplicatie. Regula ramane valabila pentru codul de aplicatie — asta e un
 * script de intretinere, care nu se importa de nicaieri.
 */
// eslint-disable-next-line no-restricted-imports
import pg from 'pg';
import { loadDbEnv } from '../../db/src/env';
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

/**
 * Smoke pentru 11a, pe baza de dezvoltare — verificarile 1-13 si 20.
 *
 * De ce exista, cand exista si `tests/deviz.test.ts`: suita de teste porneste un
 * Postgres efemer prin Testcontainers si ruleaza DOAR in CI (decizia „zero
 * Docker local"). Regula casei cere insa ca fiecare use-case sa fie rulat pe
 * date reale, din rolul restrans, INAINTE de orice ecran — iar „date reale"
 * inseamna aici baza de dev, cu migrarile ei aplicate si cu rolurile ei.
 *
 *   pnpm --filter @damina/services exec tsx scripts/smoke-deviz.ts
 *
 * Isi face terenul si il sterge la final, si pe drumul de eroare.
 */

const results: { readonly label: string; readonly ok: boolean; readonly detail: string }[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  results.push({ label, ok, detail });
  process.stdout.write(`${ok ? '  ok  ' : ' PICA '} ${label}${detail === '' ? '' : ` — ${detail}`}\n`);
}

const actorFor = (
  persona: Actor['persona'],
  pgRole: Actor['pgRole'],
  claims: Record<string, unknown>,
  reason?: string,
): Actor => ({
  personId: PERSON_ID,
  persona,
  pgRole,
  claims,
  ...(reason === undefined ? {} : { reason }),
});

/** Persoana in numele careia ruleaza smoke-ul. Se creeaza si se sterge aici. */
const PERSON_ID = uuidv7();
const COMPANY_ID = uuidv7();
const WORK_UNIT_ID = uuidv7();
const TAG = COMPANY_ID.slice(-8);

const admin = (reason?: string): Actor =>
  actorFor('office', 'app_office', { office_roles: ['admin'] }, reason);

/** Rolul restrans al pasului: PM, cu firma lui, fara drept financiar. */
const pm = (reason?: string): Actor =>
  actorFor('office', 'app_office', { office_roles: ['pm'], company_ids: [COMPANY_ID] }, reason);

const stranger = (): Actor =>
  actorFor('office', 'app_office', { office_roles: ['pm'], company_ids: [uuidv7()] });

async function setUp(): Promise<void> {
  const clientId = uuidv7();
  const objectiveId = uuidv7();

  await withActor(admin('smoke 11a'), async (tx) => {
    await tx.execute(sql`insert into app.companies (id, name) values (${COMPANY_ID}, ${`SMOKE ${TAG}`})`);
    await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, ${`SMOKE client ${TAG}`})`);
    await tx.execute(sql`
      insert into app.persons (id, full_name, persona, category)
      values (${PERSON_ID}, ${`SMOKE ${TAG}`}, 'office', 'angajat')`);
    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`SMOKE-${TAG}`}, 'Stație de pompare', 'statie_pompare')`);
    await tx.execute(sql`
      insert into app.work_units (id, company_id, code, type, name, objective_id, status, responsible_person_id)
      values (${WORK_UNIT_ID}, ${COMPANY_ID}, ${`SMOKE-L-${TAG}`}, 'lucrare', ${`Lucrare smoke ${TAG}`},
              ${objectiveId}, 'in_executie', ${PERSON_ID})`);
  });
}

/**
 * Curatenia NU se poate face din `app_office`, si asta e o veste buna.
 *
 * Biroul n-are `delete` pe `normed_articles` si pe `deviz_templates`: un articol
 * folosit intr-un deviz e referit de `deviz_lines.normed_article_id`, iar
 * disparitia lui ar lasa linii care nu mai stiu de unde vin. Se dezactiveaza,
 * nu se sterg. Prima varianta a smoke-ului a picat exact aici — deci grant-urile
 * chiar tin.
 *
 * Deci stergerea de dupa proba se face pe conexiunea de migrare, ca superuser,
 * exact ca in `scripts/dev-sql.ts`.
 */
async function tearDown(): Promise<void> {
  const env = loadDbEnv({ requireSession: true });
  const ssl = env.DATABASE_URL_SESSION.includes('localhost')
    ? false
    : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: env.DATABASE_URL_SESSION, ssl });
  await client.connect();

  try {
    /*
     * Ordinea nu e o preferinta. Fiecare unitate de lucru isi capata la insert
     * un folder in `app.nodes`, prin trigger (07a) — deci arborele de fisiere
     * tine unitatea de lucru in viata pana cand nodul ei pleaca. Prima varianta
     * a curateniei a cazut exact pe cheia aia straina.
     *
     * Devizele, categoriile, liniile si maparile pleaca singure, in cascada cu
     * unitatea. Firmele „SMOKE %" ramase de la o rulare picata se iau si ele.
     */
    const companies = await client.query<{ id: string }>(
      "select id from app.companies where name like 'SMOKE %'",
    );

    for (const row of companies.rows) {
      /*
       * `session_replication_role = replica` opreste triggerele — se aprinde
       * DOAR pentru stergerea nodurilor si se stinge imediat.
       *
       * De ce e nevoie: folderul unei unitati de lucru e generat automat, iar un
       * trigger refuza stergerea lui (corect in aplicatie, incomod la curatenia
       * unei probe). De ce se stinge imediat: in modul `replica`, Postgres
       * opreste si triggerele de cheie straina, deci `on delete cascade` NU mai
       * ruleaza. Prima varianta a lasat in urma 24 de devize orfane, cu
       * `work_unit_id` catre randuri inexistente — exact felul de gunoi tacut pe
       * care o curatenie ar trebui sa-l previna.
       */
      await client.query("set session_replication_role = 'replica'");
      await client.query(
        'delete from app.nodes where work_unit_id in (select id from app.work_units where company_id = $1)',
        [row.id],
      );
      await client.query('delete from app.nodes where company_id = $1', [row.id]);
      await client.query("set session_replication_role = 'origin'");

      // De aici incolo cascadele chiar ruleaza: devizele, categoriile, liniile
      // si maparile pleaca odata cu unitatea de lucru.
      await client.query('delete from app.work_units where company_id = $1', [row.id]);
      await client.query('delete from app.deviz_templates where company_id = $1', [row.id]);
      await client.query('delete from app.normed_articles where company_id = $1', [row.id]);
      await client.query('delete from app.companies where id = $1', [row.id]);
    }
    await client.query("delete from app.objectives where code like 'SMOKE-%'");
    await client.query("delete from app.clients where name like 'SMOKE client %'");
    await client.query("delete from app.persons where full_name like 'SMOKE %'");
  } finally {
    await client.end();
  }
}

const rejection = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

const errorCode = (error: unknown): string | undefined => {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code } = current as Error & { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
    current = current.cause;
  }
  return undefined;
};

const pgMessage = (error: unknown): string => {
  let current: unknown = error;
  let last = String(error);
  while (current instanceof Error) {
    last = current.message;
    current = current.cause;
  }
  return last;
};

async function run(): Promise<void> {
  const actor = pm('smoke 11a');

  // ── #1 totalurile ──────────────────────────────────────────────────────────
  const { id: clientDeviz } = await createDeviz(actor, {
    workUnitId: WORK_UNIT_ID,
    kind: 'client',
  });

  let position = 0;
  let expected = 0;
  for (let c = 1; c <= 3; c += 1) {
    const { id: categoryId } = await addDevizCategory(actor, {
      devizId: clientDeviz,
      name: `Categoria ${String(c)}`,
      position: c,
    });
    for (let o = 1; o <= 2; o += 1) {
      const { id: operationId } = await addDevizCategory(actor, {
        devizId: clientDeviz,
        parentId: categoryId,
        name: `Operațiunea ${String(c)}.${String(o)}`,
        position: o,
      });
      for (let l = 1; l <= 4; l += 1) {
        position += 1;
        const quantity = 1.25 * l;
        const unitPrice = 10.33 * o + c;
        expected += Math.round(quantity * unitPrice * 100) / 100;
        await addDevizLine(actor, {
          devizId: clientDeviz,
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

  const view = await readDeviz(actor, clientDeviz);

  /*
   * Oracolul e suma facuta de POSTGRES peste coloana `total`, nu o recalculare
   * in JavaScript. Prima varianta a smoke-ului compara cu `Math.round(q*p*100)`
   * si a picat cu un ban: 2,5 x 12,33 = 30,825, pe care `numeric` si `Money` il
   * rotunjesc la 30,83, iar float-ul la 30,82, fiindca il tine ca
   * 30,8249999999. Exact motivul pentru care banii nu circula ca `number` in
   * proiectul asta — iar un test scris cu float ar fi impus greseala codului.
   */
  const dbTotal = await withActor(actor, async (tx) => {
    const result = await tx.execute<{ sum: string }>(sql`
      select coalesce(sum(total), 0)::text as sum from app.deviz_lines
       where deviz_id = ${clientDeviz}`);
    return Number(result.rows[0]?.sum ?? '0').toFixed(2);
  });

  check(
    '#1 24 de pozitii, totalul da cu suma liniilor la ban',
    view.lines.length === 24 && view.totals.direct === dbTotal,
    `domeniu ${view.totals.direct} vs baza ${dbTotal} (float ar fi zis ${expected.toFixed(2)})`,
  );

  const topCategories = view.totals.categories.filter((c) => c.parentId === null);
  const categorySum = topCategories.reduce((acc, c) => acc + Number(c.direct), 0);
  check(
    '#1 subtotalurile pe categorie insumeaza totalul',
    topCategories.length === 3 && categorySum.toFixed(2) === dbTotal,
    `${categorySum.toFixed(2)}`,
  );

  // ── #3 al treilea nivel de arbore e refuzat ────────────────────────────────
  const [firstCategory] = view.totals.categories.filter((c) => c.parentId !== null);
  const depthError = await rejection(
    addDevizCategory(actor, {
      devizId: clientDeviz,
      parentId: firstCategory?.categoryId ?? '',
      name: 'Al treilea nivel',
      position: 9,
    }),
  );
  check(
    'trigger: al treilea nivel de categorie e refuzat',
    (depthError as AppError | undefined)?.code === 'VALIDATION_FAILED',
    pgMessage(depthError).slice(0, 60),
  );

  // ── #2 indirecte si profit ────────────────────────────────────────────────
  const { id: markupDeviz } = await createDeviz(admin('smoke markup'), {
    workUnitId: WORK_UNIT_ID,
    kind: 'intern',
  });
  await addDevizLine(actor, {
    devizId: markupDeviz,
    position: 1,
    name: 'Cost intern',
    uom: 'buc',
    quantity: '2',
    materialCost: '30',
    laborCost: '20',
  });
  const internView = await readDeviz(actor, markupDeviz);
  check(
    'trigger: pretul unitar intern e suma componentelor, totalul e cantitate x pret',
    internView.lines[0]?.unitPrice === '50.00' && internView.lines[0]?.total === '100.00',
    `${internView.lines[0]?.unitPrice ?? '-'} / ${internView.lines[0]?.total ?? '-'}`,
  );

  await updateDevizMarkup(actor, {
    devizId: clientDeviz,
    indirectPct: '0.08',
    profitPct: '0.12',
  });
  const withMarkup = await readDeviz(actor, clientDeviz);
  const direct = Number(withMarkup.totals.direct);
  const expectedIndirect = Math.round(direct * 0.08 * 100) / 100;
  const expectedProfit = Math.round((direct + expectedIndirect) * 0.12 * 100) / 100;
  check(
    '#2 indirectele si profitul se compun, in ordinea asta',
    withMarkup.totals.indirect === expectedIndirect.toFixed(2) &&
      withMarkup.totals.profit === expectedProfit.toFixed(2),
    `${withMarkup.totals.indirect} + ${withMarkup.totals.profit}`,
  );

  // ── #3 indirecte pe intern ────────────────────────────────────────────────
  const markupError = await rejection(
    updateDevizMarkup(actor, { devizId: markupDeviz, indirectPct: '0.08', profitPct: '' }),
  );
  check(
    '#3 serviciul refuza indirectele pe devizul intern, cu VALIDATION_FAILED',
    (markupError as AppError | undefined)?.code === 'VALIDATION_FAILED',
    (markupError as AppError | undefined)?.message ?? '',
  );

  const checkError = await rejection(
    withActor(actor, async (tx) => {
      await tx.execute(sql`update app.devize set indirect_pct = 0.08 where id = ${markupDeviz}`);
    }),
  );
  check(
    '#3 check-ul din baza refuza acelasi lucru, scris direct in tabela',
    pgMessage(checkError).includes('devize_intern_has_no_markup'),
    pgMessage(checkError).slice(0, 60),
  );

  // ── #7 si #8 inghetarea ───────────────────────────────────────────────────
  const first = await freezeClientDeviz(pm('ofertă trimisă'), {
    devizId: clientDeviz,
    reason: 'ofertă trimisă clientului',
  });
  const [firstLine] = withMarkup.lines;
  await updateDevizLine(actor, { lineId: firstLine?.id ?? '', unitPrice: '99.99' });
  const second = await freezeClientDeviz(pm('revizie'), {
    devizId: clientDeviz,
    reason: 'clientul a cerut altă cantitate',
  });
  check(
    '#7 modificarea de dupa inghet produce versiunea 2',
    first.version === 1 && second.version === 2 && first.total !== second.total,
    `${first.total} -> ${second.total}`,
  );

  const frozen = await withActor(actor, async (tx) => {
    const result = await tx.execute<{ version: number; total: string }>(
      sql`select version, total from app.deviz_versions where deviz_id = ${clientDeviz} order by version`,
    );
    return result.rows;
  });
  check(
    '#7 versiunea 1 a ramas cu totalul ei',
    frozen[0]?.total === first.total,
    `${frozen[0]?.total ?? '-'}`,
  );

  const noReason = await rejection(
    freezeClientDeviz(actor, { devizId: clientDeviz, reason: '' }),
  );
  check('#8 inghetarea fara motiv scris e respinsa', noReason !== undefined);

  const immutable = await rejection(
    withActor(actor, async (tx) => {
      await tx.execute(sql`update app.deviz_versions set total = 1 where deviz_id = ${clientDeviz}`);
    }),
  );
  check(
    '#7 versiunile sunt imutabile: biroul n-are update pe ele',
    errorCode(immutable) === '42501',
    errorCode(immutable) ?? 'fara eroare',
  );

  // ── #4 preia ca deviz intern ──────────────────────────────────────────────
  const secondWorkUnit = uuidv7();
  await withActor(admin('a doua lucrare pentru preluare'), async (tx) => {
    await tx.execute(sql`
      insert into app.work_units (id, company_id, code, type, name, objective_id, status, responsible_person_id)
      select ${secondWorkUnit}, company_id, ${`SMOKE-L2-${TAG}`}, 'lucrare', ${`Lucrare 2 ${TAG}`},
             objective_id, 'in_executie', responsible_person_id
        from app.work_units where id = ${WORK_UNIT_ID}`);
  });

  const { id: adoptSource } = await createDeviz(actor, {
    workUnitId: secondWorkUnit,
    kind: 'client',
  });
  for (let i = 1; i <= 12; i += 1) {
    await addDevizLine(actor, {
      devizId: adoptSource,
      position: i,
      name: `Poziția ${String(i)}`,
      uom: 'mp',
      quantity: '10',
      unitPrice: '25',
    });
  }
  const adopted = await adoptAsInternal(actor, { workUnitId: secondWorkUnit });
  const adoptedCheck = await checkDevizMapping(actor, secondWorkUnit);
  check(
    '#4 12 pozitii dau 12 linii interne si 12 mapari cu coeficient 1',
    adopted.lineCount === 12 && adopted.mappingCount === 12 && adoptedCheck.isComplete,
    `${String(adopted.lineCount)} linii / ${String(adopted.mappingCount)} mapari`,
  );

  const adoptedView = await readDeviz(actor, adopted.devizId);
  check(
    '#4 costurile interne pornesc de la zero, nu de la pretul ofertat',
    adoptedView.totals.direct === '0.00',
    adoptedView.totals.direct,
  );

  const secondAdopt = await rejection(adoptAsInternal(actor, { workUnitId: secondWorkUnit }));
  check(
    '#4 a doua preluare e refuzata, nu suprascrie',
    (secondAdopt as AppError | undefined)?.code === 'CONFLICT',
  );

  // ── #5 si #6 maparea ──────────────────────────────────────────────────────
  const thirdWorkUnit = uuidv7();
  await withActor(admin('a treia lucrare pentru mapare'), async (tx) => {
    await tx.execute(sql`
      insert into app.work_units (id, company_id, code, type, name, objective_id, status, responsible_person_id)
      select ${thirdWorkUnit}, company_id, ${`SMOKE-L3-${TAG}`}, 'lucrare', ${`Lucrare 3 ${TAG}`},
             objective_id, 'in_executie', responsible_person_id
        from app.work_units where id = ${WORK_UNIT_ID}`);
  });

  const { id: mapClient } = await createDeviz(actor, {
    workUnitId: thirdWorkUnit,
    kind: 'client',
  });
  const { id: mapIntern } = await createDeviz(actor, {
    workUnitId: thirdWorkUnit,
    kind: 'intern',
  });
  const { id: splitLine } = await addDevizLine(actor, {
    devizId: mapClient,
    position: 1,
    name: 'Hidroizolație',
    uom: 'mp',
    quantity: '340',
    unitPrice: '55',
  });
  await addDevizLine(actor, {
    devizId: mapClient,
    position: 2,
    name: 'Poziție nemapată',
    uom: 'mp',
    quantity: '10',
    unitPrice: '5',
  });

  const internLines: string[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const { id } = await addDevizLine(actor, {
      devizId: mapIntern,
      position: i,
      name: `Componenta ${String(i)}`,
      uom: 'mp',
      quantity: '340',
      materialCost: '10',
      laborCost: '5',
    });
    internLines.push(id);
  }

  await mapDevizLines(actor, {
    pairs: [
      { clientLineId: splitLine, internLineId: internLines[0] ?? '', coefficient: '0.5' },
      { clientLineId: splitLine, internLineId: internLines[1] ?? '', coefficient: '0.3' },
      { clientLineId: splitLine, internLineId: internLines[2] ?? '', coefficient: '0.2' },
    ],
  });

  const mappingCheck = await checkDevizMapping(actor, thirdWorkUnit);
  check(
    '#5 pozitie sparta in trei, cu 0,5 / 0,3 / 0,2: coeficientii sunt buni',
    mappingCheck.coefficientProblems.length === 0,
    JSON.stringify(mappingCheck.coefficientProblems),
  );
  check(
    '#6 pozitia nemapata se raporteaza, fara sa blocheze',
    mappingCheck.uncoveredClientLineIds.length === 1 && !mappingCheck.isComplete,
    `${String(mappingCheck.uncoveredClientLineIds.length)} nemapate`,
  );

  const savedAnyway = await addDevizLine(actor, {
    devizId: mapClient,
    position: 3,
    name: 'Încă o poziție',
    uom: 'mp',
    quantity: '1',
    unitPrice: '1',
  });
  check('#6 salvarea merge mai departe cu maparea incompleta', savedAnyway.id !== '');

  const wrongSide = await rejection(
    mapDevizLines(actor, {
      pairs: [{ clientLineId: splitLine, internLineId: splitLine, coefficient: '1' }],
    }),
  );
  check(
    'trigger: maparea intre doua pozitii client e refuzata',
    (wrongSide as AppError | undefined)?.code === 'VALIDATION_FAILED',
    pgMessage(wrongSide).slice(0, 60),
  );

  // ── #12, #13, #16 biblioteca ──────────────────────────────────────────────
  const { id: articleId } = await createNormedArticle(actor, {
    companyId: COMPANY_ID,
    code: `HZ-${TAG}`,
    name: 'Hidroizolație bituminoasă',
    uom: 'mp',
    components: [
      { kind: 'material', position: 1, quantityPerUom: '2.4' },
      { kind: 'manopera', position: 2, quantityPerUom: '0.35', normHours: '0.35' },
      { kind: 'utilaj', position: 3, quantityPerUom: '0.1' },
    ],
  });

  const { lineIds } = await putNormedArticleIntoDeviz(actor, {
    devizId: mapIntern,
    articleId,
    quantity: '20',
  });
  const explodedView = await readDeviz(actor, mapIntern);
  const explodedLines = explodedView.lines.filter((l) => l.normedArticleId === articleId);
  check(
    '#12 articol cu 3 componente, cantitate 20: 3 linii cu cantitatile inmultite',
    lineIds.length === 3 &&
      explodedLines.map((l) => l.quantity).join(',') === '48.0000,7.0000,2.0000',
    explodedLines.map((l) => l.quantity).join(', '),
  );

  const { id: savedArticle } = await saveAsNormedArticle(actor, {
    lineId: internLines[0] ?? '',
    code: `BT-${TAG}`,
  });

  const library = await listNormedArticles(actor, { companyId: COMPANY_ID });
  const exploded = library.find((a) => a.id === articleId);
  const saved = library.find((a) => a.id === savedArticle);
  check(
    '#13 biblioteca arata numarul de folosiri si lucrarile',
    exploded?.usageCount === 3 && exploded?.workUnits.length === 1,
    `${String(exploded?.usageCount ?? -1)} folosiri, ${String(exploded?.workUnits.length ?? -1)} lucrari`,
  );
  check(
    '#16 pozitia salvata ca articol are componentele deduse din linie',
    saved?.componentCount === 2 && saved?.usageCount === 1,
    `${String(saved?.componentCount ?? -1)} componente`,
  );

  // ── #9 si #10 izolarea pretului ───────────────────────────────────────────
  for (const [persona, role] of [
    ['field', 'app_field'],
    ['subcontractor', 'app_subcontractor'],
  ] as const) {
    const denied = await rejection(
      withActor(actorFor(persona, role, {}), async (tx) => {
        await tx.execute(sql`select unit_price from app.deviz_lines limit 1`);
      }),
    );
    check(
      `${persona === 'field' ? '#9' : '#10'} ${persona} primeste 42501 pe app.deviz_lines`,
      errorCode(denied) === '42501',
      errorCode(denied) ?? 'fara eroare',
    );
  }

  // ── #11 plasa de bani, aceeasi interogare ca in CI ────────────────────────
  const leaks = await withActor(admin(), async (tx) => {
    const result = await tx.execute<{ leak: string }>(sql`
      select format('%s.%s → %s', c.relname, a.attname, r.rolname) as leak
        from pg_class c
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        cross join (select rolname from pg_roles where rolname in ('app_field','app_subcontractor','app_client')) r
       where c.relnamespace = 'app'::regnamespace and c.relkind = 'r'
         and (a.attname ~ '(price|pret|cost|amount|margin|salary)' or a.attname = 'total')
         and has_column_privilege(r.rolname, c.oid, a.attnum, 'select')`);
    return result.rows.map((row) => row.leak);
  });
  check('#11 nicio coloana de bani vizibila in afara biroului', leaks.length === 0, leaks.join(', '));

  // ── #20 RLS pe firma ──────────────────────────────────────────────────────
  const denied = await rejection(readDeviz(stranger(), clientDeviz));
  check(
    '#20 devizul altei firme nu se vede',
    (denied as AppError | undefined)?.code === 'NOT_FOUND',
    (denied as AppError | undefined)?.code ?? 'vizibil!',
  );

}

async function main(): Promise<void> {
  await setUp();
  try {
    await run();
  } finally {
    await tearDown();
    await closeConnections();
  }

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    `\n${String(results.length - failed.length)}/${String(results.length)} verificări trec.\n`,
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${pgMessage(error)}\n`);
  process.exitCode = 1;
});
