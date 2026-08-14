# Pasul 02 — Identitate, acces, RLS, audit, perioade și serii

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** patru personas se pot autentifica și aterizează fiecare în spațiul ei; baza de date refuză prin construcție ce nu are voie să iasă; orice modificare e jurnalizată; lunile se pot închide și blochează scrierile.
> Ăsta e **pasul cel mai important din tot proiectul**. Dacă e greșit, se rescrie tot mai târziu.

---

## 0. Context minim

Damina = grup de **5 firme** de construcții și mentenanță, 30–40 utilizatori. ERP intern.

Trei cerințe de business care **nu se pot implementa în UI** și de-asta trăiesc în Postgres:

1. **Șeful de șantier și subcontractantul nu văd prețuri.** Nu „ecrane cu prețul ascuns" — **rute, view-uri și privilegii separate**. Dacă un developer scrie `select *` din contextul de teren, query-ul trebuie să **eșueze**, zgomotos, în development.
2. **Subcontractantul A nu vede nimic de la subcontractantul B.** Izolare prin RLS bazată pe apartenență, nu prin filtru în query.
3. **Luna închisă e blocată.** Nu prin `if` în serviciu — prin trigger. Altfel cifrele lunilor trecute nu mai sunt reproductibile, și tot raportul financiar devine inutil.

Sunt **patru spații de lucru distincte**, nu o aplicație cu permisiuni multe:

| Spațiu (persona) | Cine | Rol Postgres | Ce vede |
|---|---|---|---|
| **Birou** (`office`) | PM, devizist, achiziții, magazie, flotă, financiar, admin | `app_office` | tot, filtrat pe firmă și rol de business |
| **Teren** (`field`) | șef de șantier, echipă, inspector | `app_field` | **fără nicio coloană de preț**, doar UL-urile lui |
| **Portal subcontractant** | firme subcontractante | `app_subcontractor` | doar pachetele, SL-urile, PV-urile lui |
| **Portal client** | clienți | `app_client` | tichetele și rapoartele contractului lui |

Plus `app_service` pentru worker și integrări (bypass RLS controlat, cu audit obligatoriu).

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §4.3 (roluri), §4.4 (izolarea prețului), §4.5 (RLS), §4.8 (perioade), §4.10 (serii), §4.11 (audit), §6.2 (autorizare), §8 (auth complet), §15.2 (testele nenegociabile), §17 (securitate), Anexa C.1 (organizație), C.2 (perioade) |
| `Damina_Aplicatie_Structura_Functionala.md` | §2 (spațiile de lucru), §14.4 (oameni, echipe, SSM, provizionare), §18 (Administrare) |

## 2. Precondiții (verifică înainte să începi)

Din pasul 01 trebuie să existe:
- monorepo cu `packages/{db,shared,auth,services,contracts}` și `apps/{web,worker}`;
- schemele `app`, `audit`, `jobs` + toate enumerările;
- rolurile Postgres `app_office`, `app_field`, `app_subcontractor`, `app_client`, `app_service`, `app_runtime`;
- `withActor()` funcțional, `pool` neexportat;
- `app.companies` există.

Dacă lipsește ceva, **oprește-te și raportează** — nu construi peste o fundație incompletă.

---

## 3. Ce livrezi

### 3.1 Schema de organizație și identitate (migrarea `0004_organization`)

Din `PLAN_TEHNIC` Anexa C.1, integral:

```sql
app.companies      -- extinde: reg_com, address jsonb, logo_node_id, is_group_member,
                   -- default_indexation_pct 0.0500, default_delta_threshold 2000.00
app.clients        -- + payment_term_days 70, is_intercompany, intercompany_company_id
app.subcontractors -- + specialties text[], warranty_retention_pct
app.suppliers      -- + default_lead_time_days
app.qualifications -- instalator, electrician, zidar…

app.rate_cards     -- ISTORICIZAT. hourly_salary, tax_coefficient, unproductivity_coefficient,
                   -- hourly_cost generated stored
                   -- exclude using gist (qualification_id with =, daterange(valid_from, valid_to) with &&)

app.persons        -- auth_user_id (unique, null până la provizionare), persona, category,
                   -- full_name, email citext, phone, qualification_id,
                   -- subcontractor_id, client_id, must_change_password, is_active
                   -- check ((persona='subcontractor') = (subcontractor_id is not null))
                   -- check ((persona='client')        = (client_id is not null))
app.person_company_access (person_id, company_id)
app.person_office_roles   (person_id, role app.office_role)
app.teams          -- echipă, NU per om. lead_person_id, location_id
app.team_members   (team_id, person_id, valid_from, valid_to)

app.person_authorizations  -- SSM, lucru la înălțime, foc deschis, ISCIR…
                           -- kind, issued_at, expires_at, document_node_id
                           -- index (person_id, expires_at)
```

