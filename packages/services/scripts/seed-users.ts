import { randomBytes } from 'node:crypto';
import { closeConnections, loadEnvFiles, schema, withActor, type Actor } from '@damina/db';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

/**
 * Conturi de test, cate unul per persona (pasul 02c).
 *
 * Ecranul de provizionare vine in 02d; pana atunci verificarile #12–#15 au
 * nevoie de oameni care se pot loga. Scriptul face exact ce va face ecranul:
 *
 *   1. se asigura ca persoana exista in `app.persons` (id fix, ca in seed);
 *   2. creeaza contul GoTrue prin Admin API, cu parola temporara;
 *   3. leaga cele doua prin `auth_user_id` — de unde le ia hook-ul de token.
 *
 * Idempotent: rulat de doua ori, a doua oara doar reseteaza parolele. Nu sterge
 * niciodata conturi — un `delete` pe `auth.users` intr-un script de seed e o
 * unealta care intr-o zi se ruleaza pe alt proiect decat cel intentionat.
 *
 * Rulare:  pnpm db:seed:users
 *          pnpm db:seed:users --must-change   (pentru verificarea #15)
 *
 * Cere `pnpm db:seed` inainte: firmele si clientii vin de acolo.
 */

loadEnvFiles();

const P = '01950000';
const id = (group: number, index = 0): string =>
  `${P}-0000-7000-8000-${String(group).padStart(6, '0')}${String(index).padStart(6, '0')}`;

const IDS = {
  companyA: id(1, 1),
  companyB: id(1, 2),
  clientApaNova: id(2, 1),
  pm: id(3, 1),
  fieldLead: id(3, 2),
  subcontractorUser: id(3, 3),
  clientUser: id(3, 4),
  subcontractor: id(6, 1),
};

const mustChange = process.argv.includes('--must-change');

/**
 * Parola temporara. Din `SEED_USER_PASSWORD` daca exista — altfel una generata,
 * afisata o singura data la final, ca pe ecranul PM-ului din §3.5.
 */
const PASSWORD =
  process.env.SEED_USER_PASSWORD ?? `Damina-${randomBytes(9).toString('base64url')}`;

interface SeedUser {
  readonly personId: string;
  readonly email: string;
  readonly fullName: string;
  readonly persona: 'office' | 'field' | 'subcontractor' | 'client';
  readonly category: 'angajat' | 'sef_santier' | 'subcontractant' | 'client_user';
  readonly officeRoles?: readonly ('pm' | 'admin' | 'financiar')[];
  readonly companyIds?: readonly string[];
  readonly subcontractorId?: string;
  readonly clientId?: string;
}

const USERS: readonly SeedUser[] = [
  {
    personId: IDS.pm,
    email: 'andrei.ionescu@damina.test',
    fullName: 'Andrei Ionescu',
    persona: 'office',
    category: 'angajat',
    officeRoles: ['pm', 'admin'],
    companyIds: [IDS.companyA, IDS.companyB],
  },
  {
    personId: IDS.fieldLead,
    email: 'marius.sef@damina.test',
    fullName: 'Marius Dobre',
    persona: 'field',
    category: 'sef_santier',
    // O SINGURA firma, dinadins: verificarea #4 din 02b cere un om care vede A
    // si nu vede B. Aici e omul acela.
    companyIds: [IDS.companyA],
  },
  {
    personId: IDS.subcontractorUser,
    email: 'contact@instalprest.test',
    fullName: 'Elena Vasile',
    persona: 'subcontractor',
    category: 'subcontractant',
    subcontractorId: IDS.subcontractor,
  },
  {
    personId: IDS.clientUser,
    email: 'dispecerat@apanova.test',
    fullName: 'Dispecerat Apa Nova',
    persona: 'client',
    category: 'client_user',
    clientId: IDS.clientApaNova,
  },
];

