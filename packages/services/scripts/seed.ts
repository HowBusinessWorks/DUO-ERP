import { closeConnections, loadEnvFiles, schema, withActor, type Actor } from '@damina/db';
import { and, eq, inArray, or } from 'drizzle-orm';
import {
  createComponent,
  createContract,
  setCostCeiling,
  setRevenueCeiling,
} from '../src/contracts';
import { addProfileItem, createInspectionProfile, linkObjective } from '../src/objectives';
import { ensureOpenPeriods } from '../src/periods';
import { createStage, createWorkUnit } from '../src/work-units';

/**
 * Seed-ul DETERMINIST al fazei 0 (pasul 04, §7).
 *
 * Doua lucruri il fac util, si amandoua sunt alegeri, nu detalii:
 *
 * 1. **ID-uri fixe.** Testele E2E de acum incolo se leaga de ele. Un seed cu
 *    id-uri aleatoare inseamna un test care cauta „primul contract din lista” —
 *    adica un test care pica atunci cand cineva adauga al doilea.
 *
 * 2. **Trece prin SERVICII, nu prin `insert` direct.** Anii contractuali se
 *    genereaza de `createContract`, plafoanele trec prin trigger-ul de motiv
 *    scris, legaturile trec prin `exclude`. Un seed care ocoleste regulile
 *    produce o baza in care aplicatia n-ar fi putut ajunge singura, si atunci
 *    testele verifica o realitate care nu exista.
 *
 * Rulare:  pnpm db:seed          — creeaza ce lipseste, nu atinge ce exista
 *          pnpm db:seed --force  — sterge intai datele de seed, apoi recreeaza
 */

loadEnvFiles();

/** Prefix rezervat seed-ului. Orice id care incepe cu el e date de test. */
const P = '01950000';
const id = (group: number, index = 0): string =>
  `${P}-0000-7000-8000-${String(group).padStart(6, '0')}${String(index).padStart(6, '0')}`;

const IDS = {
  companyA: id(1, 1),
  companyB: id(1, 2),
  clientApaNova: id(2, 1),
  clientPrimarie: id(2, 2),
  pm: id(3, 1),
  /**
   * Marius Dobre, seful de santier. Persoana e creata AICI, iar contul lui de
   * login in `seed-users.ts` — care o gaseste existenta si doar o leaga.
   *
   * Emailul se repeta in ambele fisiere dinadins, ca la PM: `seed-users` insereaza
   * cu `on conflict do nothing`, deci daca persoana ar aparea aici fara email, ar
   * ramane fara el pentru totdeauna.
   */
  fieldLead: id(3, 2),
  contractMaintenance: id(4, 1),
  contractIndividual: id(4, 2),
  checklistStation: id(5, 1),
  checklistBasin: id(5, 2),
  objective: (n: number) => id(7, n),
  workUnitLucrare: id(8, 1),
  workUnitInterventie: id(8, 2),
  workUnitInspectie: id(8, 3),
};

/** Seriile de numerotare, per firma. Codurile UL trec prin acelasi alocator. */
const SERIES = {
  lucrare: 'L',
  interventie: 'IV',
  inspectie: 'I',
  nota_realocare: 'NRA',
} as const;

/** Profilele isi iau id-ul din baza, deci numele le e cheia — si aici, si in `wipe`. */
const PROFILE_QUARTERLY = 'Trimestrial — stații';
const PROFILE_MONTHLY = 'Lunar — obiective critice';

const OBJECTIVES = [
  { kind: 'statie_pompare', name: 'Stația de pompare' },
  { kind: 'bazin', name: 'Bazin de retenție' },
  { kind: 'gura_canal', name: 'Gură de canal' },
  { kind: 'rezervor', name: 'Rezervor' },
  { kind: 'cladire', name: 'Clădire tehnică' },
] as const;

/** Bucuresti, imprastiate cat sa se vada ca pin-uri distincte pe harta. */
const BASE_LAT = 44.4268;
const BASE_LNG = 26.1025;