**Regulă de business impusă în DB:** un trigger pe asignarea unei persoane pe o unitate de lucru **refuză** inserarea dacă persoana are o autorizație cerută expirată la data de start. Nu avertizează — blochează. (Tabela `work_unit_assignments` vine în pasul 05; pregătește funcția trigger acum și atașeaz-o acolo.)

**Nomenclatoarele sunt comune între cele 5 firme** (produse, furnizori, clienți, obiective, calificări). Doar seriile de documente sunt per firmă.

### 3.2 Perioade și blocarea lunii (migrarea `0005_periods`)

```sql
app.periods (
  id uuid pk, company_id uuid not null references app.companies,
  year smallint not null, month smallint not null,
  status app.period_status not null default 'open',   -- open|closing|closed
  closed_at timestamptz, closed_by uuid,
  unique (company_id, year, month)
);

app.period_close_checks (
  id uuid pk, period_id uuid, check_key text,
  status text,                    -- pending | ok | blocked
  blocking_count integer, detail jsonb, evaluated_at timestamptz
);
```

**Trigger generic de blocare**, atașabil pe orice tabelă care poartă `period_id` sau `effect_date`:

```sql
create function app.guard_closed_period() returns trigger language plpgsql as $$
begin
  if app.period_status_of(coalesce(new.period_id, old.period_id)) = 'closed'
     and current_setting('app.allow_closed_period', true) is distinct from 'on' then
    raise exception 'PERIOD_CLOSED: luna % este închisă', ... using errcode = 'P0001';
  end if;
  return new;
end $$;
```

- Escape hatch-ul `app.allow_closed_period` e setat **doar** de funcția de re-alocare (`security definer`) și de un job administrativ care scrie obligatoriu în audit, cu motiv. **O singură ușă, cu jurnal.**
- Funcție helper `app.period_of(company_id, effect_date)` care returnează/creează perioada — folosită de triggerele care derivă `period_id` automat.
- Serviciu `periods.ensureOpenPeriods(companyId, fromYear)` care creează lunile lipsă.
- Mașina de stări `open → closing → closed` există ca use-case, dar **ecranul de închidere se construiește în pasul 06**, când există ce verifica.

### 3.3 Serii și numere de documente (migrarea `0006_document_series`)

Sequence-urile Postgres lasă goluri la rollback. Documentele fiscale nu au voie să aibă goluri.

```sql
app.document_series (
  id uuid pk, company_id uuid not null, document_type app.numbered_document_type not null,
  series text not null, next_number integer not null,
  unique (company_id, document_type, series)
);

create function app.allocate_document_number(p_company uuid, p_type app.numbered_document_type, p_series text)
returns text language plpgsql as $$  -- SELECT ... FOR UPDATE pe rândul de serie, incrementează
$$;
```

Se apelează **în tranzacția care creează documentul**, cât mai târziu posibil.

### 3.4 Audit trail (migrarea `0007_audit`)

```sql
audit.entries (
  id bigserial pk, occurred_at timestamptz default now(),
  actor_id uuid,                    -- din current_setting('app.actor_id')
  persona app.persona,
  table_name text not null, record_id uuid not null,
  operation app.audit_op not null,
  changed jsonb not null,           -- DOAR câmpurile modificate: {col: {old, new}}
  reason text,                      -- din current_setting('app.action_reason')
  request_id text
);
```

- **Un singur trigger generic**, atașat pe lista de tabele auditabile printr-o funcție `app.attach_audit('app.contracts')`.
- `changed` conține **doar diferența**. Rândul întreg face jurnalul de 10× mai mare și necitibil.
- Acțiunile ireversibile (mutare de finanțare, anulare de document, suprascriere de preț, închidere de lună) au `check` care refuză `reason is null`.
- Citire: doar `app_office` cu rol `admin`. Scriere: doar din trigger (`security definer`).
- Retenție: nelimitată pe tabelele financiare, 24 luni pe restul.

### 3.5 Autentificare (Supabase Auth)

```
auth.users (Supabase) ──1:1──▶ app.persons ──N:M──▶ app.person_office_roles
                                    ├── persona: office | field | subcontractor | client
                                    ├── category: angajat | sef_santier | subcontractant | client_user
                                    └── company_access[]
```

**Custom Access Token Hook** — funcție Postgres apelată de GoTrue la emiterea token-ului, care injectează în JWT:

```json
{ "persona": "field", "person_id": "...", "office_roles": [],
  "company_ids": ["..."], "subcontractor_id": null }
```

Astfel RLS citește direct din `request.jwt.claims`, fără round-trip la fiecare query.

