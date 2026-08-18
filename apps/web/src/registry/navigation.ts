/**
 * Harta completa a meniului, transcrisa din §3.
 *
 * Fisierul e SERIALIZABIL dinadins: doar siruri, numere si liste. Sidebar-ul e
 * o componenta de client (se expandeaza, isi tine starea), iar registry-ul de
 * entitati contine componente React si interogari de server. Daca ar fi acelasi
 * fisier, jumatate din server ar ajunge in bundle-ul browserului.
 *
 * Regula de aur a fisierului: **intrarile modulelor care inca nu exista NU se
 * sterg**. Randeaza o stare goala „Disponibil din faza X”, nu 404. Un meniu care
 * creste pe masura ce se construieste aplicatia invata omul de doua ori; unul
 * complet de la inceput il invata o data si ii arata unde se ajunge.
 */

export type NavGroup = 'operational' | 'libraries' | 'configuration';

/** Numele icoanei din `lucide-react`. Maparea se face in sidebar. */
export type IconName =
  | 'gauge'
  | 'fileSignature'
  | 'mapPin'
  | 'inbox'
  | 'hammer'
  | 'truck'
  | 'users'
  | 'banknote'
  | 'folder'
  | 'library'
  | 'settings'
  | 'package'
  | 'building'
  | 'handshake'
  | 'award'
  | 'receipt';

export interface NavChild {
  readonly slug: string;
  readonly label: string;
}

export interface NavItem {
  /** Primul segment de ruta: `/produse`, `/contracte`. */
  readonly slug: string;
  readonly label: string;
  readonly icon: IconName;
  readonly group: NavGroup;
  /**
   * Faza in care modulul chiar exista. `0` inseamna construit acum.
   * Restul randeaza `EmptyState` cu „Disponibil din faza X”.
   */
  readonly phase: 0 | 1 | 2 | 3 | 4 | 5;
  /** Sub-sectiunile care se expandeaza inline sub modulul activ. */
  readonly children?: readonly NavChild[];
  /**
   * Ce tipuri de coada alimenteaza badge-ul numeric al modulului.
   *
   * Badge-ul e „cate lucruri asteapta de la MINE aici”, nu un total. Un modul
   * fara `queueKinds` nu are badge — si asta e corect: daca cifra nu se poate
   * goli prin actiune, e statistica, si statisticile stau in Panou.
   */
  readonly queueKinds?: readonly string[];
  /** Ecranele care nu depind de luna ascund selectorul de perioada (§5.2). */
  readonly usesPeriod?: boolean;
}

