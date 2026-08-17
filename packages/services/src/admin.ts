import type {
  CompanyAccessInput,
  OfficeRole,
  OfficeRolesInput,
  PersonInput,
} from '@damina/contracts';
import {
  companyAccessInputSchema,
  officeRoleSchema,
  officeRolesInputSchema,
  personInputSchema,
} from '@damina/contracts';
import { type Actor, schema, withActor } from '@damina/db';
import { AppError } from '@damina/shared';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

/**
 * Administrarea persoanelor si a accesului (pasul 02d).
 *
 * Ce e AICI: identitatea de business — cine e omul, ce persona are, ce roluri de
 * birou, la ce firme ajunge. Toate trei sunt sursele din care hook-ul de token
 * (`0013`) umple JWT-ul, deci tot ce se schimba pe ecranul de administrare se
 * propaga la urmatorul refresh de token.
 *
 * Ce NU e aici: contul GoTrue. Crearea lui cere cheia de service, care n-are ce
 * cauta in stratul de servicii (rulat si de worker, si de web). Ecranul cheama
 * `/api/admin/provision`, iar ruta aceea revine aici prin `linkAuthUser`.
 *
 * Stratul care apara ramane RLS: politicile de scriere pe `persons`,
 * `person_office_roles` si `person_company_access` cer deja rol de birou. Ce se
 * verifica aici e ca omul sa primeasca un mesaj in romana in loc de un `42501`.
 */

export interface ListPersonsOptions {
  readonly query?: string;
  readonly includeInactive?: boolean;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 200;

function like(query: string): string {
  return `%${query.replace(/([%_\\])/g, '\\$1')}%`;
}

function sqlstate(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    const { code } = current as Error & { code?: unknown };
    if (typeof code === 'string') {
      return code;
    }
    current = current.cause;
  }
  return undefined;
}

function asConflict(error: unknown, message: string): never {
  const code = sqlstate(error);
  if (code === '23505' || code === '23P01') {
    throw new AppError('CONFLICT', message);
  }
  if (code === '23514') {
    throw new AppError(
      'VALIDATION_FAILED',
      'Combinația de persona și firmă legată nu e permisă: „Subcontractant” cere o firmă subcontractantă, „Client” cere un client, iar restul le interzic pe amândouă.',
    );
  }
  throw error;
}

export type PersonRow = typeof schema.persons.$inferSelect & {
  /**
   * Tipul ingust, nu `string[]`.
   *
   * Coloana vine dintr-un `array_agg` peste un enum Postgres, deci valorile SUNT
   * roluri valide — dar `sql<...>` e o promisiune, nu o verificare. Promisiunea
   * se face aici, o data, pentru ca altfel fiecare consumator care intreaba
   * matricea de drepturi „vede preturi cu rolurile astea?” ar fi trebuit sa
   * filtreze singur, iar unul dintre ei ar fi uitat.
   */
  readonly officeRoles: readonly OfficeRole[];
  readonly companyIds: readonly string[];
  readonly companyNames: readonly string[];
  readonly qualificationName: string | null;
  readonly subcontractorName: string | null;
  readonly clientName: string | null;
  /** Are cont GoTrue? Deriva din `auth_user_id`, nu din alt tabel. */
  readonly hasAccount: boolean;
};

/**
 * Rolurile si firmele se agrega in interogare, nu in trei drumuri la baza.
 *
 * Subinterogarile sunt corelate, deci coloana exterioara e scrisa CALIFICAT
 * (`app.persons.id`). Fara prefix, drizzle o randeaza ca `"id"` si Postgres o
 * leaga de tabela dinauntru — conditia devine mereu falsa si contorul iese 0 in
 * tacere. Exact bugul din pasul 04a; nu se repeta.
 */
const rolesAgg = sql<string[]>`coalesce((
  select array_agg(r.role::text order by r.role::text)
    from app.person_office_roles r
   where r.person_id = app.persons.id
), '{}')`;

const companyIdsAgg = sql<string[]>`coalesce((
  select array_agg(a.company_id::text order by c.name)
    from app.person_company_access a
    join app.companies c on c.id = a.company_id
   where a.person_id = app.persons.id
), '{}')`;

const companyNamesAgg = sql<string[]>`coalesce((
  select array_agg(c.name order by c.name)
    from app.person_company_access a
    join app.companies c on c.id = a.company_id
   where a.person_id = app.persons.id
), '{}')`;

function selection() {
  return {
    person: schema.persons,
    officeRoles: rolesAgg,
    companyIds: companyIdsAgg,
    companyNames: companyNamesAgg,
    qualificationName: schema.qualifications.name,
    subcontractorName: schema.subcontractors.name,
    clientName: schema.clients.name,
  };
}

type SelectedPerson = {
  person: typeof schema.persons.$inferSelect;
  officeRoles: string[];
  companyIds: string[];
  companyNames: string[];
  qualificationName: string | null;
  subcontractorName: string | null;
  clientName: string | null;
};

