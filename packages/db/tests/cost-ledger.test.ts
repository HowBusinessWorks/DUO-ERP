import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeConnections, serviceActor, withActor, type ActorTx } from '../src/index';
import { SQLSTATE, fieldActor, officeActor, pgMessage, rejection, sqlstate } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce impune BAZA la registrul de cost si la rollup-uri (pasul 06a).
 *
 * Aici stau exact lucrurile pe care o functie pura nu le poate garanta: ce
 * refuza schema, ce deriva triggerele, ce nu se mai poate schimba dupa scriere,
 * cine vede ce coloana, si daca cifra agregata chiar da suma din registru.
 */

const companyId = uuidv7();
const otherCompanyId = uuidv7();
const clientId = uuidv7();
const contractId = uuidv7();
const otherContractId = uuidv7();
const objectiveId = uuidv7();
const pmId = uuidv7();

let componentMentenanta = '';
let componentDelta = '';
let componentStrain = '';
let periodAugust = '';
let periodSeptember = '';
let lucrareId = '';
let stageId = '';
let interventieId = '';

/** Insereaza o linie de cost si intoarce id-ul ei. */
interface LineOptions {
  readonly companyId?: string;
  readonly effectDate?: string;
  readonly documentDate?: string;
  readonly stage?: string;
  readonly amount?: string;
  readonly workUnitId?: string | null;
  readonly stageId?: string | null;
  readonly usedContractId?: string | null;
  readonly usedComponentId?: string | null;
  readonly chargedContractId?: string | null;
  readonly chargedComponentId?: string | null;
  readonly periodId?: string | null;
}

async function insertLine(tx: ActorTx, options: LineOptions = {}): Promise<string> {
  const id = uuidv7();
  // `??` nu se poate folosi pe campurile nullabile: `null` e o VALOARE ceruta de
  // teste (o linie fara analitica „descarcat" e cazul verificarii #1), iar
  // `null ?? implicit` ar trimite implicitul si testul n-ar verifica nimic.
  const pick = <T>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);

  await tx.execute(sql`
    insert into app.cost_lines (
      id, company_id, document_date, effect_date, period_id,
      used_contract_id, used_component_id, objective_id, work_unit_id, stage_id,
      charged_contract_id, charged_component_id,
      expense_type, quantity, uom, amount, stage,
      document_type, document_id, created_by
    ) values (
      ${id}, ${options.companyId ?? companyId},
      ${options.documentDate ?? '2026-08-17'}, ${options.effectDate ?? '2026-08-17'},
      ${pick(options.periodId, null)},
      ${pick(options.usedContractId, contractId)}, ${pick(options.usedComponentId, componentMentenanta)},
      ${objectiveId}, ${pick(options.workUnitId, interventieId)}, ${pick(options.stageId, null)},
      ${pick(options.chargedContractId, contractId)},
      ${pick(options.chargedComponentId, componentMentenanta)},
      'material', 4.0000, 'buc', ${options.amount ?? '1000.00'}, ${options.stage ?? 'consumat'},
      'bon_consum', ${uuidv7()}, ${pmId}
    )`);
  return id;
}

async function rollupOf(component: string, period: string): Promise<Record<string, string>> {
  return withActor(officeActor(), async (tx) => {
    const rows = await tx.execute(sql`
      select committed, received, consumed, invoiced, allocated_revenue
        from app.component_period_rollup
       where component_id = ${component} and period_id = ${period}`);
    return (rows.rows[0] ?? {}) as Record<string, string>;
  });
}

