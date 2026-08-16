import type { Actor, Session } from '@damina/auth';
import type { ReactNode } from 'react';
import type { AppContext } from '../lib/context';
import type { IconName, NavGroup } from './navigation';

/**
 * Contractul unei entitati din shell-ul fractal.
 *
 * TOT ce inseamna „o pagina de entitate” se declara aici: lista, antetul,
 * tab-urile, legaturile, actiunile rapide si formularul. Nu exista cod de
 * pagina per entitate — exista `[module]/page.tsx` si
 * `[module]/[id]/[[...tab]]/page.tsx`, si atat.
 *
 * Testul pasului: in pasul 04 se adauga contractul FARA sa se atinga shell-ul.
 * Daca cineva simte nevoia sa scrie a doua pagina de detaliu „pentru ca e
 * speciala”, ceva din interfata asta lipseste — se completeaza ea, nu se
 * ocoleste.
 *
 * Nota de tipuri: metodele sunt scrise cu sintaxa de metoda (`load(...)`), nu
 * de proprietate (`load: (...) => ...`). Diferenta nu e cosmetica: sintaxa de
 * metoda face parametrii bivarianti in TypeScript, ceea ce permite ca un
 * `EntityDefinition<ProductRow>` sa stea intr-un registry de
 * `EntityDefinition<unknown>`. Fara ea, singura alternativa era `any` peste tot
 * in registry — adica sa nu mai avem tipuri deloc acolo unde conteaza.
 */

export interface EntityContext {
  readonly session: Session;
  readonly actor: Actor;
  readonly app: AppContext;
}

export interface ListQuery {
  readonly query?: string;
  readonly includeInactive?: boolean;
  /**
   * Vederea aleasa din comutatorul listei. Sirul vid e tabelul.
   *
   * Exista pentru ca obiectivele se citesc si pe harta (§3.5) — aceleasi date,
   * alta reprezentare. Nu e o a doua lista: `load` ramane unul singur, ca
   * numarul de randuri sa nu poata diferi intre vederi.
   */
  readonly view?: string;
}

/** O vedere a listei. Prima din sir e implicita si e intotdeauna tabelul. */
export interface ListView {
  readonly key: string;
  readonly label: string;
}

export interface ListColumn<Row> {
  readonly key: string;
  readonly header: string;
  cell(row: Row): ReactNode;
  readonly align?: 'left' | 'right' | 'center';
  readonly width?: string;
  readonly hideBelow?: 'md' | 'lg';
}

/** Starea goala, obligatorie pe orice lista (§30.11). Nu e optionala. */
export interface EmptyStateSpec {
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
}

export interface EntityListConfig<Row> {
  load(ctx: EntityContext, query: ListQuery): Promise<Row[]>;
  readonly columns: readonly ListColumn<Row>[];
  rowKey(row: Row): string;
  rowHref(row: Row): string;
  /** Randul se evidentiaza: document deschis, tarif in vigoare (§30.3). */
  rowFlagged?(row: Row): boolean;
  readonly empty: EmptyStateSpec;
  readonly searchPlaceholder: string;
  /** Text de context deasupra listei. Ex: „nomenclatoarele sunt comune”. */
  readonly notice?: string;
  /**
   * Vederile comutabile. Lipsa lor inseamna „doar tabel”, cazul obisnuit.
   *
   * Cheia unei vederi e si sub-slugul ei de navigare: `/obiective/profile` din
   * sidebar ajunge la `?view=profile`. Asa intrarile de meniu prevazute in §3
   * raman navigabile fara sa se creeze o a doua pagina de lista.
   */
  readonly views?: readonly ListView[];
  /** Randeaza o vedere care nu e tabelul. Primeste ACELEASI randuri. */
  renderView?(
    rows: readonly Row[],
    view: string,
    ctx: EntityContext,
  ): ReactNode | Promise<ReactNode>;
}

export interface HeaderBadge {
  readonly label: string;
  readonly tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'outline';
}

export interface HeaderMeta {
  readonly label: string;
  readonly value: ReactNode;
}

/**
 * Cele MAXIM DOUA bare de progres din antet (§4).
 *
 * Doua, nu cinci. Barele din antet sunt cele pe care se ia decizia — la lucrare
 * progres vs consum, la contract gradul de plafon. Restul indicatorilor stau in
 * tab-uri, unde omul se duce cand chiar ii cauta.
 */
export interface HeaderProgress {
  readonly label: string;
  readonly value: number;
  readonly detail?: string;
  readonly tone?: 'brand' | 'success' | 'warning' | 'danger';
}

export interface EntityHeaderModel {
  readonly title: string;
  /** Breadcrumb semantic: NUME, nu ID-uri. */
  readonly breadcrumb: readonly { readonly label: string; readonly href?: string }[];
  readonly badges: readonly HeaderBadge[];
  readonly meta: readonly HeaderMeta[];
  readonly progress?: readonly HeaderProgress[];
}

