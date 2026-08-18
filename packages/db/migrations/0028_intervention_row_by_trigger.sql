/*
 * Randul de interventie se naste din TRIGGER, nu din formular.
 *
 * `app.interventions` e extensia 1:1 a unei unitati de lucru cu
 * `type = 'interventie'`. Pana acum o scria doar `createIntervention`, iar
 * unitatea de tip interventie se putea naste pe inca doua drumuri:
 *
 *   - formularul generic de Activitate (`createWorkUnitFromForm`);
 *   - decizia de rutare din pasul 08, care creeaza unitatea in aceeasi
 *     tranzactie cu decizia.
 *
 * Amandoua lasau o interventie FARA fisa. Nu cadea nimic la creare — se vedea
 * abia cand cineva deschidea tab-ul Fisa si primea „nu exista sau nu e
 * vizibila", pentru o unitate care exista si era vizibila.
 *
 * La 09b-1, aceeasi problema pe inspectii a fost rezolvata invers: drumul
 * generic a fost INTERZIS, fiindca o inspectie fara checklist n-are ce arata si
 * checklist-ul nu se poate ghici. Interventia e alt caz — fisa ei n-are nimic
 * de ghicit: data executiei e inceputul unitatii, restul se completeaza pe
 * teren. Deci aici raspunsul corect nu e sa inchidem drumuri, ci sa facem randul
 * sa apara pe toate, in aceeasi tranzactie cu unitatea. Exact ca arborele de
 * fisiere din 07a.
 *
 * `on conflict do nothing` pentru ca `createIntervention` isi da propriul id de
 * unitate si apoi completeaza fisa: trigger-ul o naste, serviciul o umple.
 */

create or replace function app.ensure_intervention_row() returns trigger
  language plpgsql
  security definer
  set search_path = app, pg_catalog
as $fn$
begin
  insert into app.interventions (work_unit_id, performed_on)
  values (new.id, coalesce(new.starts_on, current_date))
  on conflict (work_unit_id) do nothing;
  return new;
end
$fn$;
--> statement-breakpoint

revoke execute on function app.ensure_intervention_row() from public;
--> statement-breakpoint

create trigger work_units_intervention_sheet
  after insert on app.work_units
  for each row when (new.type = 'interventie')
  execute function app.ensure_intervention_row();
--> statement-breakpoint

/*
 * Backfill, cu acelasi cod ca trigger-ul — nu o a doua implementare care se
 * poate abate. Interventiile existente fara fisa sunt cele nascute pe drumul
 * generic sau din rutare.
 */
insert into app.interventions (work_unit_id, performed_on)
select wu.id, coalesce(wu.starts_on, current_date)
  from app.work_units wu
 where wu.type = 'interventie'
   and not exists (select 1 from app.interventions i where i.work_unit_id = wu.id);
--> statement-breakpoint

-- Plasa: de acum incolo, o interventie fara fisa e o eroare de migrare, nu o
-- surpriza pe ecran.
do $$
declare
  v_missing bigint;
begin
  select count(*) into v_missing
    from app.work_units wu
   where wu.type = 'interventie'
     and not exists (select 1 from app.interventions i where i.work_unit_id = wu.id);

  if v_missing > 0 then
    raise exception 'Au ramas % interventii fara fisa.', v_missing;
  end if;
end
$$;