/** Actorul scriptului. Admin, ca sa treaca de politicile de scriere pe persoane. */
function actor(): Actor {
  return {
    personId: IDS.pm,
    persona: 'office',
    pgRole: 'app_office',
    claims: {
      persona: 'office',
      person_id: IDS.pm,
      office_roles: ['admin'],
      company_ids: [IDS.companyA, IDS.companyB],
    },
    reason: 'seed de conturi',
  };
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || url === '' || key === undefined || key === '') {
    throw new Error(
      'Lipsesc NEXT_PUBLIC_SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY din .env.local. ' +
        'Cheia de service se ia din Supabase → Project Settings → API.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Persoanele si nomenclatorul de care atarna, in baza noastra. */
async function ensurePersons(): Promise<void> {
  await withActor(actor(), async (tx) => {
    const companies = await tx
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(eq(schema.companies.id, IDS.companyA));
    if (companies.length === 0) {
      throw new Error('Firmele de seed lipsesc. Rulează întâi `pnpm db:seed`.');
    }

    await tx
      .insert(schema.subcontractors)
      .values({
        id: IDS.subcontractor,
        name: 'InstalPrest SRL',
        cui: 'RO33333333',
        specialties: ['instalații sanitare', 'termice'],
      })
      .onConflictDoNothing();

    for (const user of USERS) {
      await tx
        .insert(schema.persons)
        .values({
          id: user.personId,
          persona: user.persona,
          category: user.category,
          fullName: user.fullName,
          email: user.email,
          ...(user.subcontractorId === undefined ? {} : { subcontractorId: user.subcontractorId }),
          ...(user.clientId === undefined ? {} : { clientId: user.clientId }),
        })
        .onConflictDoNothing();

      if (user.officeRoles !== undefined) {
        await tx
          .insert(schema.personOfficeRoles)
          .values(user.officeRoles.map((role) => ({ personId: user.personId, role })))
          .onConflictDoNothing();
      }

      if (user.companyIds !== undefined) {
        await tx
          .insert(schema.personCompanyAccess)
          .values(user.companyIds.map((companyId) => ({ personId: user.personId, companyId })))
          .onConflictDoNothing();
      }
    }
  });
}

/** Contul GoTrue. Il creeaza sau, daca exista deja, ii reseteaza parola. */
async function ensureAuthUser(supabase: SupabaseClient, user: SeedUser): Promise<User> {
  const created = await supabase.auth.admin.createUser({
    email: user.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: user.fullName },
  });

  if (created.data.user !== null) {
    return created.data.user;
  }

  // `createUser` pe un email existent da eroare; il cautam si ii punem parola
  // noua, ca rularea a doua sa lase acelasi rezultat ca prima.
  const existing = await findByEmail(supabase, user.email);
  if (existing === null) {
    throw new Error(`Nu am putut crea contul ${user.email}: ${created.error?.message ?? '?'}`);
  }

  const updated = await supabase.auth.admin.updateUserById(existing.id, {
    password: PASSWORD,
    email_confirm: true,
  });
  if (updated.error !== null) {
    throw new Error(`Nu am putut reseta parola pentru ${user.email}: ${updated.error.message}`);
  }
  return existing;
}

async function findByEmail(supabase: SupabaseClient, email: string): Promise<User | null> {
  // Admin API-ul nu are cautare dupa email; la scara seed-ului, o pagina ajunge.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error !== null) {
    throw new Error(`Nu am putut lista conturile: ${error.message}`);
  }
  return data.users.find((candidate) => candidate.email === email) ?? null;
}

async function link(personId: string, authUserId: string): Promise<void> {
  await withActor(actor(), async (tx) => {
    await tx
      .update(schema.persons)
      .set({ authUserId, mustChangePassword: mustChange, isActive: true })
      .where(eq(schema.persons.id, personId));
  });
}

async function main(): Promise<void> {
  await ensurePersons();

  const supabase = adminClient();
  const lines: string[] = [];

  for (const user of USERS) {
    const authUser = await ensureAuthUser(supabase, user);
    await link(user.personId, authUser.id);
    lines.push(`  ${user.persona.padEnd(14)} ${user.email}`);
  }

  console.log('\nConturi gata. Parola e aceeași pentru toate:\n');
  console.log(lines.join('\n'));
  console.log(`\n  parola: ${PASSWORD}\n`);
  if (mustChange) {
    console.log('  must_change_password = true — primul login duce la /parola-noua.\n');
  }
  console.log(
    'Parola nu se mai afișează a doua oară decât dacă rulezi scriptul din nou.\n' +
      'Fixeaz-o cu SEED_USER_PASSWORD în .env.local dacă vrei una stabilă.\n',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeConnections);
