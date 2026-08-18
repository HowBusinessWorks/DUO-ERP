/*
 * Terenul nu-si putea citi seriile de numerotare.
 *
 * `app.document_series` a intrat in 0006 ca nomenclator de birou: grant si
 * politica doar pentru `app_office`. Dar de la pasul 10 incoace, telefonul
 * deschide fise fara semnal — iar `createInspection`, `createIntervention` si
 * bonul de consum cer toate seria din care se ia numarul. Fara ea, felia de
 * date pleaca fara seriile firmei, si prima fisa scrisa in subsol nu se poate
 * salva nici cand revine reteaua.
 *
 * Se vede numai chemand felia din rolul de teren: din birou totul merge, iar
 * niciun typecheck nu stie ce inseamna `permission denied`. E a treia oara in
 * proiect cand un drum de teren pica pe un grant lipsa (dupa catalogul de
 * operatiuni la 09b-2 si liniile de pontaj la 09b-3), si toate trei aveau
 * aceeasi forma: partea de jos era corecta, dar o persona n-avea drum pana la ea.
 *
 * `next_number` NU se acorda: e contorul gapless, si singurul care are voie sa-l
 * miste e `app.allocate_document_number`, o functie `security definer`. Un rol
 * care l-ar putea citi ar putea si ghici cate documente s-au emis; unul care
 * l-ar putea scrie ar rupe garantia de numerotare fara goluri.
 */

create policy "read" on app.document_series
  for select to app_field, app_subcontractor
  using (company_id = any(app.current_company_ids()));
--> statement-breakpoint

grant select (id, company_id, document_type, series, is_active, created_at)
  on app.document_series to app_field, app_subcontractor;
--> statement-breakpoint

-- Plasa de bani, a sasea rulare. `next_number` nu e bani, dar verificarea
-- confirma ca nimic din ce s-a acordat aici n-a deschis alta usa.
select app.assert_no_money_leak();
