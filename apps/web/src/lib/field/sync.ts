import { MAX_MUTATIONS_PER_PUSH } from '@damina/contracts';
import { fieldDb, hasIndexedDb, type MediaRow, type OutboxRow } from './db';
import { deviceId } from './device';
import { uploadPending } from './media';

/**
 * Motorul de sincronizare, partea de client (pasul 10, §3.1).
 *
 * Ordinea e o regulă, nu o optimizare: **datele urcă înaintea pozelor.** O fișă
 * ajunsă la birou fără poze e o fișă pe care cineva poate lucra; o poză fără
 * fișă nu e nimic. De aceea media are canal separat și prioritate mai mică — dar
 * nu se pierde niciodată, fiindcă stă în IndexedDB, nu în memorie.
 */

export interface SyncCounts {
  /** Mutații care așteaptă. Numărate SEPARAT de poze — vezi mai jos. */
  readonly data: number;
  readonly media: number;
  /** Mutații oprite de o eroare de business. Cer omul, nu rețeaua. */
  readonly blocked: number;
}

export interface SyncSummary extends SyncCounts {
  readonly lastPulledAt: string | null;
  readonly lastPushedAt: string | null;
  readonly online: boolean;
}

/**
 * Cele două numere nu se adună.
 *
 * Dacă omul vede „4 de sincronizat" și sunt doar poze, intră în panică degeaba —
 * fișa lui e deja la birou. Contorul spune ce sunt, nu doar câte.
 */
export async function counts(): Promise<SyncCounts> {
  if (!hasIndexedDb()) {
    return { data: 0, media: 0, blocked: 0 };
  }
  const db = fieldDb();
  const [pending, blocked, media] = await Promise.all([
    db.outbox.where('status').equals('pending').count(),
    db.outbox.where('status').equals('blocked').count(),
    db.media.count(),
  ]);
  return { data: pending, media, blocked };
}

export async function summary(): Promise<SyncSummary> {
  const base = await counts();
  const state = hasIndexedDb() ? await fieldDb().state.get('state') : undefined;
  return {
    ...base,
    lastPulledAt: state?.lastPulledAt ?? null,
    lastPushedAt: state?.lastPushedAt ?? null,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  };
}

/** Pune o mutație în coadă. Se cheamă din ecrane, offline sau nu. */
export async function enqueueMutation(row: Omit<OutboxRow, 'attempts' | 'status'>): Promise<void> {
  await fieldDb().outbox.put({ ...row, attempts: 0, status: 'pending' });
}

/** Pune o poză în coadă. Blob-ul intră în IndexedDB, nu rămâne în memorie. */
export async function enqueueMedia(
  row: Omit<MediaRow, 'attempts' | 'uploadedParts' | 'status'>,
): Promise<void> {
  await fieldDb().media.put({ ...row, attempts: 0, uploadedParts: 0, status: 'pending' });
}

// ── Pull ─────────────────────────────────────────────────────────────────────

interface PullResponse {
  readonly cursor: string;
  readonly full: boolean;
  readonly snapshot: {
    readonly takenAt: string;
    readonly workUnits: readonly { readonly id: string }[];
    readonly stages: readonly { readonly id: string }[];
    readonly checklists: readonly { readonly id: string }[];
    readonly stock: readonly {
      readonly locationId: string;
      readonly productId: string;
    }[];
    readonly people: readonly { readonly id: string }[];
    readonly series: readonly { readonly companyId: string; readonly series: string }[];
    readonly answers: readonly {
      readonly workUnitId: string;
      readonly checklistItemId: string;
    }[];
    readonly interventions: readonly { readonly workUnitId: string }[];
  };
}

/**
 * Trage felia și o scrie peste cea locală, **într-o singură tranzacție**.
 *
 * Se rescrie întreagă, nu se îmbină: felia e mică, iar o îmbinare ar fi cerut
 * tombstones pe șase tabele ca să se vadă ce a dispărut de la birou. O unitate
 * scoasă din felie trebuie să dispară de pe telefon, nu să rămână agățată.
 *
 * **Outbox-ul și media NU se ating.** Ele sunt munca omului; felia e doar o
 * copie a ce știe serverul.
 */