const actor = (reason?: string): Actor => ({
  personId: IDS.pm,
  persona: 'office',
  pgRole: 'app_office',
  claims: { persona: 'office', person_id: IDS.pm, office_roles: ['admin'] },
  ...(reason === undefined ? {} : { reason }),
});

/**
 * `--force` nu mai poate sterge tot, de la pasul 05a incoace, si asta e o
 * consecinta a unei reguli, nu un bug.
 *
 * Alocarile de finantare NU se sterg — trigger-ul `funding_allocations_immutable`
 * refuza `delete` pentru oricine, pentru ca o alocare stearsa ia cu ea explicatia
 * unei cifre deja raportate. Iar cum alocarile arata spre componentele
 * contractului, nici contractul nu se mai poate sterge.
 *
 * Deci: cand exista unitati de lucru de seed, singura reconstruire de la zero e
 * `pnpm db:reset`. Mesajul o spune, in loc sa lase omul cu un `23503` in fata.
 */
async function assertWipeable(): Promise<void> {
  const seeded = await withActor(actor(), async (tx) =>
    tx
      .select({ id: schema.workUnits.id })
      .from(schema.workUnits)
      .where(
        inArray(schema.workUnits.id, [
          IDS.workUnitLucrare,
          IDS.workUnitInterventie,
          IDS.workUnitInspectie,
        ]),
      )
      .limit(1),
  );

  if (seeded.length > 0) {
    throw new Error(
      'Exista unitati de lucru de seed, iar alocarile lor de finantare nu se pot sterge ' +
        '(regula pasului 05: o alocare stearsa ia cu ea explicatia unei cifre raportate). ' +
        'Ca sa reconstruiesti de la zero, ruleaza `pnpm db:reset`.',
    );
  }
}

async function wipe(): Promise<void> {
  await assertWipeable();

  // Ordinea conteaza doar pentru ce n-are `on delete cascade`.
  await withActor(actor('stergere date de seed'), async (tx) => {
    // Cautate dupa cheia naturala (cod + firma), nu dupa id: rulari mai vechi
    // ale seed-ului au lasat contracte cu id generat, iar ele blocheaza unicul
    // pe cod la reluare. Codurile '4700' si '5100' sunt rezervate seed-ului.
    const stale = await tx
      .select({ id: schema.contracts.id })
      .from(schema.contracts)
      .where(
        and(
          inArray(schema.contracts.companyId, [IDS.companyA, IDS.companyB]),
          inArray(schema.contracts.code, ['4700', '5100']),
        ),
      );
    const contractIds = stale.map((row) => row.id);
    if (contractIds.length > 0) {
      await tx.delete(schema.contractObjectives).where(
        inArray(schema.contractObjectives.contractId, contractIds),
      );
      await tx.delete(schema.contracts).where(inArray(schema.contracts.id, contractIds));
    }
    await tx.delete(schema.objectives).where(
      inArray(
        schema.objectives.id,
        Array.from({ length: 20 }, (_, index) => IDS.objective(index + 1)),
      ),
    );
    // Profilele isi iau id-ul din baza (`createInspectionProfile` nu-l impune),
    // deci si ele se cauta dupa cheia naturala — numele.
    const profiles = await tx
      .select({ id: schema.inspectionProfiles.id })
      .from(schema.inspectionProfiles)
      .where(inArray(schema.inspectionProfiles.name, [PROFILE_QUARTERLY, PROFILE_MONTHLY]));
    // Randurile de profil trimit si spre fise, nu doar spre profil: sterse dupa
    // ambele capete, altfel fisele raman referite si `delete` pica cu 23503.
    await tx.delete(schema.inspectionProfileItems).where(
      or(
        inArray(schema.inspectionProfileItems.profileId, profiles.map((row) => row.id)),
        inArray(schema.inspectionProfileItems.checklistId, [IDS.checklistStation, IDS.checklistBasin]),
      ),
    );
    await tx.delete(schema.inspectionProfiles).where(
      inArray(schema.inspectionProfiles.name, [PROFILE_QUARTERLY, PROFILE_MONTHLY]),
    );
    await tx.delete(schema.checklists).where(
      inArray(schema.checklists.id, [IDS.checklistStation, IDS.checklistBasin]),
    );
  });
  console.log('Datele de seed sterse.');
}