beforeAll(async () => {
  await withActor(officeActor(), async (tx) => {
    for (const [id, name] of [
      [companyId, 'Damina Cost SRL'],
      [otherCompanyId, 'Damina Cost Doi SRL'],
    ] as const) {
      await tx.execute(
        sql`insert into app.companies (id, name, cui) values (${id}, ${name}, ${`RO${id.slice(-8)}`})`,
      );
    }

    await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, 'Apa Nova Cost')`);

    await tx.execute(sql`
      insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
      values (${contractId}, ${companyId}, ${clientId}, ${`CT-${contractId.slice(-6)}`},
              'mentenanta_multianual', '2026-01-01', '2029-12-31', 'activ'),
             (${otherContractId}, ${otherCompanyId}, ${clientId}, ${`CT-${otherContractId.slice(-6)}`},
              'mentenanta_multianual', '2026-01-01', '2029-12-31', 'activ')`);

    componentMentenanta = uuidv7();
    componentDelta = uuidv7();
    componentStrain = uuidv7();
    await tx.execute(sql`
      insert into app.contract_components (id, contract_id, type, name, budget_cadence, is_fill_target)
      values (${componentMentenanta}, ${contractId}, 'mentenanta', 'Mentenanta', 'lunar', false),
             (${componentDelta}, ${contractId}, 'delta', 'Delta', 'lunar', true),
             (${componentStrain}, ${otherContractId}, 'mentenanta', 'Mentenanta straina', 'lunar', false)`);

    await tx.execute(sql`
      insert into app.objectives (id, code, name, kind)
      values (${objectiveId}, ${`OB-${objectiveId.slice(-8)}`}, 'Statia de pompare 21', 'statie_pompare')`);

    await tx.execute(sql`
      insert into app.persons (id, persona, category, full_name)
      values (${pmId}, 'office', 'angajat', 'PM de cost')`);

    periodAugust = uuidv7();
    periodSeptember = uuidv7();
    await tx.execute(sql`
      insert into app.periods (id, company_id, year, month)
      values (${periodAugust}, ${companyId}, 2026, 8),
             (${periodSeptember}, ${companyId}, 2026, 9)`);

    lucrareId = uuidv7();
    interventieId = uuidv7();
    await tx.execute(sql`
      insert into app.work_units (id, company_id, code, type, name, objective_id, status)
      values (${lucrareId}, ${companyId}, ${`L-${lucrareId.slice(-8)}`}, 'lucrare',
              'Inlocuire conducta', ${objectiveId}, 'in_executie'),
             (${interventieId}, ${companyId}, ${`I-${interventieId.slice(-8)}`}, 'interventie',
              'Remediere avarie', ${objectiveId}, 'in_executie')`);

    stageId = uuidv7();
    await tx.execute(sql`
      insert into app.work_stages (id, work_unit_id, position, name)
      values (${stageId}, ${lucrareId}, 1, 'Sapatura')`);
  });
});

describe('ce refuza registrul la scriere', () => {
  it('#1 o linie consumata fara analitica „descarcat" e respinsa', async () => {
    const error = await rejection(
      withActor(officeActor(), (tx) =>
        insertLine(tx, { stage: 'consumat', chargedContractId: null, chargedComponentId: null }),
      ),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.CHECK_VIOLATION);
  });

  it('#1 aceeasi linie ANGAJATA trece — la comanda inca nu se stie bugetul', async () => {
    await expect(
      withActor(officeActor(), (tx) =>
        insertLine(tx, { stage: 'angajat', chargedContractId: null, chargedComponentId: null }),
      ),
    ).resolves.toBeTruthy();
  });

  it('#2 o linie pe o lucrare fara etapa e respinsa', async () => {
    const error = await rejection(
      withActor(officeActor(), (tx) =>
        insertLine(tx, { workUnitId: lucrareId, stageId: null }),
      ),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toContain('cere etapa pe fiecare linie de cost');
  });

  it('#2 si reversul: o etapa pe o interventie e respinsa', async () => {
    const error = await rejection(
      withActor(officeActor(), (tx) =>
        insertLine(tx, { workUnitId: interventieId, stageId }),
      ),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toContain('etapele exista doar pe lucrari');
  });

  it('#2 etapa altei lucrari nu se poate scrie pe linie', async () => {
    const altaLucrare = uuidv7();
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          insert into app.work_units (id, company_id, code, type, name, objective_id)
          values (${altaLucrare}, ${companyId}, ${`L-${altaLucrare.slice(-8)}`}, 'lucrare',
                  'Alta lucrare', ${objectiveId})`);
        await insertLine(tx, { workUnitId: altaLucrare, stageId });
      }),
    );

    expect(pgMessage(error)).toContain('etapa nu apartine unitatii de lucru');
  });

  it('#3 o linie fara document sursa e respinsa — altfel cifra nu se desface', async () => {
    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          insert into app.cost_lines (
            id, company_id, document_date, effect_date, objective_id,
            charged_contract_id, charged_component_id,
            expense_type, amount, stage, document_type, created_by
          ) values (
            ${uuidv7()}, ${companyId}, '2026-08-17', '2026-08-17', ${objectiveId},
            ${contractId}, ${componentMentenanta},
            'material', 900.00, 'consumat', 'bon_consum', ${pmId}
          )`);
      }),
    );

    // 23502: `document_id` e `not null`. Perechea document + id e principiul I3.
    expect(sqlstate(error)).toBe('23502');
  });

  it('componenta trebuie sa apartina contractului de pe ACEEASI analitica', async () => {
    const error = await rejection(
      withActor(officeActor(), (tx) => insertLine(tx, { chargedComponentId: componentStrain })),
    );

    expect(pgMessage(error)).toContain('nu apartine contractului');
  });

  it('o linie nu poate descarca pe contractul altei firme', async () => {
    const error = await rejection(
      withActor(officeActor(), (tx) =>
        insertLine(tx, { chargedContractId: otherContractId, chargedComponentId: componentStrain }),
      ),
    );

    expect(pgMessage(error)).toContain('alta firma');
  });
});

describe('#4 luna se deriva din data de efect', () => {
  it('linia primeste luna datei de efect, nu pe cea trimisa de aplicatie', async () => {
    const id = await withActor(officeActor(), (tx) =>
      // Aplicatia trimite dinadins luna GRESITA: septembrie pe o data din august.
      insertLine(tx, { effectDate: '2026-08-30', periodId: periodSeptember }),
    );

    const period = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(
        sql`select period_id from app.cost_lines where id = ${id}`,
      );
      return (rows.rows[0] as { period_id: string }).period_id;
    });

    expect(period).toBe(periodAugust);
  });

  it('data documentului si data de efect pot fi in luni diferite', async () => {
    const id = await withActor(officeActor(), (tx) =>
      // Fisa facuta pe 28 iulie, raportata in august — cazul de la §11.
      insertLine(tx, { documentDate: '2026-07-28', effectDate: '2026-08-03' }),
    );

    const row = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(
        sql`select document_date, period_id from app.cost_lines where id = ${id}`,
      );
      return rows.rows[0] as { document_date: string; period_id: string };
    });

    expect(row.period_id).toBe(periodAugust);
    expect(String(row.document_date)).toContain('2026-07-28');
  });
});

describe('#5, #6, #7 registrul e append-only', () => {
  it('#5 biroul nu poate face UPDATE pe o linie de cost', async () => {
    const id = await withActor(officeActor(), (tx) => insertLine(tx));

    const error = await rejection(
      withActor(officeActor('corectie'), async (tx) => {
        await tx.execute(sql`update app.cost_lines set amount = 1.00 where id = ${id}`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });

  it('#6 nici DELETE', async () => {
    const id = await withActor(officeActor(), (tx) => insertLine(tx));

    const error = await rejection(
      withActor(officeActor('stergere'), async (tx) => {
        await tx.execute(sql`delete from app.cost_lines where id = ${id}`);
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);
  });

  it('#7 corectia se face prin storno: ambele linii raman vizibile', async () => {
    const component = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.contract_components (id, contract_id, type, name, budget_cadence)
        values (${component}, ${contractId}, 'lucrari', 'Lucrari storno', 'lunar')`);
    });

    const gresita = await withActor(officeActor(), (tx) =>
      insertLine(tx, { chargedComponentId: component, amount: '2500.00' }),
    );

    await withActor(officeActor(), (tx) =>
      insertLine(tx, { chargedComponentId: component, amount: '-2500.00' }),
    );

    const corecta = await withActor(officeActor(), (tx) =>
      insertLine(tx, { chargedComponentId: component, amount: '250.00' }),
    );

    const lines = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select amount from app.cost_lines
         where charged_component_id = ${component} order by amount`);
      return rows.rows.map((r) => (r as { amount: string }).amount);
    });

    // Trei linii, nu una corectata: registrul spune si ce s-a gresit, si ce s-a
    // indreptat. Un `update` ar fi sters intrebarea „de ce 250 si nu 2500".
    expect(lines).toEqual(['-2500.00', '250.00', '2500.00']);
    expect(gresita).not.toBe(corecta);

    const rollup = await rollupOf(component, periodAugust);
    expect(rollup.consumed).toBe('250.00');
  });
});

describe('#8 rollup-ul da exact suma din registru', () => {
  it('doua sute de linii pe patru stadii, verificate cu interogare independenta', async () => {
    const component = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.contract_components (id, contract_id, type, name, budget_cadence)
        values (${component}, ${contractId}, 'lucrari', 'Lucrari rollup', 'lunar')`);
    });

    const stages = ['angajat', 'receptionat', 'consumat', 'facturat'] as const;
    await withActor(officeActor(), async (tx) => {
      for (let i = 0; i < 200; i += 1) {
        await insertLine(tx, {
          chargedComponentId: component,
          stage: stages[i % stages.length],
          amount: `${(i + 1) * 10}.00`,
          effectDate: i % 2 === 0 ? '2026-08-05' : '2026-08-25',
        });
      }
    });

    const rollup = await rollupOf(component, periodAugust);
    const expected = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select
          coalesce(sum(amount) filter (where stage = 'angajat'), 0)     as committed,
          coalesce(sum(amount) filter (where stage = 'receptionat'), 0) as received,
          coalesce(sum(amount) filter (where stage = 'consumat'), 0)    as consumed,
          coalesce(sum(amount) filter (where stage = 'facturat'), 0)    as invoiced
          from app.cost_lines
         where charged_component_id = ${component} and period_id = ${periodAugust}`);
      return rows.rows[0] as Record<string, string>;
    });

    expect(rollup.committed).toBe(expected.committed);
    expect(rollup.received).toBe(expected.received);
    expect(rollup.consumed).toBe(expected.consumed);
    expect(rollup.invoiced).toBe(expected.invoiced);

    // Si a doua oara, prin functia pe care o va chema jobul nocturn din 06b.
    const divergences = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`select * from app.rollup_verify(${periodAugust})`);
      return rows.rows;
    });

    expect(divergences).toEqual([]);
  });

  it('#9 o coruptere a rollup-ului iese la verificare, cu componenta si diferenta', async () => {
    const component = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.contract_components (id, contract_id, type, name, budget_cadence)
        values (${component}, ${contractId}, 'lucrari', 'Lucrari corupte', 'lunar')`);
    });

    await withActor(officeActor(), (tx) =>
      insertLine(tx, { chargedComponentId: component, amount: '700.00' }),
    );

    // Corupem rollup-ul pe singura usa care exista: functia de intretinere, data
    // doar worker-ului. Biroul n-o poate chema, si nici nu are `update` pe tabela.
    await withActor(serviceActor('test-corupere-rollup'), async (tx) => {
      await tx.execute(sql`
        select app.rollup_apply_cost(${component}, ${periodAugust}, 'consumat', 13.00)`);
    });

    const refuz = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          select app.rollup_apply_cost(${component}, ${periodAugust}, 'consumat', 1.00)`);
      }),
    );
    expect(sqlstate(refuz)).toBe(SQLSTATE.INSUFFICIENT_PRIVILEGE);

    const divergences = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select component_id, column_name, stored, expected
          from app.rollup_verify(${periodAugust})
         where component_id = ${component}`);
      return rows.rows as { component_id: string; column_name: string; stored: string; expected: string }[];
    });

    expect(divergences).toHaveLength(1);
    expect(divergences[0]?.column_name).toBe('consumed');
    expect(divergences[0]?.stored).toBe('713.00');
    expect(divergences[0]?.expected).toBe('700.00');
  });
});

