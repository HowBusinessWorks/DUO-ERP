import type {
  ProductInput,
  SupplierInput,
  ClientInput,
  SubcontractorInput,
  QualificationInput,
  RateCardInput,
} from '@damina/contracts';
import {
  clientInputSchema,
  productInputSchema,
  qualificationInputSchema,
  rateCardInputSchema,
  subcontractorInputSchema,
  supplierInputSchema,
} from '@damina/contracts';
import { type Actor, schema, withActor } from '@damina/db';
import { AppError } from '@damina/shared';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';

/**
 * Nomenclatoarele — primul CRUD real al aplicatiei.
 *
 * Sunt COMUNE celor 5 firme (§17): nu exista `company_id` pe niciuna din
 * tabelele astea, si nici filtrare pe selectia de firme. Doar seriile de
 * documente si gestiunile sunt per firma. Confuzia costa scump: un produs
 * dublat per firma inseamna cinci stocuri paralele pentru acelasi cui.
 */

export interface ListOptions {
  /** Text liber peste cod si denumire. */
  readonly query?: string;
  /** Implicit doar activele: nomenclatoarele cresc si nu se sterge nimic din ele. */
  readonly includeInactive?: boolean;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 200;

function like(query: string): string {
  // `%` si `_` din textul omului nu au voie sa devina metacaractere.
  return `%${query.replace(/([%_\\])/g, '\\$1')}%`;
}

/** Violare de unicitate → mesaj in romana, nu 23505 pe ecran. */
function asConflict(error: unknown, message: string): never {
  const code = sqlstate(error);
  if (code === '23505') {
    throw new AppError('CONFLICT', message);
  }
  if (code === '23P01') {
    throw new AppError('CONFLICT', message);
  }
  throw error;
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

// ── Produse ──────────────────────────────────────────────────────────────────

export type ProductRow = typeof schema.products.$inferSelect & {
  readonly supplierName: string | null;
};

export async function listProducts(actor: Actor, options: ListOptions = {}): Promise<ProductRow[]> {
  const { query, includeInactive = false, limit = DEFAULT_LIMIT } = options;

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        product: schema.products,
        supplierName: schema.suppliers.name,
      })
      .from(schema.products)
      .leftJoin(schema.suppliers, eq(schema.products.defaultSupplierId, schema.suppliers.id))
      .where(
        and(
          includeInactive ? undefined : eq(schema.products.isActive, true),
          query === undefined || query === ''
            ? undefined
            : or(
                ilike(schema.products.code, like(query)),
                ilike(schema.products.name, like(query)),
              ),
        ),
      )
      .orderBy(asc(schema.products.name))
      .limit(limit);

    return rows.map((row) => ({ ...row.product, supplierName: row.supplierName }));
  });
}

export async function getProduct(actor: Actor, id: string): Promise<ProductRow> {
  const [row] = await listProductsById(actor, id);
  if (row === undefined) {
    throw AppError.notFound('Produsul', id);
  }
  return row;
}

async function listProductsById(actor: Actor, id: string): Promise<ProductRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({ product: schema.products, supplierName: schema.suppliers.name })
      .from(schema.products)
      .leftJoin(schema.suppliers, eq(schema.products.defaultSupplierId, schema.suppliers.id))
      .where(eq(schema.products.id, id))
      .limit(1);
    return rows.map((row) => ({ ...row.product, supplierName: row.supplierName }));
  });
}

export async function createProduct(actor: Actor, input: ProductInput): Promise<{ id: string }> {
  const values = productInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.products)
        .values(values)
        .returning({ id: schema.products.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Produsul nu a putut fi salvat.');
      }
      return row;
    });
  } catch (error) {
    return asConflict(error, `Există deja un produs cu codul ${values.code}.`);
  }
}

export async function updateProduct(
  actor: Actor,
  id: string,
  input: ProductInput,
): Promise<{ id: string }> {
  const values = productInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .update(schema.products)
        .set(values)
        .where(eq(schema.products.id, id))
        .returning({ id: schema.products.id });
      if (row === undefined) {
        throw AppError.notFound('Produsul', id);
      }
      return row;
    });
  } catch (error) {
    return asConflict(error, `Există deja un produs cu codul ${values.code}.`);
  }
}

// ── Furnizori ────────────────────────────────────────────────────────────────

export type SupplierRow = typeof schema.suppliers.$inferSelect;

export async function listSuppliers(
  actor: Actor,
  options: ListOptions = {},
): Promise<SupplierRow[]> {
  const { query, includeInactive = false, limit = DEFAULT_LIMIT } = options;
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.suppliers)
      .where(
        and(
          includeInactive ? undefined : eq(schema.suppliers.isActive, true),
          query === undefined || query === ''
            ? undefined
            : ilike(schema.suppliers.name, like(query)),
        ),
      )
      .orderBy(asc(schema.suppliers.name))
      .limit(limit),
  );
}

