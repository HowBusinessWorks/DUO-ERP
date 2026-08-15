import { closeConnections, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createContract } from '../src/contracts';
import {
  addProfileItem,
  createChecklist,
  createInspectionProfile,
  createObjective,
  getInspectionCoverage,
  getObjective,
  linkObjective,
  listContractObjectives,
  listObjectives,
  unlinkObjective,
} from '../src/objectives';
import { listContractsForObjective } from '../src/contracts';
import { officeActor, rejection } from './helpers';

afterAll(async () => {
  await closeConnections();
});

async function makeContract(code: string): Promise<{ contractId: string; companyId: string }> {
  const companyId = uuidv7();
  const clientId = uuidv7();
  const tag = companyId.slice(-8);

  await withActor(officeActor(), async (tx) => {
    await tx.execute(sql`insert into app.companies (id, name) values (${companyId}, ${`F ${tag}`})`);
    await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, ${`C ${tag}`})`);
  });

  const { id } = await createContract(officeActor(), {
    companyId,
    clientId,
    code: `${code}-${tag}`,
    reference: '',
    type: 'individual_deviz',
    startsOn: '2026-01-01',
    endsOn: '2029-12-31',
    totalValue: '',
    monthlyValue: '',
    paymentTermDays: '70',
    indexationPct: '0',
    deltaThreshold: '2000.00',
    expiryAlertMonths: '6',
    ownerPersonId: '',
    overheadPct: '',
    status: 'activ',
  });

  return { contractId: id, companyId };
}

function objectiveInput(overrides: Record<string, unknown> = {}) {
  const tag = uuidv7().slice(-8);
  return {
    code: `OB-${tag}`,
    name: `Stația ${tag}`,
    kind: 'statie_pompare' as const,
    geoLat: '44.4268',
    geoLng: '26.1025',
    areaSqm: '120',
    isActive: true,
    ...overrides,
  };
}

describe('obiective', () => {
  it('se creeaza fara nicio referinta la firma — sunt comune grupului', async () => {
    const { id } = await createObjective(officeActor(), objectiveInput());
    const objective = await getObjective(officeActor(), id);

    expect(objective.geoLat).toBe('44.4268000');
    expect(objective.activeContractCount).toBe(0);
    expect(Object.keys(objective)).not.toContain('companyId');
  });

  it('o singura coordonata e refuzata inainte sa atinga baza', async () => {
    const error = await rejection(
      createObjective(officeActor(), objectiveInput({ geoLng: '' })),
    );
    expect(String(error)).toContain('ambele coordonate');
  });

  it('codul duplicat, chiar cu alt scris, da mesaj in romana', async () => {
    const input = objectiveInput();
    await createObjective(officeActor(), input);
    const error = await rejection(
      createObjective(officeActor(), { ...input, code: input.code.toLowerCase() }),
    );
    expect(String(error)).toContain('Există deja un obiectiv');
  });

  it('vederea de harta cere doar obiectivele cu coordonate', async () => {
    const withGeo = await createObjective(officeActor(), objectiveInput());
    const withoutGeo = await createObjective(
      officeActor(),
      objectiveInput({ geoLat: '', geoLng: '' }),
    );

    const pins = await listObjectives(officeActor(), { withCoordinatesOnly: true, limit: 1000 });
    const ids = pins.map((row) => row.id);

    expect(ids).toContain(withGeo.id);
    expect(ids).not.toContain(withoutGeo.id);
  });
});

describe('legatura contract ↔ obiectiv', () => {
  // Verificarea #11 + #12, prin serviciu.
  it('acelasi obiectiv pe doua contracte simultan, vizibil din ambele sensuri', async () => {
    const first = await makeContract('A');
    const second = await makeContract('B');
    const { id: objectiveId } = await createObjective(officeActor(), objectiveInput());

    for (const contract of [first, second]) {
      await linkObjective(officeActor(), {
        contractId: contract.contractId,
        objectiveId,
        validFrom: '2026-01-01',
        validTo: '',
        inspectionProfileId: '',
      });
    }

    // Din contract → obiectiv.
    expect(await listContractObjectives(officeActor(), first.contractId)).toHaveLength(1);

    // Din obiectiv → contracte. Regula de aur: legatura e navigabila in ambele
    // sensuri, altfel jumatate din intrebarile reale n-au raspuns.
    const contracts = await listContractsForObjective(officeActor(), objectiveId);
    expect(contracts).toHaveLength(2);
    expect(contracts.every((row) => row.isCurrent)).toBe(true);

    expect((await getObjective(officeActor(), objectiveId)).activeContractCount).toBe(2);
  });

  // Verificarea #10, prin serviciu: mesaj in romana, nu 23P01 pe ecran.
  it('suprapunerea pe acelasi contract da o propozitie, nu un cod SQL', async () => {
    const { contractId } = await makeContract('C');
    const { id: objectiveId } = await createObjective(officeActor(), objectiveInput());

    await linkObjective(officeActor(), {
      contractId,
      objectiveId,
      validFrom: '2026-01-01',
      validTo: '2027-01-01',
      inspectionProfileId: '',
    });

    const error = await rejection(
      linkObjective(officeActor(), {
        contractId,
        objectiveId,
        validFrom: '2026-06-01',
        validTo: '',
        inspectionProfileId: '',
      }),
    );

    expect(String(error)).toContain('deja pe contractul ăsta');
    expect(String(error)).not.toContain('23P01');
  });

  it('scoaterea din contract pastreaza randul si cere motiv', async () => {
    const { contractId } = await makeContract('D');
    const { id: objectiveId } = await createObjective(officeActor(), objectiveInput());
    const { id: linkId } = await linkObjective(officeActor(), {
      contractId,
      objectiveId,
      validFrom: '2026-01-01',
      validTo: '',
      inspectionProfileId: '',
    });

    const error = await rejection(unlinkObjective(officeActor(), linkId, '2026-09-01', '  '));
    expect(String(error)).toContain('motiv scris');

    // Data de iesire e in TRECUT fata de azi: altfel legatura ramane curenta,
    // si pe buna dreptate — un obiectiv anuntat ca iese luna viitoare e inca in
    // contract azi. `isCurrent` inseamna „acum”, nu „are data de sfarsit”.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await unlinkObjective(officeActor(), linkId, yesterday, 'trece pe contractul 4800');

    const links = await listContractObjectives(officeActor(), contractId);
    expect(links).toHaveLength(1);
    expect(links[0]?.validTo).toBe(yesterday);
    expect(links[0]?.isCurrent).toBe(false);
  });
});

describe('acoperire inspectii', () => {
  // Verificarea #16: 20 obiective, profil trimestrial, 0 inspectii.
  it('20 de obiective cu profil trimestrial dau 20 de randuri si 0 inspectii', async () => {
    const { contractId } = await makeContract('E');

    const { id: checklistId } = await createChecklist(officeActor(), {
      code: `CHK-${uuidv7().slice(-6)}`,
      name: 'Inspecție trimestrială stație',
      objectiveKind: 'statie_pompare',
      isActive: true,
    });
    const { id: profileId } = await createInspectionProfile(officeActor(), {
      name: `Trimestrial ${uuidv7().slice(-6)}`,
      description: '',
      isActive: true,
    });
    await addProfileItem(officeActor(), {
      profileId,
      checklistId,
      frequencyMonths: '3',
    });

    for (let i = 0; i < 20; i += 1) {
      const { id: objectiveId } = await createObjective(officeActor(), objectiveInput());
      await linkObjective(officeActor(), {
        contractId,
        objectiveId,
        validFrom: '2026-01-01',
        validTo: '',
        inspectionProfileId: profileId,
      });
    }

    // Aprilie e la 3 luni de la intrarea in contract: fisa trimestriala e datorata.
    const due = await getInspectionCoverage(officeActor(), contractId, 2026, 4);
    expect(due.objectiveCount).toBe(20);
    expect(due.rows).toHaveLength(20);
    expect(due.dueTotal).toBe(20);
    expect(due.doneTotal).toBe(0);
    expect(due.basis).toBe('profil de inspectie · fara date de teren');

    // Mai nu e multiplu de 3: nimic datorat, deci nicio restanta falsa.
    const quiet = await getInspectionCoverage(officeActor(), contractId, 2026, 5);
    expect(quiet.dueTotal).toBe(0);
    expect(quiet.objectiveCount).toBe(20);
  });

  it('un obiectiv fara profil apare in acoperire, dar fara frecventa', async () => {
    const { contractId } = await makeContract('F');
    const { id: objectiveId } = await createObjective(officeActor(), objectiveInput());
    await linkObjective(officeActor(), {
      contractId,
      objectiveId,
      validFrom: '2026-01-01',
      validTo: '',
      inspectionProfileId: '',
    });

    const coverage = await getInspectionCoverage(officeActor(), contractId, 2026, 4);
    expect(coverage.rows).toHaveLength(1);
    expect(coverage.rows[0]?.frequencyMonths).toBeNull();
    expect(coverage.dueTotal).toBe(0);
  });

  it('un obiectiv scos inainte de luna analizata nu mai apare', async () => {
    const { contractId } = await makeContract('G');
    const { id: objectiveId } = await createObjective(officeActor(), objectiveInput());
    const { id: linkId } = await linkObjective(officeActor(), {
      contractId,
      objectiveId,
      validFrom: '2026-01-01',
      validTo: '',
      inspectionProfileId: '',
    });
    await unlinkObjective(officeActor(), linkId, '2026-03-01', 'reziliat');

    expect((await getInspectionCoverage(officeActor(), contractId, 2026, 2)).objectiveCount).toBe(1);
    expect((await getInspectionCoverage(officeActor(), contractId, 2026, 4)).objectiveCount).toBe(0);
  });
});