describe('#12 luna inchisa', () => {
  it('nu se mai poate scrie in ea', async () => {
    const periodIulie = await withActor(officeActor('inchidere de luna pentru test'), async (tx) => {
      const id = uuidv7();
      await tx.execute(sql`
        insert into app.periods (id, company_id, year, month)
        values (${id}, ${companyId}, 2026, 7)`);
      await tx.execute(sql`
        update app.periods set status = 'closed', closed_at = now(), closed_by = ${pmId}
         where id = ${id}`);
      return id;
    });

    expect(periodIulie).toBeTruthy();

    const error = await rejection(
      withActor(officeActor(), (tx) => insertLine(tx, { effectDate: '2026-07-15' })),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toContain('PERIOD_CLOSED');
    expect(pgMessage(error)).toContain('07/2026');
  });
});

describe('rescrierea analiticei „descarcat" — usa din §13.1', () => {
  it('muta banii intre componente si actualizeaza AMBELE rollup-uri', async () => {
    const dinCare = uuidv7();
    const inCare = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.contract_components (id, contract_id, type, name, budget_cadence)
        values (${dinCare}, ${contractId}, 'lucrari', 'Sursa mutarii', 'lunar'),
               (${inCare}, ${contractId}, 'lucrari', 'Tinta mutarii', 'lunar')`);
    });

    const id = await withActor(officeActor(), (tx) =>
      insertLine(tx, { chargedComponentId: dinCare, amount: '800.00' }),
    );

    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        select app.recharge_cost_line(
          ${id}, ${contractId}, ${inCare}, 'interventia a trecut pe Delta'
        )`);
    });

    expect((await rollupOf(dinCare, periodAugust)).consumed).toBe('0.00');
    expect((await rollupOf(inCare, periodAugust)).consumed).toBe('800.00');

    // Ce NU se schimba niciodata: analitica „folosit". Istoricul obiectivului
    // ramane corect oricat s-ar muta banii (§13.1).
    const row = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select used_component_id, objective_id, document_date from app.cost_lines where id = ${id}`);
      return rows.rows[0] as { used_component_id: string; objective_id: string };
    });

    expect(row.used_component_id).toBe(componentMentenanta);
    expect(row.objective_id).toBe(objectiveId);
  });

  it('#15 mutata pe ALT contract, linia intra in raportul de reconciliere', async () => {
    // Al doilea contract al ACELEIASI firme: mutarea intre firme e refuzata de
    // trigger-ul de coerenta, deci anomalia reala arata asa.
    const contractDoi = uuidv7();
    const componentDoi = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        insert into app.contracts (id, company_id, client_id, code, type, starts_on, ends_on, status)
        values (${contractDoi}, ${companyId}, ${clientId}, ${`CT-${contractDoi.slice(-6)}`},
                'individual_deviz', '2026-01-01', '2027-12-31', 'activ')`);
      await tx.execute(sql`
        insert into app.contract_components (id, contract_id, type, name, budget_cadence)
        values (${componentDoi}, ${contractDoi}, 'individual', 'Individual', 'lunar')`);
    });

    const id = await withActor(officeActor(), (tx) => insertLine(tx, { amount: '410.00' }));

    // Inainte de mutare linia e normala: cele doua analitici sunt egale.
    const inainte = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select id from app.cost_lines
         where id = ${id} and used_contract_id is distinct from charged_contract_id`);
      return rows.rows;
    });
    expect(inainte).toEqual([]);

    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`
        select app.recharge_cost_line(
          ${id}, ${contractDoi}, ${componentDoi}, 'lucrarea s-a facturat pe contractul individual'
        )`);
    });

    /*
     * Dupa mutare intra in raport — si asta e chiar interogarea din spatele
     * ecranului de reconciliere, care merge pe indexul partial din 0017: el
     * contine EXACT anomaliile, deci scanarea nu atinge nicio linie normala.
     */
    const dupa = await withActor(officeActor(), async (tx) => {
      const rows = await tx.execute(sql`
        select used_contract_id, charged_contract_id from app.cost_lines
         where id = ${id} and used_contract_id is distinct from charged_contract_id`);
      return rows.rows as { used_contract_id: string; charged_contract_id: string }[];
    });

    expect(dupa).toHaveLength(1);
    expect(dupa[0]?.used_contract_id).toBe(contractId);
    expect(dupa[0]?.charged_contract_id).toBe(contractDoi);
  });

  it('fara motiv scris, mutarea e respinsa', async () => {
    const id = await withActor(officeActor(), (tx) => insertLine(tx, { amount: '120.00' }));

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(
          sql`select app.recharge_cost_line(${id}, ${contractId}, ${componentDelta}, '  ')`,
        );
      }),
    );

    expect(sqlstate(error)).toBe(SQLSTATE.RAISED);
    expect(pgMessage(error)).toContain('cere un motiv scris');
  });

  it('pe o luna inchisa nu se muta nimic — se emite document de re-alocare', async () => {
    const id = await withActor(officeActor(), (tx) =>
      insertLine(tx, { effectDate: '2026-09-10', amount: '300.00' }),
    );

    await withActor(officeActor('inchidere de luna pentru test'), async (tx) => {
      await tx.execute(sql`
        update app.periods set status = 'closed', closed_at = now(), closed_by = ${pmId}
         where id = ${periodSeptember}`);
    });

    const error = await rejection(
      withActor(officeActor(), async (tx) => {
        await tx.execute(sql`
          select app.recharge_cost_line(${id}, ${contractId}, ${componentDelta}, 'mutare tarzie')`);
      }),
    );

    expect(pgMessage(error)).toContain('PERIOD_CLOSED');

    await withActor(officeActor('redeschidere dupa test'), async (tx) => {
      await tx.execute(sql`
        update app.periods set status = 'open', closed_at = null, closed_by = null
         where id = ${periodSeptember}`);
    });
  });
});

describe('#20 terenul nu vede registrul', () => {
  it('zero randuri si zero coloane de suma', async () => {
    await withActor(officeActor(), (tx) => insertLine(tx, { amount: '5000.00' }));

    const rows = await withActor(fieldActor({ companyIds: [companyId] }), async (tx) => {
      const result = await tx.execute(sql`select id from app.cost_lines`);
      return result.rows;
    });

    expect(rows).toEqual([]);

    const privileges = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(sql`
        select
          has_column_privilege('app_field', 'app.cost_lines', 'amount', 'select')   as amount,
          has_table_privilege('app_field', 'app.cost_lines', 'select')              as tabela,
          has_column_privilege('app_field', 'app.component_period_rollup', 'consumed', 'select')
            as rollup`);
      return result.rows[0] as Record<string, boolean>;
    });

    expect(privileges.amount).toBe(false);
    expect(privileges.tabela).toBe(false);
    expect(privileges.rollup).toBe(false);
  });
});
