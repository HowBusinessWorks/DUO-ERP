-- Pasul 02b — izolarea pretului, stratul 1: privilegiul pe COLOANA.
--
-- Sursa de adevar (pasul 02 §3.9, regula 3): un `select` gresit din contextul de
-- teren nu returneaza null si nu returneaza zero — CADE, cu 42501. Zgomotos, in
-- development, inainte sa ajunga in productie.
--
-- Ce s-a facut deja in alte migrari si NU se repeta aici:
--   0004 — `app.rate_cards` (salariu, cost orar) nu e acordata decat biroului;
--   0009 — `app.contracts` are grant pe cele 13 coloane necomerciale, iar
--          `contract_years` / `component_ceilings` nu sunt acordate deloc.
--
-- Ce mai ramanea: firmele. `app.companies` era acordata INTREAGA tuturor
-- personelor inca din 0002, iar intre timp a capatat doua coloane comerciale
-- (indexarea implicita si pragul Delta) plus configuratia de e-Factura.

revoke select on app.companies from app_field, app_subcontractor, app_client;
--> statement-breakpoint

-- Ce ramane vizibil: identitatea firmei. Ecranul de teren arata numele firmei
-- in bara de sus si atat. `is_active` intra in lista pentru ca selectorul de
-- firma filtreaza pe el — o coloana citita intr-un `where` cere acelasi
-- privilegiu ca una din `select`.
grant select (
  id, name, cui, reg_com, address, logo_node_id, is_group_member, is_active, created_at
) on app.companies to app_field, app_subcontractor, app_client;
--> statement-breakpoint

-- Explicit, chiar daca niciun `grant` nu le-a dat vreodata: un `revoke` scris
-- e o afirmatie verificabila, un grant lipsa e o omisiune care seamana cu ea.
revoke select on app.rate_cards, app.contract_years, app.component_ceilings
  from app_field, app_subcontractor, app_client;
--> statement-breakpoint

/*
 * Poarta de la migrare: aceeasi regula ca testul #1 din pas, dar aplicata la
 * `db:migrate`, nu la `vitest`.
 *
 * Cauta orice coloana din `app` al carei nume contine price/pret/cost/amount/
 * margin/salary si care e vizibila unei persone din afara biroului. Daca gaseste
 * una, migrarea CADE — deci o coloana de bani adaugata fara `revoke` nu poate
 * ajunge in baza, nici macar pe laptopul cuiva.
 *
 * `app_service` nu e in lista: worker-ul calculeaza costuri, aia e treaba lui.
 */
do $$
declare
  leaked text;
begin
  select string_agg(format('%s.%s → %s', c.relname, a.attname, r.rolname), ', ')
    into leaked
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join (
      select rolname from pg_roles
       where rolname in ('app_field', 'app_subcontractor', 'app_client')
    ) r
   where c.relnamespace = 'app'::regnamespace
     and c.relkind = 'r'
     and a.attname ~ '(price|pret|cost|amount|margin|salary)'
     -- Forma cu `oid`/`attnum`, nu cu nume: nu depinde de `search_path` si
     -- raspunde si pentru grant-urile mostenite prin apartenenta la rol.
     and has_column_privilege(r.rolname, c.oid, a.attnum, 'select');

  if leaked is not null then
    raise exception 'PRICE_LEAK: coloane de bani vizibile in afara biroului: %', leaked
      using errcode = 'P0001';
  end if;
end
$$;
