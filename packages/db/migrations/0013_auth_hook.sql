-- Pasul 02c — Custom Access Token Hook (pasul 02 §3.5, PLAN_TEHNIC §8).
--
-- GoTrue cheama functia asta la fiecare emitere de token si ii scrie raspunsul
-- in JWT. De acolo, claim-urile ajung in doua locuri diferite si amandoua
-- conteaza:
--
--   1. `apps/web` construieste `Session` din ele, fara nicio interogare — deci
--      randarea shell-ului nu incepe cu un round-trip la baza;
--   2. `withActor()` le pune inapoi in `request.jwt.claims`, GUC-ul din care
--      citesc politicile RLS scrise in 0011.
--
-- Numele claim-urilor de aici sunt aceleasi cu cele citite de
-- `app.current_person_id()`, `app.current_persona()`, `app.has_office_role()`,
-- `app.current_company_ids()` si `app.current_subcontractor_id()`. Contractul e
-- deja scris in 0011; migrarea asta doar il umple.
--
-- Rolul `supabase_auth_admin` exista DOAR pe Supabase. In Postgres-ul efemer
-- din CI blocurile care il ating trec fara efect, ca publicatia Realtime din
-- 0008 — functia insasi se creeaza si se testeaza in ambele locuri.

/*
 * `security definer`, ca tot restul mecanicii din 02a–04: tabelele au `force
 * row level security`, iar `supabase_auth_admin` n-are politici pe ele (si nici
 * n-ar trebui sa aiba — un rol de autentificare care poate citi liber
 * nomenclatorul de persoane e exact ce nu vrem). Rulata ca proprietar, functia
 * trece prin politica `definer` din 0011.
 *
 * `stable`, nu `volatile`: hook-ul nu are voie sa scrie nimic. Daca maine cineva
 * vrea sa jurnalizeze login-urile de aici, raspunsul e nu — jurnalul de audit e
 * pentru modificari de date, iar un hook care scrie poate bloca autentificarea
 * tuturor cand tabela lui creste.
 */
create or replace function app.custom_access_token_hook(event jsonb) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog
as $$
declare
  v_person   record;
  v_claims   jsonb;
begin
  v_claims := coalesce(event -> 'claims', '{}'::jsonb);

  select p.id,
         p.persona,
         p.full_name,
         p.is_active,
         p.must_change_password,
         p.subcontractor_id,
         p.client_id,
         coalesce(
           (select jsonb_agg(r.role order by r.role)
              from app.person_office_roles r
             where r.person_id = p.id),
           '[]'::jsonb
         ) as office_roles,
         coalesce(
           (select jsonb_agg(a.company_id order by a.company_id)
              from app.person_company_access a
             where a.person_id = p.id),
           '[]'::jsonb
         ) as company_ids
    into v_person
    from app.persons p
   where p.auth_user_id = (event ->> 'user_id')::uuid;

  /*
   * Un cont fara persoana atasata, sau atasat unei persoane dezactivate, tot
   * primeste token — GoTrue nu are cum sa refuze de aici, iar o exceptie
   * aruncata in hook inseamna login picat cu 500, nu login refuzat.
   *
   * Ce primeste e un token FARA `persona`. Aplicatia trateaza lipsa ei ca
   * „fara acces” si duce omul la ecranul de login cu un mesaj, iar politicile
   * RLS nu se pot satisface fara `persona`, deci nici pe drumul direct la baza
   * nu iese nimic. `damina_status` exista doar ca sa putem spune de ce.
   */
  if not found or not v_person.is_active then
    return jsonb_set(
      event,
      '{claims}',
      (v_claims - 'persona' - 'person_id' - 'office_roles' - 'company_ids'
                - 'subcontractor_id' - 'client_id' - 'must_change_password')
        || jsonb_build_object(
             'damina_status', case when found then 'inactive' else 'unlinked' end
           )
    );
  end if;

  /*
   * Rolurile de birou se emit doar pentru persona `office`. Un sef de santier
   * caruia i-a ramas din greseala un rand in `person_office_roles` nu capata
   * nimic din el: `app.has_office_role()` cere oricum `persona = 'office'`, dar
   * un claim care nu se emite nu poate fi nici macar citit gresit.
   */
  return jsonb_set(
    event,
    '{claims}',
    v_claims || jsonb_build_object(
      'damina_status',        'ok',
      'persona',              v_person.persona,
      'person_id',            v_person.id,
      'full_name',            v_person.full_name,
      'office_roles',         case when v_person.persona = 'office'
                                   then v_person.office_roles
                                   else '[]'::jsonb end,
      'company_ids',          v_person.company_ids,
      'subcontractor_id',     v_person.subcontractor_id,
      'client_id',            v_person.client_id,
      'must_change_password', v_person.must_change_password
    )
  );