- `@supabase/ssr` cu cookie-uri `httpOnly`, `secure`, `sameSite=lax`. Middleware de refresh.
- TTL token 1h. Schimbarea de rol se propagă la refresh — **cu o excepție: retragerea accesului la prețuri revocă sesiunea imediat**, prin Admin API.
- `supabase-js` se folosește **numai** pentru auth. Datele merg prin Drizzle.
- **MFA:** TOTP obligatoriu pentru rolurile `admin` și `financiar`.
- Politica de parole: min 12 caractere, verificare HIBP activată.

**Provizionarea de conturi** (fără flux de invitații pe email — pattern validat în prototip): PM-ul asignează un șef de șantier sau subcontractant care nu are cont → server action → Supabase Admin API `createUser` cu parolă temporară generată → **afișată o singură dată pe ecranul PM-ului**, cu `must_change_password = true`.

### 3.6 `packages/auth`

- `getActor()` — din sesiune → `Actor { personId, persona, pgRole, claims, officeRoles, companyIds }`.
- `permissions.ts` — **matricea rol de birou × use-case, într-un singur fișier**, generată ca tabel. Ecranul de administrare se randează din același fișier, deci UI-ul nu poate diverge de realitate.
- Guard-uri: `requirePersona`, `requireOfficeRole`. Sunt **al doilea** strat, nu primul — primul e RLS. Rolul lor e să dea erori bune (403 cu mesaj), nu să apere.

### 3.7 Rutare pe personas (Next.js)

```
src/app/
  (auth)/login · reset · change-password
  (office)/layout.tsx      → verifică persona='office'
  (field)/layout.tsx       → verifică persona='field'
  (portal)/subcontractor/layout.tsx
  (portal)/client/layout.tsx
  (public)/                → rute fără cont (PV tokenizat, faza 4)
```