export async function getSupplier(actor: Actor, id: string): Promise<SupplierRow> {
  const row = await withActor(actor, async (tx) => {
    const [found] = await tx
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.id, id))
      .limit(1);
    return found;
  });
  if (row === undefined) {
    throw AppError.notFound('Furnizorul', id);
  }
  return row;
}

export async function createSupplier(actor: Actor, input: SupplierInput): Promise<{ id: string }> {
  const values = supplierInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(schema.suppliers)
      .values(values)
      .returning({ id: schema.suppliers.id });
    if (row === undefined) {
      throw new AppError('CONFLICT', 'Furnizorul nu a putut fi salvat.');
    }
    return row;
  });
}

export async function updateSupplier(
  actor: Actor,
  id: string,
  input: SupplierInput,
): Promise<{ id: string }> {
  const values = supplierInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .update(schema.suppliers)
      .set(values)
      .where(eq(schema.suppliers.id, id))
      .returning({ id: schema.suppliers.id });
    if (row === undefined) {
      throw AppError.notFound('Furnizorul', id);
    }
    return row;
  });
}

// ── Clienți ──────────────────────────────────────────────────────────────────

export type ClientRow = typeof schema.clients.$inferSelect;

export async function listClients(actor: Actor, options: ListOptions = {}): Promise<ClientRow[]> {
  const { query, includeInactive = false, limit = DEFAULT_LIMIT } = options;
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.clients)
      .where(
        and(
          includeInactive ? undefined : eq(schema.clients.isActive, true),
          query === undefined || query === '' ? undefined : ilike(schema.clients.name, like(query)),
        ),
      )
      .orderBy(asc(schema.clients.name))
      .limit(limit),
  );
}

export async function getClient(actor: Actor, id: string): Promise<ClientRow> {
  const row = await withActor(actor, async (tx) => {
    const [found] = await tx
      .select()
      .from(schema.clients)
      .where(eq(schema.clients.id, id))
      .limit(1);
    return found;
  });
  if (row === undefined) {
    throw AppError.notFound('Clientul', id);
  }
  return row;
}

export async function createClient(actor: Actor, input: ClientInput): Promise<{ id: string }> {
  const values = clientInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(schema.clients)
      .values(values)
      .returning({ id: schema.clients.id });
    if (row === undefined) {
      throw new AppError('CONFLICT', 'Clientul nu a putut fi salvat.');
    }
    return row;
  });
}

export async function updateClient(
  actor: Actor,
  id: string,
  input: ClientInput,
): Promise<{ id: string }> {
  const values = clientInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .update(schema.clients)
      .set(values)
      .where(eq(schema.clients.id, id))
      .returning({ id: schema.clients.id });
    if (row === undefined) {
      throw AppError.notFound('Clientul', id);
    }
    return row;
  });
}

// ── Subcontractanți ──────────────────────────────────────────────────────────

export type SubcontractorRow = typeof schema.subcontractors.$inferSelect;

export async function listSubcontractors(
  actor: Actor,
  options: ListOptions = {},
): Promise<SubcontractorRow[]> {
  const { query, includeInactive = false, limit = DEFAULT_LIMIT } = options;
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.subcontractors)
      .where(
        and(
          includeInactive ? undefined : eq(schema.subcontractors.isActive, true),
          query === undefined || query === ''
            ? undefined
            : ilike(schema.subcontractors.name, like(query)),
        ),
      )
      .orderBy(asc(schema.subcontractors.name))
      .limit(limit),
  );
}

export async function getSubcontractor(actor: Actor, id: string): Promise<SubcontractorRow> {
  const row = await withActor(actor, async (tx) => {
    const [found] = await tx
      .select()
      .from(schema.subcontractors)
      .where(eq(schema.subcontractors.id, id))
      .limit(1);
    return found;
  });
  if (row === undefined) {
    throw AppError.notFound('Subcontractantul', id);
  }
  return row;
}

export async function createSubcontractor(
  actor: Actor,
  input: SubcontractorInput,
): Promise<{ id: string }> {
  const values = subcontractorInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(schema.subcontractors)
      .values(values)
      .returning({ id: schema.subcontractors.id });
    if (row === undefined) {
      throw new AppError('CONFLICT', 'Subcontractantul nu a putut fi salvat.');
    }
    return row;
  });
}

export async function updateSubcontractor(
  actor: Actor,
  id: string,
  input: SubcontractorInput,
): Promise<{ id: string }> {
  const values = subcontractorInputSchema.parse(input);
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .update(schema.subcontractors)
      .set(values)
      .where(eq(schema.subcontractors.id, id))
      .returning({ id: schema.subcontractors.id });
    if (row === undefined) {
      throw AppError.notFound('Subcontractantul', id);
    }
    return row;
  });
}

// ── Calificări ───────────────────────────────────────────────────────────────