export async function pull(): Promise<{ ok: boolean; reason?: string }> {
  if (!hasIndexedDb()) {
    return { ok: false, reason: 'Fără stocare locală.' };
  }

  const response = await fetch(`/api/field/sync?deviceId=${encodeURIComponent(deviceId())}`, {
    cache: 'no-store',
  }).catch(() => null);

  if (response === null) {
    return { ok: false, reason: 'Fără rețea.' };
  }
  if (!response.ok) {
    return { ok: false, reason: `Serverul a răspuns ${String(response.status)}.` };
  }

  const body = (await response.json()) as PullResponse;
  const db = fieldDb();

  await db.transaction(
    'rw',
    [
      db.workUnits,
      db.stages,
      db.checklists,
      db.stock,
      db.people,
      db.series,
      db.answers,
      db.interventionSheets,
      db.state,
    ],
    async () => {
      await Promise.all([
        db.workUnits.clear(),
        db.stages.clear(),
        db.checklists.clear(),
        db.stock.clear(),
        db.people.clear(),
        db.series.clear(),
        db.answers.clear(),
        db.interventionSheets.clear(),
      ]);

      await db.workUnits.bulkPut(body.snapshot.workUnits as never[]);
      await db.stages.bulkPut(body.snapshot.stages as never[]);
      await db.checklists.bulkPut(body.snapshot.checklists as never[]);
      // Stocul n-are cheie proprie pe server: e (gestiune, produs).
      await db.stock.bulkPut(
        body.snapshot.stock.map((line) => ({
          ...line,
          key: `${line.locationId}|${line.productId}`,
        })) as never[],
      );
      await db.people.bulkPut(body.snapshot.people as never[]);
      await db.series.bulkPut(
        body.snapshot.series.map((entry) => ({
          ...entry,
          key: `${entry.companyId}|${entry.series}`,
        })) as never[],
      );

      // Raspunsurile n-au cheie proprie pe server: sunt (unitate, punct).
      await db.answers.bulkPut(
        body.snapshot.answers.map((answer) => ({
          ...answer,
          key: `${answer.workUnitId}|${answer.checklistItemId}`,
        })) as never[],
      );
      await db.interventionSheets.bulkPut(body.snapshot.interventions as never[]);

      await db.state.put({
        key: 'state',
        cursor: body.cursor,
        lastPulledAt: body.snapshot.takenAt,
        lastPushedAt: (await db.state.get('state'))?.lastPushedAt ?? null,
      });
    },
  );

  return { ok: true };
}

// ── Push ─────────────────────────────────────────────────────────────────────

interface PushResponse {
  readonly outcomes: readonly {
    readonly id: string;
    readonly status: 'applied' | 'duplicate' | 'failed' | 'skipped';
    readonly code?: string;
    readonly message?: string;
  }[];
  readonly applied: number;
  readonly blocked: boolean;
}

/**
 * Urcă mutațiile care așteaptă, în ordinea creării.
 *
 * Ce se întâmplă cu fiecare rezultat, și de ce:
 *
 *  - `applied` / `duplicate` → **iese din coadă.** Duplicatul înseamnă că
 *    serverul o aplicase deja; a rămas în coadă doar pentru că răspunsul se
 *    pierduse. Exact cazul pentru care există idempotența.
 *  - `failed` → **rămâne, marcată `blocked`.** N-are rost s-o retrimită
 *    automat: aceleași date vor da același răspuns. Cere omul.
 *  - `skipped` → rămâne `pending`. N-a fost încercată, fiindcă una dinaintea ei
 *    a blocat coada.
 */