- Verificarea personei se face **și în middleware, și în layout** (dublu, ieftin).
- **Nu există o rută care să servească două personas.** Un utilizator `field` care nimerește pe `/office/...` primește redirect, nu 403 cu conținut parțial.
- După login, fiecare persona aterizează în shell-ul ei (în pasul ăsta, o pagină simplă care spune „Birou / Teren / Portal" — shell-ul real vine în pasul 03).

### 3.8 RLS — politicile de bază (migrarea `0008_rls_policies`)

`enable row level security` **și** `force row level security` pe **toate** tabelele din `app`. Fără excepții — o tabelă fără politică nu returnează nimic, ceea ce e comportamentul sigur.

Funcții helper `stable` (evită subquery repetat, sunt cache-uite per statement):

```sql
app.current_person_id() · app.current_company_ids() · app.current_persona()
app.current_subcontractor_id() · app.has_office_role(app.office_role)
```

Tipare de politică pe categorii:

| Categorie | Politică |
|---|---|
| Scoped pe firmă | `company_id = any(app.current_company_ids())` |
| Nomenclatoare comune | citire pentru toate personele interne; scriere doar `app_office` cu rolul potrivit |
| Persoane | fiecare se vede pe sine; `app_office` cu rol admin vede tot |
| Audit | citire doar `app_office` + rol admin; scriere doar din trigger |

**Un fișier de politici per tabelă**, în `packages/db/policies/`, aplicat prin migrare. Nimic din dashboard.

### 3.9 Izolarea prețului — cele trei straturi (migrarea `0009_column_grants`)

**Stratul 1 — privilegiu pe coloană** (sursa de adevăr):

```sql
REVOKE SELECT ON app.<tabela_cu_pret> FROM app_field, app_subcontractor, app_client;
GRANT SELECT (id, ...coloane_permise) ON app.<tabela> TO app_field;
-- coloanele de preț: NEACORDATE
```

**Stratul 2 — view-uri per persona**, cu `security_invoker = on`. Aplicația de teren **nu atinge niciodată tabela de bază**. `packages/db` le expune ca scheme Drizzle separate, deci `SchemaFor<'field'>` nu conține câmpul `unit_price` — greșeala devine **eroare de compilare**, nu incident de securitate.

**Stratul 3 — DTO-uri de ieșire.** Fiecare use-case declară în `packages/contracts` schema Zod a răspunsului, per persona. Un câmp scăpat din straturile 1–2 se oprește aici.

În pasul ăsta există puține coloane de preț (`rate_cards.hourly_salary`, `hourly_cost`). **Dar infrastructura de test se construiește acum**, pentru că din pasul 04 încolo apar zeci.

### 3.10 Ecranul Administrare › Utilizatori și roluri

Singurul ecran real din pasul ăsta (minimalist, fără design system — vine în 03):
- listă de persoane cu persona, categorie, roluri, firme, stare cont;
- creare persoană + provizionare cont (parolă temporară afișată o singură dată);
- **ecranul spune explicit ce NU vede rolul**, nu doar ce vede;
- izolarea prețului și izolarea subcontractant-vs-subcontractant apar ca **proprietăți fixe, needitabile** — sunt constrângeri de arhitectură, nu setări.

---

## 4. Reguli care nu se negociază

1. **RLS pe toate tabelele din `app`**, cu `force row level security`. Tabelă nouă fără politică = build spart (vezi testul generic).
2. **Politicile sunt migrări versionate**, un fișier per tabelă. Nimic prin click.
3. **`REVOKE` pe coloana de preț e sursa de adevăr.** View-urile și DTO-urile sunt straturi în plus, nu înlocuitori.
4. **Motivul scris e obligatoriu** pe acțiuni ireversibile, impus prin `check`, nu prin validare în formular.
5. **Nu se pornește nicio tranzacție în afara `packages/services`.**
6. **`SUPABASE_SERVICE_ROLE_KEY` doar în worker și în rute `/api` dedicate.**

## 5. Ce NU faci în pasul ăsta

- Nu construiești shell-ul de navigare, sidebar-ul, pagina fractală — pasul 03.
- Nu creezi contracte, obiective, UL, costuri — pașii 04–06.
- Nu construiești ecranul de închidere de lună — pasul 06 (aici doar mecanica DB).
- Nu implementezi portalul de client sau semnarea prin link tokenizat.
- Nu adaugi rate limiting complex — doar pe login (simplu, pe IP).

## 6. Verificare — ce rulezi ca să vezi că e ok

### Teste automate, blocante în CI (Vitest + Testcontainers)

| # | Test | Rezultat așteptat |
|---|---|---|
| 1 | **Test generat automat de izolare a prețului:** pentru fiecare coloană din `information_schema.columns` cu prefix `price`, `pret`, `cost`, `amount`, `margin`, `salary`, pentru fiecare rol non-office → `select` pe coloană | **eroare** de privilegiu, la fiecare |
| 2 | **Test generic de RLS:** enumeră toate tabelele din `app` fără `rowsecurity = true` | listă goală |
| 3 | **Test generic de politici:** tabele cu RLS activ dar zero politici | listă goală |
| 4 | `app_field` face `select` pe `app.companies` a unei firme la care nu are acces | zero rânduri (nu eroare — filtrare de rânduri) |
| 5 | Insert într-o tabelă cu `period_id` pe o lună `closed` | eroare `PERIOD_CLOSED` (errcode `P0001`) |
| 6 | Același insert cu `app.allow_closed_period = 'on'` setat de funcția de re-alocare | reușește **și** scrie în `audit.entries` cu `reason` |
| 7 | **Concurență pe serii:** 100 de alocări paralele de număr pe aceeași serie | zero goluri, zero duplicate, numerele 1–100 |
| 8 | Update pe o tabelă auditată | rând în `audit.entries` cu `changed` conținând **doar** câmpul modificat |
| 9 | Acțiune ireversibilă fără `app.action_reason` | eroare, nu insert |
| 10 | `rate_cards`: două intervale suprapuse pe aceeași calificare | eroare de constrângere `exclude` |
| 11 | `persons`: persona `subcontractor` fără `subcontractor_id` | eroare de `check` |

### Verificare manuală

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 12 | Login cu user `office` | aterizezi în `/office`, vezi „Birou" |
| 13 | Login cu user `field` | aterizezi în `/field`. Navighezi manual la `/office/...` → **redirect**, nu conținut |
| 14 | Login cu user `subcontractor` și cu `client` | fiecare în portalul lui |
| 15 | Cont cu `must_change_password = true` | ești forțat pe ecranul de schimbare parolă, nu poți sări peste |
| 16 | User cu rol `admin` fără MFA configurat | forțat să configureze TOTP la primul login |
| 17 | Administrare › Utilizatori → creezi un șef de șantier | parola temporară apare **o singură dată**; refresh-ul paginii nu o mai arată |
| 18 | Revoci accesul la prețuri unui user logat | sesiunea lui e revocată imediat, la următorul request |
| 19 | Deschizi Audit trail ca `financiar` (nu admin) | nu ai acces |

## 7. Definiția de „gata"

- Toate cele 19 verificări trec; testele 1–3 sunt **blocante în CI** (dacă cineva adaugă mâine o coloană `pret_x` fără `REVOKE`, build-ul cade).
- Există un seed determinist cu: 2 firme, câte un utilizator din fiecare persona, 3 calificări cu rate card, 2 luni deschise per firmă.
- `packages/auth/src/permissions.ts` conține matricea completă rol × use-case (chiar dacă majoritatea use-case-urilor nu există încă — lista se completează în pașii următori).
- Documentat în `docs/security.md`: cum se adaugă o tabelă nouă (politică + grant + test), în ≤ 15 linii.
