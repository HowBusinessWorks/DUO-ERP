import { type Actor, schema, withActor } from '@damina/db';
import { and, eq, ilike, or, sql } from 'drizzle-orm';

/**
 * Cautarea globala (Ctrl+K), partea de date.
 *
 * Ce cauta in pasul 03: firme, persoane si nomenclatoarele existente. Fiecare
 * entitate adaugata in pasii urmatori isi inregistreaza propriul furnizor in
 * `entityRegistry` — modulul de cautare nu se rescrie, se extinde.
 *
 * Prefixele (`#`, `L-`, `@`, `/`, `>`) se interpreteaza in aplicatie, nu aici:
 * `/` si `>` nici nu ating baza de date.
 */

export type SearchGroup =
  | 'companies'
  | 'persons'
  | 'produse'
  | 'furnizori'
  | 'clienti'
  | 'subcontractanti'
  | 'calificari';

export interface SearchHit {
  readonly group: SearchGroup;
  readonly id: string;
  /** Ce se citeste primul: numele. */
  readonly title: string;
  /** Ce dezambiguizeaza: cod, CUI, meserie. */
  readonly subtitle: string | null;
  readonly href: string;
}

const PER_GROUP = 5;

function like(query: string): string {
  return `%${query.replace(/([%_\\])/g, '\\$1')}%`;
}

/**
 * Cauta in tot ce exista azi.
 *
 * Interogarile pleaca in paralel: sunt independente si fiecare are limita ei.
 * Cu 7 grupuri secventiale, caseta ar raspunde in ~200 ms in loc de ~40.
 */
export async function searchEverything(
  actor: Actor,
  rawQuery: string,
  options: { readonly only?: readonly SearchGroup[] } = {},
): Promise<SearchHit[]> {
  const query = rawQuery.trim();
  if (query.length < 2) {
    return [];
  }

  const pattern = like(query);
  const wanted = (group: SearchGroup): boolean =>
    options.only === undefined || options.only.includes(group);

  const results = await withActor(actor, async (tx) => {
    const tasks: Promise<SearchHit[]>[] = [];

    if (wanted('produse')) {
      tasks.push(
        tx
          .select({
            id: schema.products.id,
            code: schema.products.code,
            name: schema.products.name,
            uom: schema.products.uom,
          })
          .from(schema.products)
          .where(
            and(
              eq(schema.products.isActive, true),
              or(ilike(schema.products.code, pattern), ilike(schema.products.name, pattern)),
            ),
          )
          .limit(PER_GROUP)
          .then((rows) =>
            rows.map((row) => ({
              group: 'produse' as const,
              id: row.id,
              title: row.name,
              subtitle: `${row.code} · ${row.uom}`,
              href: `/produse/${row.id}`,
            })),
          ),
      );
    }

    if (wanted('furnizori')) {
      tasks.push(
        tx
          .select({ id: schema.suppliers.id, name: schema.suppliers.name, cui: schema.suppliers.cui })
          .from(schema.suppliers)
          .where(and(eq(schema.suppliers.isActive, true), ilike(schema.suppliers.name, pattern)))
          .limit(PER_GROUP)
          .then((rows) =>
            rows.map((row) => ({
              group: 'furnizori' as const,
              id: row.id,
              title: row.name,
              subtitle: row.cui,
              href: `/furnizori/${row.id}`,
            })),
          ),
      );
    }

    if (wanted('clienti')) {
      tasks.push(
        tx
          .select({ id: schema.clients.id, name: schema.clients.name, cui: schema.clients.cui })
          .from(schema.clients)
          .where(and(eq(schema.clients.isActive, true), ilike(schema.clients.name, pattern)))
          .limit(PER_GROUP)
          .then((rows) =>
            rows.map((row) => ({
              group: 'clienti' as const,
              id: row.id,
              title: row.name,
              subtitle: row.cui,
              href: `/clienti/${row.id}`,
            })),
          ),
      );
    }

    if (wanted('subcontractanti')) {
      tasks.push(
        tx
          .select({
            id: schema.subcontractors.id,
            name: schema.subcontractors.name,
            specialties: schema.subcontractors.specialties,
          })
          .from(schema.subcontractors)
          .where(
            and(eq(schema.subcontractors.isActive, true), ilike(schema.subcontractors.name, pattern)),
          )
          .limit(PER_GROUP)
          .then((rows) =>
            rows.map((row) => ({
              group: 'subcontractanti' as const,
              id: row.id,
              title: row.name,
              subtitle: row.specialties === null ? null : row.specialties.join(', '),
              href: `/subcontractanti/${row.id}`,
            })),
          ),
      );
    }

    if (wanted('calificari')) {
      tasks.push(
        tx
          .select({
            id: schema.qualifications.id,
            code: schema.qualifications.code,
            name: schema.qualifications.name,
          })
          .from(schema.qualifications)
          .where(
            and(
              eq(schema.qualifications.isActive, true),
              or(
                ilike(schema.qualifications.code, pattern),
                ilike(schema.qualifications.name, pattern),
              ),
            ),
          )
          .limit(PER_GROUP)
          .then((rows) =>
            rows.map((row) => ({
              group: 'calificari' as const,
              id: row.id,
              title: row.name,
              subtitle: row.code,
              href: `/calificari/${row.id}`,
            })),
          ),
      );
    }

    if (wanted('persons')) {
      tasks.push(
        tx
          .select({
            id: schema.persons.id,
            fullName: schema.persons.fullName,
            email: schema.persons.email,
          })
          .from(schema.persons)
          .where(and(eq(schema.persons.isActive, true), ilike(schema.persons.fullName, pattern)))
          .limit(PER_GROUP)
          .then((rows) =>
            rows.map((row) => ({
              group: 'persons' as const,
              id: row.id,
              title: row.fullName,
              subtitle: row.email,
              href: `/administrare/persoane/${row.id}`,
            })),
          ),
      );
    }

    if (wanted('companies')) {
      tasks.push(
        tx
          .select({ id: schema.companies.id, name: schema.companies.name, cui: schema.companies.cui })
          .from(schema.companies)
          .where(and(eq(schema.companies.isActive, true), ilike(schema.companies.name, pattern)))
          .limit(PER_GROUP)
          .then((rows) =>
            rows.map((row) => ({
              group: 'companies' as const,
              id: row.id,
              title: row.name,
              subtitle: row.cui,
              href: `/administrare/firme/${row.id}`,
            })),
          ),
      );
    }

    return Promise.all(tasks);
  });

  return results.flat();
}

/** Cate produse / furnizori / … exista, pentru cifrele din Panou. */
export async function countNomenclature(actor: Actor): Promise<Record<string, number>> {
  return withActor(actor, async (tx) => {
    const rows = await tx.execute<{ label: string; count: string }>(sql`
      select 'produse' as label, count(*)::text as count from app.products where is_active
      union all select 'furnizori', count(*)::text from app.suppliers where is_active
      union all select 'clienti', count(*)::text from app.clients where is_active
      union all select 'subcontractanti', count(*)::text from app.subcontractors where is_active
      union all select 'calificari', count(*)::text from app.qualifications where is_active
    `);

    return Object.fromEntries(rows.rows.map((row) => [row.label, Number(row.count)]));
  });
}
