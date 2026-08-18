/*
 * `complete` nu putea sa-si termine treaba.
 *
 * Migrarea 0021 a dat pe `app.file_versions` politici de `select` si de
 * `insert`, dar niciuna de `update` — iar finalizarea unui upload face exact
 * asta: scrie `state = 'ready'`, marimea reala si tipul dedus din magic bytes.
 * Cu `force row level security` si fara politica potrivita, `update`-ul nu da
 * eroare: **atinge zero randuri**. Fisierul ramanea la nesfarsit `uploading`,
 * cu tipul declarat de client si cu marimea declarata de client — adica fix
 * cele doua valori pe care pasul asta se laudă ca nu le crede.
 *
 * Asa arata greselile de RLS cand lipseste o politica de scriere: nu cad, tac.
 * De-aia smoke-ul pe date reale prinde ce nu prinde niciun typecheck.
 *
 * Acelasi lucru pe `app.nodes` pentru teren si subcontractant: aveau voie sa
 * insereze, nu si sa lege nodul de versiunea urcata.
 */

create policy "accessible_update" on app.file_versions for update
  to app_office, app_field, app_subcontractor
  using (app.can_access_node(node_id, 'write'))
  with check (app.can_access_node(node_id, 'write'));
--> statement-breakpoint

create policy "assigned_update" on app.nodes for update to app_field
  using (work_unit_id is not null and app.work_unit_assigned_to_me(work_unit_id))
  with check (work_unit_id is not null and app.work_unit_assigned_to_me(work_unit_id));
--> statement-breakpoint

create policy "shared_update" on app.nodes for update to app_subcontractor
  using (app.node_share_rank(id) >= 2)
  with check (app.node_share_rank(id) >= 2);
--> statement-breakpoint

grant update on app.nodes to app_field, app_subcontractor;
--> statement-breakpoint
grant update on app.file_versions to app_field, app_subcontractor;
--> statement-breakpoint

/*
 * Plasa care ar fi prins-o de la inceput: fiecare tabela de fisiere trebuie sa
 * aiba cel putin o politica de scriere pentru biroul care o foloseste. O tabela
 * cu `insert` dar fara `update` e aproape sigur o scapare, nu o decizie — iar
 * simptomul ei e tacut.
 */
do $$
declare
  v_missing text;
begin
  select string_agg(t.relname, ', ')
    into v_missing
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'app'
     and t.relname in ('nodes', 'file_versions')
     and not exists (
       select 1 from pg_policies p
        where p.schemaname = 'app' and p.tablename = t.relname
          and p.cmd in ('UPDATE', 'ALL')
          and 'app_office' = any(p.roles)
     );

  if v_missing is not null then
    raise exception 'Tabele de fisiere fara politica de update pentru birou: %', v_missing;
  end if;
end
$$;
