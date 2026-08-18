import Dexie, { type Table } from 'dexie';
import type {
  FieldChecklist,
  FieldPerson,
  FieldSeries,
  FieldStage,
  FieldStockLine,
  FieldWorkUnit,
} from '@damina/services';

/**
 * Baza locală a aplicației de teren (pasul 10, §3.1).
 *
 * Trei magazii, cu roluri care nu se amestecă:
 *
 *  - **`snapshot`** — felia mea de date, read model, **doar cantități**. Se
 *    rescrie întreagă la fiecare pull. Nimic din ea nu e sursă de adevăr: e o
 *    copie, iar dacă se pierde, se ia din nou.
 *  - **`outbox`** — mutațiile care așteaptă, în ordinea creării. **Asta e**
 *    munca omului. Dacă se pierde, s-a pierdut o zi de teren.
 *  - **`media`** — pozele care așteaptă, cu progresul lor. Coadă separată,
 *    prioritate mai mică decât datele, dar nu se pierde niciodată.
 *
 * De ce outbox propriu peste Dexie și nu un motor de replicare: felia e mică și
 * bine delimitată, scrierile sunt oricum custom (regulile rulează pe server), iar
 * izolarea prețului ar cere reguli de sincronizare care exclud coloane — adică
 * protecție în două locuri, care pot diverge. Escape hatch-ul e documentat în
 * `docs/field-sync.md`: dacă felia crește necontrolat, se poate adăuga un motor
 * **pentru citiri**, fără să se schimbe push-ul.
 */

/** O mutație în așteptare. `id` e generat pe client și NU se remapează. */
export interface OutboxRow {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: string;
  /** Câte încercări a avut. Crește doar la eșecuri de rețea. */
  attempts: number;
  /**
   * Starea în coadă. `blocked` e mutația care a picat cu eroare de business:
   * ea oprește coada și așteaptă omul, pe ecranul de conflicte.
   */
  status: 'pending' | 'blocked';
  errorCode?: string;
  errorMessage?: string;
  /** Ce descrie mutația, în cuvintele omului. Apare pe ecranul de conflicte. */
  label: string;
}

/** O poză care așteaptă. Blob-ul stă în IndexedDB, nu în memorie. */
export interface MediaRow {
  readonly id: string;
  readonly parentNodeId: string;
  readonly filename: string;
  readonly blob: Blob;
  readonly createdAt: string;
  /** Coordonatele culese de aparat, dacă le-a dat. */
  readonly lat?: number;
  readonly lng?: number;
  readonly accuracy?: number;
  attempts: number;
  /** Câte părți s-au urcat deja, ca progresul să nu o ia de la capăt. */
  uploadedParts: number;
  status: 'pending' | 'uploading' | 'failed';
  errorMessage?: string;
}

/** Metadate ale sincronizării. O singură linie, cheia `state`. */
export interface SyncState {
  readonly key: 'state';
  cursor: string | null;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
}

class FieldDatabase extends Dexie {
  declare workUnits: Table<FieldWorkUnit, string>;
  declare stages: Table<FieldStage, string>;
  declare checklists: Table<FieldChecklist, string>;
  declare stock: Table<FieldStockLine & { key: string }, string>;
  declare people: Table<FieldPerson, string>;
  declare series: Table<FieldSeries & { key: string }, string>;
  declare outbox: Table<OutboxRow, string>;
  declare media: Table<MediaRow, string>;
  declare state: Table<SyncState, string>;

  constructor() {
    super('damina-field');
    /*
     * Indecșii sunt exact interogările ecranelor, nu „toate coloanele":
     * `outbox` se citește în ordinea creării, `media` la fel, stocul pe
     * gestiune. Un index în plus e o scriere în plus la fiecare pull.
     */
    this.version(1).stores({
      workUnits: 'id, type, status, startsOn',
      stages: 'id, workUnitId',
      checklists: 'id',
      stock: 'key, locationId, productId',
      people: 'id',
      series: 'key, companyId',
      outbox: 'id, createdAt, status',
      media: 'id, createdAt, status',
      state: 'key',
    });
  }
}

let instance: FieldDatabase | null = null;

/**
 * Baza, deschisă leneș.
 *
 * Nu la import: modulul ăsta ajunge și în bundle-ul unei pagini randate pe
 * server, unde `indexedDB` nu există. Deschiderea la prima folosire ține
 * decizia acolo unde se știe că suntem în browser.
 */
export function fieldDb(): FieldDatabase {
  instance ??= new FieldDatabase();
  return instance;
}

export const hasIndexedDb = (): boolean =>
  typeof globalThis !== 'undefined' && 'indexedDB' in globalThis;
