import { closeConnections, withActor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createPerson,
  getPerson,
  linkAuthUser,
  listPersonOptions,
  listPersons,
  setCompanyAccess,
  setOfficeRoles,
  updatePerson,
} from '../src/admin';
import { officeActor, rejection } from './helpers';

afterAll(async () => {
  await closeConnections();
});

/** Valorile brute, asa cum vin din formular: siruri, cu `''` in loc de `null`. */
function personForm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const tag = uuidv7().slice(-8);
  return {
    fullName: `Om ${tag}`,
    email: `om.${tag}@damina.test`,
    phone: '',
    persona: 'office',
    category: 'angajat',
    qualificationId: '',
    subcontractorId: '',
    clientId: '',
    isActive: true,
    ...overrides,
  };
}

async function makeCompany(): Promise<string> {
  const id = uuidv7();
  await withActor(officeActor(), async (tx) => {
    await tx.execute(
      sql`insert into app.companies (id, name) values (${id}, ${`F ${id.slice(-8)}`})`,
    );
  });
  return id;
}

describe('persoane', () => {
  it('creeaza, citeste si modifica o persoana', async () => {
    const form = personForm();
    const { id } = await createPerson(officeActor(), form as never);

    const person = await getPerson(officeActor(), id);
    expect(person.fullName).toBe(form.fullName);
    expect(person.email).toBe(form.email);
    // Fara cont de login: persoana exista in nomenclator inainte sa se poata loga.
    expect(person.hasAccount).toBe(false);
    expect(person.officeRoles).toEqual([]);
    expect(person.companyIds).toEqual([]);

    await updatePerson(
      officeActor('test'),
      id,
      { ...form, phone: '0722 000 111' } as never,
    );
    expect((await getPerson(officeActor(), id)).phone).toBe('0722 000 111');
  });

  it('refuza doua persoane pe aceeasi adresa, cu mesaj in romana', async () => {
    const form = personForm();
    await createPerson(officeActor(), form as never);

    const error = await rejection(createPerson(officeActor(), personForm({ email: form.email }) as never));
    expect(String(error)).toMatch(/Există deja o persoană/);
  });

  it('impune consistenta persona ↔ firma legata', async () => {
    // Aceeasi regula ca cele doua `check`-uri din baza. Verificata in schema Zod,
    // ca sa iasa mesaj sub camp, dar baza ramane cea care nu se poate ocoli.
    const error = await rejection(
      createPerson(officeActor(), personForm({ persona: 'subcontractor' }) as never),
    );
    expect(String(error)).toMatch(/Subcontractant/);
  });
});

describe('roluri de birou', () => {
  it('salveaza SETUL, nu diferenta', async () => {
    const { id } = await createPerson(officeActor(), personForm() as never);

    await setOfficeRoles(officeActor('test'), { personId: id, roles: ['pm', 'financiar'] });
    expect((await getPerson(officeActor(), id)).officeRoles).toEqual(['financiar', 'pm']);

    // A doua salvare cu un singur rol le sterge pe celelalte — daca API-ul ar fi
    // fost „adauga”, ecranul ar fi trebuit sa calculeze singur ce sa stearga.
    await setOfficeRoles(officeActor('test'), { personId: id, roles: ['admin'] });
    expect((await getPerson(officeActor(), id)).officeRoles).toEqual(['admin']);

    await setOfficeRoles(officeActor('test'), { personId: id, roles: [] });
    expect((await getPerson(officeActor(), id)).officeRoles).toEqual([]);
  });

  it('nu da roluri de birou unui om de teren', async () => {
    const { id } = await createPerson(
      officeActor(),
      personForm({ persona: 'field', category: 'sef_santier' }) as never,
    );
    const error = await rejection(
      setOfficeRoles(officeActor('test'), { personId: id, roles: ['financiar'] }),
    );
    expect(String(error)).toMatch(/doar persoanelor cu persona/);
  });
});

describe('acces pe firme', () => {
  it('salveaza setul de firme si il intoarce cu numele lor', async () => {
    const [companyA, companyB] = await Promise.all([makeCompany(), makeCompany()]);
    const { id } = await createPerson(officeActor(), personForm() as never);

    await setCompanyAccess(officeActor('test'), { personId: id, companyIds: [companyA, companyB] });
    const person = await getPerson(officeActor(), id);
    expect([...person.companyIds].sort()).toEqual([companyA, companyB].sort());
    expect(person.companyNames).toHaveLength(2);

    await setCompanyAccess(officeActor('test'), { personId: id, companyIds: [companyA] });
    expect((await getPerson(officeActor(), id)).companyIds).toEqual([companyA]);
  });

  it('nu da acces pe firme unui portal', async () => {
    const companyId = await makeCompany();
    const clientId = uuidv7();
    await withActor(officeActor(), async (tx) => {
      await tx.execute(sql`insert into app.clients (id, name) values (${clientId}, 'Client test')`);
    });

    const { id } = await createPerson(
      officeActor(),
      personForm({ persona: 'client', category: 'client_user', clientId }) as never,
    );
    const error = await rejection(
      setCompanyAccess(officeActor('test'), { personId: id, companyIds: [companyId] }),
    );
    expect(String(error)).toMatch(/birou și din teren/);
  });
});

describe('contul de login', () => {
  it('legarea de un cont aprinde must_change_password', async () => {
    const { id } = await createPerson(officeActor(), personForm() as never);
    const authUserId = uuidv7();

    await linkAuthUser(officeActor('test'), id, authUserId);

    const person = await getPerson(officeActor(), id);
    expect(person.hasAccount).toBe(true);
    expect(person.authUserId).toBe(authUserId);
    // Nu e optiune: parola generata a fost vazuta de doi oameni.
    expect(person.mustChangePassword).toBe(true);
  });

  it('acelasi cont nu poate fi legat de doua persoane', async () => {
    const authUserId = uuidv7();
    const first = await createPerson(officeActor(), personForm() as never);
    const second = await createPerson(officeActor(), personForm() as never);

    await linkAuthUser(officeActor('test'), first.id, authUserId);
    const error = await rejection(linkAuthUser(officeActor('test'), second.id, authUserId));
    expect(String(error)).toMatch(/deja legat/);
  });
});

describe('liste', () => {
  it('cauta dupa nume si dupa email', async () => {
    const form = personForm();
    await createPerson(officeActor(), form as never);

    const byName = await listPersons(officeActor(), { query: String(form.fullName) });
    expect(byName.map((row) => row.fullName)).toContain(form.fullName);

    const byEmail = await listPersons(officeActor(), { query: String(form.email) });
    expect(byEmail.map((row) => row.email)).toContain(form.email);
  });

  it('optiunile de PM sunt doar oameni de birou, activi', async () => {
    const active = await createPerson(officeActor(), personForm() as never);
    const inactiveForm = personForm({ isActive: false });
    const inactive = await createPerson(officeActor(), inactiveForm as never);
    const fieldPerson = await createPerson(
      officeActor(),
      personForm({ persona: 'field', category: 'sef_santier' }) as never,
    );

    const ids = (await listPersonOptions(officeActor())).map((option) => option.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
    expect(ids).not.toContain(fieldPerson.id);
  });
});
