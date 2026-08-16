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
  contractMaintenance: id(4, 1),
  contractIndividual: id(4, 2),
  checklistStation: id(5, 1),
  checklistBasin: id(5, 2),
  objective: (n: number) => id(7, n),
};

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

async function wipe(): Promise<void> {
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

  console.log('Seed complet: 2 firme, 2 contracte, 20 obiective, plafoane pe 3 luni.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void closeConnections());
