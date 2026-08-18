/*
 * Terenul nu putea deschide o fisa de interventie. Deloc.
 *
 * `getInterventionSheet` face `left join app.operation_catalog`, ca sa arate
 * codul operatiunii pe fisa. Catalogul a intrat in 0025 ca nomenclator de
 * BIROU: politica „office", grant-uri pentru `app_office` si `app_service`,
 * nimic pentru teren. Deci orice citire a fisei din rolul de teren cadea cu
 * „permission denied for table operation_catalog" — inclusiv cea cu
 * `withMoney = false`, care e exact drumul terenului.
 *
 * N-a observat nimeni pentru ca la 09a citirea n-a fost chemata niciodata din
 * rolul de teren, iar interfata nu exista inca. E aceeasi forma cu bug-ul din
 * 07b (`file_versions` fara politica de `update`): partea de jos e corecta, dar
 * o persona n-are drum pana la ea.
 *
 * Reparatia urmeaza tiparul lui `app.products` (0008 + 0011): nomenclatorul se
 * citeste de toata lumea, dar **pe coloane enumerate**. `estimated_labor` si
 * `estimated_material` raman doar la birou — sunt bani, si sunt exact cifra pe
 * care verificarea #23 o cauta pe ecranul terenului.
 */

drop policy if exists "read" on app.operation_catalog;
--> statement-breakpoint
create policy "read" on app.operation_catalog
  for select to app_field, app_subcontractor using (true);
--> statement-breakpoint

drop policy if exists "read" on app.operation_catalog_materials;
--> statement-breakpoint
create policy "read" on app.operation_catalog_materials
  for select to app_field, app_subcontractor using (true);
--> statement-breakpoint

/*
 * Enumerare explicita, ca la `app.requests` in 0025: o coloana de bani adaugata
 * maine nu intra in lista de la sine. Asta e si motivul pentru care nu scriem
 * `grant select on app.operation_catalog` — ar fi corect azi si gresit la prima
 * coloana noua.
 */
grant select (
  id, code, name, category, standard_hours, qualification_id, is_active, created_at
) on app.operation_catalog to app_field, app_subcontractor;
--> statement-breakpoint

-- Lista de materiale tipice n-are nicio coloana de bani: cantitati si produse.
grant select on app.operation_catalog_materials to app_field, app_subcontractor;
--> statement-breakpoint

/*
 * Poarta de bani, a patra rulare (0012, 0016, 0025, aici). `avg_real_cost` si
 * `avg_estimated_cost` din `operation_actuals` raman office-only si dupa
 * migrarea asta — sunt mecanismul anti-furt din §8.5, nu date de teren.
 */
select app.assert_no_money_leak(
  array['estimated_labor', 'estimated_material', 'avg_real_cost', 'avg_estimated_cost']
);
--> statement-breakpoint

/*
 * A doua descoperire a aceluiasi smoke: terenul nu-si putea SALVA fisa.
 *
 * 0026 a dat `grant insert (coloane)` pe trei tabele, ca `unit_cost` si
 * `consumption_note_id` sa nu poata fi scrise de pe teren. Corect ca intentie —
 * dar lista a uitat `created_at`, iar drizzle scrie in `insert` **toate**
 * coloanele tabelei, cu `default` pentru cele nedate:
 *
 *   insert into app.intervention_materials (id, ..., location_id, created_at)
 *   values ($1, ..., $6, default)
 *
 * Postgres cere privilegiu pe fiecare coloana din lista, inclusiv pe cea
 * completata cu `default`. Deci `saveIntervention` din rolul de teren cadea cu
 * „permission denied for table intervention_materials", desi din birou mergea.
 *
 * Aceleasi doua tabele mai au bug-ul: `timesheet_lines` (pasul 09b-3) si
 * `inspection_findings` (09b-1, unde smoke-ul a rulat din birou). Se repara
 * toate trei aici, ca a doua descoperire sa nu fie a treia oara.
 *
 * `created_at` are `default now()` si e in lista de `select`: acordarea lui la
 * `insert` nu deschide nimic — permite doar sa fie scris cu propriul default.
 */
grant insert (created_at) on app.intervention_materials to app_field;
--> statement-breakpoint

grant insert (created_at) on app.timesheet_lines to app_field;
--> statement-breakpoint

grant insert (created_at) on app.inspection_findings to app_field;