export const NAVIGATION: readonly NavItem[] = [
  {
    slug: 'panou',
    label: 'Panou',
    icon: 'gauge',
    group: 'operational',
    phase: 0,
    usesPeriod: true,
    children: [
      { slug: '', label: 'Panoul meu' },
      { slug: 'grup', label: 'Panou grup' },
      { slug: 'rapoarte', label: 'Rapoarte' },
    ],
  },

  // ── Operațional ───────────────────────────────────────────────────────────
  {
    slug: 'contracte',
    label: 'Contracte',
    icon: 'fileSignature',
    group: 'operational',
    phase: 0,
    usesPeriod: true,
    children: [
      { slug: '', label: 'Toate contractele' },
      { slug: 'plafoane', label: 'Plafoane și componente' },
      { slug: 'portofoliu', label: 'Portofoliu pe an contractual' },
      { slug: 'cadru-furnizori', label: 'Contracte cadru furnizori' },
      { slug: 'subcontractanti', label: 'Contracte subcontractanți' },
    ],
  },
  {
    slug: 'obiective',
    label: 'Obiective',
    icon: 'mapPin',
    group: 'operational',
    phase: 0,
    children: [
      { slug: '', label: 'Toate obiectivele' },
      { slug: 'acoperire', label: 'Acoperire inspecții' },
      { slug: 'profile', label: 'Profile de inspecție' },
    ],
  },
  {
    slug: 'cereri',
    label: 'Cereri',
    icon: 'inbox',
    group: 'operational',
    // Construit la 08b. Sub-sectiunile sunt VEDERI ale aceleiasi liste
    // (`?view=…`), nu pagini separate: numarul de cereri nu poate diferi intre
    // „Toate cererile" si „Inbox" pentru ca amandoua ies din acelasi `load`.
    phase: 0,
    queueKinds: ['cerere_neprocesata'],
    // Cererea e a firmei, nu a lunii: traieste pana e decisa. Selectorul de
    // perioada ar sugera ca inbox-ul se goleste la schimbarea lunii.
    usesPeriod: false,
    children: [
      { slug: 'inbox', label: 'Inbox (email neprocesat)' },
      { slug: '', label: 'Toate cererile' },
      { slug: 'backlog', label: 'Backlog de propuneri' },
      { slug: 'rutare', label: 'Decizii de rutare' },
    ],
  },
  {
    slug: 'activitate',
    label: 'Activitate',
    icon: 'hammer',
    group: 'operational',
    phase: 0,
    usesPeriod: true,
    children: [
      { slug: '', label: 'Toată activitatea' },
      { slug: 'inspectii', label: 'Inspecții' },
      { slug: 'interventii', label: 'Intervenții' },
      { slug: 'lucrari', label: 'Lucrări' },
      { slug: 'calendar', label: 'Calendar / Gantt' },
      { slug: 'pontaj', label: 'Pontaj' },
    ],
  },
  {
    slug: 'aprovizionare',
    label: 'Aprovizionare',
    icon: 'truck',
    group: 'operational',
    phase: 3,
    queueKinds: ['necesar_de_procesat', 'receptie_de_facut'],
    usesPeriod: true,
    children: [
      { slug: 'necesare', label: 'Necesare de material' },
      { slug: 'comenzi', label: 'Comenzi (PO)' },
      { slug: 'receptii', label: 'Recepții' },
      { slug: 'stoc', label: 'Stoc și gestiuni' },
      { slug: 'transferuri', label: 'Transferuri și retururi' },
      { slug: 'inventare', label: 'Inventare' },
      { slug: 'rezervari', label: 'Rezervări' },
    ],
  },
  {
    slug: 'resurse',
    label: 'Resurse',
    icon: 'users',
    group: 'operational',
    phase: 4,
    usesPeriod: true,
    children: [
      { slug: 'utilaje', label: 'Utilaje (flotă)' },
      { slug: 'unelte', label: 'Unelte' },
      { slug: 'transporturi', label: 'Transporturi' },
      { slug: 'oameni', label: 'Oameni și echipe' },
      { slug: 'subcontractanti', label: 'Subcontractanți' },
    ],
  },
  {
    slug: 'bani',
    label: 'Bani',
    icon: 'banknote',
    group: 'operational',
    // Patru ecrane construite la 06c: re-alocarile lunii, reconcilierea, marja si
    // inchiderea. Restul sub-sectiunilor NU s-au sters: sunt vederi care spun din
    // ce faza vin. Un link care duce altundeva decat spune e mai rau decat unul
    // care asteapta.
    phase: 0,
    queueKinds: ['sl_de_aprobat', 'factura_nematchata'],
    usesPeriod: true,
    children: [
      { slug: '', label: 'Re-alocările lunii' },
      { slug: 'reconciliere', label: 'Folosit vs descărcat' },
      { slug: 'marja', label: 'Marjă și plafoane' },
      { slug: 'inchidere', label: 'Închidere de perioadă' },
      { slug: 'facturare', label: 'Facturare emisă' },
      { slug: 'facturi-furnizor', label: 'Facturi furnizor / SPV' },
      { slug: 'situatii', label: 'Situații de lucrări' },
      { slug: 'garantii', label: 'Garanții și avansuri' },
      { slug: 'cash-flow', label: 'Cash-flow' },
      { slug: 'saga', label: 'Conector Saga' },
    ],
  },

  // ── Biblioteci ────────────────────────────────────────────────────────────
  {
    slug: 'documente',
    label: 'Documente',
    icon: 'folder',
    group: 'libraries',
    phase: 1,
    queueKinds: ['pv_deschis'],
    children: [
      { slug: '', label: 'Arbore de fișiere' },
      { slug: 'procese-verbale', label: 'Procese verbale' },
      { slug: 'sabloane', label: 'Șabloane' },
      { slug: 'expirari', label: 'Expirări și autorizații' },
    ],
  },

  // Nomenclatoarele sunt module de sine statatoare la nivel de ruta (`/produse`),
  // grupate vizual sub „Nomenclatoare”. Ruta plata e ce face pagina fractala sa
  // functioneze uniform: `/produse/{id}/istoric` are exact forma pe care o va
  // avea `/contracte/{id}/plafoane` in pasul 04.
  {
    slug: 'produse',
    label: 'Produse',
    icon: 'package',
    group: 'libraries',
    phase: 0,
  },
  {
    slug: 'furnizori',
    label: 'Furnizori',
    icon: 'truck',
    group: 'libraries',
    phase: 0,
  },
  {
    slug: 'clienti',
    label: 'Clienți',
    icon: 'building',
    group: 'libraries',
    phase: 0,
  },
  {
    slug: 'subcontractanti',
    label: 'Subcontractanți',
    icon: 'handshake',
    group: 'libraries',
    phase: 0,
  },
  {
    slug: 'calificari',
    label: 'Calificări',
    icon: 'award',
    group: 'libraries',
    phase: 0,
  },
  {
    slug: 'tarife',
    label: 'Tarife',
    icon: 'receipt',
    group: 'libraries',
    phase: 0,
  },
  {
    slug: 'articole-normate',
    label: 'Articole normate',
    icon: 'library',
    group: 'libraries',
    phase: 2,
  },
  {
    slug: 'operatiuni',
    label: 'Catalog de operațiuni',
    icon: 'library',
    group: 'libraries',
    phase: 0,
  },

  // ── Configurare ───────────────────────────────────────────────────────────
  {
    slug: 'administrare',
    label: 'Administrare',
    icon: 'settings',
    group: 'configuration',
    // Trecut pe 0 in 02d. Cele trei sub-sectiuni care inca nu exista (firme,
    // praguri, integrari) NU s-au sters: sunt vederi ale listei care randeaza
    // „din faza 1”. Fara ele, intrarile de meniu ar fi cazut tacut pe tabelul de
    // utilizatori — un link care duce altundeva decat spune e mai rau decat unul
    // care spune ca inca nu e gata.
    phase: 0,
    children: [
      { slug: '', label: 'Utilizatori și roluri' },
      { slug: 'drepturi', label: 'Matricea de drepturi' },
      { slug: 'audit', label: 'Audit trail' },
      { slug: 'firme', label: 'Firme și serii de documente' },
      { slug: 'praguri', label: 'Praguri și reguli' },
      { slug: 'integrari', label: 'Integrări' },
    ],
  },
];

/** Grupurile de nomenclator, ca sa apara sub un singur titlu in sidebar. */
export const NOMENCLATURE_SLUGS: readonly string[] = [
  'produse',
  'furnizori',
  'clienti',
  'subcontractanti',
  'calificari',
  'tarife',
  'articole-normate',
  'operatiuni',
];

const BY_SLUG = new Map(NAVIGATION.map((item) => [item.slug, item]));

export function findNavItem(slug: string): NavItem | undefined {
  return BY_SLUG.get(slug);
}

/** Toate tipurile de coada care alimenteaza un badge. Pentru o singura interogare. */
export const BADGED_QUEUE_KINDS: readonly string[] = [
  ...new Set(NAVIGATION.flatMap((item) => item.queueKinds ?? [])),
];
