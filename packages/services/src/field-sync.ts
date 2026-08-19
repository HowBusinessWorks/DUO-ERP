import type { PushMutationsInput } from '@damina/contracts';
import {
  MUTATION_PAYLOAD_SCHEMAS,
  pushMutationsInputSchema,
  type FieldMutation,
  type MutationOutcome,
  type MutationType,
} from '@damina/contracts';
import { schema, withActor, type Actor } from '@damina/db';
import { AppError } from '@damina/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { saveInspection } from './inspections';
import { appendJournalEntry } from './journal';
import { saveIntervention } from './interventions';
import { createRequest } from './requests';
import { saveTimesheet } from './timesheets';

/**
 * Motorul de sincronizare al aplicatiei de teren (pasul 10, §3.2).
 *
 * Trei reguli, si toate trei vin din acelasi fapt: **conexiunea cade la
 * jumatatea cererii, in subsol.** Nu e un caz limita, e cazul obisnuit.
 *
 * 1. **Idempotenta prin id de client.** Mutatia isi aduce propriul UUID v7,
 *    generat inainte sa existe retea. Un `id` deja aplicat intoarce rezultatul
 *    MEMORAT, fara sa reexecute nimic. Fara asta, un retry dupa un raspuns
 *    pierdut ar emite al doilea bon de consum pentru acelasi material.
 * 2. **Ordinea, secvential per dispozitiv.** Fisa se salveaza inainte sa fie
 *    validata; consumul, dupa ce exista fisa. Paralelizarea ar fi facut ordinea
 *    sa depinda de latenta.
 * 3. **Coada se opreste la prima eroare de BUSINESS**, nu sare peste. Cele de
 *    dupa pot depinde de cea care a picat, iar o coada care le aplica oricum ar
 *    produce o stare pe care omul n-a cerut-o niciodata. Erorile de retea nu
 *    intra aici: ele nu ajung sa fie inregistrate, deci se reiau de la sine.
 */

/**
 * Un executant de mutatie: primeste payload-ul BRUT, ca use-case-urile, si
 * intoarce un rezultat **deja serializabil**.
 *
 * Forma de pe sarma e o decizie, nu ce se intampla sa intoarca serviciul. Prima
 * varianta dadea mai departe obiectul use-case-ului, iar `Quantity` si `Money`
 * ajungeau in `jsonb` ca structurile interne ale bibliotecii de zecimale — deci
 * telefonul care primea raspunsul memorat vedea `{c:[8],e:0,s:1}` acolo unde
 * cel care prinsese executia vedea `"8.0000"`. Doua raspunsuri diferite pentru
 * aceeasi mutatie, si diferenta se vedea abia dupa o cadere de retea.
 */
type Executor = (actor: Actor, payload: unknown) => Promise<Record<string, unknown>>;

/**
 * Harta tip → use-case.
 *
 * Fiecare intrare cheama **exact serviciul pe care il cheama si ecranul de
 * birou**. Nu exista o a doua cale de scriere „pentru teren": daca ar exista,
 * prima regula noua ar ajunge intr-una dintre ele si nu in cealalta, iar
 * diferenta s-ar vedea abia in cifre, luna urmatoare.
 */
const EXECUTORS: Readonly<Record<MutationType, Executor>> = {
  'inspection.save': async (actor, payload) => {
    const result = await saveInspection(actor, payload as never);
    return {
      createdRequestIds: [...result.createdRequestIds],
      createdProposalIds: [...result.createdProposalIds],
    };
  },
  'intervention.save': async (actor, payload) => {
    const result = await saveIntervention(actor, payload as never);
    return { materials: result.materials, hours: result.hours };
  },
  'timesheet.save': async (actor, payload) => {
    const result = await saveTimesheet(actor, payload as never);
    return { id: result.id, totalHours: result.totalHours.toDbString() };
  },
  'material.request': async (actor, payload) => {
    const request = await createRequest(actor, payload as never);
    return { id: request.id };
  },
  /*
   * Jurnalul ADAUGA, nu rescrie — singurul tip de aici care nu are o cheie
   * naturala pe care sa fie idempotent de la sine. Ce-l tine sa nu produca a
   * doua consemnare identica la o retrimitere e strict `app.applied_mutations`,
   * si de asta id-ul mutatiei se genereaza pe telefon, inainte sa existe retea.
   */
  'journal.append': async (actor, payload) => {
    const entry = await appendJournalEntry(actor, payload as never);
    return { id: entry.id };
  },
};

