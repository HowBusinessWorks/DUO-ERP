import type { BrowserContext } from '@playwright/test';

/**
 * Cine e in fata ecranului, in teste.
 *
 * Foloseste **sesiunea de dezvoltare** — acelasi cookie pe care il citeste
 * `parseDevSession` — si nu Supabase Auth. Motivul e ca testele astea masoara
 * ecranul, nu autentificarea: un login real ar fi legat bugetul de tapuri de un
 * serviciu extern, cu retea si cu rate limit, si ar fi picat din motive care
 * n-au nicio treaba cu numarul de atingeri.
 *
 * Cookie-ul e citit doar cand `devSessionAllowed()` da adevarat — adica fara
 * Supabase configurat sau cu `ALLOW_DEV_SESSION=1`, ambele adevarate doar in
 * mediile de test. In productie, functia asta n-ar deschide nimic.
 */

/** Acelasi nume ca `DEV_SESSION_COOKIE` din `@damina/auth`. */
const COOKIE = 'damina_dev_session';

export interface DevPerson {
  readonly personId: string;
  readonly fullName: string;
  readonly persona: 'office' | 'field' | 'subcontractor' | 'client';
  readonly officeRoles?: readonly string[];
  readonly companyIds?: readonly string[];
}

/** Un om de teren, fara firma anume: felia locala e oricum goala in teste. */
export const FIELD_PERSON: DevPerson = {
  personId: '00000000-0000-7000-8000-00000000f1e1',
  fullName: 'Muncitor de test',
  persona: 'field',
  officeRoles: [],
  companyIds: [],
};

export async function signIn(
  context: BrowserContext,
  person: DevPerson,
  baseURL: string,
): Promise<void> {
  const { hostname } = new URL(baseURL);
  await context.addCookies([
    {
      name: COOKIE,
      value: JSON.stringify(person),
      domain: hostname,
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}
