# Securitatea datelor — cum se adaugă o tabelă nouă

Trei straturi, în ordinea în care se dărâmă unul pe altul. **Primul e sursa de adevăr**,
celelalte două sunt plase, nu înlocuitori:

1. **Grant-uri pe tabelă și pe coloană** — ce _coloane_ pot fi citite. Un `select` greșit din
   contextul de teren **cade cu 42501**, nu întoarce null.
2. **Politici RLS** — ce _rânduri_ pot fi citite. Filtrare, nu refuz: o firmă la care nu ai
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

| Funcție                                                      | Sursă                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `app.current_person_id()` · `app.current_persona()`          | claim-ul din `request.jwt.claims`                                              |
| `app.has_office_role(rol)`                                   | **doar** claim-ul — citirea din tabelă ar da recursiune de politică            |
| `app.current_company_ids()`                                  | claim → `person_company_access` → _(dacă e admin fără nicio firmă)_ tot grupul |
| `app.current_subcontractor_id()` · `app.current_client_id()` | claim → `app.persons`                                                          |

Regula administratorului fără firme nu deschide nimic: un admin poate oricum să scrie în
`person_company_access`, deci să-și dea singur acces. Fără ea, prima instalare n-ar avea cum
să fie configurată.

### De unde vin claim-urile

Le scrie `app.custom_access_token_hook(event jsonb)` (migrarea `0013`), chemată de GoTrue la
fiecare emitere de token. Ea citește `app.persons` + `person_office_roles` +
`person_company_access` și pune în JWT: `persona`, `person_id`, `full_name`, `office_roles`,
`company_ids`, `subcontractor_id`, `client_id`, `must_change_password`, `damina_status`.

Aceleași claim-uri ajung înapoi în `request.jwt.claims` prin `withActor()`, deci politicile
citesc exact ce a emis baza. Un nume de claim schimbat într-un loc și nu în celălalt e prins de
testul „duce claim-urile mai departe către RLS” din `packages/auth`.

**Hook-ul trebuie activat în proiect**, o singură dată, din Authentication → Hooks →
_Customize Access Token (JWT) Claims_ → `app.custom_access_token_hook`. Fără activare,
autentificarea funcționează dar token-ul n-are `persona`, iar aplicația refuză sesiunea cu
mesajul „hook-ul nu e activat” — deliberat diferit de „contul nu e configurat”, pentru că se
rezolvă în alt loc și de altcineva.

`app.clear_must_change_password()` e singura ușă prin care cineva își poate modifica propriul
rând din `app.persons`, și schimbă exact o coloană. Nu ia parametri: dacă ar lua, prima cerere
falsificată ar stinge flagul altcuiva.

`app_service` (worker, integrări) trece peste RLS printr-o politică explicită per tabelă. Nu
e o portiță: rolul nu e accesibil dintr-o sesiune de utilizator, iar tot ce scrie trece prin
același trigger de audit.

## Al doilea factor

TOTP e **obligatoriu** pentru rolurile `admin` și `financiar` — cele care pot da drepturi altora
și văd toți banii. Lista trăiește lângă matricea de drepturi, în `packages/auth/src/permissions.ts`
(`MFA_REQUIRED_ROLES`), pentru că ecranul care spune „rolul tău cere verificare în doi pași” și
poarta care oprește omul citesc amândouă de acolo.

`aal` (`aal1` = parolă, `aal2` = parolă + factor) e claim **nativ GoTrue** — hook-ul nostru nici
nu-l atinge. Contează că e așa: un claim calculat de serverul de autentificare nu poate fi
influențat de datele noastre. Lipsa lui sau o valoare necunoscută se citesc ca `aal1`, adică
„nu s-a dovedit nimic”: un claim deteriorat trebuie să te facă să ceri mai mult, nu mai puțin.

`aal` **nu intră în `can()`**. Matricea descrie ce poate un ROL, nu cât de tare s-a autentificat
sesiunea curentă; altfel un admin proaspăt logat și-ar vedea propriile drepturi dispărând din
tabel. Nivelul de autentificare e o poartă pe drum, aplicată în două locuri:

- **middleware**, pentru ecrane — redirect către `/doi-pasi`, după schimbarea parolei temporare și
  înaintea rutării pe personas;
- **`requireMfa()` în rutele `/api/admin/*`**, cu 403 și mesaj. Rutele sunt scutite dinadins de
  redirect: un `fetch` care primește 307 către HTML îl urmează și încearcă să citească JSON dintr-o
  pagină.

Un `admin` care și-a schimbat telefonul se deblochează din Administrare › fișa lui › _Cont de
login_ → „Resetează verificarea în doi pași”, de către **alt** administrator — pe sine nu se poate.
Fără ușa asta, un mecanism obligatoriu ar fi o capcană.

### `MFA_ENFORCED=0` — poarta oprită, pe medii de test

Pe un deploy de test se intră de zeci de ori pe zi. Un cod de 6 cifre la fiecare intrare nu face
testarea mai sigură, o face să nu se mai facă. De aceea `MFA_ENFORCED=0` oprește **poarta**:
`mfaSatisfied()` întoarce `true`, deci nici middleware-ul, nici `requireMfa()` nu mai opresc pe
nimeni.

**Ce NU face:** nu atinge drepturile. `requiresMfa()` răspunde în continuare `true` pentru un
`admin`, iar ecranul de administrare spune în continuare adevărul despre el. Matricea nu se
schimbă cu un bit.

