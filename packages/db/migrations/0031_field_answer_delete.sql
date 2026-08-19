/*
 * Terenul nu-si putea salva de a doua oara fisa de inspectie.
 *
 * `saveInspection` REScrie tot setul de raspunsuri: sterge ce era si insereaza
 * ce a trimis ecranul. E singura forma corecta — un punct scos din fisa trebuie
 * sa dispara, iar o imbinare ar fi lasat raspunsuri orfane la fiecare
 * recompletare. Dar la 0026 rolul `app_field` a primit doar
 * `select, insert, update` pe `app.inspection_answers`. Fara `delete`, prima
 * salvare mergea (tabela era goala, deci `delete` n-avea ce sterge) si a doua
 * cadea cu 42501.
 *
 * A patra oara in proiect cand un drum de teren pica pe un grant lipsa, dupa
 * catalogul de operatiuni (0027), liniile de pontaj (0027) si seriile de
 * numerotare (0030). Toate patru au aceeasi forma: **partea de jos era corecta,
 * dar o persona n-avea drum pana la ea.** Si toate patru s-au vazut abia
 * chemand use-case-ul din rolul restrans, pe date reale — niciun typecheck nu
 * stie ce inseamna `permission denied`.
 *
 * `inspection_findings` NU are nevoie de grant: iesirile pleaca in cascada, prin
 * cheia straina catre raspuns, iar cascada e executata de sistem, nu de rol.
 * Un `grant delete` acolo ar fi dat terenului voie sa stearga o iesire fara sa
 * atinga raspunsul ei — adica sa scoata tocmai obligatia din „fiecare NOK are o
 * iesire".
 */

grant delete on app.inspection_answers to app_field;
--> statement-breakpoint

-- Plasa de bani, a saptea rulare. Un `delete` nu deschide o coloana, dar
-- verificarea confirma ca nimic din ce s-a atins aici n-a deschis alta usa.
select app.assert_no_money_leak();
