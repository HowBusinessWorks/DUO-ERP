# Securitatea datelor — cum se adaugă o tabelă nouă

Trei straturi, în ordinea în care se dărâmă unul pe altul. **Primul e sursa de adevăr**,
celelalte două sunt plase, nu înlocuitori:

1. **Grant-uri pe tabelă și pe coloană** — ce *coloane* pot fi citite. Un `select` greșit din
   contextul de teren **cade cu 42501**, nu întoarce null.
2. **Politici RLS** — ce *rânduri* pot fi citite. Filtrare, nu refuz: o firmă la care nu ai
   acces întoarce zero rânduri, pentru că un refuz ar spune că firma există.
3. **DTO-uri Zod** în `packages/contracts` — ce iese pe sârmă.

## Rețeta pentru o tabelă nouă (migrarea în care o creezi)

```sql
-- 1. cine o citește și cine scrie în ea
grant select on app.tabela_noua to app_office, app_field;
grant insert, update, delete on app.tabela_noua to app_office;
-- coloanele de bani NU se acordă în afara biroului. Dacă tabela e integral
-- financiară, nu se decupează pe coloane: nu se acordă deloc.

-- 2. RLS + politicile obligatorii (`definer` pentru funcțiile `security definer`,
--    `service` pentru worker). Fără linia asta, testul #2 pică build-ul.
select app.rls_enable('app.tabela_noua'::regclass);

-- 3. politicile proprii. Fără măcar una, testul #3 pică build-ul.
create policy "office" on app.tabela_noua for all to app_office
  using (company_id = any(app.current_company_ids()))
  with check (company_id = any(app.current_company_ids()));
create policy "read" on app.tabela_noua for select to app_field
  using (company_id = any(app.current_company_ids()));
```

Dacă tabela nu poartă `company_id`, se filtrează prin părinte:
`app.contract_in_scope(contract_id)`, `app.component_in_scope(...)`,
`app.period_in_scope(...)`, `app.team_in_scope(...)`. Sunt `security definer`, deci văd
rândul-părinte indiferent de ce vede apelantul.

**Testul nu se scrie.** Cele trei verificări generice din `packages/db/tests/rls.test.ts` se
generează din cataloage: o tabelă fără RLS, una fără politică sau o coloană `*_cost` vizibilă
terenului pică CI-ul de la sine. Testul propriu se scrie doar pentru reguli pe care cataloagele
nu le pot exprima.

## Cine sunt eu, în politici

| Funcție | Sursă |
|---|---|
| `app.current_person_id()` · `app.current_persona()` | claim-ul din `request.jwt.claims` |
| `app.has_office_role(rol)` | **doar** claim-ul — citirea din tabelă ar da recursiune de politică |
| `app.current_company_ids()` | claim → `person_company_access` → *(dacă e admin fără nicio firmă)* tot grupul |
| `app.current_subcontractor_id()` · `app.current_client_id()` | claim → `app.persons` |

Regula administratorului fără firme nu deschide nimic: un admin poate oricum să scrie în
`person_company_access`, deci să-și dea singur acces. Fără ea, prima instalare n-ar avea cum
să fie configurată.

`app_service` (worker, integrări) trece peste RLS printr-o politică explicită per tabelă. Nu
e o portiță: rolul nu e accesibil dintr-o sesiune de utilizator, iar tot ce scrie trece prin
același trigger de audit.

## Ce nu se face niciodată

- Politici sau grant-uri din dashboard. Totul e migrare versionată.
- `force row level security` scos ca să „meargă un script”. Proprietarul are politica
  `definer`; dacă un script nu trece, îi lipsește rolul potrivit, nu politica.
- Coloană de bani acordată „temporar”. Regexul din `0012` și testul #1 o găsesc la următoarea
  migrare, iar migrarea cade.
