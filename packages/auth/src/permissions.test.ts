import { AppError } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import {
  can,
  canEditNomenclature,
  canSeeFinancials,
  capabilitiesOf,
  CAPABILITIES,
  PERMISSION_MATRIX,
  grantsCapability,
  MFA_REQUIRED_ROLES,
  mfaBypassed,
  mfaSatisfied,
  requireCapability,
  requireMfa,
  requireOfficeRole,
  requirePersona,
  requiresMfa,
} from './permissions';
import type { AuthenticatorLevel, OfficeRole, Session } from './session';

function session(
  persona: Session['persona'],
  officeRoles: readonly OfficeRole[] = [],
  aal: AuthenticatorLevel = 'aal2',
): Session {
  return {
    personId: '01950000-0000-7000-8000-000000030001',
    fullName: 'Test',
    persona,
    officeRoles,
    companyIds: [],
    subcontractorId: persona === 'subcontractor' ? '01950000-0000-7000-8000-000000060001' : null,
    clientId: persona === 'client' ? '01950000-0000-7000-8000-000000020001' : null,
    mustChangePassword: false,
    aal,
  };
}

describe('matricea de permisiuni', () => {
  it('acopera fiecare drept declarat, o singura data', () => {
    // Ecranul de administrare se randeaza din matrice. Un drept care exista in
    // cod dar lipseste din tabel ar fi invizibil acolo — adica un drept pe care
    // nimeni nu-l revizuieste.
    const keys = PERMISSION_MATRIX.map((spec) => spec.key);
    expect([...keys].sort()).toEqual([...CAPABILITIES].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('nu da niciun drept comercial in afara biroului', () => {
    for (const persona of ['field', 'subcontractor', 'client'] as const) {
      expect(can(session(persona), 'financials.read')).toBe(false);
      expect(can(session(persona), 'periods.close')).toBe(false);
      expect(can(session(persona), 'audit.read')).toBe(false);
    }
  });

  it('jurnalul de audit e doar al administratorului (verificarea #19)', () => {
    expect(can(session('office', ['admin']), 'audit.read')).toBe(true);
    expect(can(session('office', ['financiar']), 'audit.read')).toBe(false);
    expect(can(session('office', ['pm']), 'audit.read')).toBe(false);
  });

  it('un om de birou fara niciun rol nu capata nimic din birou', () => {
    const nobody = session('office');
    expect(can(nobody, 'nomenclature.read')).toBe(false);
    expect(can(nobody, 'contracts.read')).toBe(false);
  });

  it('terenul citeste nomenclatorul, dar nu-l scrie', () => {
    expect(can(session('field'), 'nomenclature.read')).toBe(true);
    expect(can(session('field'), 'nomenclature.write')).toBe(false);
  });

  it('helper-ele vechi citesc din matrice, nu din liste proprii', () => {
    expect(canSeeFinancials(session('office', ['financiar']))).toBe(true);
    expect(canSeeFinancials(session('office', ['magazie']))).toBe(false);
    expect(canSeeFinancials(session('field'))).toBe(false);

    expect(canEditNomenclature(session('office', ['achizitii']))).toBe(true);
    expect(canEditNomenclature(session('office', ['flota']))).toBe(false);
  });

  it('spune si ce NU vede rolul — ecranul de administrare cere ambele liste', () => {
    const { granted, denied } = capabilitiesOf(session('office', ['magazie']));

    expect(granted.map((spec) => spec.key)).toContain('nomenclature.write');
    expect(denied.map((spec) => spec.key)).toContain('financials.read');
    expect(granted.length + denied.length).toBe(PERMISSION_MATRIX.length);
  });
});

describe('guard-uri', () => {
  it('refuza cu FORBIDDEN, nu cu eroare de sistem', () => {
    const field = session('field');

    expect(() => requirePersona(field, 'office')).toThrow(AppError);
    expect(() => requireOfficeRole(field, 'admin')).toThrow(AppError);
    try {
      requireCapability(field, 'financials.read');
      expect.unreachable('trebuia sa arunce');
    } catch (error) {
      expect(AppError.is(error) && error.code).toBe('FORBIDDEN');
    }
  });

  it('lasa sa treaca cine are dreptul', () => {
    const admin = session('office', ['admin']);
    expect(() => requirePersona(admin, 'office', 'field')).not.toThrow();
    expect(() => requireOfficeRole(admin, 'admin', 'financiar')).not.toThrow();
    expect(() => requireCapability(admin, 'admin.users')).not.toThrow();
  });
});

describe('al doilea factor', () => {
  it('il cere exact rolurilor care dau drepturi si vad banii', () => {
    for (const role of MFA_REQUIRED_ROLES) {
      expect(requiresMfa(session('office', [role]))).toBe(true);
    }
    for (const role of ['pm', 'devizist', 'achizitii', 'magazie', 'flota'] as const) {
      expect(requiresMfa(session('office', [role]))).toBe(false);
    }
  });

  it('il cere si cand rolul obligat e doar unul dintre mai multe', () => {
    // Un om cu `pm` si `financiar` nu scapa pentru ca primul rol nu cere nimic.
    expect(requiresMfa(session('office', ['pm', 'financiar']))).toBe(true);
  });

  it('nu il cere in afara biroului', () => {
    // Terenul si portalurile n-au roluri de birou, deci n-au cum sa intre in
    // lista. Verificarea exista pentru ziua in care cineva pune un rand in
    // `person_office_roles` pentru un sef de santier.
    for (const persona of ['field', 'subcontractor', 'client'] as const) {
      expect(requiresMfa(session(persona, ['admin']))).toBe(false);
      expect(mfaSatisfied(session(persona, ['admin'], 'aal1'))).toBe(true);
    }
  });

  it('un admin pe aal1 e oprit, acelasi admin pe aal2 trece', () => {
    expect(mfaSatisfied(session('office', ['admin'], 'aal1'))).toBe(false);
    expect(mfaSatisfied(session('office', ['admin'], 'aal2'))).toBe(true);

    expect(() => requireMfa(session('office', ['admin'], 'aal1'))).toThrow(AppError);
    expect(() => requireMfa(session('office', ['admin'], 'aal2'))).not.toThrow();
  });

  it('MFA_ENFORCED=0 opreste POARTA, nu drepturile', () => {
    const before = process.env.MFA_ENFORCED;
    try {
      process.env.MFA_ENFORCED = '0';

      expect(mfaBypassed()).toBe(true);
      // Poarta se deschide...
      expect(mfaSatisfied(session('office', ['admin'], 'aal1'))).toBe(true);
      expect(() => requireMfa(session('office', ['admin'], 'aal1'))).not.toThrow();
      // ...dar rolul CONTINUA sa ceara al doilea factor, si ecranul de
      // administrare trebuie sa spuna in continuare adevarul despre el.
      expect(requiresMfa(session('office', ['admin'], 'aal1'))).toBe(true);
      // Si niciun drept nu se schimba.
      expect(can(session('office', ['admin'], 'aal1'), 'admin.users')).toBe(true);
    } finally {
      if (before === undefined) {
        delete process.env.MFA_ENFORCED;
      } else {
        process.env.MFA_ENFORCED = before;
      }
    }
  });

  it('fara variabila, poarta e la locul ei', () => {
    expect(mfaBypassed()).toBe(false);
    expect(mfaSatisfied(session('office', ['admin'], 'aal1'))).toBe(false);
  });

  it('nu scade drepturile din matrice cand lipseste al doilea factor', () => {
    // `aal` e o poarta pe drum, nu un drept. Daca ar intra in `can()`, ecranul
    // de administrare si-ar arata propriile coloane golite.
    const admin = session('office', ['admin'], 'aal1');
    expect(can(admin, 'admin.users')).toBe(true);
    expect(canSeeFinancials(admin)).toBe(true);
  });
});

describe('grantsCapability', () => {
  it('raspunde identic cu `can`, fara sesiune', () => {
    for (const spec of PERMISSION_MATRIX) {
      for (const role of ['admin', 'financiar', 'pm', 'magazie'] as const) {
        expect(grantsCapability('office', [role], spec.key)).toBe(
          can(session('office', [role]), spec.key),
        );
      }
    }
  });

  it('vede pierderea dreptului la preturi intre doua seturi de roluri', () => {
    // Exact intrebarea din verificarea #18, pusa asa cum o pune ruta de roluri.
    const before = grantsCapability('office', ['pm', 'financiar'], 'financials.read');
    const after = grantsCapability('office', ['magazie'], 'financials.read');
    expect(before).toBe(true);
    expect(after).toBe(false);
  });
});