**De ce nu se blochează pe `NODE_ENV === 'production'`**, care ar fi fost reflexul: pe Vercel
`NODE_ENV` e `production` pe _toate_ deploy-urile, inclusiv preview. Verificarea ar fi fost ori
inutilă, ori ar fi blocat exact mediul pentru care comutatorul există. Garanția e deci **vizibilă**,
nu ascunsă: cât timp comutatorul e pornit, shell-ul de birou afișează o bandă roșie pe fiecare
ecran, la fiecare om. Un mediu în care al doilea factor e oprit nu poate fi confundat cu unul în
care nu e — și asta se verifică dintr-o privire, nu citind variabile de mediu.

## Revocarea sesiunii

Drepturile călătoresc în JWT, iar JWT-ul trăiește o oră. La **retragerea accesului la prețuri**,
asta nu e acceptabil: `/api/admin/roles` compară `financials.read` înainte și după salvare și, dacă
dreptul a dispărut, închide sesiunile pe loc. Câștigarea unui drept nu declanșează nimic — un drept
care apare cu întârziere e o neplăcere, unul care dispare cu întârziere e o scurgere.

**Nu se face prin Admin API, pentru că Admin API-ul nu poate.** `auth.admin.signOut(jwt)` cere
access token-ul omului, nu id-ul lui, iar endpoint-urile care ar fi făcut-o după id răspund 404.
Mecanismul real e `app.revoke_sessions(uuid)` (migrarea `0015`): șterge rândurile din
`auth.sessions`, iar GoTrue întoarce apoi `403 session_not_found` la primul `GET /user`. Cum
`apps/web` cheamă `getUser()` la fiecare cerere, omul e afară la următoarea pagină.

Funcția e `security definer` — rolurile de aplicație n-au și nu trebuie să aibă drepturi pe schema
`auth` — și **își verifică singură apelantul** (`app.has_office_role('admin')`). O funcție care
șterge sesiuni și s-ar încrede în apelant ar fi o unealtă de deconectare a oricui.

Fiecare revocare scrie `persons.sessions_revoked_at`. Nu e decor: jurnalul se scrie **numai** din
trigger-ul de pe o tabelă auditată, deci fără coloana asta o revocare n-ar lăsa urmă nicăieri.

## Limita de încercări la login

10 încercări / 10 minute, pe cheia IP + email (`packages/auth/src/rate-limit.ts`), ștearsă la un
login reușit. Contorul e în memoria procesului: se pierde la repornire și nu se împarte între
instanțe. E o **frânare**, nu un zid — zidul e limita proprie a lui GoTrue, care vede toate
instanțele. Alternativa, un tabel în Postgres, ar fi însemnat o scriere la fiecare încercare de
login, adică exact suprafața pe care vrea s-o obosească un atacator.

## Capcana grant-ului pe coloane la scriere

`grant insert (coloane)` pare simetric cu `grant select (coloane)`. **Nu e**, dacă scrii prin
drizzle: un `insert` generat de drizzle **numește toate coloanele tabelei**, punând `default`
pe cele nedate. Postgres cere privilegiu pe fiecare coloană _numită_, nu doar pe cele cu
valoare — deci un `insert` care lasă `unit_cost` pe `default` cade tot cu 42501.

Consecința practică, aflată la 09b-2 pe `app.intervention_materials`:

- **`created_at` trebuie să fie în listă.** Are `default now()` și e oricum în lista de `select`;
  acordarea lui nu deschide nimic, doar permite să fie scris cu propriul default.
- **Coloanele pe care chiar vrei să le ții închise cer un `insert` scris de mână**, cu doar
  coloanele acordate. Alternativa — să le acorzi ca să treacă drizzle — e renunțarea la exact
  protecția pentru care le-ai scos.

Cum se vede: **numai chemând use-case-ul din rolul restrâns**. Din birou merge, typecheck-ul
tace, testele de RLS nu se uită la `insert`-uri.

## Ce nu se face niciodată

- Politici sau grant-uri din dashboard. Totul e migrare versionată.
- `force row level security` scos ca să „meargă un script”. Proprietarul are politica
  `definer`; dacă un script nu trece, îi lipsește rolul potrivit, nu politica.
- Coloană de bani acordată „temporar”. Regexul din `0012` și testul #1 o găsesc la următoarea
  migrare, iar migrarea cade.

## Ce vede terenul din cereri (pasul 08)

`app_field` are pe lanțul de cereri **exact o singură ușă**: `select` pe `app.requests`, prin
politica `assigned` și `app.request_assigned_to_me`, pe o listă **enumerată** de coloane care nu
include `estimated_value` (`0025_requests_and_catalog.sql:304-308`, verificat de
`assert_no_money_leak`).

`app.request_estimate_lines` și `app.request_decisions` **nu au nicio politică pentru
`app_field`**, și nici grant. E intenționat: liniile de evaluare sunt tarifele firmei, iar decizia
e raționamentul de business din spatele banilor — nimic din ce are nevoie omul de pe teren.

Consecința pentru ecranele viitoare: dacă un ecran de teren ajunge vreodată să ceară liniile de
evaluare sau decizia, **nu adăuga grantul fără politică**. O tabelă cu RLS pornit și fără politică
nu dă eroare — dă **zero rânduri, tăcut**, iar ecranul arată o cerere fără evaluare ca și cum
n-ar avea una. Rețeta din capul fișierului se aplică integral și acolo.
