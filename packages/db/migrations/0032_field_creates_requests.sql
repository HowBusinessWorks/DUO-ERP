/*
 * Terenul nu putea inchide un NOK cu „creeaza interventie".
 *
 * E cea mai frecventa iesire a unei inspectii si e chiar rostul regulii „fiecare
 * NOK are o iesire" (#18): constatarea naste o CERERE, care ajunge in coada
 * biroului. Dar `app.requests` a primit la 0025 doar `select` pentru `app_field`
 * — nicio politica de scriere, niciun grant de insert. Practic, singurul drum
 * prin care terenul putea folosi iesirea aia n-a existat niciodata.
 *
 * Acelasi lucru bloca si `material.request`, tipul de mutatie declarat la 10a:
 * exista in `MUTATION_TYPES`, are executant, e testat — dar cadea cu 42501 la
 * prima trimitere reala din teren.
 *
 * A cincea oara cand un drum de teren pica pe un grant lipsa, dupa catalogul de
 * operatiuni si liniile de pontaj (0027), seriile de numerotare (0030) si
 * stergerea raspunsurilor (0031). Toate cinci au aceeasi forma: **partea de jos
 * era corecta, dar o persona n-avea drum pana la ea.**
 *
 * `estimated_value` NU se acorda. Terenul poate NASTE o cerere, dar nu-i poate
 * pune pret — evaluarea e a biroului, si asta e regula „zero lei pe teren"
 * privita din partea cealalta: nu doar ca nu vede bani, dar nici nu-i scrie.
 * Ca sa poata fi respectat grantul, `createRequestTx` numeste coloana in
 * `insert` doar cand chiar are ce pune in ea — drizzle le-ar fi numit pe toate.
 */

-- Cererile propriei firme, si doar la creare. Modificarea lor ramane a biroului:
-- triajul, rutarea si estimarea sunt decizii care se iau acolo.
drop policy if exists "mine_insert" on app.requests;
--> statement-breakpoint
create policy "mine_insert" on app.requests for insert to app_field
  with check (company_id = any(app.current_company_ids()));
--> statement-breakpoint

grant insert (
  id, company_id, type, source, status, objective_id, contract_id,
  contract_objective_id, title, description, source_inspection_finding_id,
  source_equipment_id, sla_due_at, created_by
) on app.requests to app_field;
--> statement-breakpoint

/*
 * Si legatura inapoi. `saveInspection` scrie in cerere `source_inspection_finding_id`
 * imediat dupa ce o creeaza, ca drumul cerere → punctul de fisa care a nascut-o
 * sa nu ramana gol (§6, verificarea #4).
 *
 * Politica e cea mai ingusta care functioneaza: **doar cererile pe care le-am
 * creat eu.** Politica de citire a terenului e „cererile care mi-au nascut o UL
 * pe care sunt asignat", iar o cerere de acum doua secunde n-are inca nicio UL —
 * deci un `update` sub politica aia n-ar fi gasit niciun rand si ar fi trecut
 * TACUT, lasand legatura goala. Exact genul de esec care nu se vede niciodata.
 *
 * Grantul e pe o singura coloana: terenul nu poate schimba nici titlul, nici
 * starea, nici estimarea. Triajul ramane al biroului.
 */
drop policy if exists "mine_backlink" on app.requests;
--> statement-breakpoint
create policy "mine_backlink" on app.requests for update to app_field
  using (created_by = app.current_person_id())
  with check (created_by = app.current_person_id());
--> statement-breakpoint

grant update (source_inspection_finding_id) on app.requests to app_field;
--> statement-breakpoint

-- Plasa de bani, a opta rulare. `estimated_value` trebuie sa ramana in afara
-- listei de mai sus, si asta o confirma.
select app.assert_no_money_leak(array['estimated_value']);