export type QualificationRow = typeof schema.qualifications.$inferSelect;

export async function listQualifications(
  actor: Actor,
  options: ListOptions = {},
): Promise<QualificationRow[]> {
  const { query, includeInactive = false, limit = DEFAULT_LIMIT } = options;
  return withActor(actor, async (tx) =>
    tx
      .select()
      .from(schema.qualifications)
      .where(
        and(
          includeInactive ? undefined : eq(schema.qualifications.isActive, true),
          query === undefined || query === ''
            ? undefined
            : or(
                ilike(schema.qualifications.code, like(query)),
                ilike(schema.qualifications.name, like(query)),
              ),
        ),
      )
      .orderBy(asc(schema.qualifications.name))
      .limit(limit),
  );
}

export async function getQualification(actor: Actor, id: string): Promise<QualificationRow> {
  const row = await withActor(actor, async (tx) => {
    const [found] = await tx
      .select()
      .from(schema.qualifications)
      .where(eq(schema.qualifications.id, id))
      .limit(1);
    return found;
  });
  if (row === undefined) {
    throw AppError.notFound('Calificarea', id);
  }
  return row;
}

export async function createQualification(
  actor: Actor,
  input: QualificationInput,
): Promise<{ id: string }> {
  const values = qualificationInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.qualifications)
        .values(values)
        .returning({ id: schema.qualifications.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Calificarea nu a putut fi salvată.');
      }
      return row;
    });
  } catch (error) {
    return asConflict(error, `Există deja o calificare cu codul ${values.code}.`);
  }
}

// ── Tarife (rate card istoricizat) ───────────────────────────────────────────

export type RateCardRow = typeof schema.rateCards.$inferSelect & {
  readonly qualificationName: string;
  readonly qualificationCode: string;
};

/**
 * Tarifele, cu calificarea alaturi, cele mai noi primele.
 *
 * Poarta salariu si cost orar, deci `app.rate_cards` are `select` doar pentru
 * `app_office` si `app_service`. Un apel din teren nu esueaza cu lista goala —
 * esueaza cu `42501`, adica exact ce vrem: refuz, nu tacere.
 */
export async function listRateCards(
  actor: Actor,
  options: { readonly qualificationId?: string } = {},
): Promise<RateCardRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        rateCard: schema.rateCards,
        qualificationName: schema.qualifications.name,
        qualificationCode: schema.qualifications.code,
      })
      .from(schema.rateCards)
      .innerJoin(
        schema.qualifications,
        eq(schema.rateCards.qualificationId, schema.qualifications.id),
      )
      .where(
        options.qualificationId === undefined
          ? undefined
          : eq(schema.rateCards.qualificationId, options.qualificationId),
      )
      .orderBy(asc(schema.qualifications.name), desc(schema.rateCards.validFrom));

    return rows.map((row) => ({
      ...row.rateCard,
      qualificationName: row.qualificationName,
      qualificationCode: row.qualificationCode,
    }));
  });
}

/**
 * Adauga un interval de tarif. NU exista `updateRateCard`, intentionat.
 *
 * Salariile cresc pe durata unui contract de 4 ani, iar un pontaj din martie
 * trebuie sa ramana evaluat la tariful din martie. Un `UPDATE` ar rescrie
 * retroactiv costul tuturor orelor deja pontate — inclusiv al celor din luni
 * inchise, unde cifrele trebuie sa ramana reproductibile.
 *
 * Suprapunerea e refuzata de constrangerea `exclude` din baza (23P01). O prindem
 * aici doar cat sa iasa o propozitie in romana in loc de un cod SQL.
 */
export async function createRateCard(actor: Actor, input: RateCardInput): Promise<{ id: string }> {
  const values = rateCardInputSchema.parse(input);
  try {
    return await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(schema.rateCards)
        .values(values)
        .returning({ id: schema.rateCards.id });
      if (row === undefined) {
        throw new AppError('CONFLICT', 'Tariful nu a putut fi salvat.');
      }
      return row;
    });
  } catch (error) {
    if (sqlstate(error) === '23P01') {
      throw new AppError(
        'CONFLICT',
        `Există deja un tarif pentru calificarea asta care acoperă ${values.validFrom}. Închide intervalul vechi înainte să adaugi unul nou.`,
      );
    }
    throw error;
  }
}

/** Cate randuri de tarif are fiecare calificare — pentru badge-ul de pe tab. */
export async function countRateCardsByQualification(
  actor: Actor,
): Promise<ReadonlyMap<string, number>> {
  const rows = await withActor(actor, async (tx) =>
    tx
      .select({
        qualificationId: schema.rateCards.qualificationId,
        count: sql<string>`count(*)::text`,
      })
      .from(schema.rateCards)
      .groupBy(schema.rateCards.qualificationId),
  );

  return new Map(rows.map((row) => [row.qualificationId, Number(row.count)]));
}