export interface EntityTab<Entity> {
  /** Sirul vid e tab-ul implicit („Prezentare”), la `/modul/{id}`. */
  readonly slug: string;
  readonly label: string;
  /**
   * Cine vede tab-ul. Cand intoarce `false`, tab-ul NU se randeaza si ruta lui
   * raspunde cu „nu ai acces” — §30.5: lipseste, nu e gri. Nu exista `disabled`
   * in interfata asta, si nici nu trebuie sa apara.
   */
  visible?(session: Session): boolean;
  count?(entity: Entity): number | undefined;
  /**
   * `sub` sunt segmentele de dupa slugul tab-ului.
   *
   * Exista pentru cifrele care se desfac: banda unei componente duce la
   * `/contracte/{id}/componente/{componentId}`, adica la lista de UL finantate
   * din ea. Fara ele, „orice cifra se poate deschide” (I3) ar fi cerut o a doua
   * pagina de detaliu — exact ce interzice fisierul asta.
   */
  render(
    entity: Entity,
    ctx: EntityContext,
    sub: readonly string[],
  ): ReactNode | Promise<ReactNode>;
}

export interface LinkItem {
  readonly label: string;
  readonly href: string;
  readonly meta?: string;
  readonly tone?: 'neutral' | 'warning' | 'danger' | 'success';
}

export interface LinkGroup {
  /** `up` = parintii (contract, obiectiv, cererea de origine). */
  readonly kind: 'up' | 'related';
  readonly title: string;
  readonly count?: number;
  readonly items: readonly LinkItem[];
}

export interface QuickAction {
  readonly label: string;
  readonly href?: string;
  readonly tone?: 'primary' | 'secondary';
  readonly disabledReason?: string;
}

export interface EntityDetailConfig<Entity> {
  load(ctx: EntityContext, id: string): Promise<Entity | null>;
  /**
   * Antetul. Poate fi asincron: barele de progres ale contractului se calculeaza
   * din plafoanele lunii selectate, iar luna vine din context, nu din rand.
   */
  header(entity: Entity, ctx: EntityContext): EntityHeaderModel | Promise<EntityHeaderModel>;
  readonly tabs: readonly EntityTab<Entity>[];
  /**
   * Panoul de Legaturi, rezolvat in RSC, cu contoare.
   *
   * Regula de aur (§6): daca doua entitati sunt legate in model, legatura e
   * navigabila IN AMBELE SENSURI. Din reparatie vezi observatia care a
   * generat-o; din observatie vezi reparatia. Fara reciprocitate, jumatate din
   * intrebarile reale nu au raspuns.
   */
  links(entity: Entity, ctx: EntityContext): Promise<readonly LinkGroup[]>;
  /** 3–5 actiuni, care se schimba cu STATUSUL entitatii. */
  quickActions(entity: Entity, ctx: EntityContext): readonly QuickAction[];
}

// ── Formularul, declarat ca date ─────────────────────────────────────────────

export type ControlKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'date'
  | 'number'
  /**
   * Perechea de coordonate, cu harta pe care se pune pinul.
   *
   * E un singur control, nu doua campuri de text, pentru ca latitudinea si
   * longitudinea nu au sens separat — iar §3.5 cere explicit ca pinul de pe
   * harta sa se foloseasca si la SELECTIA coordonatelor, nu doar la afisare.
   * Numele campului e cel al latitudinii; longitudinea o da `pairedWith`.
   */
  | 'geo';

export interface FormFieldSpec {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly control: ControlKind;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly suffix?: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly full?: boolean;
  /** Se poate scrie doar la creare. Ex: codul unui produs deja folosit. */
  readonly readOnlyOnEdit?: boolean;
  /** Doar pentru `control: 'geo'`: numele campului de longitudine. */
  readonly pairedWith?: string;
}

export type Lookups = Readonly<Record<string, readonly { value: string; label: string }[]>>;

export interface EntityFormConfig<Row> {
  /** Cheia schemei Zod din `record-form-dialog.tsx`. Aceeasi si pe server. */
  readonly schemaKey: string;
  /** Listele de optiuni care se incarca inainte de a desena formularul. */
  loadLookups?(ctx: EntityContext): Promise<Lookups>;
  fields(lookups: Lookups): readonly FormFieldSpec[];
  /** Valorile initiale la editare. La creare se folosesc cele din `blank`. */
  toFormValues(row: Row): Readonly<Record<string, unknown>>;
  readonly blank: Readonly<Record<string, unknown>>;
  readonly createTitle: string;
  readonly editTitle: string;
  /** Lipseste cand entitatea nu se editeaza deloc (tarifele: doar se adauga). */
  readonly editable: boolean;
}

export interface EntityDefinition<Row = unknown, Entity = Row> {
  readonly slug: string;
  readonly singular: string;
  readonly plural: string;
  readonly icon: IconName;
  readonly group: NavGroup;
  readonly usesPeriod: boolean;
  /**
   * Cine poate DESCHIDE modulul. Cand intoarce `false`, modulul lipseste din
   * sidebar si ruta lui raspunde cu „nu ai acces” — nu apare gri, ca sa nu
   * invete nimeni ca exista un ecran la care nu ajunge.
   */
  canRead?(session: Session): boolean;
  /** Cine poate crea/edita. Cand lipseste, entitatea e doar de citit. */
  canWrite?(session: Session): boolean;
  readonly list?: EntityListConfig<Row>;
  readonly detail?: EntityDetailConfig<Entity>;
  readonly form?: EntityFormConfig<Row>;
}

/**
 * Sterge tipurile la granita registry-ului, pastrandu-le in interiorul fiecarei
 * definitii. Consumatorul generic (pagina fractala) lucreaza cu `unknown` si nu
 * are nevoie sa stie ce entitate randeaza — exact rostul lui.
 */
export function defineEntity<Row, Entity = Row>(
  definition: EntityDefinition<Row, Entity>,
): EntityDefinition {
  return definition as EntityDefinition;
}
