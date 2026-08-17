-- Pasul 02c′ — revocarea sesiunii la retragerea accesului (pasul 02 §3.5,
-- verificarea #18).
--
-- ── Problema ────────────────────────────────────────────────────────────────
--
-- Drepturile calatoresc in JWT, iar JWT-ul traieste o ora. Cine pierde accesul
-- la preturi il mai are pana la urmatorul refresh de token — si il are CU
-- stirea aplicatiei, pentru ca si politicile RLS citesc din claim-uri. Planul
-- cere ca retragerea sa taie sesiunea imediat.
--
-- ── De ce nu prin Admin API, cum spunea planul ──────────────────────────────
--
-- Planul zice „prin Admin API”. Admin API-ul GoTrue NU are cum: singura functie
-- de deconectare, `auth.admin.signOut(jwt)`, cere ACCESS TOKEN-UL omului, nu
-- id-ul lui — iar pe ecranul de administrare nu ai token-ul altcuiva. Am
-- verificat si direct pe REST: `DELETE /admin/users/{id}/sessions`,
-- `POST /admin/users/{id}/logout` si `.../sign_out` raspund toate 404. Nu
-- exista.
--
-- Ce exista, si e chiar mai direct: sesiunile stau in `auth.sessions`, iar
-- GoTrue verifica la fiecare `GET /user` daca sesiunea din claim-ul `session_id`
-- mai exista. Sters randul, urmatorul apel intoarce
-- `403 session_not_found` — verificat pe proiectul real, cu refresh token-ul
-- picand si el pe 400, fiindca `auth.refresh_tokens` cade in cascada.
--
-- Iar `apps/web` cheama `getUser()` la FIECARE cerere, prin middleware. Deci
-- „imediat” nu e o promisiune, e o consecinta: omul e afara la urmatoarea
-- pagina pe care o cere.
--
-- ── De ce e o functie in baza si nu cod in aplicatie ────────────────────────
--
-- `auth` e schema Supabase. Rolurile noastre de aplicatie n-au si nu trebuie sa
-- aiba drepturi pe ea — un `app_office` care poate scrie in `auth.sessions` ar
-- fi o gaura mult mai mare decat cea pe care o inchidem. Functia ruleaza ca
-- proprietar, atinge EXACT randurile unui singur utilizator, si verifica
-- singura ca apelantul e administrator.
--
-- In Postgres-ul efemer din CI schema `auth` nu exista. Functia nu cade: se
-- uita la `to_regclass` si intoarce 0. Restul — guard-ul, randul de jurnal —
-- se testeaza acolo la fel ca pe Supabase.

/*
 * Momentul ultimei inchideri de sesiuni.
 *
 * Nu e doar informativ. `audit.entries` se scrie NUMAI din trigger-ul de pe o
 * tabela auditata (0007), deci o revocare care n-ar atinge nicio coloana n-ar
 * lasa urma nicaieri — pentru o operatie cu efectul asta, ar fi inacceptabil.
 * Coloana e ce transforma revocarea intr-o modificare auditabila, cu actor si
 * cu motiv, ca orice altceva.
 */
alter table app.persons add column if not exists sessions_revoked_at timestamptz;
--> statement-breakpoint

comment on column app.persons.sessions_revoked_at is
  'Ultima inchidere forțată de sesiuni. Scrisă de app.revoke_sessions(); sursa rândului din jurnal.';
--> statement-breakpoint

create or replace function app.revoke_sessions(p_person uuid) returns integer
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  v_auth_user uuid;
  v_deleted   integer := 0;
begin
  /*
   * Guard-ul e AICI, nu in aplicatie, si nu doar in plus fata de ea.
   *
   * O functie `security definer` care sterge sesiuni si care s-ar increde in
   * apelant ar fi o unealta de deconectare a oricui, pusa la dispozitia
   * oricarei sesiuni autentificate. Politicile RLS nu apara functiile, deci
   * verificarea se scrie explicit.
   */
  if not app.has_office_role('admin') then
    raise exception 'FORBIDDEN: doar administratorii pot inchide sesiunile altcuiva'
      using errcode = 'P0001';
  end if;

  select auth_user_id into v_auth_user from app.persons where id = p_person;

  if not found then
    raise exception 'NOT_FOUND: persoana % nu exista', p_person using errcode = 'P0002';
  end if;

  /*
   * Fara cont GoTrue nu exista sesiuni, si nu e o eroare: o persoana intra in
   * nomenclator inainte sa aiba cu ce sa se logheze. Randul de jurnal NU se
   * scrie in cazul asta — n-ar consemna nimic intamplat.
   */
  if v_auth_user is null then
    return 0;
  end if;

  -- `to_regclass`: in CI schema `auth` nu exista, si migrarea trebuie sa treaca
  -- la fel. SQL dinamic, ca functia sa se poata compila fara tabela.
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using v_auth_user;
    get diagnostics v_deleted = row_count;
  end if;

  -- Urma. Trigger-ul de pe `app.persons` o duce in `audit.entries`, cu actorul
  -- si motivul din claim-urile sesiunii care a cerut revocarea.
  update app.persons set sessions_revoked_at = now() where id = p_person;

  return v_deleted;
end
$$;
--> statement-breakpoint

revoke execute on function app.revoke_sessions(uuid) from public;
--> statement-breakpoint

/*
 * Doar biroul. Terenul si portalurile n-au ecran de administrare, iar guard-ul
 * din corp cere oricum rolul `admin` — dar un drept de execuție care nu e
 * folosit de nimeni n-are motiv sa existe.
 */
grant execute on function app.revoke_sessions(uuid) to app_office;
