/*
 * Un contract cu 20 de obiective avea UN SINGUR folder de obiectiv.
 *
 * `app.ensure_folder` cauta folderul existent pe `(parinte, rol, work_unit_id,
 * stage_id)` — fara `objective_id`. Pentru rolul `objective` toate cele patru
 * coincid: parintele e folderul `Obiective` al contractului, rolul e acelasi,
 * iar unitatea si etapa sunt null pe amandoua. Deci al doilea obiectiv legat de
 * contract primea folderul PRIMULUI, si tot asa: 120 de legaturi, 40 de foldere.
 *
 * Ce se strica din asta, in ordinea gravitatii:
 *
 *   1. `contract_objectives.root_node_id` arata, pentru 19 din 20 de obiective,
 *      catre dosarul altui obiectiv. Documentele lor ar fi ajuns toate gramada
 *      in dosarul primului — si nimeni n-ar fi banuit nimic, fiindca folderul
 *      exista si se deschide.
 *   2. Cautarea pe rol si chei (`objective_id = X and node_role = 'objective'`)
 *      nu gaseste nimic pentru celelalte 19, fiindca nodul poarta id-ul primului.
 *      Asa s-a si vazut: tab-ul `Documente` al obiectivului spunea „nu exista
 *      inca un folder" exact pe obiectivele care sunt legate de un contract.
 *
 * Greseala e din aceeasi familie cu cea din 0023: nu a dat eroare nicaieri. O
 * functie idempotenta care se uita la prea putine coloane nu creeaza duplicate —
 * creeaza SUPRAPUNERI, care sunt mai greu de vazut si mai rele.
 *
 * Migrarea e scrisa de mana, ca 0022 si 0023: nu schimba nicio tabela, doar
 * rescrie o functie si repara datele pe care le-a produs.
 */

create or replace function app.ensure_folder(
  p_company    uuid,
  p_parent     uuid,
  p_name       text,
  p_role       app.node_role,
  p_contract   uuid default null,
  p_objective  uuid default null,
  p_work_unit  uuid default null,
  p_stage      uuid default null
) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = pg_catalog
as $$
declare
  v_id        uuid;
  v_parent    app.nodes%rowtype;
  v_objective uuid;
  v_work_unit uuid;
  v_stage     uuid;
begin
  if p_company is null or p_name is null or btrim(p_name) = '' then
    raise exception 'ensure_folder: firma si numele sunt obligatorii.';
  end if;

  /*
   * Parintele se citeste INAINTEA cautarii, nu dupa.
   *
   * Analitica unui folder e cea mostenita din parinte, ingustata de argumente —
   * asa se si insereaza, cu `coalesce`. Daca insa cautarea compara cu ARGUMENTUL
   * si inserarea scrie MOSTENIREA, cele doua nu se mai potrivesc: `Fișă` de sub
   * folderul unei unitati de lucru se cheama cu `p_objective => null`, dar exista
   * in baza cu obiectivul mostenit — deci cautarea n-o gaseste si incearca s-o
   * creeze a doua oara. Nu e ipoteza: asa a picat testul de arbore, prima data.
   */
  if p_parent is not null then
    select * into v_parent from app.nodes where id = p_parent;
  end if;

  v_objective := coalesce(p_objective, v_parent.objective_id);
  v_work_unit := coalesce(p_work_unit, v_parent.work_unit_id);
  v_stage     := coalesce(p_stage,     v_parent.stage_id);

  /*
   * Cautarea se face pe ROL, nu pe nume — regula din Anexa E.3. Daca cineva a
   * redenumit „PV" in „Procese verbale" (nu poate din interfata, dar poate un
   * script), folderul tot se gaseste si nu se creeaza un al doilea.
   *
   * Rolul singur nu e insa identitatea: sub acelasi parinte pot sta mai multe
   * foldere cu acelasi rol, si atunci le deosebesc CHEILE. Obiectivul intra in
   * comparatie din acelasi motiv pentru care intrau deja unitatea si etapa —
   * `Obiective` al unui contract are cate un folder pentru fiecare obiectiv.
   *
   * Exceptie: rolurile care se repeta sub acelasi parinte fara nicio cheie care
   * sa le deosebeasca — folderul de luna si cel de faza foto. Acolo numele ESTE
   * identitatea.
   */
  if p_role in ('month', 'photo_phase', 'user') then
    select n.id into v_id
      from app.nodes n
     where n.company_id = p_company
       and n.parent_id is not distinct from p_parent
       and n.name = p_name
       and n.deleted_at is null;
  else
    select n.id into v_id
      from app.nodes n
     where n.company_id = p_company
       and n.parent_id is not distinct from p_parent
       and n.node_role = p_role
       and n.objective_id is not distinct from v_objective
       and n.work_unit_id is not distinct from v_work_unit
       and n.stage_id is not distinct from v_stage
       and n.deleted_at is null;
  end if;

  if v_id is not null then
    return v_id;
  end if;

  insert into app.nodes (
    id, parent_id, company_id, kind, name, node_role, is_system,
    contract_id, objective_id, work_unit_id, stage_id, created_by
  )
  values (
    gen_random_uuid(), p_parent, p_company, 'folder', p_name, p_role, p_role <> 'user',
    coalesce(p_contract, v_parent.contract_id),
    v_objective,
    v_work_unit,
    v_stage,
    -- Folderele generate n-au autor, dinadins: nu le-a facut cine a apasat
    -- „salveaza", si generarea nu trebuie sa cada cand actorul n-are rand in
    -- `app.persons` (un job, un import, un test).
    null
  )
  returning id into v_id;

  return v_id;
end
$$;
--> statement-breakpoint

/*
 * Reparatia.
 *
 * Acelasi cod ca triggerul, ca la 0021: `build_contract_objective_tree` e
 * idempotenta, deci legaturile care aveau deja folderul lor raman neatinse, iar
 * celelalte il primesc acum. Nimic nu se muta si nimic nu se sterge — folderul
 * suprapus ramane al obiectivului al carui `objective_id` il poarta, cu tot ce
 * s-a incarcat vreodata in el.
 */
do $$
declare
  r record;
begin
  for r in select id from app.contract_objectives loop
    perform app.build_contract_objective_tree(r.id);
  end loop;
end
$$;
--> statement-breakpoint

/*
 * Plasa, ca la 0023: migrarea cade daca un folder mai e impartit de DOUA
 * OBIECTIVE DIFERITE.
 *
 * Doua legaturi pe acelasi folder sunt insa normale si trebuie sa ramana: acelasi
 * obiectiv poate fi legat de acelasi contract in doua perioade succesive (a iesit
 * si a revenit). Alea sunt doua randuri in `contract_objectives`, dar un singur
 * dosar — obiectivul e acelasi, si istoricul lui nu se rupe in doua fiindca s-a
 * intrerupt contractul o luna. Verificarea numara deci obiective distincte, nu
 * legaturi; pe baza de dezvoltare exista trei perechi din astea.
 */
do $$
declare
  v_shared int;
begin
  select count(*) into v_shared
    from (select root_node_id from app.contract_objectives
           where root_node_id is not null
           group by root_node_id having count(distinct objective_id) > 1) s;

  if v_shared > 0 then
    raise exception 'Reparatia n-a mers: % foldere de obiectiv sunt inca impartite intre obiective diferite.', v_shared;
  end if;
end
$$;
