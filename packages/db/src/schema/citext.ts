import { customType } from 'drizzle-orm/pg-core';

/**
 * `citext` — text insensibil la majuscule. Folosit pentru email, care e
 * identitate de login: `Ion@damina.ro` si `ion@damina.ro` sunt acelasi om.
 *
 * Extensia se instaleaza in `public`, nu in `extensions` cum e conventia
 * Supabase, si asta e deliberat. Rolurile noastre sunt NOLOGIN si se intra in
 * ele prin `SET ROLE` — iar `alter role ... set search_path` se aplica la
 * conectare, dupa utilizatorul de sesiune, deci nu ajunge niciodata la ele.
 * Operatorii `citext = citext` se rezolva prin `search_path`, care implicit e
 * `"$user", public`. In `extensions`, orice `where email = $1` ar pica cu
 * "operator does not exist". In `public` merge peste tot, fara configurare.
 *
 * `public` ramane fara tabele — extensia adauga doar un tip si functii — deci
 * invarianta din pasul 01 se pastreaza.
 *
 * Numele se lasa necalificat intentionat: drizzle citeaza tot ce intoarce
 * `dataType()` ca un singur identificator, deci "public.citext" ar deveni un
 * tip inexistent cu punct in nume. Necalificat, se rezolva prin `search_path`
 * — adica exact prin `public`.
 */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});