export interface PushResult {
  readonly outcomes: readonly MutationOutcome[];
  /** Cate au fost aplicate acum. Duplicatele nu se numara: n-au facut nimic. */
  readonly applied: number;
  /** `true` cand coada s-a oprit: exista o mutatie de rezolvat pe ecranul de conflicte. */
  readonly blocked: boolean;
}

/**
 * Aplica un lot de mutatii, in ordine, oprindu-se la prima eroare de business.
 *
 * Ce NU face, si e deliberat: **nu deschide o tranzactie peste tot lotul.**
 * Fiecare mutatie e deja atomica in use-case-ul ei (o fisa validata produce bon,
 * stoc si cost sau niciunul), iar o tranzactie mai mare ar fi dat inapoi si
 * mutatiile care au mers — adica exact munca pe care omul o crede trimisa.
 */
export async function pushMutations(
  actor: Actor,
  input: PushMutationsInput,
): Promise<PushResult> {
  const values = pushMutationsInputSchema.parse(input);

  // Ordinea crearii, nu cea din sir: un client care le trimite amestecate n-are
  // voie sa schimbe ordinea in care s-au intamplat lucrurile pe teren.
  const ordered = [...values.mutations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const remembered = await loadRemembered(
    actor,
    ordered.map((mutation) => mutation.id),
  );

  const outcomes: MutationOutcome[] = [];
  let applied = 0;
  let blocked = false;

  for (const mutation of ordered) {
    if (blocked) {
      // Nu se sare peste: se raporteaza explicit ca n-a fost incercata, ca
      // telefonul sa nu le stearga din coada.
      outcomes.push({ id: mutation.id, status: 'skipped' });
      continue;
    }

    const known = remembered.get(mutation.id);
    if (known !== undefined) {
      // Rezultatul memorat, inclusiv cand a fost o respingere: a doua incercare
      // a aceleiasi mutatii va esua la fel, iar coada trebuie sa se opreasca in
      // acelasi loc — fara sa reexecute o tranzactie grea ca sa afle asta.
      if (known.errorCode === null) {
        outcomes.push({ id: mutation.id, status: 'duplicate', result: known.result });
      } else {
        outcomes.push({
          id: mutation.id,
          status: 'failed',
          code: known.errorCode,
          message: known.errorMessage ?? 'Mutația a fost respinsă anterior.',
        });
        blocked = true;
      }
      continue;
    }

    const outcome = await applyOne(actor, values.deviceId, mutation);
    outcomes.push(outcome);
    if (outcome.status === 'applied') {
      applied += 1;
    } else {
      blocked = true;
    }
  }

  return { outcomes, applied, blocked };
}

async function applyOne(
  actor: Actor,
  deviceId: string,
  mutation: FieldMutation,
): Promise<MutationOutcome> {
  const parsed = MUTATION_PAYLOAD_SCHEMAS[mutation.type].safeParse(mutation.payload);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Datele mutației nu sunt valide.';
    await remember(actor, deviceId, mutation, null, 'VALIDATION_FAILED', message);
    return { id: mutation.id, status: 'failed', code: 'VALIDATION_FAILED', message };
  }

  try {
    /*
     * Payload-ul BRUT, nu cel parsat — aceeasi regula ca la `createAction` din
     * aplicatia web: schemele au transformari (`'' → null`), iar rezultatul lor
     * nu mai trece a doua oara prin ele. Parsarea de mai sus exista ca sa dea un
     * mesaj in romana inainte de tranzactie, nu ca sa inlocuiasca use-case-ul.
     */
    const result = await EXECUTORS[mutation.type](actor, mutation.payload);
    await remember(actor, deviceId, mutation, result, null, null);
    return { id: mutation.id, status: 'applied', result };
  } catch (error) {
    if (error instanceof AppError) {
      await remember(actor, deviceId, mutation, null, error.code, error.message);
      return { id: mutation.id, status: 'failed', code: error.code, message: error.message };
    }
    /*
     * Ce nu e `AppError` nu se memoreaza: e o cadere de infrastructura, iar
     * memorarea ei ar fi transformat un timeout intr-o respingere definitiva —
     * fisa omului ar fi ramas blocata pentru totdeauna intr-o coada care nu se
     * mai misca.
     */
    throw error;
  }
}