export async function push(): Promise<{ ok: boolean; applied: number; reason?: string }> {
  if (!hasIndexedDb()) {
    return { ok: false, applied: 0, reason: 'Fără stocare locală.' };
  }

  const db = fieldDb();
  // O mutație blocată oprește tot: nu se sare peste ea nici pe client.
  if ((await db.outbox.where('status').equals('blocked').count()) > 0) {
    return { ok: false, applied: 0, reason: 'Coada e oprită de un conflict.' };
  }

  const batch = await db.outbox
    .where('status')
    .equals('pending')
    .sortBy('createdAt')
    .then((rows) => rows.slice(0, MAX_MUTATIONS_PER_PUSH));

  if (batch.length === 0) {
    return { ok: true, applied: 0 };
  }

  const response = await fetch('/api/field/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: deviceId(),
      mutations: batch.map((row) => ({
        id: row.id,
        type: row.type,
        payload: row.payload,
        createdAt: row.createdAt,
      })),
    }),
  }).catch(() => null);

  if (response === null) {
    // Eșec de REȚEA: nu se marchează nimic. Mutațiile rămân exact cum erau, iar
    // reluarea e sigură pentru că serverul le recunoaște după id.
    await db.outbox.bulkPut(batch.map((row) => ({ ...row, attempts: row.attempts + 1 })));
    return { ok: false, applied: 0, reason: 'Fără rețea.' };
  }

  if (!response.ok) {
    return { ok: false, applied: 0, reason: `Serverul a răspuns ${String(response.status)}.` };
  }

  const body = (await response.json()) as PushResponse;
  const byId = new Map(body.outcomes.map((outcome) => [outcome.id, outcome]));

  await db.transaction('rw', [db.outbox, db.state], async () => {
    for (const row of batch) {
      const outcome = byId.get(row.id);
      if (outcome === undefined) {
        continue;
      }
      if (outcome.status === 'applied' || outcome.status === 'duplicate') {
        await db.outbox.delete(row.id);
      } else if (outcome.status === 'failed') {
        await db.outbox.put({
          ...row,
          status: 'blocked',
          ...(outcome.code === undefined ? {} : { errorCode: outcome.code }),
          ...(outcome.message === undefined ? {} : { errorMessage: outcome.message }),
        });
      }
      // `skipped` rămâne neatinsă: se reia după ce omul deblochează coada.
    }

    const state = await db.state.get('state');
    await db.state.put({
      key: 'state',
      cursor: state?.cursor ?? null,
      lastPulledAt: state?.lastPulledAt ?? null,
      lastPushedAt: new Date().toISOString(),
    });
  });

  return { ok: true, applied: body.applied };
}

// ── Conflicte ────────────────────────────────────────────────────────────────

/** Mutațiile care așteaptă omul. Ecranul de conflicte citește de aici. */
export async function blockedMutations(): Promise<OutboxRow[]> {
  if (!hasIndexedDb()) {
    return [];
  }
  return fieldDb().outbox.where('status').equals('blocked').sortBy('createdAt');
}

/**
 * Renunță la o mutație blocată.
 *
 * E singura ștergere pe care o poate face omul, și e deliberat brutală: nu
 * există „încearcă din nou" pentru aceleași date, pentru că serverul ține minte
 * răspunsul după `id`. Cine vrea să reîncerce trebuie să facă o **mutație
 * nouă**, deci să redeschidă fișa — și atunci vede și ce a respins serverul.
 */
export async function discardMutation(id: string): Promise<void> {
  await fieldDb().outbox.delete(id);
}

/** Deblochează coada după ce omul a renunțat la ce o oprea. */
export async function retryQueue(): Promise<void> {
  const db = fieldDb();
  const blocked = await db.outbox.where('status').equals('blocked').toArray();
  await db.outbox.bulkPut(
    blocked.map((row) => ({ ...row, status: 'pending' as const, attempts: 0 })),
  );
}

// ── Ciclul complet ───────────────────────────────────────────────────────────

/**
 * Un ciclu: întâi urcă datele, apoi trage felia, apoi pozele.
 *
 * Pull-ul vine DUPĂ push dinadins: altfel felia proaspătă ar fi arătat o stare
 * din care lipsește exact ce tocmai a scris omul, iar ecranul ar fi clipit
 * înapoi la vechi pentru o secundă.
 */
export async function syncOnce(): Promise<SyncSummary> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return summary();
  }
  await push();
  await pull();
  // Pozele la urma, si abia dupa ce felia e proaspata: daca reteaua se stinge
  // la jumatatea lor, fisele sunt deja la birou.
  await uploadPending();
  return summary();
}