function toRow(row: SelectedPerson): PersonRow {
  return {
    ...row.person,
    // Filtrarea nu e paranoia goala: `sql<...>` spune ce SPERAM sa vina, nu ce
    // vine. Daca maine se adauga o valoare in enum-ul din baza si nu si in
    // `officeRoleSchema`, aici se pierde un rol necunoscut in loc sa se
    // strecoare unul pe care matricea nu-l cunoaste.
    officeRoles: row.officeRoles.filter((role): role is OfficeRole =>
      (officeRoleSchema.options as readonly string[]).includes(role),
    ),
    companyIds: row.companyIds,
    companyNames: row.companyNames,
    qualificationName: row.qualificationName,
    subcontractorName: row.subcontractorName,
    clientName: row.clientName,
    hasAccount: row.person.authUserId !== null,
  };
}

export async function listPersons(
  actor: Actor,
  options: ListPersonsOptions = {},
): Promise<PersonRow[]> {
  const { query, includeInactive = true, limit = DEFAULT_LIMIT } = options;

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select(selection())
      .from(schema.persons)
      .leftJoin(schema.qualifications, eq(schema.persons.qualificationId, schema.qualifications.id))
      .leftJoin(
        schema.subcontractors,
        eq(schema.persons.subcontractorId, schema.subcontractors.id),
      )
      .leftJoin(schema.clients, eq(schema.persons.clientId, schema.clients.id))
      .where(
        and(
          includeInactive ? undefined : eq(schema.persons.isActive, true),
          query === undefined || query === ''
            ? undefined
            : or(
                ilike(schema.persons.fullName, like(query)),
                ilike(sql`${schema.persons.email}::text`, like(query)),
              ),
        ),
      )
      .orderBy(asc(schema.persons.fullName))
      .limit(limit);

    return rows.map(toRow);
  });
}

export async function getPerson(actor: Actor, id: string): Promise<PersonRow> {
  const row = await withActor(actor, async (tx) => {
    const rows = await tx
      .select(selection())
      .from(schema.persons)
      .leftJoin(schema.qualifications, eq(schema.persons.qualificationId, schema.qualifications.id))
      .leftJoin(
        schema.subcontractors,
        eq(schema.persons.subcontractorId, schema.subcontractors.id),
      )
      .leftJoin(schema.clients, eq(schema.persons.clientId, schema.clients.id))
      .where(eq(schema.persons.id, id))
      .limit(1);
    return rows[0];
  });

  if (row === undefined) {
    throw AppError.notFound('Persoana', id);
  }
  return toRow(row);
}

export async function createPerson(actor: Actor, input: PersonInput): Promise<{ id: string }> {
  const values = personInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.persons)
        .values(values)
        .returning({ id: schema.persons.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Persoana nu a putut fi salvată.');
      }
      return row;
    });
  } catch (error) {
    return asConflict(error, `Există deja o persoană cu adresa ${values.email ?? ''}.`);
  }
}

export async function updatePerson(
  actor: Actor,
  id: string,
  input: PersonInput,
): Promise<{ id: string }> {
  const values = personInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .update(schema.persons)
        .set(values)
        .where(eq(schema.persons.id, id))
        .returning({ id: schema.persons.id });
      if (row === undefined) {
        throw AppError.notFound('Persoana', id);
      }
      return row;
    });
  } catch (error) {
    return asConflict(error, `Există deja o persoană cu adresa ${values.email ?? ''}.`);
  }
}

/**
 * Rolurile de birou, ca SET complet.
 *
 * Nu „adaugă rolul X”: ecranul arata sapte casute, iar ce se trimite e starea
 * lor. Un API de adaugare/stergere ar fi cerut ca ecranul sa calculeze
 * diferenta, adica sa existe un al doilea loc care poate gresi.
 *
 * Rolurile n-au sens decat pentru persona `office` — un sef de santier cu rol
 * `financiar` ar arata pe ecran un drept pe care matricea nu-l da si RLS-ul nu-l
 * respecta. Se refuza aici, unde iese mesaj citibil.
 */
export async function setOfficeRoles(
  actor: Actor,
  input: OfficeRolesInput,
): Promise<{ id: string }> {
  const { personId, roles } = officeRolesInputSchema.parse(input);
  const unique = [...new Set(roles)];

  return withActor(actor, async (tx) => {
    const [person] = await tx
      .select({ persona: schema.persons.persona })
      .from(schema.persons)
      .where(eq(schema.persons.id, personId))
      .limit(1);

    if (person === undefined) {
      throw AppError.notFound('Persoana', personId);
    }
    if (person.persona !== 'office' && unique.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Rolurile de birou se dau doar persoanelor cu persona „Birou”. Schimbă întâi persona.',
      );
    }

    await tx.delete(schema.personOfficeRoles).where(eq(schema.personOfficeRoles.personId, personId));
    if (unique.length > 0) {
      await tx
        .insert(schema.personOfficeRoles)
        .values(unique.map((role) => ({ personId, role })));
    }
    return { id: personId };
  });
}

