-- Pasul 02c — reparatie la hook-ul din 0013.
--
-- Bug gasit la primul login real, dupa activarea hook-ului in proiect: GoTrue
-- VALIDEAZA claim-urile intoarse de hook inainte sa le semneze, iar `client_id`
-- e un nume rezervat in specificatia JWT (OAuth). Un `null` pe el nu trece:
--
--   500 output claims do not conform to the expected schema:
--       client_id: Invalid type. Expected: string, given: null
--
-- Consecinta era ca EXACT trei din cele patru persone nu se puteau autentifica.
-- Contul de client mergea — el e singurul care are `client_id` nenul. Genul de
-- bug care ar fi trecut de orice test scris pe cazul fericit.
--
-- Reparatia: claim-urile optionale se emit doar cand au valoare. Semantica nu se
-- schimba — `app.current_subcontractor_id()` si `app.current_client_id()` din
-- 0011 tratau deja claim-ul lipsa la fel ca pe unul null, cazand pe
-- `app.persons`. Iar `check`-urile din 0004 garanteaza ca acolo raspunsul e tot
-- null pentru cine n-are ce cauta cu o firma atasata.
--
-- `create or replace`, nu o migrare care editeaza 0013: migrarea aia e deja
-- aplicata si versionata. Istoria ramane cum a fost, cu tot cu greseala.

create or replace function app.custom_access_token_hook(event jsonb) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = pg_catalog
as $$
declare
  v_person record;
  v_claims jsonb;
  v_ours   jsonb;
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

  v_ours := jsonb_build_object(
    'damina_status',        'ok',
    'persona',              v_person.persona,
    'person_id',            v_person.id,
    'full_name',            v_person.full_name,
    'office_roles',         case when v_person.persona = 'office'
                                 then v_person.office_roles
                                 else '[]'::jsonb end,
    'company_ids',          v_person.company_ids,
    'must_change_password', v_person.must_change_password
  );

  -- Doar cand au valoare. Vezi antetul: un `null` pe `client_id` pica tot login-ul.
  if v_person.subcontractor_id is not null then
    v_ours := v_ours || jsonb_build_object('subcontractor_id', v_person.subcontractor_id);
  end if;

  if v_person.client_id is not null then
    v_ours := v_ours || jsonb_build_object('client_id', v_person.client_id);
  end if;

  return jsonb_set(event, '{claims}', v_claims || v_ours);
end
$$;
