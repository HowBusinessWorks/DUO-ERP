import { closeConnections, schema, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createComponent,
  createContract,
  getContractOverview,
  listComponents,
  listContracts,
  listContractYears,
  setCostCeiling,
  setRevenueCeiling,
} from '../src/contracts';
import { scanContractExpiry, scanDeltaFill } from '../src/contract-alerts';
import { officeActor, rejection } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/**
 * Ce verifica fisierul asta, si testele din `packages/db` nu pot:
 * comportamentul use-case-urilor. Ca un contract creat vine cu anii lui, ca
 * plafonul cere motiv si la prima setare, ca un scan de alerte rulat de doua ori
 * produce o singura alerta.
 */

interface Ground {
  readonly companyId: string;
  readonly clientId: string;
}

async function ground(): Promise<Ground> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const tag = companyId.slice(-8);

  await withActor(officeActor(), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name) values (${companyId}, ${`Firma ${tag}`})`,
    );
    await tx.execute(
      sql`insert into app.clients (id, name) values (${clientId}, ${`Client ${tag}`})`,
    );
  });

  return { companyId, clientId };
}

function contractInput(base: Ground, overrides: Record<string, unknown> = {}) {
  return {
    companyId: base.companyId,
    clientId: base.clientId,
    code: `C-${base.companyId.slice(-6)}`,
    reference: '',
    type: 'mentenanta_multianual' as const,
    startsOn: '2026-03-01',
    endsOn: '2030-02-28',
    totalValue: '',
    monthlyValue: '50000.00',
    paymentTermDays: '70',
    indexationPct: '5',
    deltaThreshold: '2000.00',
    expiryAlertMonths: '6',
    ownerPersonId: '',
    overheadPct: '',
    status: 'activ' as const,
    ...overrides,
  };
}

/** Deschide luna in firma, ca plafoanele sa aiba de ce se agata. */
async function openPeriod(companyId: string, year: number, month: number): Promise<string> {
  return withActor(officeActor(), async (tx) => {
    const id = uuidv7();
    await tx.execute(sql`
      insert into app.periods (id, company_id, year, month)
      values (${id}, ${companyId}, ${year}, ${month})`);
    return id;
  });
}

describe('createContract', () => {
  // Verificarea #1 din pasul 04, capat la capat.
  it('genereaza automat cei 4 ani contractuali, indexati si cu aniversare corecta', async () => {
    const base = await ground();
    const { id } = await createContract(officeActor(), contractInput(base));
    const years = await listContractYears(officeActor(), id);

    expect(years.map((year) => [year.startsOn, year.endsOn])).toEqual([
      ['2026-03-01', '2027-02-28'],
      ['2027-03-01', '2028-02-29'],
      ['2028-03-01', '2029-02-28'],
      ['2029-03-01', '2030-02-28'],
    ]);
    expect(years.map((year) => year.monthlyValue)).toEqual([
      '50000.00',
      '52500.00',
      '55125.00',
      '57881.25',
    ]);
    expect(years.map((year) => year.indexationAppliedPct)).toEqual([
      '0.0000',
      '0.0500',
      '0.0500',
      '0.0500',
    ]);
  });

  // Verificarea #2.
  it('cu indexare 0 cei 4 ani au aceeasi valoare', async () => {
    const base = await ground();
    const { id } = await createContract(officeActor(), contractInput(base, { indexationPct: '0' }));
    const years = await listContractYears(officeActor(), id);

    expect(years).toHaveLength(4);
    expect(new Set(years.map((year) => year.monthlyValue))).toEqual(new Set(['50000.00']));
  });

  it('un contract de mentenanta fara abonament lunar e refuzat inainte sa atinga baza', async () => {
    const base = await ground();
    const error = await rejection(
      createContract(officeActor(), contractInput(base, { monthlyValue: '' })),
    );
    expect(String(error)).toContain('abonament lunar');
  });

  it('contractul si anii lui sunt atomici — codul duplicat nu lasa ani orfani', async () => {
    const base = await ground();
    await createContract(officeActor(), contractInput(base));
    const error = await rejection(createContract(officeActor(), contractInput(base)));
    expect(String(error)).toContain('Există deja un contract');

    const orphans = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(sql`
        select count(*)::int as n from app.contract_years y
         where not exists (select 1 from app.contracts c where c.id = y.contract_id)`);
      return (result.rows as { n: number }[])[0]?.n;
    });
    expect(orphans).toBe(0);
  });

  it('lista se filtreaza pe firmele selectate, si o selectie goala da zero randuri', async () => {
    const base = await ground();
    await createContract(officeActor(), contractInput(base));

    const mine = await listContracts(officeActor(), { companyIds: [base.companyId] });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.clientName).toContain('Client');
    expect(mine[0]?.yearCount).toBe(4);

    expect(await listContracts(officeActor(), { companyIds: [] })).toEqual([]);
  });
});

describe('componente si plafoane', () => {
  // Verificarea #3.
  it('cele trei componente primesc is_fill_target corect, derivat din tip', async () => {
    const base = await ground();
    const { id: contractId } = await createContract(officeActor(), contractInput(base));

    await createComponent(officeActor(), {
      contractId,
      type: 'mentenanta',
      name: 'Mentenanță',
      budgetCadence: 'lunar',
    });
    await createComponent(officeActor(), {
      contractId,
      type: 'lucrari',
      name: 'Lucrări',
      budgetCadence: 'anual',
    });
    await createComponent(officeActor(), {
      contractId,
      type: 'delta',
      name: 'Delta',
      budgetCadence: 'lunar',
    });

    const components = await listComponents(officeActor(), contractId);
    const fill = Object.fromEntries(components.map((c) => [c.type, c.isFillTarget]));
    expect(fill).toEqual({ mentenanta: false, lucrari: false, delta: true });
  });

  it('Lucrări cu cadenta lunara e refuzat de schema, nu de baza', async () => {
    const base = await ground();
    const { id: contractId } = await createContract(officeActor(), contractInput(base));
    const error = await rejection(
      createComponent(officeActor(), {
        contractId,
        type: 'lucrari',
        name: 'Lucrări',
        budgetCadence: 'lunar',
      }),
    );
    expect(String(error)).toContain('plafon anual');
  });

  // Verificarea #5, in intelesul ei literal: si prima setare cere motiv.
  it('plafonul fara motiv e respins la CREARE, nu doar la modificare', async () => {
    const base = await ground();
    const { id: contractId } = await createContract(officeActor(), contractInput(base));
    const { id: componentId } = await createComponent(officeActor(), {
      contractId,
      type: 'mentenanta',
      name: 'Mentenanță',
      budgetCadence: 'lunar',
    });
    const periodId = await openPeriod(base.companyId, 2026, 3);

    const error = await rejection(
      setCostCeiling(officeActor(), {
        componentId,
        periodId,
        contractYearId: '',
        allocatedRevenue: '',
        costCeiling: '40000.00',
        reason: '',
      }),
    );
    expect(String(error)).toContain('motiv scris');
  });

  it('setarea de doua ori actualizeaza randul, nu creeaza al doilea', async () => {
    const base = await ground();
    const { id: contractId } = await createContract(officeActor(), contractInput(base));
    const { id: componentId } = await createComponent(officeActor(), {
      contractId,
      type: 'mentenanta',
      name: 'Mentenanță',
      budgetCadence: 'lunar',
    });
    const periodId = await openPeriod(base.companyId, 2026, 4);

    const first = await setCostCeiling(officeActor(), {
      componentId,
      periodId,
      contractYearId: '',
      allocatedRevenue: '60000.00',
      costCeiling: '40000.00',
      reason: 'plan initial de an',
    });
    const second = await setCostCeiling(officeActor(), {
      componentId,
      periodId,
      contractYearId: '',
      allocatedRevenue: '60000.00',
      costCeiling: '44000.00',
      reason: 'crestere de pret la materiale',
    });

    expect(second.id).toBe(first.id);

    const audited = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(sql`
        select reason from audit.entries
         where table_name = 'app.component_ceilings' and record_id = ${first.id}
           and operation = 'update'`);
      return (result.rows as { reason: string }[]).map((row) => row.reason);
    });
    expect(audited).toEqual(['crestere de pret la materiale']);
  });

  it('plafonul de venit merge doar pe Delta; pe mentenanta baza il refuza in romana', async () => {
    const base = await ground();
    const { id: contractId } = await createContract(officeActor(), contractInput(base));
    const { id: maintenance } = await createComponent(officeActor(), {
      contractId,
      type: 'mentenanta',
      name: 'Mentenanță',
      budgetCadence: 'lunar',
    });
    const periodId = await openPeriod(base.companyId, 2026, 5);

    const error = await rejection(
      setRevenueCeiling(officeActor(), {
        componentId: maintenance,
        periodId,
        allocatedRevenue: '',
        revenueCeiling: '20000.00',
        reason: 'incercare',
      }),
    );
    expect(String(error)).toContain('Delta are plafon de venit');
  });
});

describe('prezentarea contractului', () => {
  // Verificarea #7: trei benzi, Delta cu lei neumpluti.
  it('produce o banda per componenta, cu Delta masurata ca umplere', async () => {
    const base = await ground();
    const { id: contractId } = await createContract(officeActor(), contractInput(base));
    const periodId = await openPeriod(base.companyId, 2026, 8);

    const maintenance = await createComponent(officeActor(), {
      contractId,
      type: 'mentenanta',
      name: 'Mentenanță',
      budgetCadence: 'lunar',
    });
    const delta = await createComponent(officeActor(), {
      contractId,
      type: 'delta',
      name: 'Delta',
      budgetCadence: 'lunar',
    });

    await setCostCeiling(officeActor(), {
      componentId: maintenance.id,
      periodId,
      contractYearId: '',
      allocatedRevenue: '50000.00',
      costCeiling: '30000.00',
      reason: 'plan de luna',
    });
    await setRevenueCeiling(officeActor(), {
      componentId: delta.id,
      periodId,
      allocatedRevenue: '7600.00',
      revenueCeiling: '20000.00',
      reason: 'buget Delta august',
    });

    const overview = await getContractOverview(officeActor(), contractId, 2026, 8);

    // Luna august 2026 cade in anul contractual 1 (01.03.2026 – 28.02.2027).
    expect(overview.contractYear?.yearIndex).toBe(1);
    expect(overview.monthlyValue?.toString()).toBe('50000.00');
    expect(overview.bands).toHaveLength(2);

    const deltaBand = overview.bands.find((band) => band.component.isFillTarget);
    expect(deltaBand?.usage).toBeNull();
    expect(deltaBand?.fill?.fillPercent).toBe(38);
    expect(deltaBand?.fill?.unfilled.toString()).toBe('12400.00');

    const maintenanceBand = overview.bands.find((band) => !band.component.isFillTarget);
    expect(maintenanceBand?.fill).toBeNull();
    // Pasul 06 aduce rollup-urile. Pana atunci zero, si se vede ca e zero.
    expect(maintenanceBand?.usage?.used.toString()).toBe('0.00');
    expect(maintenanceBand?.usage?.remaining.toString()).toBe('30000.00');
    expect(maintenanceBand?.allocatedRevenue.toString()).toBe('50000.00');
  });

  it('o luna fara plafoane nu crapa — benzile exista, cifrele lipsesc', async () => {
    const base = await ground();
    const { id: contractId } = await createContract(officeActor(), contractInput(base));
    await createComponent(officeActor(), {
      contractId,
      type: 'mentenanta',
      name: 'Mentenanță',
      budgetCadence: 'lunar',
    });

    const overview = await getContractOverview(officeActor(), contractId, 2026, 9);
    expect(overview.bands[0]?.usage?.hasCeiling).toBe(false);
  });
});

describe('alerte de contract', () => {
  // Verificarea #17: o singura alerta, nu 40.
  it('contractul care expira produce o alerta, si a doua rulare nu mai adauga nimic', async () => {
    const base = await ground();
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 5);
    const endsOn = soon.toISOString().slice(0, 10);

    const { id: contractId } = await createContract(
      officeActor(),
      contractInput(base, {
        type: 'individual_deviz',
        monthlyValue: '',
        startsOn: new Date().toISOString().slice(0, 10),
        endsOn,
      }),
    );

    await scanContractExpiry();
    await scanContractExpiry();
    await scanContractExpiry();

    const alerts = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(sql`
        select id, title from app.alerts
         where scope_type = 'contract' and scope_id = ${contractId}
           and kind = 'contract_expira' and resolved_at is null`);
      return result.rows as { id: string; title: string }[];
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.title).toContain('expiră pe');
  });

  it('un contract care expira peste doi ani nu produce alerta', async () => {
    const base = await ground();
    const far = new Date();
    far.setFullYear(far.getFullYear() + 2);

    const { id: contractId } = await createContract(
      officeActor(),
      contractInput(base, {
        type: 'individual_deviz',
        monthlyValue: '',
        startsOn: new Date().toISOString().slice(0, 10),
        endsOn: far.toISOString().slice(0, 10),
      }),
    );

    await scanContractExpiry();

    const alerts = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(
        sql`select id from app.alerts where scope_id = ${contractId} and kind = 'contract_expira'`,
      );
      return result.rows;
    });
    expect(alerts).toHaveLength(0);
  });

  it('Delta ramasa in urma ridica alerta cu leii neumpluti in titlu', async () => {
    const base = await ground();
    const now = new Date();
    const { id: contractId } = await createContract(officeActor(), contractInput(base));
    const periodId = await openPeriod(base.companyId, now.getFullYear(), now.getMonth() + 1);

    const delta = await createComponent(officeActor(), {
      contractId,
      type: 'delta',
      name: 'Delta',
      budgetCadence: 'lunar',
    });
    await setRevenueCeiling(officeActor(), {
      componentId: delta.id,
      periodId,
      allocatedRevenue: '0.00',
      revenueCeiling: '20000.00',
      reason: 'buget Delta',
    });

    // Pe 20 ale lunii, ritmul asteptat e ~65%. Cu 0 lei alocati, e „in urma”.
    const twentieth = new Date(now.getFullYear(), now.getMonth(), 20);
    await scanDeltaFill(twentieth);
    await scanDeltaFill(twentieth);

    const alerts = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(sql`
        select title, severity::text as severity from app.alerts
         where scope_id = ${contractId} and kind = 'delta_sub_ritm' and resolved_at is null`);
      return result.rows as { title: string; severity: string }[];
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.title).toContain('neumpluți');
    expect(alerts[0]?.severity).toBe('critical');
  });

  it('Delta umpluta peste ritm nu produce alerta', async () => {
    const base = await ground();
    const now = new Date();
    const { id: contractId } = await createContract(officeActor(), contractInput(base));
    const periodId = await openPeriod(base.companyId, now.getFullYear(), now.getMonth() + 1);

    const delta = await createComponent(officeActor(), {
      contractId,
      type: 'delta',
      name: 'Delta',
      budgetCadence: 'lunar',
    });
    await setRevenueCeiling(officeActor(), {
      componentId: delta.id,
      periodId,
      allocatedRevenue: '20000.00',
      revenueCeiling: '20000.00',
      reason: 'buget Delta',
    });

    await scanDeltaFill(new Date(now.getFullYear(), now.getMonth(), 20));

    const alerts = await withActor(officeActor(), async (tx) => {
      const result = await tx.execute(
        sql`select id from app.alerts where scope_id = ${contractId} and kind = 'delta_sub_ritm'`,
      );
      return result.rows;
    });
    expect(alerts).toHaveLength(0);
  });
});

/** Ancora de tipuri: schema exportata de `@damina/db` chiar are tabelele noi. */
it('schema expune tabelele pasului 04', () => {
  expect(schema.contracts).toBeDefined();
  expect(schema.componentCeilings).toBeDefined();
  expect(schema.contractObjectives).toBeDefined();
});
