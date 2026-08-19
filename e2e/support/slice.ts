import type { BrowserContext } from '@playwright/test';

/**
 * O felie de date fabricata, servita pe ruta reala de sincronizare.
 *
 * De ce asa si nu scriind direct in IndexedDB: aplicatia isi scrie singura
 * felia, cu acelasi cod care ruleaza pe telefon. Un test care ar popula Dexie de
 * mana ar fi trebuit sa stie numele magaziilor si cheile lor compuse — adica ar
 * fi ramas in urma la prima schimbare de schema locala, si ar fi facut-o tacut.
 *
 * Jobul de tapuri n-are baza de date, dinadins: masoara ecranul, nu datele.
 * Felia asta e minimul cu care ecranele au ce afisa.
 */

export interface SliceOptions {
  readonly workUnitId?: string;
  readonly companyId?: string;
}

const EMPTY_SNAPSHOT = {
  takenAt: '2026-08-19T06:00:00.000Z',
  workUnits: [],
  stages: [],
  checklists: [],
  stock: [],
  people: [],
  series: [],
  answers: [],
  interventions: [],
};

export async function installSlice(
  context: BrowserContext,
  options: SliceOptions = {},
): Promise<void> {
  const workUnitId = options.workUnitId ?? '01950000-0000-7000-8000-000000000001';
  const companyId = options.companyId ?? '01950000-0000-7000-8000-0000000000c0';

  const snapshot = {
    ...EMPTY_SNAPSHOT,
    workUnits: [
      {
        id: workUnitId,
        companyId,
        code: 'L-233',
        name: 'Lucrarea de test',
        type: 'lucrare',
        status: 'in_executie',
        objectiveId: '01950000-0000-7000-8000-0000000000b0',
        objectiveName: 'Stația Berceni',
        objectiveCode: 'OB-1',
        startsOn: '2026-08-19',
        endsOn: null,
        locationId: '',
        checklistId: null,
        performedOn: null,
        validated: false,
      },
    ],
  };

  await context.route('**/api/field/sync**', async (route) => {
    if (route.request().method() === 'POST') {
      // Nu se aplica nimic: testul masoara tapurile pana la trimitere, nu ce se
      // intampla dupa. Raspunsul trebuie doar sa fie unul valid.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ outcomes: [], applied: 0, blocked: false }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ since: null, cursor: snapshot.takenAt, full: true, snapshot }),
    });
  });
}
