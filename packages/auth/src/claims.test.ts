import { describe, expect, it } from 'vitest';
import { sessionFromClaims } from './claims';
import { actorFor } from './actor';

const PERSON = '01950000-0000-7000-8000-000000030001';
const COMPANY = '01950000-0000-7000-8000-000000010001';

/** Un token asa cum il emite `app.custom_access_token_hook` pentru un om de birou. */
function officeClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: '9d1f0c00-0000-4000-8000-000000000001',
    email: 'pm@damina.test',
    damina_status: 'ok',
    persona: 'office',
    person_id: PERSON,
    full_name: 'Andrei PM',
    office_roles: ['pm'],
    company_ids: [COMPANY],
    subcontractor_id: null,
    client_id: null,
    must_change_password: false,
    ...overrides,
  };
}

describe('sessionFromClaims', () => {
  it('construieste sesiunea de birou din claim-urile hook-ului', () => {
    const result = sessionFromClaims(officeClaims());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toEqual({
      personId: PERSON,
      fullName: 'Andrei PM',
      persona: 'office',
      officeRoles: ['pm'],
      companyIds: [COMPANY],
      subcontractorId: null,
      clientId: null,
      mustChangePassword: false,
      // Fixtura n-are `aal`, iar lipsa lui se citeste in jos, nu in sus.
      aal: 'aal1',
    });
  });

  it('nu da roluri de birou unei persone care nu e de birou', () => {
    // Un rand ramas din greseala in `person_office_roles` nu trebuie sa devina
    // drept. Hook-ul nu-l emite; parserul il ignora si daca ajunge aici.
    const result = sessionFromClaims(
      officeClaims({ persona: 'field', office_roles: ['admin'] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.persona).toBe('field');
    expect(result.session.officeRoles).toEqual([]);
  });

  it('pastreaza firma proprie a portalului', () => {
    const result = sessionFromClaims(
      officeClaims({
        persona: 'subcontractor',
        office_roles: [],
        subcontractor_id: '01950000-0000-7000-8000-000000060001',
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.subcontractorId).toBe('01950000-0000-7000-8000-000000060001');
  });

  it('refuza un cont nelegat de o persoana', () => {
    expect(sessionFromClaims({ sub: 'x', damina_status: 'unlinked' })).toEqual({
      ok: false,
      reason: 'unlinked',
    });
  });

  it('refuza o persoana dezactivata', () => {
    expect(sessionFromClaims({ sub: 'x', damina_status: 'inactive' })).toEqual({
      ok: false,
      reason: 'inactive',
    });
  });

  it('distinge hook-ul neactivat de un cont neconfigurat', () => {
    // Token valid emis de GoTrue, dar fara niciunul din claim-urile noastre.
    // E o eroare de configurare a proiectului Supabase, si trebuie sa se vada
    // ca atare — altfel se cauta zile intregi in nomenclatorul de persoane.
    expect(sessionFromClaims({ sub: 'x', email: 'cineva@damina.test' })).toEqual({
      ok: false,
      reason: 'no_claims',
    });
    expect(sessionFromClaims(null)).toEqual({ ok: false, reason: 'no_claims' });
  });

  it('refuza o persona inventata in loc sa produca o sesiune ciudata', () => {
    expect(sessionFromClaims(officeClaims({ persona: 'director' }))).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(sessionFromClaims(officeClaims({ person_id: '' }))).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('ignora rolurile pe care nu le recunoaste', () => {
    const result = sessionFromClaims(officeClaims({ office_roles: ['pm', 'sef_suprem'] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.officeRoles).toEqual(['pm']);
  });

  it('duce claim-urile mai departe catre RLS, cu aceleasi nume', () => {
    // Contractul dintre 0011 (care citeste `request.jwt.claims`) si hook-ul din
    // 0013/0014 (care le scrie). Daca un nume se schimba intr-un loc, testul cade.
    const result = sessionFromClaims(officeClaims());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Cheile optionale LIPSESC, nu sunt `null` — ca in token. GoTrue refuza sa
    // semneze `client_id: null`, iar cele doua drumuri catre RLS trebuie sa
    // arate la fel.
    expect(actorFor(result.session, 'motiv').claims).toEqual({
      persona: 'office',
      person_id: PERSON,
      office_roles: ['pm'],
      company_ids: [COMPANY],
    });
  });

  it('trimite firma proprie catre RLS doar cand exista', () => {
    const portal = sessionFromClaims(
      officeClaims({
        persona: 'client',
        office_roles: [],
        client_id: '01950000-0000-7000-8000-000002000001',
      }),
    );
    expect(portal.ok).toBe(true);
    if (!portal.ok) return;

    expect(actorFor(portal.session).claims).toEqual({
      persona: 'client',
      person_id: PERSON,
      office_roles: [],
      company_ids: [COMPANY],
      client_id: '01950000-0000-7000-8000-000002000001',
    });
  });
});

describe('nivelul de autentificare', () => {
  it('citeste `aal` asa cum il pune GoTrue', () => {
    const result = sessionFromClaims(officeClaims({ aal: 'aal2' }));
    expect(result.ok && result.session.aal).toBe('aal2');
  });

  it('trateaza lipsa sau gunoiul ca `aal1`', () => {
    // Directia contează: un claim deteriorat trebuie sa ceara mai mult, nu mai
    // putin. Fara `aal` in token, un admin e trimis la verificare — nu inauntru.
    for (const value of [undefined, null, '', 'aal9', 42]) {
      const result = sessionFromClaims(officeClaims({ aal: value }));
      expect(result.ok && result.session.aal).toBe('aal1');
    }
  });
});
