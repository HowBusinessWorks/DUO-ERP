import { AppError } from '@damina/shared';
import { describe, expect, it } from 'vitest';
import {
  can,
  canEditNomenclature,
  canSeeFinancials,
  capabilitiesOf,
  CAPABILITIES,
  PERMISSION_MATRIX,
  requireCapability,
  requireOfficeRole,
  requirePersona,
} from './permissions';
import type { OfficeRole, Session } from './session';

function session(persona: Session['persona'], officeRoles: readonly OfficeRole[] = []): Session {
  return {
    personId: '01950000-0000-7000-8000-000000030001',
    fullName: 'Test',
    persona,
    officeRoles,
    companyIds: [],
    subcontractorId: persona === 'subcontractor' ? '01950000-0000-7000-8000-000000060001' : null,
    clientId: persona === 'client' ? '01950000-0000-7000-8000-000000020001' : null,
    mustChangePassword: false,
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
