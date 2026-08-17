/**
 * Dictionarul ro-RO. Singura sursa de text pentru interfata.
 *
 * Regula pasului 03: zero siruri de UI hardcodate in componente. Nu e o
 * preferinta de stil — e ce face posibil ca un termen sa se schimbe intr-un
 * singur loc ("obiectiv" → "amplasament") fara sa vaneze cineva 40 de fisiere.
 *
 * Aici scriem romana CU diacritice. Codul si baza de date raman in engleza,
 * cu exceptia termenilor de domeniu care nu au traducere utila si care raman
 * in romana peste tot, inclusiv in schema: deviz, aviz, nir, pontaj,
 * situatie_lucrari, bon_consum, proces_verbal, delta.
 *
 * Interpolare: `{nume}` in text, obiect de parametri la `t()`.
 */
export const roRO = {
  common: {
    appName: 'Damina',
    appNameLong: 'Damina ERP',
    loading: 'Se încarcă…',
    save: 'Salvează',
    saving: 'Se salvează…',
    cancel: 'Renunță',
    close: 'Închide',
    back: 'Înapoi',
    search: 'Caută',
    filter: 'Filtrează',
    all: 'Toate',
    yes: 'Da',
    no: 'Nu',
    edit: 'Modifică',
    delete: 'Șterge',
    add: 'Adaugă',
    create: 'Creează',
    confirm: 'Confirmă',
    active: 'Activ',
    inactive: 'Inactiv',
    optional: 'opțional',
    required: 'obligatoriu',
    none: '—',
    more: 'Mai multe',
    seeAll: 'Vezi toate',
    results: 'rezultate',
    noResults: 'Niciun rezultat',
    retry: 'Încearcă din nou',
    copy: 'Copiază',
    copied: 'Copiat',
    of: 'din',
    total: 'Total',
    updatedAt: 'Actualizat',
    createdAt: 'Creat',
    unknownError: 'Ceva n-a mers. Reîncarcă pagina și încearcă din nou.',
  },

  a11y: {
    skipToContent: 'Sari la conținut',
    mainNavigation: 'Navigare principală',
    breadcrumb: 'Traseu de navigare',
    entityTabs: 'Secțiunile entității',
    closeDialog: 'Închide fereastra',
    openMenu: 'Deschide meniul',
    sortBy: 'Sortează după {column}',
  },

  workspace: {
    auth: 'Autentificare',
    office: 'Birou',
    field: 'Teren',
    portalSubcontractor: 'Portal subcontractant',
    portalClient: 'Portal client',
  },

  // ── Bara globală ──────────────────────────────────────────────────────────
  topbar: {
    searchPlaceholder: 'Caută în tot ERP-ul',
    searchHint: 'Ctrl+K',
    notifications: 'Notificări',
    quickCreate: 'Creează',
    account: 'Contul meu',
    signOut: 'Ieși din cont',
  },

  company: {
    selector: 'Firmă',
    one: 'O firmă',
    some: '{count} firme',
    all: 'Toate firmele',
    allConsolidated: 'consolidat — fără intercompany',
    allGross: 'brut — cu intercompany',
    consolidationHint:
      'Vederea pe mai multe firme elimină facturile dintre firmele grupului. Comută pe „brut” ca să le vezi.',
    locked: 'Ești pe o entitate a firmei {name}. Selectorul rămâne blocat aici.',
    selectAll: 'Selectează toate',
    selectNone: 'Deselectează tot',
  },

  period: {
    selector: 'Perioadă',
    previous: 'Luna anterioară',
    next: 'Luna următoare',
    current: 'Luna curentă',
    closed: 'Închisă',
    closing: 'În curs de închidere',
    open: 'Deschisă',
    lockedTitle: 'Luna {period} este închisă',
    lockedBody:
      'Poți citi tot ce s-a întâmplat în {period}, dar nu mai poți modifica nimic. Corecțiile se fac în luna curentă, prin document.',
    lockedShort: 'Lună închisă — doar citire',
    mixedCompanies: 'Luna {period} e închisă la {closed} din {total} firme selectate.',
    months: {
      1: 'ianuarie',
      2: 'februarie',
      3: 'martie',
      4: 'aprilie',
      5: 'mai',
      6: 'iunie',
      7: 'iulie',
      8: 'august',
      9: 'septembrie',
      10: 'octombrie',
      11: 'noiembrie',
      12: 'decembrie',
    },
    monthsShort: {
      1: 'ian',
      2: 'feb',
      3: 'mar',
      4: 'apr',
      5: 'mai',
      6: 'iun',
      7: 'iul',
      8: 'aug',
      9: 'sep',
      10: 'oct',
      11: 'noi',
      12: 'dec',
    },
  },

  // ── Sidebar ───────────────────────────────────────────────────────────────
  nav: {
    groups: {
      operational: 'Operațional',
      libraries: 'Biblioteci',
      configuration: 'Configurare',
    },
    panou: 'Panou',
    contracte: 'Contracte',
    obiective: 'Obiective',
    cereri: 'Cereri',
    activitate: 'Activitate',
    aprovizionare: 'Aprovizionare',
    resurse: 'Resurse',
    bani: 'Bani',
    documente: 'Documente',
    nomenclatoare: 'Nomenclatoare',
    administrare: 'Administrare',
    produse: 'Produse',
    articoleNormate: 'Articole normate',
    operatiuni: 'Catalog de operațiuni',
    furnizori: 'Furnizori',
    clienti: 'Clienți',
    subcontractanti: 'Subcontractanți',
    calificari: 'Calificări',
    tarife: 'Tarife',
    sabloane: 'Șabloane',
    collapse: 'Restrânge meniul',
    expand: 'Extinde meniul',
    queueBadge: '{count} de rezolvat la {module}',
  },

  // ── Căutare globală ───────────────────────────────────────────────────────
  search: {
    title: 'Căutare globală',
    placeholder: 'Caută sau tastează un prefix…',
    empty: 'Scrie cel puțin două litere.',
    noResults: 'Nimic pentru „{query}”.',
    noResultsHint: 'Încearcă un cod, un nume sau un prefix.',
    hintsTitle: 'Prefixe',
    hints: {
      request: '# — cerere',
      work: 'L- — lucrare',
      person: '@ — persoană',
      module: '/ — mergi la un modul',
      command: '> — comandă',
    },
    groups: {
      navigation: 'Navigare',
      commands: 'Comenzi',
      companies: 'Firme',
      persons: 'Persoane',
      produse: 'Produse',
      furnizori: 'Furnizori',
      clienti: 'Clienți',
      subcontractanti: 'Subcontractanți',
      calificari: 'Calificări',
    },
    commands: {
      closePeriod: 'Închide luna curentă',
      newProduct: 'Produs nou',
      goToPanel: 'Deschide Panoul',
    },
  },

  // ── Notificări, cozi, alerte ──────────────────────────────────────────────
  notifications: {
    title: 'Notificări',
    empty: 'Nicio notificare.',
    emptyHint: 'Aici ajung evenimentele punctuale: aprobări, expirări, răspunsuri.',
    markAllRead: 'Marchează tot ca citit',
    markRead: 'Marchează ca citit',
    unreadCount: '{count} necitite',
    actions: {
      aproba: 'Aprobă',
      vezi: 'Vezi',
      amana: 'Amână',
    },
  },

  queue: {
    title: 'De rezolvat',
    empty: 'Nimic nu așteaptă de la tine.',
    emptyHint: 'Cozile se umplu singure când altcineva îți trimite ceva de aprobat sau procesat.',
    resolve: 'Rezolvă',
    kinds: {
      sl_de_aprobat: 'Situații de lucrări de aprobat',
      cerere_neprocesata: 'Cereri neprocesate',
      pv_deschis: 'Procese verbale deschise',
      receptie_de_facut: 'Recepții de făcut',
      factura_nematchata: 'Facturi nerecunoscute',
      necesar_de_procesat: 'Necesare de procesat',
    },
  },

  alerts: {
    title: 'Alerte deschise',
    empty: 'Nicio alertă deschisă.',
    severity: {
      info: 'Informativ',
      warning: 'Atenție',
      critical: 'Critic',
    },
    resolve: 'Marchează rezolvată',
    since: 'deschisă din {date}',
  },

  // ── Componente ────────────────────────────────────────────────────────────
  dialog: {
    unsavedTitle: 'Ai modificări nesalvate',
    unsavedBody: 'Dacă închizi acum, ce ai scris se pierde.',
    unsavedDiscard: 'Închide și pierde modificările',
    unsavedKeep: 'Rămâi în formular',
  },

  table: {
    empty: 'Niciun rând.',
    loading: 'Se încarcă rândurile…',
    rowsCount: '{count} rânduri',
    rowCount: 'un rând',
    sortAsc: 'crescător',
    sortDesc: 'descrescător',
    page: 'Pagina {page}',
    loadMore: 'Încarcă încă {count}',
  },

  form: {
    fixErrors: 'Verifică {count} câmpuri.',
    fixError: 'Verifică un câmp.',
    saved: 'Salvat.',
    requiredField: 'Câmpul e obligatoriu.',
    invalidNumber: 'Scrie un număr.',
    searchSelect: 'Caută…',
    selectPlaceholder: 'Alege…',
    datePlaceholder: 'zz.ll.aaaa',
  },

  links: {
    title: 'Legături',
    up: 'În sus',
    related: 'Legate',
    quickActions: 'Acțiuni rapide',
    empty: 'Nicio legătură încă.',
    emptyHint: 'Legăturile apar pe măsură ce entitatea produce documente.',
    collapse: 'Ascunde legăturile',
    expand: 'Arată legăturile',
    count: '{count}',
  },

  empty: {
    genericTitle: 'Nimic aici încă',
    genericBody: 'Când apar date, se văd în locul acestui mesaj.',
    phaseTitle: '{module} vine în faza {phase}',
    phaseBody:
      'Modulul e prevăzut în plan, dar încă nu e construit. Navigarea către el funcționează deja, ca să nu se rupă nicio legătură.',
  },

  // ── Panou ─────────────────────────────────────────────────────────────────
  dashboard: {
    title: 'Panoul meu',
    greeting: 'Bună, {name}',
    subtitle: 'Ce așteaptă de la tine în {period}.',
    queueCard: 'Cozile mele',
    alertsCard: 'Alerte deschise',
    statsCard: 'Cifre',
    groupPanel: 'Panou grup',
    reports: 'Rapoarte',
  },

  // ── Nomenclatoare ─────────────────────────────────────────────────────────
  nomenclature: {
    sharedNotice: 'Nomenclatoarele sunt comune celor 5 firme. Doar seriile de documente sunt per firmă.',
    tabs: {
      prezentare: 'Prezentare',
      utilizare: 'Utilizare',
      istoric: 'Istoric',
      documente: 'Documente',
      tarife: 'Tarife',
      solduri: 'Solduri',
      stoc: 'Stoc',
      persoane: 'Persoane',
    },
  },

  produse: {
    singular: 'Produs',
    plural: 'Produse',
    new: 'Produs nou',
    emptyTitle: 'Niciun produs în nomenclator',
    emptyBody:
      'Produsele sunt lista comună din care se cer materiale, se fac NIR-uri și se scriu bonuri de consum. Fără ele, cantitățile din teren nu au de ce să se agațe.',
    emptyAction: 'Adaugă primul produs',
    fields: {
      code: 'Cod',
      name: 'Denumire',
      uom: 'U.M.',
      category: 'Categorie',
      defaultSupplier: 'Furnizor implicit',
      isStockItem: 'Intră în gestiune',
      minStock: 'Stoc minim',
      notes: 'Observații',
      isActive: 'Activ',
    },
    hints: {
      code: 'Codul scris pe bonul de consum. Unic, indiferent de scris.',
      isStockItem: 'Serviciile și manopera facturată nu intră niciodată în gestiune.',
      minStock: 'Sub acest prag se ridică alerta de stoc. Lasă gol dacă nu urmărești.',
    },
    usageEmpty: 'Produsul n-a fost folosit încă în niciun document.',
    usageHint: 'Aici apar NIR-urile, bonurile de consum și comenzile care ating produsul.',
  },

  furnizori: {
    singular: 'Furnizor',
    plural: 'Furnizori',
    new: 'Furnizor nou',
    emptyTitle: 'Niciun furnizor',
    emptyBody:
      'Furnizorii sunt cei de la care se cumpără. Comenzile, NIR-urile și facturile intrate se leagă de ei.',
    emptyAction: 'Adaugă primul furnizor',
    fields: {
      name: 'Denumire',
      cui: 'CUI',
      leadTime: 'Termen de livrare',
      leadTimeDays: '{count} zile',
      isActive: 'Activ',
    },
    hints: {
      leadTime: 'Câte zile trec, în medie, de la comandă la livrare. Se folosește la planificare.',
    },
    balancesTitle: 'Solduri și facturi',
    balancesEmpty: 'Modulul Bani aduce soldurile aici, în faza 3.',
  },

  clienti: {
    singular: 'Client',
    plural: 'Clienți',
    new: 'Client nou',
    emptyTitle: 'Niciun client',
    emptyBody: 'Clienții sunt cei către care se facturează. Contractele se leagă de ei.',
    emptyAction: 'Adaugă primul client',
    fields: {
      name: 'Denumire',
      cui: 'CUI',
      paymentTermDays: 'Termen de plată',
      isIntercompany: 'Firmă din grup',
      intercompanyCompany: 'Care firmă',
    },
    hints: {
      paymentTermDays: 'Zile de la emiterea facturii. Implicit 70.',
      isIntercompany:
        'Marchează clientul dacă e una din cele 5 firme. Facturile către el se elimină la consolidare.',
    },
  },

  subcontractanti: {
    singular: 'Subcontractant',
    plural: 'Subcontractanți',
    new: 'Subcontractant nou',
    emptyTitle: 'Niciun subcontractant',
    emptyBody:
      'Subcontractanții execută pachete de lucrări și își raportează situațiile prin portalul lor.',
    emptyAction: 'Adaugă primul subcontractant',
    fields: {
      name: 'Denumire',
      cui: 'CUI',
      specialties: 'Specialități',
      warrantyRetentionPct: 'Garanție reținută',
    },
    hints: {
      warrantyRetentionPct:
        'Procentul reținut din fiecare situație de lucrări, ca garanție de bună execuție.',
      specialties: 'Separate prin virgulă. Se folosesc la filtrarea ofertanților.',
    },
  },

  calificari: {
    singular: 'Calificare',
    plural: 'Calificări',
    new: 'Calificare nouă',
    emptyTitle: 'Nicio calificare',
    emptyBody:
      'Calificările sunt meseriile pe care le pontezi: instalator, electrician, zidar. Fiecare are un tarif orar istoricizat.',
    emptyAction: 'Adaugă prima calificare',
    fields: {
      code: 'Cod',
      name: 'Denumire',
    },
  },

  tarife: {
    singular: 'Tarif',
    plural: 'Tarife',
    new: 'Tarif nou',
    title: 'Rate card',
    emptyTitle: 'Niciun tarif definit',
    emptyBody:
      'Tariful orar spune cât costă efectiv o oră de manoperă. Fără el, pontajul nu produce cost, iar marja pe lucrare rămâne necunoscută.',
    emptyAction: 'Adaugă primul tarif',
    historicizedNotice:
      'Tarifele nu se modifică — se adaugă un interval nou. Un pontaj din martie rămâne evaluat la tariful din martie.',
    fields: {
      qualification: 'Calificare',
      validFrom: 'Valabil de la',
      validTo: 'Valabil până la',
      hourlySalary: 'Salariu orar',
      taxCoefficient: 'Taxe',
      unproductivityCoefficient: 'Neproductivitate',
      hourlyCost: 'Cost orar',
    },
    hints: {
      validTo: 'Lasă gol pentru tariful curent, fără dată de sfârșit.',
      taxCoefficient: 'Fracție, nu multiplicator: 0,45 înseamnă 45% peste salariu.',
      unproductivityCoefficient:
        'Ore plătite dar nelucrate: deplasări, așteptări, concedii. 0,15 = 15%.',
      hourlyCost: 'Calculat: salariu × (1 + taxe) × (1 + neproductivitate). Nu se editează.',
    },
    overlap:
      'Există deja un tarif pentru {qualification} care acoperă {from}. Închide intervalul vechi înainte să adaugi unul nou.',
    currentBadge: 'în vigoare',
    endedBadge: 'încheiat',
    futureBadge: 'viitor',
  },

  // ── Teren și portaluri ────────────────────────────────────────────────────
  field: {
    title: 'Teren',
    todo: 'Azi',
    syncPending: '{count} de trimis',
    syncOk: 'Totul e sincronizat',
    syncOffline: 'Fără semnal — se lucrează local',
    syncLastAt: 'Ultima sincronizare {time}',
    emptyTitle: 'Nimic pe ziua de azi',
    emptyBody: 'Când primești o inspecție sau o intervenție, apare aici. Merge și fără semnal.',
    noPrices: 'Aplicația de teren nu arată prețuri. Niciodată.',
  },

  portal: {
    subcontractorTitle: 'Portal subcontractant',
    subcontractorBody:
      'Aici își vede fiecare subcontractant pachetele lui, situațiile de lucrări și procesele verbale. Vine în faza 2.',
    clientTitle: 'Portal client',
    clientBody:
      'Tichete, rapoarte lunare și istoricul obiectivelor, pentru clienții de mentenanță. Vine în faza 5.',
  },

  // ── Erori ─────────────────────────────────────────────────────────────────
  errors: {
    PERIOD_CLOSED: 'Luna este închisă și nu mai poate fi modificată.',
    PRICE_FORBIDDEN: 'Nu ai acces la informațiile de preț.',
    AUTHORIZATION_EXPIRED: 'Autorizația folosită a expirat.',
    QUANTITY_EXCEEDS_CONTRACT: 'Cantitatea depășește ce permite contractul.',
    VALIDATION_FAILED: 'Datele introduse nu sunt valide.',
    NOT_FOUND: 'Nu am găsit ce cauți.',
    FORBIDDEN: 'Nu ai dreptul să faci această operațiune.',
    CONFLICT: 'Altcineva a modificat între timp. Reîncarcă și încearcă din nou.',
    notFoundTitle: 'Pagina nu există',
    notFoundBody: 'Linkul e greșit sau entitatea a fost ștearsă.',
    forbiddenTitle: 'Nu ai acces aici',
    forbiddenBody: 'Rolul tău nu deschide ecranul acesta. Cere-i unui administrator dreptul.',
    boundaryTitle: 'Ecranul n-a putut fi afișat',
    boundaryBody: 'Eroarea a fost înregistrată. Reîncarcă pagina; dacă persistă, anunță IT-ul.',
  },

  // ── Autentificare ─────────────────────────────────────────────────────────
  auth: {
    signInTitle: 'Intră în cont',
    signInBody: 'Folosește adresa de email primită de la administrator.',
    email: 'Email',
    password: 'Parolă',
    signIn: 'Intră',
    signingIn: 'Se verifică…',
    forgot: 'Mi-am uitat parola',

    resetTitle: 'Resetare de parolă',
    resetBody: 'Îți trimitem un link pe email. Are valabilitate o oră.',
    resetSend: 'Trimite linkul',
    resetSent:
      'Dacă adresa există în sistem, linkul a plecat. Verifică și în Spam. Poți închide fila.',
    backToSignIn: 'Înapoi la autentificare',

    changeTitle: 'Alege-ți o parolă',
    changeBodyForced:
      'Parola pe care ai primit-o e temporară. Până n-o schimbi, nu poți intra în aplicație.',
    changeBody: 'Parola nouă înlocuiește imediat parola curentă, pe toate dispozitivele.',
    newPassword: 'Parola nouă',
    confirmPassword: 'Repetă parola',
    passwordRule: 'Minimum 12 caractere. Evită parolele folosite pe alte site-uri.',
    changeSubmit: 'Schimbă parola',
    changed: 'Parola a fost schimbată.',

    // Motivele refuzului. Fiecare spune omului CE are de făcut mai departe.
    invalidCredentials: 'Email sau parolă greșite.',
    unlinked:
      'Contul există, dar nu e legat de nicio persoană din nomenclator. Cere-i unui administrator să-l lege.',
    inactive: 'Contul tău e dezactivat. Cere-i unui administrator să-l reactiveze.',
    noClaims:
      'Autentificarea funcționează, dar proiectul Supabase nu are hook-ul de token activat — aplicația nu poate afla cine ești. E o setare de infrastructură; anunță IT-ul.',
    malformed: 'Sesiunea ta e coruptă. Ieși din cont și încearcă din nou.',
    passwordTooShort: 'Parola trebuie să aibă cel puțin 12 caractere.',
    passwordMismatch: 'Cele două parole nu coincid.',
    passwordRejected: 'Parola a fost refuzată. Alege una mai puternică, nefolosită în altă parte.',
    rateLimited: 'Prea multe încercări. Așteaptă un minut și încearcă din nou.',
    generic: 'Autentificarea n-a reușit. Încearcă din nou.',
  },

  // ── Verificarea în doi pași ───────────────────────────────────────────────
  mfa: {
    title: 'Verificare în doi pași',

    enrollBody:
      'Rolul tău dă drepturi altora și vede toți banii. Pentru el, o parolă furată nu e un incident — de aceea mai e nevoie de un cod din telefonul tău.',
    enrollStep1: 'Deschide aplicația de autentificare de pe telefon și scanează codul.',
    enrollStep2: 'Scrie codul de șase cifre pe care ți-l arată, ca să confirmi legătura.',
    enrollApps: 'Merge cu Google Authenticator, Microsoft Authenticator, 1Password, Authy.',
    secretLabel: 'Nu poți scana? Introdu manual cheia:',
    secretCopied: 'Cheia a fost copiată.',

    challengeBody: 'Deschide aplicația de autentificare și scrie codul de șase cifre.',
    code: 'Cod din aplicație',
    codeHint: 'Șase cifre. Se schimbă la fiecare 30 de secunde.',
    verify: 'Confirmă',
    verifying: 'Se verifică…',

    invalidCode: 'Codul nu e bun. Mai încearcă — se schimbă la fiecare 30 de secunde.',
    enrollFailed:
      'Nu am putut porni configurarea. Reîncarcă pagina; dacă se repetă, anunță un administrator.',
    lockedOut:
      'Ți-ai pierdut telefonul? Un administrator îți poate reseta verificarea în doi pași din Administrare › Utilizatori.',

    // Ecranul de administrare.
    adminRequired: 'Cere verificare în doi pași',
    adminEnrolled: 'Verificare în doi pași activă',
    adminMissing: 'Verificarea în doi pași nu e configurată încă',
    adminReset: 'Resetează verificarea în doi pași',
    adminResetDone:
      'Verificarea a fost resetată și sesiunile au fost închise. La următorul login va configura din nou.',
    adminRevoke: 'Închide toate sesiunile',
    adminRevokeDone: 'Sesiunile au fost închise. Următoarea cerere a lui cere login din nou.',
  },
} as const;

export type Dictionary = typeof roRO;