/**
 * Firmele la care are acces, tot ca set complet.
 *
 * Nu se verifica aici ca firmele exista sau ca actorul are acces la ele: cheia
 * straina raspunde de prima, iar politicile de pe `companies` de a doua. Ce se
 * verifica e ca personele de portal sa nu primeasca acces pe firme din grup —
 * ele isi vad propria fisa, iar un rand aici le-ar da un scop pe care ecranele
 * lor nu-l asteapta.
 */
export async function setCompanyAccess(
  actor: Actor,
  input: CompanyAccessInput,
): Promise<{ id: string }> {
  const { personId, companyIds } = companyAccessInputSchema.parse(input);
  const unique = [...new Set(companyIds)];

  return withActor(actor, async (tx) => {
    const [person] = await tx
      .select({ persona: schema.persons.persona })
      .from(schema.persons)
      .where(eq(schema.persons.id, personId))
      .limit(1);

    if (person === undefined) {
      throw AppError.notFound('Persoana', personId);
    }
    if (person.persona !== 'office' && person.persona !== 'field' && unique.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Accesul pe firme se dă doar oamenilor din birou și din teren. Portalurile își văd propria fișă.',
      );
    }

    await tx
      .delete(schema.personCompanyAccess)
      .where(eq(schema.personCompanyAccess.personId, personId));
    if (unique.length > 0) {
      await tx
        .insert(schema.personCompanyAccess)
        .values(unique.map((companyId) => ({ personId, companyId })));
    }
    return { id: personId };
  });
}

/**
 * Inchide toate sesiunile unei persoane, acum (verificarea #18).
 *
 * ── De ce nu prin Admin API, cum spunea planul ──────────────────────────────
 *
 * Pentru ca Admin API-ul GoTrue nu poate: singura lui functie de deconectare,
 * `auth.admin.signOut(jwt)`, cere ACCESS TOKEN-UL omului, nu id-ul lui. Pe
 * ecranul de administrare n-ai token-ul altcuiva. Endpoint-urile care ar fi
 * facut-o dupa id (`DELETE /admin/users/{id}/sessions` si vecinii lor) intorc
 * 404 — nu exista.
 *
 * Ce exista e mai direct: sesiunile stau in `auth.sessions`, iar GoTrue le
 * verifica la fiecare `GET /user`. Sterse, urmatorul apel intoarce 403
 * `session_not_found`. Detaliile si guard-ul sunt in migrarea 0015; aici e doar
 * poarta.
 *
 * Intoarce cate sesiuni s-au inchis. `0` inseamna „n-avea niciuna deschisa”
 * sau „n-are cont” — ecranul are voie sa spuna adevarul, nu o revocare
 * imaginara.
 */
export async function revokeSessions(actor: Actor, personId: string): Promise<number> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute<{ revoked: number }>(
      sql`select app.revoke_sessions(${personId}) as revoked`,
    );
    return result.rows[0]?.revoked ?? 0;
  });
}

/**
 * Leaga persoana de contul GoTrue proaspat creat. Apelata DOAR de
 * `/api/admin/provision`, imediat dupa `auth.admin.createUser`.
 *
 * `mustChangePassword` se pune pe `true` fara optiune: parola care ajunge pe
 * ecranul administratorului a fost vazuta de doi oameni, deci nu mai e a
 * nimanui.
 */
export async function linkAuthUser(
  actor: Actor,
  personId: string,
  authUserId: string,
): Promise<{ id: string }> {
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .update(schema.persons)
        .set({ authUserId, mustChangePassword: true, isActive: true })
        .where(eq(schema.persons.id, personId))
        .returning({ id: schema.persons.id });
      if (row === undefined) {
        throw AppError.notFound('Persoana', personId);
      }
      return row;
    });
  } catch (error) {
    return asConflict(error, 'Contul acesta e deja legat de altă persoană.');
  }
}

export interface PersonOption {
  readonly id: string;
  readonly fullName: string;
  readonly email: string | null;
}

/**
 * Oamenii care pot fi alesi drept responsabil pe un contract.
 *
 * Exista pentru campul PM din formularul de contract, ramas gol din 04b.
 * Filtrul e persona `office` + activ: un sef de santier nu poate fi PM, iar un
 * om plecat din firma nu trebuie sa mai apara in liste noi — dar contractele
 * care il au deja pastreaza numele, pentru ca `owner_person_id` nu se sterge.
 */
export async function listPersonOptions(
  actor: Actor,
  personas: readonly ('office' | 'field' | 'subcontractor' | 'client')[] = ['office'],
): Promise<PersonOption[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: schema.persons.id,
        fullName: schema.persons.fullName,
        email: sql<string | null>`${schema.persons.email}::text`,
      })
      .from(schema.persons)
      .where(and(eq(schema.persons.isActive, true), inArray(schema.persons.persona, [...personas])))
      .orderBy(asc(schema.persons.fullName))
      .limit(DEFAULT_LIMIT),
  );
}
