/**
 * Dictionarul ro-RO. Singura sursa de text pentru interfata.
 *
 * Regula: zero siruri de UI hardcodate in componente. Chiar daca dictionarul e
 * aproape gol acum, structura exista si se foloseste de la primul ecran.
 * Aici scriem romana CU diacritice — codul si baza de date raman in engleza.
 */
export const roRO = {
  common: {
    appName: 'Damina ERP',
    loading: 'Se încarcă…',
    save: 'Salvează',
    cancel: 'Renunță',
    search: 'Caută',
    yes: 'Da',
    no: 'Nu',
  },
  workspace: {
    auth: 'Autentificare',
    office: 'Birou',
    field: 'Teren',
    portalSubcontractor: 'Portal subcontractant',
    portalClient: 'Portal client',
  },
  errors: {
    PERIOD_CLOSED: 'Perioada contabilă este închisă. Modificarea nu mai este permisă.',
    PRICE_FORBIDDEN: 'Nu ai acces la informațiile de preț.',
    AUTHORIZATION_EXPIRED: 'Autorizația folosită a expirat.',
    QUANTITY_EXCEEDS_CONTRACT: 'Cantitatea depășește ce permite contractul.',
    VALIDATION_FAILED: 'Datele introduse nu sunt valide.',
    NOT_FOUND: 'Nu am găsit ce cauți.',
    FORBIDDEN: 'Nu ai dreptul să faci această operațiune.',
    CONFLICT: 'Altcineva a modificat între timp. Reîncarcă și încearcă din nou.',
  },
} as const;

export type Dictionary = typeof roRO;