end
$$;
--> statement-breakpoint

/*
 * Cine are voie s-o cheme: numai GoTrue.
 *
 * `revoke ... from public` e partea care conteaza. Functia e `security definer`
 * si vede tot nomenclatorul de persoane; lasata executabila de oricine, ar fi o
 * portita prin care orice sesiune autentificata afla rolurile si firmele
 * oricui, doar cu un `user_id` ghicit.
 */
revoke execute on function app.custom_access_token_hook(jsonb) from public;
--> statement-breakpoint

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema app to supabase_auth_admin;
    grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;

  -- Rolurile de aplicatie nu cheama hook-ul niciodata: ele primesc claim-urile
  -- gata facute, in token.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function app.custom_access_token_hook(jsonb) from authenticated, anon;
  end if;
end
$$;
--> statement-breakpoint

/*
 * ── Legatura auth.users ↔ app.persons ───────────────────────────────────────
 *
 * `auth_user_id` exista din 0004 si e `unique`, deci 1:1 e deja impus. Ce
 * lipseste e indexul pentru intrebarea pusa la FIECARE emitere de token
 * („cine e persoana contului asta?”) — pe care `unique` il da gratis — si o
 * garantie ca nu se leaga un cont de o persoana inactiva pe tacute.
 *
 * Nu punem cheie straina catre `auth.users`: schema `auth` apartine Supabase,
 * o migrare de-a lor peste ea ar bloca-o pe a noastra, iar in CI schema nici nu
 * exista. Legatura se impune in serviciul de provizionare.
 */
comment on column app.persons.auth_user_id is
  'Contul GoTrue al persoanei. Null pana la provizionare. Sursa pentru hook-ul de token.';
--> statement-breakpoint

/*
 * ── Stingerea flagului de parola temporara ──────────────────────────────────
 *
 * Verificarea #15 cere ca un cont cu `must_change_password` sa nu poata face
 * nimic altceva pana nu-si schimba parola. Partea a doua a cerintei e ca DUPA
 * ce si-a schimbat-o sa poata intra — adica cineva trebuie sa stinga flagul.
 *
 * Cine nu poate: omul insusi. Politicile din 0011 ii dau pe `app.persons` doar
 * `select` pe propriul rand (`self`), iar scrierea e rezervata rolului `admin`.
 * Si e bine asa: un sef de santier care poate face `update` pe propria fisa
 * poate incerca si alte coloane.
 *
 * Solutia e o usa ingusta: o functie `security definer` care schimba EXACT o
 * coloana, EXACT pe randul apelantului. `p_person` nu e parametru — daca ar fi,
 * ar fi si prima cerere falsificata.
 */
create or replace function app.clear_must_change_password() returns void
  language plpgsql
  security definer
  set search_path = pg_catalog
as $$
declare
  v_person uuid := app.current_person_id();
begin
  if v_person is null then
    raise exception 'FORBIDDEN: nu exista persoana in sesiune' using errcode = 'P0001';
  end if;

  update app.persons
     set must_change_password = false
   where id = v_person
     and must_change_password;
end
$$;
--> statement-breakpoint

revoke execute on function app.clear_must_change_password() from public;
--> statement-breakpoint
grant execute on function app.clear_must_change_password()
  to app_office, app_field, app_subcontractor, app_client;