async function exists(): Promise<boolean> {
  return withActor(actor(), async (tx) => {
    const rows = await tx
      .select({ id: schema.contracts.id })
      .from(schema.contracts)
      .where(
        and(
          eq(schema.contracts.companyId, IDS.companyA),
          eq(schema.contracts.code, '4700'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
}

/** Firme, client si PM. Inserate direct: nu exista inca use-case pentru ele. */
async function bootstrap(): Promise<void> {
  await withActor(actor('seed'), async (tx) => {
    await tx
      .insert(schema.companies)
      .values([
        { id: IDS.companyA, name: 'Damina Construct SRL', cui: 'RO11111111' },
        { id: IDS.companyB, name: 'Damina Instal SRL', cui: 'RO22222222' },
      ])
      .onConflictDoNothing();

    await tx
      .insert(schema.clients)
      .values([
        { id: IDS.clientApaNova, name: 'Apa Nova București', cui: 'RO12345678', paymentTermDays: 70 },
        { id: IDS.clientPrimarie, name: 'Primăria Sector 3', cui: 'RO87654321', paymentTermDays: 90 },
      ])
      .onConflictDoNothing();

    await tx
      .insert(schema.persons)
      .values({
        id: IDS.pm,
        persona: 'office',
        category: 'angajat',
        fullName: 'Andrei Ionescu',
        email: 'andrei.ionescu@damina.test',
      })
      .onConflictDoNothing();

    await tx
      .insert(schema.personOfficeRoles)
      .values([
        { personId: IDS.pm, role: 'pm' },
        { personId: IDS.pm, role: 'admin' },
      ])
      .onConflictDoNothing();

    await tx
      .insert(schema.personCompanyAccess)
      .values([
        { personId: IDS.pm, companyId: IDS.companyA },
        { personId: IDS.pm, companyId: IDS.companyB },
      ])
      .onConflictDoNothing();
  });

  for (const companyId of [IDS.companyA, IDS.companyB]) {
    await ensureOpenPeriods(actor('seed'), companyId, 2026);
  }
}

async function inspectionLibrary(): Promise<void> {
  await withActor(actor('seed'), async (tx) => {
    await tx
      .insert(schema.checklists)
      .values([
        {
          id: IDS.checklistStation,
          code: 'INSP-SP',
          name: 'Inspecție stație de pompare',
          objectiveKind: 'statie_pompare',
          version: 1,
        },
        {
          id: IDS.checklistBasin,
          code: 'INSP-BZ',
          name: 'Inspecție bazin',
          objectiveKind: 'bazin',
          version: 1,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(schema.checklistItems)
      .values([
        {
          checklistId: IDS.checklistStation,
          position: 1,
          text: 'Pompele pornesc și se opresc la comandă',
          isCritical: true,
        },
        {
          checklistId: IDS.checklistStation,
          position: 2,
          text: 'Fără scurgeri la garnituri',
          requiresPhoto: true,
        },
        { checklistId: IDS.checklistStation, position: 3, text: 'Tabloul electric — fără urme de arc' },
        { checklistId: IDS.checklistBasin, position: 1, text: 'Nivelul apei în limite', requiresPhoto: true },
        { checklistId: IDS.checklistBasin, position: 2, text: 'Grătarul de la intrare e curat' },
      ])
      .onConflictDoNothing();
  });

  await createInspectionProfile(actor('seed'), {
    name: PROFILE_QUARTERLY,
    description: 'Fișa de stație, o dată la trei luni.',
    isActive: true,
  }).catch(ignoreConflict);

  await createInspectionProfile(actor('seed'), {
    name: PROFILE_MONTHLY,
    description: 'Obiectivele care nu suportă trei luni fără verificare.',
    isActive: true,
  }).catch(ignoreConflict);

  // Profilele au id generat de serviciu, deci le recitim dupa nume.
  const profiles = await withActor(actor(), async (tx) =>
    tx.select().from(schema.inspectionProfiles),
  );
  const quarterly = profiles.find((profile) => profile.name === PROFILE_QUARTERLY);
  const monthly = profiles.find((profile) => profile.name === PROFILE_MONTHLY);

  if (quarterly !== undefined) {
    await addProfileItem(actor('seed'), {
      profileId: quarterly.id,
      checklistId: IDS.checklistStation,
      frequencyMonths: '3',
    }).catch(ignoreConflict);
  }
  if (monthly !== undefined) {
    await addProfileItem(actor('seed'), {
      profileId: monthly.id,
      checklistId: IDS.checklistBasin,
      frequencyMonths: '1',
    }).catch(ignoreConflict);
  }
}

function ignoreConflict(error: unknown): void {
  const message = String(error);
  if (!message.includes('Există deja') && !message.includes('deja în profil')) {
    throw error;
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  if (await exists()) {
    if (!force) {
      console.log('Seed-ul exista deja. Ruleaza cu --force ca sa-l refaci.');
      return;
    }
    await wipe();
  }

  await bootstrap();
  await inspectionLibrary();

  const profiles = await withActor(actor(), async (tx) =>
    tx.select().from(schema.inspectionProfiles),
  );
  const quarterly = profiles.find((profile) => profile.name === PROFILE_QUARTERLY)?.id ?? '';
  const monthly = profiles.find((profile) => profile.name === PROFILE_MONTHLY)?.id ?? '';

  // ── Cele 20 de obiective ───────────────────────────────────────────────────
  const objectiveIds: string[] = [];
  await withActor(actor('seed'), async (tx) => {
    const rows = Array.from({ length: 20 }, (_, index) => {
      const template = OBJECTIVES[index % OBJECTIVES.length];
      const number = index + 1;
      objectiveIds.push(IDS.objective(number));
      return {
        id: IDS.objective(number),
        code: `OB-${String(number).padStart(3, '0')}`,
        name: `${template?.name ?? 'Obiectiv'} ${String(number)}`,
        kind: template?.kind ?? 'altul',
        geoLat: (BASE_LAT + (index % 5) * 0.012 - 0.03).toFixed(7),
        geoLng: (BASE_LNG + Math.floor(index / 5) * 0.02 - 0.03).toFixed(7),
        areaSqm: String(80 + index * 15),
      };
    });
    await tx.insert(schema.objectives).values(rows).onConflictDoNothing();
  });
  console.log(`${String(objectiveIds.length)} obiective.`);

  // ── Contractul de mentenanta pe 4 ani ──────────────────────────────────────
  const maintenance = await createContract(actor('seed'), {
    companyId: IDS.companyA,
    clientId: IDS.clientApaNova,
    code: '4700',
    reference: 'Contract 4700 / 12.02.2026',
    type: 'mentenanta_multianual',
    startsOn: '2026-03-01',
    endsOn: '2030-02-28',
    totalValue: '2400000.00',
    monthlyValue: '50000.00',
    paymentTermDays: '70',
    indexationPct: '5',
    deltaThreshold: '2000.00',
    expiryAlertMonths: '6',
    ownerPersonId: IDS.pm,
    overheadPct: '12',
    status: 'activ',
  }, IDS.contractMaintenance);

  const components = {
    maintenance: await createComponent(actor('seed'), {
      contractId: maintenance.id,
      type: 'mentenanta',
      name: 'Mentenanță',
      budgetCadence: 'lunar',
    }),
    works: await createComponent(actor('seed'), {
      contractId: maintenance.id,
      type: 'lucrari',
      name: 'Lucrări',
      budgetCadence: 'anual',
    }),
    delta: await createComponent(actor('seed'), {
      contractId: maintenance.id,
      type: 'delta',
      name: 'Delta',
      budgetCadence: 'lunar',
    }),
  };

  // ── Plafoane pe trei luni ──────────────────────────────────────────────────
  const periods = await withActor(actor(), async (tx) =>
    tx.select().from(schema.periods).where(eq(schema.periods.companyId, IDS.companyA)),
  );

  const months = [
    { year: 2026, month: 3 },
    { year: 2026, month: 4 },
    { year: 2026, month: 5 },
  ];

  for (const [index, target] of months.entries()) {
    const period = periods.find((row) => row.year === target.year && row.month === target.month);
    if (period === undefined) {
      continue;
    }

    await setCostCeiling(actor(), {
      componentId: components.maintenance.id,
      periodId: period.id,
      contractYearId: '',
      allocatedRevenue: '30000.00',
      costCeiling: '18000.00',
      reason: 'plan de mentenanță, an contractual 1',
    });

    await setCostCeiling(actor(), {
      componentId: components.works.id,
      periodId: period.id,
      contractYearId: '',
      allocatedRevenue: '14000.00',
      costCeiling: '9500.00',
      reason: 'defalcare lunară a planului anual de lucrări',
    });

    // Delta: buget de VENIT, umplut partial, ca ecranul sa arate diferenta.
    await setRevenueCeiling(actor(), {
      componentId: components.delta.id,
      periodId: period.id,
      allocatedRevenue: ['7600.00', '15200.00', '3100.00'][index] ?? '0.00',
      revenueCeiling: '20000.00',
      reason: 'buget Delta convenit cu clientul',
    });
  }

  // Planul ANUAL al componentei Lucrari, pe anul contractual 1.
  const years = await withActor(actor(), async (tx) =>
    tx.select().from(schema.contractYears).where(eq(schema.contractYears.contractId, maintenance.id)),
  );
  const firstYear = years.find((year) => year.yearIndex === 1);
  if (firstYear !== undefined) {
    await setCostCeiling(actor(), {
      componentId: components.works.id,
      periodId: '',
      contractYearId: firstYear.id,
      allocatedRevenue: '168000.00',
      costCeiling: '114000.00',
      reason: 'plan anual de lucrări, an contractual 1',
    });
  }

  // ── Contractul individual ──────────────────────────────────────────────────
  const individual = await createContract(actor('seed'), {
    companyId: IDS.companyB,
    clientId: IDS.clientPrimarie,
    code: '5100',
    reference: 'Comandă 5100 / 03.04.2026',
    type: 'individual_deviz',
    startsOn: '2026-04-01',
    endsOn: '2026-10-31',
    totalValue: '186000.00',
    monthlyValue: '',
    paymentTermDays: '90',
    indexationPct: '0',
    deltaThreshold: '2000.00',
    expiryAlertMonths: '2',
    ownerPersonId: IDS.pm,
    overheadPct: '',
    status: 'activ',
  }, IDS.contractIndividual);

  await createComponent(actor('seed'), {
    contractId: individual.id,
    type: 'individual',
    name: 'Lucrare punctuală',
    budgetCadence: 'lunar',
  });

  // ── Obiectivele intra in contractul de mentenanta ──────────────────────────
  for (const [index, objectiveId] of objectiveIds.entries()) {
    await linkObjective(actor('seed'), {
      contractId: maintenance.id,
      objectiveId,
      validFrom: '2026-03-01',
      validTo: '',
      // Bazinele se verifica lunar, restul trimestrial.
      inspectionProfileId: index % 5 === 1 ? monthly : quarterly,
    });
  }

  // Doua obiective sunt SI pe contractul individual, in acelasi timp — cazul
  // real care justifica profilul pe legatura, nu pe obiectiv.
  for (const objectiveId of objectiveIds.slice(0, 2)) {
    await linkObjective(actor('seed'), {
      contractId: individual.id,
      objectiveId,
      validFrom: '2026-04-01',
      validTo: '2026-10-31',
      inspectionProfileId: monthly,
    });
  }

  // ── Unitatile de lucru (pasul 05) ──────────────────────────────────────────
  await seedWorkUnits({
    objectiveIds,
    delta: components.delta.id,
    maintenance: components.maintenance.id,
    contractId: maintenance.id,
  });

  console.log(
    'Seed complet: 2 firme, 2 contracte, 20 obiective, plafoane pe 3 luni, 3 unitati de lucru.',
  );
}

interface WorkUnitGround {
  readonly objectiveIds: readonly string[];
  readonly contractId: string;
  readonly delta: string;
  readonly maintenance: string;
}

/**
 * O lucrare finantata din Delta pe TREI luni, o interventie si o inspectie (§7).
 *
 * Cifrele nu sunt la intamplare: alocarile pe Delta sunt exact veniturile alocate
 * pe cele trei luni (7.600 · 15.200 · 3.100), deci suma unitatilor finantate din
 * componenta da exact cifra de pe banda ei — verificarea #14 a pasului, adevarata
 * prin constructie, nu prin coincidenta.
 *
 * Nu se sterge si nu se rescrie la reluare: `assertWipeable` opreste `--force`
 * inainte, iar aici se verifica existenta si se iese. Codurile ies din serie o
 * singura data, deci nu se schimba de la o rulare la alta.
 */
async function seedWorkUnits(base: WorkUnitGround): Promise<void> {
  const already = await withActor(actor(), async (tx) =>
    tx
      .select({ id: schema.workUnits.id })
      .from(schema.workUnits)
      .where(eq(schema.workUnits.id, IDS.workUnitLucrare))
      .limit(1),
  );
  if (already.length > 0) {
    console.log('Unitatile de lucru de seed exista deja.');
    return;
  }

  // Seful de santier, cu SSM valabil: fara autorizatie, trigger-ul din 05a
  // refuza asignarea — si asa trebuie sa fie.
  await withActor(actor('seed'), async (tx) => {
    await tx
      .insert(schema.persons)
      .values({
        id: IDS.fieldLead,
        persona: 'field',
        category: 'sef_santier',
        fullName: 'Marius Dobre',
        email: 'marius.sef@damina.test',
      })
      .onConflictDoNothing();
    await tx
      .insert(schema.personCompanyAccess)
      .values({ personId: IDS.fieldLead, companyId: IDS.companyA })
      .onConflictDoNothing();
    await tx
      .insert(schema.personAuthorizations)
      .values({
        personId: IDS.fieldLead,
        kind: 'ssm',
        issuedAt: '2026-01-01',
        expiresAt: '2027-12-31',
      })
      .onConflictDoNothing();

    // Seriile, la ambele firme: o serie lipsa da „NOT_FOUND: seria … nu e
    // definita" la prima creare din ecran, si nimeni nu ghiceste de ce.
    await tx
      .insert(schema.documentSeries)
      .values(
        [IDS.companyA, IDS.companyB].flatMap((companyId) =>
          (
            [
              ['lucrare', SERIES.lucrare],
              ['interventie', SERIES.interventie],
              ['inspectie', SERIES.inspectie],
              ['nota_realocare', SERIES.nota_realocare],
            ] as const
          ).map(([documentType, series]) => ({
            companyId,
            documentType,
            series,
            nextNumber: 1,
          })),
        ),
      )
      .onConflictDoNothing();
  });

  const periods = await withActor(actor(), async (tx) =>
    tx.select().from(schema.periods).where(eq(schema.periods.companyId, IDS.companyA)),
  );
  const periodOf = (year: number, month: number): string | undefined =>
    periods.find((row) => row.year === year && row.month === month)?.id;

  const march = periodOf(2026, 3);
  const april = periodOf(2026, 4);
  const may = periodOf(2026, 5);
  if (march === undefined || april === undefined || may === undefined) {
    console.log('Lunile 03-05/2026 lipsesc; unitatile de lucru se sar.');
    return;
  }

  const objective = (index: number): string => base.objectiveIds[index] ?? IDS.objective(1);

  // ── Lucrarea, pe trei luni de Delta ────────────────────────────────────────
  const lucrare = await createWorkUnit(
    actor('seed'),
    {
      workUnit: {
        companyId: IDS.companyA,
        type: 'lucrare',
        name: 'Reabilitare stație de pompare SP-1',
        objectiveId: objective(0),
        contractObjectiveId: '',
        responsiblePersonId: IDS.pm,
        executorType: 'echipa_proprie',
        executorSubcontractorId: '',
        startsOn: '2026-03-02',
        endsOn: '',
        estimatedValue: '25900.00',
        costBudget: '18500.00',
      },
      allocations: [
        { periodId: march, amount: '7600.00' },
        { periodId: april, amount: '15200.00' },
        { periodId: may, amount: '3100.00' },
      ].map(({ periodId, amount }) => ({
        contractId: base.contractId,
        componentId: base.delta,
        periodId,
        allocatedAmount: amount,
        allocatedPct: '',
        reason: 'lucrare mare, tăiată pe trei luni de Delta',
      })),
      assignments: [
        { personId: IDS.fieldLead, role: 'sef_santier', validFrom: '2026-03-02', validTo: '' },
      ],
      series: SERIES.lucrare,
    },
    IDS.workUnitLucrare,
  );

  // Etape: prima incheiata, ca Prezentarea sa aiba ce desena in bara de progres.
  const stages = [
    { name: 'Demontare echipament vechi', start: '2026-03-02', end: '2026-03-20', pct: '25' },
    { name: 'Montaj pompe noi', start: '2026-03-23', end: '2026-04-24', pct: '50' },
    { name: 'Probe și punere în funcțiune', start: '2026-04-27', end: '2026-05-15', pct: '25' },
  ];
  const stageIds: string[] = [];
  for (const stage of stages) {
    const created = await createStage(actor('seed'), {
      workUnitId: lucrare.id,
      name: stage.name,
      plannedStart: stage.start,
      plannedEnd: stage.end,
      materialBudget: '',
      laborBudget: '',
      pctOfWork: stage.pct,
    });
    stageIds.push(created.id);
  }
  await withActor(actor('seed'), async (tx) => {
    await tx
      .update(schema.workStages)
      .set({ actualStart: '2026-03-02', actualEnd: '2026-03-19' })
      .where(eq(schema.workStages.id, stageIds[0] ?? ''));
  });

  // ── Interventia, pe mentenanta ─────────────────────────────────────────────
  await createWorkUnit(
    actor('seed'),
    {
      workUnit: {
        companyId: IDS.companyA,
        type: 'interventie',
        name: 'Înlocuire vană DN100',
        objectiveId: objective(2),
        contractObjectiveId: '',
        responsiblePersonId: IDS.pm,
        executorType: 'echipa_proprie',
        executorSubcontractorId: '',
        startsOn: '2026-03-10',
        endsOn: '2026-03-10',
        estimatedValue: '840.00',
        costBudget: '600.00',
      },
      allocations: [
        {
          contractId: base.contractId,
          componentId: base.maintenance,
          periodId: march,
          allocatedAmount: '840.00',
          allocatedPct: '',
          reason: 'sub pragul de 2.000 lei, intră pe mentenanță',
        },
      ],
      assignments: [
        { personId: IDS.fieldLead, role: 'echipa', validFrom: '2026-03-10', validTo: '' },
      ],
      series: SERIES.interventie,
    },
    IDS.workUnitInterventie,
  );

  // ── Inspectia, nefinantata ────────────────────────────────────────────────
  await createWorkUnit(
    actor('seed'),
    {
      workUnit: {
        companyId: IDS.companyA,
        type: 'inspectie',
        name: 'Inspecție trimestrială bazin',
        objectiveId: objective(1),
        contractObjectiveId: '',
        responsiblePersonId: IDS.pm,
        executorType: 'echipa_proprie',
        executorSubcontractorId: '',
        startsOn: '2026-03-05',
        endsOn: '',
        estimatedValue: '',
        costBudget: '',
      },
      // O inspectie nu consuma buget: e o verificare pe checklist.
      allocations: [],
      assignments: [
        { personId: IDS.fieldLead, role: 'inspector', validFrom: '2026-03-05', validTo: '' },
      ],
      series: SERIES.inspectie,
    },
    IDS.workUnitInspectie,
  );

  console.log('3 unitati de lucru: o lucrare pe 3 luni de Delta, o interventie, o inspectie.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void closeConnections());