async function remember(
  actor: Actor,
  deviceId: string,
  mutation: FieldMutation,
  result: unknown,
  errorCode: string | null,
  errorMessage: string | null,
): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx
      .insert(schema.appliedMutations)
      .values({
        id: mutation.id,
        personId: actor.personId,
        deviceId,
        type: mutation.type,
        result: errorCode === null ? (result as Record<string, unknown>) : null,
        errorCode,
        errorMessage,
      })
      // Doua cereri paralele cu acelasi id: prima scrie, a doua nu suprascrie.
      // Rezultatul memorat ramane cel al executiei care chiar a avut loc.
      .onConflictDoNothing();
  });
}

interface RememberedRow {
  readonly result: unknown;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

async function loadRemembered(
  actor: Actor,
  ids: readonly string[],
): Promise<Map<string, RememberedRow>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await withActor(actor, async (tx) =>
    tx
      .select({
        id: schema.appliedMutations.id,
        result: schema.appliedMutations.result,
        errorCode: schema.appliedMutations.errorCode,
        errorMessage: schema.appliedMutations.errorMessage,
      })
      .from(schema.appliedMutations)
      .where(inArray(schema.appliedMutations.id, [...ids])),
  );

  return new Map(
    rows.map((row) => [
      row.id,
      { result: row.result, errorCode: row.errorCode, errorMessage: row.errorMessage },
    ]),
  );
}

// ── Cursorul de pull ─────────────────────────────────────────────────────────

export interface SyncCursor {
  readonly cursor: string;
  readonly lastPulledAt: Date | null;
}

/**
 * Marcheaza ca dispozitivul a primit felia pana la momentul `at`.
 *
 * Cursorul e **opac** pentru client — azi e un ISO timestamp, maine poate fi
 * altceva. Forma lui e treaba serverului, si de asta coloana e `text`: o
 * schimbare de format n-are voie sa ceara o migrare de date pe telefoanele
 * oamenilor.
 */
export async function markPulled(
  actor: Actor,
  deviceId: string,
  at: Date = new Date(),
): Promise<SyncCursor> {
  const cursor = at.toISOString();

  await withActor(actor, async (tx) => {
    await tx
      .insert(schema.syncCursors)
      .values({ personId: actor.personId, deviceId, lastPulledAt: at, lastCursor: cursor })
      .onConflictDoUpdate({
        target: [schema.syncCursors.personId, schema.syncCursors.deviceId],
        set: { lastPulledAt: at, lastCursor: cursor },
      });
  });

  return { cursor, lastPulledAt: at };
}

/**
 * Ce cursor are dispozitivul acum. `null` = n-a mai sincronizat niciodata, deci
 * urmatorul pull e complet.
 */
export async function readCursor(actor: Actor, deviceId: string): Promise<SyncCursor | null> {
  const [row] = await withActor(actor, async (tx) =>
    tx
      .select({
        cursor: schema.syncCursors.lastCursor,
        lastPulledAt: schema.syncCursors.lastPulledAt,
      })
      .from(schema.syncCursors)
      .where(
        and(
          eq(schema.syncCursors.personId, actor.personId),
          eq(schema.syncCursors.deviceId, deviceId),
        ),
      )
      .limit(1),
  );

  if (row?.cursor === undefined || row.cursor === null) {
    return null;
  }
  return { cursor: row.cursor, lastPulledAt: row.lastPulledAt };
}

// ── Curatenia jurnalului ─────────────────────────────────────────────────────

/**
 * Retentia de 90 de zile a jurnalului de mutatii.
 *
 * Un dispozitiv care revine dupa 90 de zile isi pierde memoria de idempotenta
 * si face pull complet — comportamentul e documentat, nu accidental
 * (verificarea #11 a pasului).
 */
export async function pruneAppliedMutations(actor: Actor, days = 90): Promise<number> {
  const rows = await withActor(actor, async (tx) =>
    tx.execute<{ pruned: number }>(
      sql`select app.prune_applied_mutations(${days}) as pruned`,
    ),
  );
  return rows.rows[0]?.pruned ?? 0;
}
