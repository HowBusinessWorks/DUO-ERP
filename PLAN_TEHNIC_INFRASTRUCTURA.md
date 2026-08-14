# Damina ERP — Plan tehnic de infrastructură

**Ce e documentul ăsta.** `DaminaStructuraCapCoada FInal.md` spune *ce* face sistemul. `Damina_Aplicatie_Structura_Functionala.md` spune *cum arată* în aplicație. Documentul de față spune **din ce e construit și cum se leagă tehnic**: monorepo, schema și regulile din Postgres, stratul de acces la date, arhitectura backend, rutarea Next.js, autentificare, storage, joburi, sincronizare offline, integrări, testare, CI/CD, securitate de bază.

Stack fixat: **Next.js (App Router) · Supabase (Postgres + Auth) · Cloudflare R2 (blob storage)**.

Scara reală (§21 din arhitectură): **30–40 utilizatori, ~20 concomitent pe mobil**. Asta nu e un sistem care cade sub trafic. E un sistem care cade sub **complexitate de date și reguli**. Tot planul e optimizat pentru corectitudine, izolare și viteză de dezvoltare pe 5 faze — nu pentru throughput.

---

## 0. Rezumatul deciziilor

Cele 14 decizii care determină tot restul. Fiecare e argumentată în secțiunea indicată.

| # | Decizie | De ce | §  |
|---|---|---|---|
| 1 | **Monorepo pnpm + Turborepo**, o singură aplicație Next.js cu 4 route-group-uri pentru cele 4 spații de lucru | Spațiile partajează 90% din domeniu și 0% din ecrane. Route groups dau rute și layout-uri complet separate, dar un singur build, un singur strat de date | §3, §7 |
| 2 | **Postgres deține regulile critice**, nu doar datele: RLS, închiderea de perioadă, seriile de documente, rollup-urile de plafon, audit trail | Sunt reguli care nu au voie să depindă de disciplina unui developer la fiecare query (§10.3, §21.8) | §4 |
| 3 | **Izolarea prețului = `REVOKE` pe coloană + RLS + view-uri per persona**, nu `if (role !== 'field')` în cod | Cerință explicită, confirmată de trei ori în practică. Singura implementare care nu se erodează | §4.4 |
| 4 | **Drizzle ORM** peste Postgres, cu un wrapper `withActor()` care deschide tranzacția, setează rolul Postgres și claim-urile JWT | Type-safety completă + RLS activ pe fiecare query, inclusiv din server actions | §5 |
| 5 | **Supabase = Postgres + Auth + Realtime. Atât.** Storage-ul e R2; logica e în aplicație | Evită lock-in pe partea care contează și respectă decizia „R2 deține blob-urile" (§19.1) | §4.1, §9 |
| 6 | **Registrul de cost e append-only**, cu rollup-uri întreținute prin trigger tranzacțional | Ecranul de contract trebuie să dea aceeași cifră ca drill-down-ul, mereu (§8.2: „dacă nu dă, e bug") | §4.6 |
| 7 | **Server Actions pentru mutații, RSC pentru citiri, Route Handlers doar pentru webhook-uri și integrări** | Fără API REST intern de întreținut; type-safety din DB până în componentă | §7 |
| 8 | **`pg-boss` pentru joburi**, pe același Postgres, cu un worker separat rulat ca proces persistent | Enqueue tranzacțional cu mutația (fără „job lansat, tranzacție rollback"). Zero vendori în plus | §10 |
| 9 | **Aplicația de teren = PWA în același Next.js**, offline-first cu **outbox propriu** peste IndexedDB (Dexie), nu motor de replicare | Feliile de date sunt mici și bine delimitate; partea grea sunt *scrierile*, pe care orice motor te pune oricum să le scrii singur | §11 |
| 10 | **UUID v7 generat pe client** pentru toate entitățile create în teren | Offline-ul are nevoie de ID-uri înainte de a atinge serverul; v7 e ordonat temporal, deci indexabil ca un serial | §4.2 |
| 11 | **Bani = `numeric(14,2)` în DB, `Decimal.js` în aplicație.** Niciodată `float`, niciodată `number` pe valori | Un ERP cu marje pe 4 ani nu are voie să aibă erori de rotunjire | §4.2 |
| 12 | **Integrările externe (ANAF, Saga, email) trec printr-un strat anticorupție** — pachet propriu, cu contract intern stabil | „Dacă schimbați programul de contabilitate peste doi ani, rescrieți conectorul, nu aplicația" (§20.2) | §12 |
| 13 | **Hosting: Vercel (web) + Railway/Fly (worker) + Supabase + R2**, toate în EU (Frankfurt) | Latență mică către DB, zero admin de infrastructură la scara asta. Alternativa self-hosted e documentată la §16.4 | §16 |
| 14 | **Cod și DB în engleză, domeniu intraductibil în română, UI complet în română prin dicționar** | `deviz`, `aviz`, `NIR`, `pontaj` nu au echivalent; `created_at`, `status`, `id` nu au ce căuta în română | §3.4 |

---

## 1. Constrângerile care modelează infrastructura

Nu tot ce e în cele două documente afectează infrastructura. Astea da, și fiecare are o consecință tehnică directă.

| Constrângere funcțională | Consecință de infrastructură |
|---|---|
| Șeful de șantier **nu vede prețuri, la nivel de date** (§10.3, §18.1.1, I6) | Roluri Postgres separate + `REVOKE SELECT (pret_*)` + view-uri per persona. Nu se poate face din UI |
| Subcontractantul A nu vede nimic de la B (§21.8) | RLS pe fiecare tabelă atinsă de portal, cu politici bazate pe apartenență, nu pe filtru în query |
| Închiderea de lună **blochează** modificările (§21.1, faza 0) | Constrângere impusă prin trigger în DB, nu prin verificare în serviciu |
| Costurile se mută cu UL-ul, diferit după starea lunii (§13.1) | Registrul de cost append-only + document de re-alocare; niciodată `UPDATE` pe o lună închisă |
| Dubla analitică „folosit" vs „descărcat" (§12) | Două perechi de coloane pe fiecare linie de cost, de la prima migrare. Retrofit-ul e dureros |
| `data_efect` ≠ `data_document` (§11) | Toate agregările lunare merg pe `data_efect`; indexare pe el, nu pe data documentului |
| Offline obligatoriu în subsoluri și guri de canal (§21.15) | ID-uri generate pe client, outbox idempotent, coadă separată pentru poze |
| Poze cu geotag și timestamp, 700 obiective (§19.1, §26) | EXIF extras server-side la ingest, stocat în DB, nu doar în fișier — EXIF-ul se pierde la recompresie |
| Mutare de folder cu 100.000 fișiere = un `UPDATE` (§19.1) | Arborele stă în Postgres ca listă de adiacență; R2 ține blob-uri cu cheie UUID, fără cale în cheie |
| Rapoarte lunare cu sute de poze (§20.1) | Generare asincronă obligatorie, cu job runner și storage de artefacte |
| Serii și numere de documente per firmă (§21.5) | Alocator gapless cu lock pe rând, nu sequence Postgres |
| 5 firme, intercompany, consolidare (§3) | `firma_id` pe tot ce e scoped, plus marcaj `intercompany` pentru eliminarea la consolidare |
| Audit trail complet (§21.9) | Trigger generic pe tabele, cu autorul luat din GUC-ul de sesiune |
| Cifrele trebuie să se desfacă până la document (I3) | Fiecare linie de cost poartă `document_type` + `document_id` obligatoriu, cu integritate verificată |

**Ce NU e o constrângere, deși pare:** volumul. 40 utilizatori × 700 obiective × 4 ani ≈ câteva milioane de linii de cost în total. Un Postgres corect indexat râde de asta. **Nu partiționăm, nu facem sharding, nu punem cache distribuit.** Punem indecși corecți și rollup-uri, atât.

---

## 2. Topologia sistemului

```
                          ┌───────────────────────────────────────────┐
   BROWSER / MOBIL        │              VERCEL (fra1)                │
   ───────────────        │                                           │
   Birou      (desktop)   │   Next.js 15 App Router                   │
   Teren      (PWA)   ────┼──▶  (office)  RSC + Server Actions        │
   Portal subc            │     (field)   PWA shell + API offline     │
   Portal client          │     (portal)  rute izolate                │
                          │     /api/*    webhooks, presign, integr.  │
                          └──────┬────────────────┬───────────────────┘
                                 │                │
              ┌──────────────────┘                └────────────┐
              ▼                                                ▼
   ┌──────────────────────────┐                   ┌──────────────────────┐
   │  SUPABASE (eu-central-1) │                   │  CLOUDFLARE R2 (EU)  │
   │  ─────────────────────── │                   │  ─────────────────── │
   │  Postgres 15             │                   │  bucket: damina-docs │
   │   · schema app           │◀──── pg-boss ────▶│  bucket: damina-tmp  │
   │   · RLS + roluri         │      (cozi)       │  chei UUID, fără cale│
   │   · rollup-uri, audit    │                   │  presigned multipart │
   │  Auth (GoTrue) + JWT hook│                   └──────────────────────┘
   │  Realtime (notificări)   │                              ▲
   └──────────┬───────────────┘                              │
              │                                              │
              ▼                                              │
   ┌──────────────────────────────────────────────┐          │
   │  WORKER (Railway/Fly, container persistent)  │──────────┘
   │  ──────────────────────────────────────────  │
   │  pg-boss consumer:                           │
   │   · thumbnails + EXIF/geotag                 │
   │   · rapoarte lunare PDF (asincron)           │
   │   · randare PV (ardere peste PDF)            │
   │   · export Saga (1×/zi)                      │
   │   · ingest email → Cereri                    │
   │   · sync SPV / e-Factura                     │
   │   · notificări + alerte de prag              │
   │   · cron: expirări, revizii, praguri Delta   │
   └──────────────────────────────────────────────┘
              │
              ▼
   ┌──────────────────────────────────────────────┐
   │  EXTERN: ANAF SPV/e-Factura · IMAP/inbound   │
   │          email · Saga (fișier) · preț motorină│
   └──────────────────────────────────────────────┘
```

**Trei procese, nu mai multe.** Web (Vercel, serverless), Worker (container persistent), Postgres. Orice serviciu în plus la scara asta e cost de operare fără beneficiu.

---

## 3. Monorepo

### 3.1 Structura

```
damina-erp/
├─ apps/
│  ├─ web/                    # Next.js 15 — toate cele 4 spații de lucru
│  │  ├─ src/app/
│  │  │  ├─ (auth)/           # login, resetare, provizionare cont
│  │  │  ├─ (office)/         # aplicația de birou — desktop
│  │  │  ├─ (field)/          # aplicația de teren — PWA, offline
│  │  │  ├─ (portal)/
│  │  │  │  ├─ subcontractor/
│  │  │  │  └─ client/
│  │  │  ├─ (public)/         # PV semnat prin link tokenizat, fără cont
│  │  │  └─ api/              # webhooks, presign R2, integrări
│  │  ├─ src/actions/         # server actions, grupate pe modul
│  │  └─ public/              # manifest PWA, service worker
│  └─ worker/                 # consumer pg-boss (Node, container)
│
├─ packages/
│  ├─ db/                     # schema Drizzle, migrații, seed, politici RLS
│  ├─ domain/                 # reguli de business pure, fără I/O
│  ├─ services/               # use-case-uri: orchestrare domain + db + jobs
│  ├─ contracts/              # scheme Zod: input/output pe fiecare use-case
│  ├─ auth/                   # sesiune, claims, guard-uri, personas
│  ├─ storage/                # client R2, presign, chei, multipart
│  ├─ jobs/                   # definiții de job + tipuri + client de enqueue
│  ├─ integrations/
│  │  ├─ anaf/                # SPV, e-Factura, e-Transport
│  │  ├─ saga/                # conector unidirecțional
│  │  └─ mail/                # ingest cutie poștală
│  ├─ ui/                     # design system + shell de navigare
│  ├─ i18n/                   # dicționar ro-RO
│  └─ shared/                 # Money, Period, Result, erori, utilitare
│
├─ tools/
│  ├─ eslint-config/
│  └─ tsconfig/
├─ supabase/                  # config local, migrații aplicate, seed
├─ turbo.json
└─ pnpm-workspace.yaml
```

### 3.2 Regula de dependențe

Săgeata înseamnă „poate importa". Nu există săgeți inverse, verificat cu `eslint-plugin-boundaries` în CI.

```
ui ──┐
     ├──▶ contracts ──▶ shared
web ─┤
     ├──▶ services ──▶ domain ──▶ shared
worker┤            └──▶ db ──▶ shared
     └──▶ auth ──▶ db
              integrations ──▶ contracts, shared
```

**`domain` nu importă `db`.** Regulile de business (routing-ul deciziei, calculul de plafon, mecanica de re-alocare, CMP) sunt funcții pure, testabile fără bază de date. Asta e ce face ca §7 și §13.1 să fie testabile în milisecunde, nu în minute.

**`services` e singurul loc care are voie să deschidă tranzacții.** Un use-case = o tranzacție = o unitate atomică. §10.3 („suplimentările intră atomic") și §10.2 din structura funcțională („se creează atomic: UL + alocare + folder + legătură") sunt exact asta.

### 3.3 Turborepo

Task-uri: `build`, `dev`, `lint`, `typecheck`, `test`, `test:db`, `db:generate`, `db:migrate`. Cache remote pe Vercel. Pipeline-ul de CI rulează `typecheck` și `lint` pe tot, `test` doar pe pachetele afectate.

### 3.4 Convenția de limbă

Regula, ca să nu se negocieze la fiecare PR:

- **Structural în engleză:** `id`, `created_at`, `updated_at`, `status`, `firma_id`… → de fapt `company_id`. Coloane tehnice, nume de tabele generice, funcții, tipuri.
- **Domeniu intraductibil în română, fără diacritice:** `deviz`, `deviz_line`, `aviz`, `nir`, `pontaj`, `situatie_lucrari`, `bon_consum`, `proces_verbal`, `delta`, `mentenanta`.
- **UI 100% română cu diacritice**, prin `packages/i18n`. Zero string-uri hardcodate în componente.

Motivul e practic: `work_estimate` nu înseamnă „deviz" pentru nimeni din firmă, iar în 3 luni cineva va traduce greșit în review. `created_at` în schimb e limbaj de infrastructură.

---

## 4. Stratul de date — Postgres / Supabase

Aici se duce jumătate din efortul de infrastructură, și e corect așa. Tot ce e mai jos e faza 0.

### 4.1 Ce folosim din Supabase și ce nu

| Componentă | Folosim? | Motiv |
|---|---|---|
| Postgres | **Da**, e nucleul | — |
| Auth (GoTrue) | **Da** | JWT cu custom claims, provizionare de conturi prin Admin API (§10.3) |
| Realtime | **Da**, limitat | Badge-uri de coadă și clopoțel. Nu pentru date de business |
| Storage | **Nu** | R2, decizie luată (§19.1) |
| Edge Functions | **Nu** | Logica stă în Next.js și în worker; un al treilea runtime e cost de operare |
| `supabase-js` pe server pentru date | **Nu** | Citirile și scrierile merg prin Drizzle, pe conexiune Postgres directă. `supabase-js` doar pentru auth |

**Conexiuni:** Supavisor în mod *transaction pooling* pentru rutele serverless (Vercel), *session pooling* pentru worker (are nevoie de `LISTEN/NOTIFY` și prepared statements). Două connection string-uri distincte, două variabile de mediu.

### 4.2 Convenții de schemă

| Aspect | Decizie |
|---|---|
| Chei primare | `uuid` v7, generat **pe client** unde e nevoie de offline, altfel `uuidv7()` în DB |
| Timp | `timestamptz` peste tot, `Europe/Bucharest` doar la afișare. Datele de business (`data_document`, `data_efect`) sunt `date`, fără oră |
| Bani | `numeric(14,2)`. În aplicație → `Decimal.js` prin tipul `Money` din `shared`. Interzis `float`/`number` |
| Cantități | `numeric(14,4)` — există UM cu 3-4 zecimale (mp, kg, ore) |
| Procente | `numeric(6,4)` (0.0500 = 5%), nu 5.00 — evită ambiguitatea din indexare |
| Enum-uri | Tipuri Postgres native (`create type`), nu `text` + check. Drizzle le mapează la union types |
| Ștergere | Soft-delete (`deleted_at`) pe documente și noduri de fișiere. Hard-delete doar pe drafturi |
| Denumire | `snake_case`, tabele la plural, coloane FK `<entitate>_id` |
| Schema | `app` pentru business, `audit` pentru jurnale, `jobs` pentru pg-boss, `public` gol |

**De ce UUID v7 și nu bigserial:** aplicația de teren creează fișe de intervenție, poze și linii de necesar **fără rețea**. Ele au nevoie de identitate înainte să atingă serverul. v7 păstrează ordinea temporală, deci indexul B-tree nu se fragmentează ca la v4 — costul e zero față de un serial, iar sincronizarea devine trivială (fără remapare de ID-uri la upload).

### 4.3 Roluri Postgres și modelul de acces

Patru roluri de aplicație, plus unul de serviciu. Toate `NOLOGIN` — se intră în ele prin `SET LOCAL ROLE`.

| Rol PG | Persona | Ce vede |
|---|---|---|
| `app_office` | birou (PM, devizist, achiziții, magazie, flotă, financiar) | tot, filtrat pe firmă și pe rol de business |
| `app_field` | șef de șantier, echipă, inspector | fără nicio coloană de preț, doar UL-urile lui |
| `app_subcontractor` | portal subcontractant | doar pachetele, SL-urile, PV-urile lui |
| `app_client` | portal client | tichetele, rapoartele și obiectivele contractului lui |
| `app_service` | worker + integrări | bypass RLS controlat, cu audit obligatoriu |

Conexiunea aplicației se face cu un singur utilizator (`app_runtime`) care are `GRANT` pe toate cele patru roluri. La începutul fiecărei tranzacții:

```sql
SET LOCAL ROLE app_field;
SET LOCAL request.jwt.claims = '{"sub":"...","persona":"field","person_id":"...","company_ids":["..."]}';
SET LOCAL app.actor_id = '...';   -- pentru trigger-ul de audit
```

**De ce nu doar RLS pe un singur rol:** RLS filtrează *rânduri*. Izolarea prețului e o problemă de *coloane*. Doar `REVOKE SELECT (col)` de la un rol o rezolvă la nivel de motor, și doar dacă rolul chiar e schimbat. Combinația celor două e singura care ține.

### 4.4 Izolarea prețului — implementarea concretă

Trei straturi, în ordinea în care apără:

**Stratul 1 — privilegiu pe coloană.** Sursa de adevăr.

```sql
REVOKE SELECT ON app.deviz_lines FROM app_field;
GRANT SELECT (id, deviz_id, code, name, uom, quantity, stage_id, position)
  ON app.deviz_lines TO app_field;
-- unit_price, proposed_price, total, material_cost, labor_cost: NEACORDATE
```

Dacă un developer scrie `select *` din contextul `app_field`, query-ul **eșuează**. Nu returnează null, nu returnează zero — eșuează, zgomotos, în development.

**Stratul 2 — view-uri per persona.** Ce chemi efectiv din cod.

```sql
create view app.v_sl_lines_field as
  select id, sl_id, deviz_line_id, name, uom, quantity_contracted,
         quantity_declared, quantity_approved, verification_status, comment
  from app.sl_lines;   -- security_invoker = on, deci RLS-ul rândurilor se aplică
```

Aplicația de teren nu atinge niciodată tabela de bază. Are propriile view-uri, iar `packages/db` le expune ca scheme Drizzle separate — deci **TypeScript-ul nu cunoaște câmpul `unit_price` în contextul field**. Greșeala devine eroare de compilare, nu incident de securitate.

**Stratul 3 — DTO-uri de ieșire.** Fiecare use-case declară în `contracts` schema Zod a răspunsului, per persona. Serializarea trece prin ea. Un câmp scăpat din strat se oprește aici.

Test obligatoriu în CI (§15): pentru fiecare rol × fiecare tabelă cu preț, un test care încearcă `select` pe coloana interzisă și **se așteaptă la eroare**. Dacă cineva adaugă o coloană `pret_` nouă fără `REVOKE`, testul o prinde — există un test generic care enumeră `information_schema.columns` după prefix.

### 4.5 RLS — politicile de bază

RLS activ (`enable row level security` + `force row level security`) pe **toate** tabelele din `app`. Fără excepții — o tabelă fără politică nu returnează nimic, ceea ce e comportamentul sigur.

Funcții helper `stable`, folosite în toate politicile (evită subquery repetat):

```sql
create function app.current_person_id() returns uuid ...
create function app.current_company_ids() returns uuid[] ...
create function app.current_persona() returns app.persona ...
create function app.has_office_role(app.office_role) returns boolean ...
```

Tiparele de politică, pe categorii de tabele:

| Categorie | Politică |
|---|---|
| Scoped pe firmă (contracte, facturi, gestiuni, serii) | `company_id = any(app.current_company_ids())` |
| Nomenclatoare comune (produse, furnizori, obiective) | citire pentru toate personele interne; scriere doar `app_office` cu rolul potrivit |
| UL și copiii lor | birou: prin firmă; teren: `exists (select 1 from work_unit_assignments where person_id = app.current_person_id())` |
| Pachete și SL-uri | subcontractant: `subcontractor_id = app.current_subcontractor_id()`. Asta e izolarea A-vs-B |
| Noduri de fișiere | prin `node_shares` + moștenire pe arbore, evaluată cu CTE recursiv într-o funcție `stable` |
| Registrul de cost | doar `app_office` cu rol financiar/PM. `app_field` **nu are nicio politică** — deci nu vede nimic |
| Audit | citire doar `app_office` rol administrator; scriere doar din trigger (`security definer`) |

**Politicile se scriu ca migrări versionate, nu din dashboard-ul Supabase.** Fișier dedicat per tabelă în `packages/db/policies/`, aplicat prin migrare. Ce e făcut prin click nu există în code review și nu ajunge identic în staging.

### 4.6 Registrul de cost — tabela centrală

Cea mai importantă decizie tehnică din tot documentul de arhitectură (§11) devine cea mai importantă tabelă.

```sql
create table app.cost_lines (
  id                    uuid primary key,              -- v7
  company_id            uuid not null references app.companies,

  -- CÂND
  document_date         date not null,
  effect_date           date not null,                 -- luna de raportare
  period_id             uuid not null references app.periods,   -- derivat, pentru blocare

  -- UNDE (analitica "folosit")
  used_contract_id      uuid references app.contracts,
  used_component_id     uuid references app.contract_components,
  objective_id          uuid references app.objectives,
  work_unit_id          uuid references app.work_units,
  stage_id              uuid references app.work_stages,

  -- CINE PLĂTEȘTE (analitica "descărcat")
  charged_contract_id   uuid references app.contracts,
  charged_component_id  uuid references app.contract_components,

  -- CE
  expense_type          app.expense_type not null,     -- material|manopera|subc|utilaj|motorina|transport|reparatii|alte
  product_id            uuid references app.products,
  qualification_id      uuid references app.qualifications,

  -- CÂT
  quantity              numeric(14,4),
  uom                   text,
  amount                numeric(14,2) not null,
  stage                 app.cost_stage not null,       -- angajat|receptionat|consumat|facturat

  -- DE UNDE
  document_type         app.cost_document_type not null,
  document_id           uuid not null,
  document_line_id      uuid,
  supplier_id           uuid,
  subcontractor_id      uuid,

  -- REALOCARE
  reallocation_of_id    uuid references app.cost_lines,  -- linia stornată/mutată
  is_reallocation       boolean not null default false,

  created_by            uuid not null,
  created_at            timestamptz not null default now()
);
```

**Reguli impuse în DB, nu în cod:**

1. **Append-only.** `revoke update, delete on app.cost_lines from app_office, app_field, ...`. Singurele `UPDATE`-uri permise sunt cele de re-alocare pe lună deschisă, prin funcție `security definer` care scrie și în audit. Corecțiile se fac prin linii de storno, ca în contabilitate.
2. **Analitica „descărcat" e obligatorie** pentru orice linie cu `stage <> 'angajat'`: `check (charged_contract_id is not null)`. Regula de interfață 6 („câmpurile analitice obligatorii chiar blochează salvarea") are aici perechea ei de DB.
3. **`stage_id` obligatoriu dacă UL-ul e lucrare** — trigger, pentru că depinde de tipul UL-ului (§22.4).
4. **`period_id` derivat automat** din `effect_date` + `company_id`, prin trigger. Nu se completează din aplicație.

**Indecși (proiectați din întrebările de la §11, nu inventați):**

```sql
create index on app.cost_lines (charged_contract_id, charged_component_id, effect_date)
  include (amount, stage);                                    -- ecranul de plafon
create index on app.cost_lines (work_unit_id, expense_type);  -- costul unei UL
create index on app.cost_lines (objective_id, effect_date);   -- istoricul obiectivului
create index on app.cost_lines (document_type, document_id);  -- drill-down invers
create index on app.cost_lines (company_id, stage) where stage = 'angajat';  -- angajat vs consumat
create index on app.cost_lines (used_contract_id)
  where used_contract_id is distinct from charged_contract_id; -- raportul de reconciliere
```

Ultimul e un index parțial și e elegant: raportul „folosit ≠ descărcat" (§12) devine un scan pe un index care conține exact anomaliile, nimic altceva.

### 4.7 Rollup-uri de plafon — cifra de pe ecran trebuie să dea

§8.2: „*Fiecare componentă e clickabilă și duce la lista de UL finanțate din ea… cu totalul care trebuie să dea exact cifra de pe bandă. Dacă nu dă, e bug, și trebuie să se vadă.*"

Asta exclude cache-ul eventual-consistent. Soluția: **tabelă de rollup întreținută prin trigger, în aceeași tranzacție cu linia de cost.**

```sql
create table app.component_period_rollup (
  component_id  uuid not null,
  period_id     uuid not null,
  committed     numeric(14,2) not null default 0,  -- angajat
  received      numeric(14,2) not null default 0,
  consumed      numeric(14,2) not null default 0,
  invoiced      numeric(14,2) not null default 0,
  primary key (component_id, period_id)
);
```

Trigger `after insert or update of stage, amount on cost_lines` care face `insert … on conflict … do update` cu delta. Costul: un `UPSERT` pe o tabelă mică per linie de cost. La volumul lor (câteva sute de linii pe zi), invizibil.

**Verificarea de integritate rulează ca job nocturn:** recalculează rollup-urile din registru și compară. Diferență ≠ 0 → alertă. Așa afli de bug-uri de trigger în ziua în care apar, nu în luna în care le vezi în factură.

Aceeași mecanică pentru: gradul de umplere Delta (venit alocat per lună), cumulatele pe linie de SL (`contractat / executat / aprobat / facturat`), și soldurile de stoc per gestiune × produs × lot.

### 4.8 Închiderea de perioadă — precondiția fazei 0

```sql
create table app.periods (
  id          uuid primary key,
  company_id  uuid not null references app.companies,
  year        smallint not null,
  month       smallint not null,
  status      app.period_status not null default 'open',  -- open|closing|closed
  closed_at   timestamptz,
  closed_by   uuid,
  unique (company_id, year, month)
);
```

Blocarea se impune printr-un **trigger generic**, atașat pe fiecare tabelă care poartă `period_id` sau `effect_date`:

```sql
create function app.guard_closed_period() returns trigger
  language plpgsql as $$
begin
  if app.period_status_of(coalesce(new.period_id, old.period_id)) = 'closed'
     and current_setting('app.allow_closed_period', true) is distinct from 'on' then
    raise exception 'PERIOD_CLOSED: luna % este închisă', ... using errcode = 'P0001';
  end if;
  return new;
end $$;
```

Escape hatch-ul (`app.allow_closed_period`) e setat **doar** de funcția de re-alocare (`security definer`) și de un job de corecție administrativă care scrie obligatoriu în audit cu motiv. E o singură ușă, cu jurnal.

**Fluxul de închidere** (ecranul de la §15.5) e o mașină de stări: `open → closing → closed`. În `closing`, checklist-ul rulează ca set de query-uri de validare; fiecare rând nebifat întoarce lista de obiecte de rezolvat, cu link. Trecerea la `closed` e o tranzacție care: setează statusul, îngheață rapoartele lunii, marchează exporturile Saga confirmate, scrie în audit.

### 4.9 Alocarea de finanțare și mutările

```sql
create table app.funding_allocations (
  id              uuid primary key,
  work_unit_id    uuid not null references app.work_units,
  contract_id     uuid not null,
  component_id    uuid not null,
  period_id       uuid not null,
  allocated_amount numeric(14,2),
  allocated_pct   numeric(6,4),
  status          app.allocation_status not null default 'active',  -- active|superseded
  superseded_by   uuid references app.funding_allocations,
  reason          text not null,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  check (allocated_amount is not null or allocated_pct is not null)
);
```

Istoricizat prin `superseded_by`, niciodată prin `UPDATE`. Constrângere: suma procentelor active pe o UL × perioadă ≤ 1 (trigger, pentru că e agregat).

**Mutarea finanțării** (§13.1, §25) e un use-case cu două ramuri, decise de starea perioadei — și e exact locul unde `domain` demonstrează că merită să fie pur:

```ts
// packages/domain/funding/move-funding.ts — funcție pură, testabilă instant
export function planFundingMove(input: MoveFundingInput): FundingMovePlan {
  return input.period.status === 'closed'
    ? { kind: 'reallocation-document', entries: buildReversalAndReapply(input) }
    : { kind: 'rewrite-charged-analytics', costLineIds: input.costLineIds, target: input.target };
}
```

`services` execută planul într-o tranzacție. Testele de domain acoperă toate cazurile din tabelul §13 fără să atingă Postgres.

### 4.10 Serii și numere de documente

Sequence-urile Postgres lasă goluri la rollback. Documentele fiscale nu au voie să aibă goluri.

```sql
create table app.document_series (
  id uuid primary key,
  company_id uuid not null,
  document_type app.numbered_document_type not null,
  series text not null,
  next_number integer not null,
  unique (company_id, document_type, series)
);

create function app.allocate_document_number(...) returns text
  language plpgsql as $$
  -- SELECT ... FOR UPDATE pe rândul de serie, incrementează, întoarce
$$;
```

Se apelează **în tranzacția care creează documentul**, cât mai târziu posibil, ca să țină lock-ul cât mai puțin. La 100–200 documente/zi, contenția e teoretică.

### 4.11 Audit trail

Un singur trigger generic, atașat pe lista de tabele auditabile:

```sql
create table audit.entries (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,                       -- din current_setting('app.actor_id')
  persona app.persona,
  table_name text not null,
  record_id uuid not null,
  operation app.audit_op not null,     -- insert|update|delete
  changed jsonb not null,              -- doar câmpurile modificate: {col: {old, new}}
  reason text,                         -- din current_setting('app.action_reason')
  request_id text
);
```

`changed` conține **doar diferența**, nu rândul întreg — altfel jurnalul crește de 10× degeaba și nu se poate citi.

Acțiunile care cer motiv scris (regula de interfață 5) îl transmit prin `SET LOCAL app.action_reason`, iar trigger-ul îl preia. Pentru operațiile din lista obligatorie (mutare de finanțare, anulare de document, suprascriere de preț, închidere de lună) există un `check` care refuză `reason is null`.

Retenție: nelimitată pe tabelele financiare, 24 luni pe restul, cu arhivare în R2.

### 4.12 Migrații

`drizzle-kit generate` pentru DDL derivat din schema TypeScript + fișiere SQL scrise de mână pentru ce Drizzle nu exprimă (politici RLS, funcții, triggere, grant-uri, view-uri). Ambele intră în același folder ordonat, aplicate de `drizzle-kit migrate`.

Reguli:
- Migrațiile sunt **imutabile după merge în `main`**. Corecția se face cu o migrare nouă.
- Fiecare migrare care schimbă o tabelă cu preț trebuie să conțină și `GRANT`/`REVOKE`-urile aferente. Un lint în CI verifică asta.
- Migrațiile care rescriu date mari (`alter table … using`) se sparg în pași `expand → migrate → contract`, cu deploy-uri separate. La scara lor rar necesar, dar regula previne blocarea tabelei în producție.

---

## 5. Stratul de acces la date

### 5.1 `withActor` — singura poartă către Postgres

```ts
// packages/db/src/with-actor.ts
export async function withActor<T>(
  actor: Actor,
  fn: (tx: ActorTx) => Promise<T>,
): Promise<T> {
  return pool.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', ${actor.pgRole}, true)`);
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(actor.claims)}, true)`);
    await tx.execute(sql`select set_config('app.actor_id', ${actor.personId}, true)`);
    if (actor.reason) {
      await tx.execute(sql`select set_config('app.action_reason', ${actor.reason}, true)`);
    }
    return fn(tx as ActorTx);
  });
}
```

**Nu există alt mod de a atinge baza de date.** `pool` nu e exportat din pachet. Un lint rule interzice importul de `drizzle` direct în `apps/` și în `services/` — totul trece prin `withActor` sau prin `withServiceActor` (worker, cu audit obligatoriu).

Consecința: **e imposibil să scrii accidental un query fără RLS**. Nu depinde de disciplină, depinde de suprafața de API.

### 5.2 Tipare per persona

`ActorTx` e generic pe persona:

```ts
type ActorTx<P extends Persona = Persona> = PgTransaction<SchemaFor<P>>;
```

`SchemaFor<'field'>` conține view-urile de teren, nu tabelele de bază. Deci `tx.select().from(schema.slLines)` nici nu compilează într-un context field — există doar `schema.slLinesField`, fără coloane de preț. Izolarea devine o proprietate a sistemului de tipuri.

### 5.3 Interogări de raportare

Pentru drill-down-uri și rapoarte cu agregări (registrul de cost pe 6 dimensiuni), Drizzle devine incomod. Regula: **SQL brut, parametrizat, în fișiere `.sql` versionate**, tipat manual cu Zod la ieșire. Sunt ~20 de query-uri de raportare în tot sistemul; merită scrise de mână și citite ca SQL.

---

## 6. Backend — arhitectura aplicativă

### 6.1 Trei straturi, responsabilități clare

| Strat | Ce face | Ce NU face |
|---|---|---|
| `domain` | reguli pure: rutarea deciziei (§7), calculul de plafon și marjă, CMP, indexarea pe an contractual, planul de mutare a finanțării, validările de coerență temporală (§18.1.8) | I/O, tranzacții, cunoașterea Postgres |
| `services` | un use-case = o tranzacție. Citește, cheamă `domain`, scrie, enqueue joburi, emite evenimente | reguli de business (le împrumută din `domain`), randare |
| `apps/web` | server actions subțiri: auth → validare Zod → `services` → `revalidatePath` | logică |

Un use-case arată așa, invariabil:

```ts
// packages/services/src/requests/decide-routing.ts
export const decideRouting = defineUseCase({
  input: DecideRoutingInput,          // Zod, din packages/contracts
  output: DecideRoutingOutput,
  requires: { persona: 'office', role: ['pm', 'admin'] },
  async handler(input, ctx) {
    return withActor(ctx.actor, async (tx) => {
      const request = await requests.byId(tx, input.requestId);
      const ceilings = await contracts.ceilingsFor(tx, request.contractId, input.period);

      const decision = routeRequest({ request, ceilings, choice: input.choice });  // domain, pur

      const workUnit  = await workUnits.create(tx, decision.workUnit);
      const allocation = await funding.allocate(tx, decision.allocations);
      const folder    = await files.createWorkUnitFolder(tx, workUnit);
      await requests.linkDecision(tx, request.id, { workUnit, decision, reason: input.reason });

      await jobs.enqueue(tx, 'notify.routing-decided', { workUnitId: workUnit.id });
      return { workUnitId: workUnit.id };
    });
  },
});
```

Atomicitatea din §10.2 al structurii funcționale („UL + alocare + folder + legătură, atomic") e literal o tranzacție. Jobul de notificare se enqueue **în aceeași tranzacție** — dacă tranzacția face rollback, jobul dispare cu ea. Ăsta e motivul pentru pg-boss în loc de o coadă externă.

### 6.2 Autorizare

`requires` din definiția use-case-ului e verificat de framework înainte de handler. E **al doilea** strat, nu primul — primul e RLS. Rolul lui e să dea erori bune (403 cu mesaj), nu să apere.

Matricea de permisiuni (rol de birou × use-case) stă într-un singur fișier, `packages/auth/src/permissions.ts`, generată ca tabel. Ecranul de la §18 („ecranul spune explicit ce **nu** vede rolul") se randează din același fișier — deci UI-ul de administrare nu poate diverge de realitate.

### 6.3 Erori

Un tip `AppError` cu cod stabil (`PERIOD_CLOSED`, `QUANTITY_EXCEEDS_CONTRACT`, `PRICE_FORBIDDEN`, `AUTHORIZATION_EXPIRED`…), mapat 1:1 pe mesajele din `i18n`. Erorile Postgres cunoscute (`P0001` de la trigger-ul de perioadă, `23505` unique) se traduc în `AppError` într-un singur loc. Utilizatorul vede „Luna august e închisă", nu un stack trace.

### 6.4 Evenimente de domeniu

Un `outbox` simplu în Postgres pentru efectele secundare care nu trebuie să blocheze tranzacția: notificări, recalculări, export Saga, indexare de căutare. Worker-ul îl consumă. Nu introducem un event bus — la 14 tipuri de eveniment, o tabelă cu `processed_at` e suficientă și se depanează cu un `SELECT`.

---

## 7. Next.js — rutare, randare, mutații

### 7.1 Route groups = spații de lucru

```
src/app/
  (office)/layout.tsx        → shell desktop (sidebar + breadcrumb dublu + Legături)
    contracte/[id]/[tab]/page.tsx
    activitate/lucrari/[id]/[tab]/page.tsx
    ...
  (field)/layout.tsx         → shell mobil, service worker, banner de sincronizare
    azi/page.tsx
    inspectie/[id]/page.tsx
    ...
  (portal)/subcontractor/layout.tsx
  (portal)/client/layout.tsx
  (public)/pv/[token]/page.tsx   → semnare fără cont
```

Fiecare layout de grup verifică persona în `middleware` + în layout (dublu, ieftin) și redirecționează. **Nu există o rută care să servească două persone.** Asta e traducerea directă a lui I6 și a lecției din §21.8: decupajul nu s-a putut face din permisiuni.

### 7.2 Pagina fractală (I2)

Un singur template parametrizat, așa cum cere I2:

```tsx
// (office)/[module]/[id]/[[...tab]]/page.tsx
const config = entityRegistry[params.module];   // tabs, header, links, actions
```

`entityRegistry` declară pentru fiecare entitate: lista de tab-uri (cu vizibilitate pe rol), componenta de antet, cele două bare de progres, sursele pentru panoul de Legături și acțiunile rapide contextuale pe status. **Un contract nou = o intrare în registry**, nu un set de pagini noi.

### 7.3 Randare și caching

| Tip de conținut | Strategie |
|---|---|
| Nomenclatoare (produse, operațiuni, calificări) | RSC + `unstable_cache` cu tag pe entitate, invalidat la scriere |
| Ecrane de business (contract, lucrare, stoc) | RSC **fără cache** — `dynamic = 'force-dynamic'`. Cifrele financiare nu au voie să fie stale |
| Liste mari (registrul de cost, 500 poziții de deviz) | Server Component + paginare cursor, `Suspense` cu skeleton |
| Editorul de deviz | Client Component cu stare locală, salvare optimistă + reconciliere |
| Gantt, calendar de flotă | Client Component, date preluate o dată, filtrare pe client |
| Badge-uri de coadă (sidebar) | Server Component în layout + Realtime pentru increment; refetch la 60s ca fallback |

**Regula de cache:** orice ecran care afișează lei e `force-dynamic`. Nicăieri în aplicație nu vrem un plafon vechi de 30 de secunde afișat la o decizie de rutare.

`revalidateTag` pe taguri structurate: `contract:{id}`, `work-unit:{id}`, `period:{companyId}:{yyyy-mm}`. Fiecare use-case declară ce taguri invalidează.

### 7.4 Mutații — Server Actions

Toate mutațiile sunt server actions, într-un wrapper unic:

```ts
export const action = createAction(useCase)  // validare Zod + auth + AppError→mesaj + revalidate
```

Excepții (Route Handlers în `/api`): webhook-uri ANAF, callback-uri de email inbound, presign R2, upload de artefacte din worker, endpoint-ul de sincronizare al aplicației de teren (are nevoie de batching și control fin, nu se pretează la actions), semnarea PV prin token public.

### 7.5 Formulare

`react-hook-form` + `zodResolver`, cu **aceeași schemă Zod** ca use-case-ul. Validarea din browser și cea din server sunt literalmente același obiect — imposibil să divergă.

Regula de interfață 1 („modala nu se închide la click în afară") se implementează o dată, în componenta `Dialog` din `packages/ui`, cu `onInteractOutside: preventDefault` și confirmare pe `isDirty`. Nu e o decizie per ecran.

---

## 8. Autentificare și identitate

### 8.1 Model

Supabase Auth deține credențialele. Aplicația deține identitatea de business:

```
auth.users (Supabase)  ──1:1──▶  app.persons  ──N:M──▶  app.person_roles
                                     │
                                     ├── persona: office | field | subcontractor | client
                                     ├── category: angajat | sef_santier | subcontractant   (§18.1.1)
                                     └── company_access[]
```

### 8.2 Claims în JWT

Un **Custom Access Token Hook** (funcție Postgres apelată de GoTrue la emiterea token-ului) injectează:

```json
{ "persona": "field", "person_id": "...", "office_roles": [], 
  "company_ids": ["..."], "subcontractor_id": null }
```

Astfel RLS-ul citește direct din `request.jwt.claims`, fără un round-trip la fiecare query. Token-ul de acces are TTL 1h; schimbarea de rol se propagă la refresh (max 1h) sau imediat prin revocarea sesiunii — acceptabil, cu o excepție: **retragerea accesului la prețuri revocă sesiunea imediat**, prin Admin API.

### 8.3 Provizionarea de conturi (§10.3)

PM-ul asignează un șef de șantier sau subcontractant care nu are cont → server action → Supabase Admin API `createUser` cu parolă temporară generată → afișată **o singură dată** pe ecranul PM-ului, cu `must_change_password = true`. Fără flux de invitații pe email — pattern validat în prototip, se portează ca atare. Același mecanism pentru clienți (faza 5).

### 8.4 Sesiune în Next.js

`@supabase/ssr` cu cookie-uri `httpOnly`, `secure`, `sameSite=lax`. Middleware refresh. `SUPABASE_SERVICE_ROLE_KEY` **există doar în worker și în rutele `/api` care au nevoie de Admin API** — niciodată în bundle-ul de client, verificat cu un test de build care scanează output-ul.

### 8.5 Link-uri tokenizate fără cont (§19.2)

Pentru semnarea PV-urilor de către subcontractanți și clienți fără login:

```sql
create table app.signing_links (
  id uuid primary key,
  token_hash bytea not null unique,     -- SHA-256 al token-ului; token-ul brut nu se stochează
  pv_id uuid not null,
  signer_role text not null,
  sequence_index smallint not null,     -- pentru semnarea secvențială
  expires_at timestamptz not null,
  opened_at timestamptz,
  used_at timestamptz,
  ip inet,
  user_agent text
);
```

Token de 32 bytes random, în URL, hash-uit în DB. Expiră în 14 zile. Rate limit pe IP. Jurnalul `creat / trimis / deschis / semnat` (§19.2 punctul 6) iese direct din tabela asta.

### 8.6 MFA

TOTP obligatoriu pentru rolurile `administrator` și `financiar`, opțional pentru restul. Faza 0 pentru administrator, faza 5 pentru restul. E în „basicul de securitate", nu în extravagant.

---

## 9. Storage — Cloudflare R2 și file management

### 9.1 Împărțirea responsabilităților (§19.1, validată în prototip)

| Ce | Unde |
|---|---|
| Arborele de foldere, nume, ierarhie, permisiuni, versiuni | **Postgres** (`nodes`, `file_versions`, `node_shares`) |
| Conținutul binar | **R2**, cheie `blobs/{uuid}`, fără cale semantică |
| Miniaturi, variante, PDF-uri randate | **R2**, `derived/{uuid}/{variant}` |

Mutarea unui folder = un `UPDATE parent_id`. Zero operații pe R2, indiferent de câte fișiere conține. Asta e proprietatea care justifică toată separarea.

### 9.2 Schema

```sql
app.nodes           (id, parent_id, company_id, kind, name, work_unit_id, contract_id,
                     objective_id, current_version_id, deleted_at, created_by, created_at)
app.file_versions   (id, node_id, blob_key, size, mime, checksum_sha256,
                     captured_at, geo_lat, geo_lng, geo_accuracy, exif jsonb, created_by, created_at)
app.derived_assets  (id, file_version_id, variant, blob_key, width, height, status)
app.node_shares     (node_id, subject_type, subject_id, permission)
```

Breadcrumbs și subarbori prin CTE recursiv, cu index pe `(parent_id, name) where deleted_at is null` pentru unicitatea numelui în folder și pentru listare rapidă.

**Geotag și timestamp** (§19.1, golul din prototip): extrase din EXIF la ingest, în worker, și scrise pe `file_versions`. Motivul pentru care nu ne bazăm pe fișier: orice recompresie sau upload prin unele browsere pierde EXIF-ul. Pe teren, aplicația trimite **și** coordonatele din `navigator.geolocation` ca metadate separate, cu `geo_source` (`exif` | `device`) — la 700 obiective, dovada că inspecția s-a făcut acolo trebuie să fie robustă.

### 9.3 Upload

**Direct din browser către R2, prin URL-uri presemnate.** Serverul nu vede niciodată byte-ii.

```
1. Client  → POST /api/files/presign  { nodeId, filename, size, mime, checksum }
2. Server  → validează permisiunea pe node, creează file_version în stare `uploading`,
             întoarce uploadId + presigned URLs pe părți (5–10 MB per parte)
3. Client  → PUT direct în R2, parte cu parte, cu retry PER PARTE, concurență 3
4. Client  → POST /api/files/complete { versionId, parts[] }
5. Server  → CompleteMultipartUpload, marchează `ready`, enqueue derive.thumbnails + derive.exif
```

Retry per parte, nu pe tot fișierul — cerință explicită pentru conexiuni proaste de șantier (§19.1). Presigned URL-urile expiră în 15 minute.

**Limite impuse:** 50 MB per poză, 500 MB per video, retenție video configurabilă (§19.1). Verificate la presign (din `size` declarat) și la complete (din `ContentLength` real, altfel limita e o sugestie).

### 9.4 Download

Niciodată URL direct către R2 în interfață. Toate accesele trec prin `/api/files/[versionId]` care: verifică permisiunea prin RLS, apoi emite un presigned GET cu TTL 60 secunde și face redirect 302. Pentru miniaturi (multe, mici), un token semnat cu TTL mai lung, cache-uit în Cloudflare.

### 9.5 Buckets și lifecycle

| Bucket | Conținut | Lifecycle |
|---|---|---|
| `damina-docs` | versiuni de fișiere, PDF-uri finale | fără expirare; versiuni orfane curățate nocturn |
| `damina-derived` | thumbnails, previzualizări | regenerabile; expirare 180 zile de la ultimul acces |
| `damina-tmp` | uploaduri incomplete, artefacte de job | expirare automată 7 zile |
| `damina-archive` | rapoarte înghețate, audit arhivat | Infrequent Access |

R2 nu are costuri de egress — ceea ce face fezabil raportul lunar cu 312 poze fără să te doară factura, spre deosebire de S3.

---

## 10. Joburi și procesare asincronă

### 10.1 pg-boss, pe același Postgres

Motivul principal e **enqueue tranzacțional**: jobul se creează în aceeași tranzacție cu datele. Cu o coadă externă (SQS, Upstash), ai mereu fereastra „job trimis, tranzacție eșuată" sau invers, și ajungi să construiești un outbox oricum.

Schema `jobs`, izolată. Worker-ul rulează ca proces persistent (Railway/Fly), cu `session pooling`.

### 10.2 Cozile

| Coadă | Ce face | Fază |
|---|---|---|
| `files.derive` | thumbnails, EXIF, geotag, checksum | 0 |
| `files.cleanup` | uploaduri abandonate, versiuni orfane | 0 |
| `reports.monthly` | generare raport lunar (PDF/web), sute de poze, asincron | 1 |
| `pv.render` | ardere de valori peste PDF-ul șablon, hash SHA-256 la semnare | 4 |
| `mail.ingest` | citire cutie poștală → Cerere `neprocesată` + atașamente în R2 | 1 |
| `anaf.spv.pull` | descărcare facturi din SPV, matching 3-way / pe cod SL | 3 |
| `anaf.efactura.push` | emitere, urmărire stare, retry | 5 |
| `saga.export` | 1×/zi, un singur sens, coadă cu erori vizibile | 3 |
| `notify.dispatch` | notificări + alerte de prag | 0 |
| `rollup.verify` | recalcul de control al rollup-urilor vs registru | 0 |
| `search.index` | OCR + full-text pe documente | 4 |

### 10.3 Joburi programate (cron)

`pg-boss` are scheduling nativ. Cele necesare din documente:

- zilnic 06:00 — expirări (ITP, RCA, ISCIR, autorizații SSM, loturi, contracte la 6 luni)
- zilnic 06:15 — revizii de utilaje scadente **pe dată și pe ore de contor** (§18.1.7 — o alertă doar pe dată ratează jumătate din cazuri)
- zilnic 07:00 — articole la 80% din cantitatea de deviz (§16); stoc sub minim; rezervări expirate
- zilnic 09:00 — filtrul de 24h: cererile nedecise curg automat la achiziții (§13.2)
- zilnic 22:00 — export Saga
- zilnic 02:00 — `rollup.verify` + curățenie R2
- lunar, ziua 10 și 20, 09:00 — **grad de umplere Delta sub prag** (§24.1: verificarea la închidere e inutilă)

### 10.4 Reguli de operare

- **Idempotență obligatorie.** Fiecare job are `singletonKey` derivat din payload. Un retry nu produce un al doilea PDF.
- **Retry exponențial**, max 5, apoi dead-letter cu alertă în Sentry.
- **Joburile lungi raportează progres** într-o tabelă `job_progress`, ca ecranul de raport lunar să arate „312 din 480 poze", nu un spinner.
- **Worker-ul rulează ca `app_service`**, cu audit forțat: orice scriere din worker trece prin `withServiceActor(jobName, ...)` care setează `app.actor_id` la un ID tehnic identificabil.

---

## 11. Aplicația de teren — offline-first

Partea cu cel mai mare risc de eșec în tot proiectul, pentru că e singura unde constrângerea nu e tehnică, ci de adopție (§24.1: 7 tap-uri → omul dă telefon la magazie).

### 11.1 Arhitectura

PWA în același Next.js, sub `(field)`. Trei componente:

```
┌─ Service Worker (Workbox) ────────────────────────────────┐
│  precache shell + rute; network-first pe date, cache-first│
│  pe assets. Fără logica de business — doar transport      │
└───────────────────────────────────────────────────────────┘
┌─ IndexedDB (Dexie) ───────────────────────────────────────┐
│  snapshot   — felia mea de date (read model, doar cantități)│
│  outbox     — mutații în așteptare, ordonate, idempotente │
│  media      — poze/video în așteptare, cu progres per parte│
└───────────────────────────────────────────────────────────┘
┌─ Sync engine ─────────────────────────────────────────────┐
│  pull:  GET /api/field/sync?since=<cursor>                │
│  push:  POST /api/field/sync  { mutations[] }             │
│  media: canal separat, prioritate mai mică decât datele   │
└───────────────────────────────────────────────────────────┘
```

### 11.2 De ce outbox propriu și nu PowerSync/ElectricSQL

Am evaluat serios. Argumentele pentru custom:

1. Felia de date a terenului e **mică și bine delimitată**: UL-urile mele active, checklist-urile lor, gestiunea echipei mele, utilajele mele, liniile de SL de verificat. Câteva mii de rânduri, nu o replică de bază.
2. **Scrierile sunt oricum custom.** Orice motor de replicare te pune să scrii singur uploader-ul de mutații, pentru că regulile de business (blocarea peste cantitatea contractată, perioada închisă, validările de coerență temporală) trebuie să ruleze pe server. Motorul îți dă doar citirile.
3. **Izolarea prețului** ar cere reguli de sincronizare care exclud coloane — fezabil, dar înseamnă că protecția există în două locuri (RLS + sync rules), care pot diverge.
4. Un vendor în plus, cu costul și modul lui de eșec, pentru ~20 utilizatori.

**Escape hatch documentat:** dacă în faza 2 se dovedește că felia crește necontrolat (de ex. subcontractanții au nevoie de replicare completă), PowerSync se poate adăuga *pentru citiri* fără să schimbe push-ul. Decizia rămâne reversibilă.

### 11.3 Mutații

```ts
type Mutation = {
  id: string;              // UUID v7, generat pe client — cheie de idempotență
  type: 'inspection.save' | 'intervention.save' | 'material.request'
      | 'journal.append' | 'timesheet.save' | 'consumption.save'
      | 'sl.verify-line' | 'equipment.request' | 'equipment.observation';
  payload: unknown;        // validat cu aceeași schemă Zod ca use-case-ul
  baseVersion?: number;    // pentru detectarea conflictelor
  createdAt: string;
  attempts: number;
};
```

Serverul ține `applied_mutations (id, person_id, applied_at, result)`. Un `POST` cu un `id` deja aplicat întoarce rezultatul memorat, fără să reexecute. **Retry-ul e sigur prin construcție**, ceea ce e obligatoriu când conexiunea cade la jumătatea request-ului în subsol.

Ordinea: mutațiile se aplică **în ordinea creării, secvențial per dispozitiv**. Dacă una eșuează cu eroare de business (nu de rețea), se oprește coada și apare ecranul de conflicte — nu se sare peste ea, pentru că mutațiile ulterioare pot depinde de ea.

### 11.4 Conflicte

| Situație | Politică |
|---|---|
| Fișă în draft, editată doar de mine | last-write-wins, fără conflict |
| Fișă validată la birou între timp | server-authoritative → conflict afișat, cu diff, cu opțiunea „duplică ca fișă nouă" |
| Linie de SL verificată de altcineva | server câștigă, notificare |
| Perioadă închisă între creare și sync | eroare `PERIOD_CLOSED` → fișa rămâne, se propune `data_efect` în luna curentă |
| Cantitate peste contractat | blocaj, cu propunerea de suplimentare |

Ecranul de conflicte e obligatoriu și e proiectat, nu improvizat — regula de interfață 11 (nu există ecran fără stare goală) se aplică și aici.

### 11.5 Media

Coadă separată, cu prioritate mai mică decât datele. Poza se comprimă pe dispozitiv (max 2000px, JPEG q80) **după** extragerea geotag-ului, se stochează în IndexedDB, se urcă în fundal, în loturi mici, cu retry per parte. Contorul „⚠ 4 de sincronizat" din ecranul `Azi` numără separat datele și pozele — dacă omul vede „4 de sincronizat" și sunt doar poze, nu intră în panică.

### 11.6 Bugetul de tapuri

Ținta e 3 tapuri (regula 12). Se măsoară: fiecare acțiune frecventă din aplicația de teren are un test Playwright care numără interacțiunile până la salvare și **eșuează la peste 4**. E singurul mod în care o cerință de UX rămâne adevărată după 6 luni de features.

---

## 12. Integrări externe

Toate în `packages/integrations`, fiecare cu aceeași formă: **client HTTP/protocol → mapper → contract intern**. Aplicația nu cunoaște niciodată formatul extern.

### 12.1 ANAF

| Flux | Detalii |
|---|---|
| **SPV — intrare** | OAuth2 cu certificat digital calificat. Token-urile în Supabase Vault, per firmă. Job `anaf.spv.pull` zilnic → descarcă facturi → parsează UBL → matching 3-way pe PO ↔ recepție ↔ factură, sau pe cod SL → coadă de nerecunoscute |
| **e-Factura — ieșire** | Generare UBL 2.1 (CIUS-RO), semnare, upload, urmărire index de încărcare, descărcare răspuns. Stare vizibilă pe factură (§15.1). Retry cu backoff — ANAF pică des, nu e un caz excepțional |
| **e-Transport** | Faza 5, doar dacă volumul de materiale intră în încadrare (de verificat) |

**Regulă de proiectare:** răspunsurile brute de la ANAF se stochează integral în R2, cu referință în DB. Când e-Factura e respinsă pentru un motiv obscur, vrei XML-ul exact, nu interpretarea noastră.

### 12.2 Email — intrarea tichetelor (§7)

Două opțiuni, cu recomandare:

| Opțiune | Verdict |
|---|---|
| **IMAP polling** pe cutia existentă (job la 5 min) | **Recomandat.** Zero schimbări la furnizorul de email, zero DNS, funcționează cu Microsoft 365 / Google Workspace prin OAuth |
| Inbound webhook (Postmark / Cloudflare Email Workers) | Mai curat tehnic, dar cere control pe DNS și o adresă nouă — schimbă obiceiul clientului |

Fiecare mail → `Cerere` în stare `neprocesată`, cu textul, expeditorul și **emailul original (.eml) atașat permanent în R2** — e dovada solicitării clientului. Atașamentele intră ca `file_versions` în folderul cererii. Deduplicare pe `Message-ID`.

**Fără parsare inteligentă** (decizie explicită §7). Singura automatizare: dacă expeditorul e cunoscut, clientul și contractul se precompletează.

### 12.3 Saga — conector unidirecțional

Aplicația **nu vorbește niciodată direct cu Saga**. Scrie într-o coadă de export, în formatul ei:

```sql
app.saga_export_queue (id, company_id, document_type, document_id,
                       payload jsonb, status, error, exported_at, retries)
```

Conectorul (job în worker) traduce și produce fișierul de import în formatul acceptat de versiunea lor de Saga — **de confirmat cu furnizorul înainte de estimare** (§24.2 punctul 1). Cele opt tipuri de documente: NIR · bon de consum · aviz de transfer · aviz de retur · notă de inventar și diferențe · factură furnizor cu analitică · factură emisă · notă de ajustare de preț.

Ecranul de operare (§15.7): coadă, trimise, eșuate cu eroare vizibilă și buton de re-trimitere, plus raportul lunar de reconciliere valoare stoc app vs Saga per gestiune.

**Zero citiri din Saga.** Contractul e literalmente unidirecțional, ceea ce face conectorul de 10× mai simplu.

### 12.4 Preț motorină

Job zilnic care preia prețul extern și îl scrie în `app.fuel_prices (date, price, source)`, cu posibilitatea de suprascriere manuală (`source = 'manual'`, cu autor). Fără el, „costul cu motorina" e o medie inventată (§18.1.6).

---

## 13. Realtime și notificări

### 13.1 Ce merge prin Realtime și ce nu

| Da | Nu |
|---|---|
| Badge-urile de coadă din sidebar | Date de business pe ecran |
| Clopoțelul de notificări | Liste care se rearanjează sub degetul omului |
| Starea unui job lung (raport lunar) | Actualizarea automată a unui deviz în editare |

Motivul: un ecran care se schimbă singur în timp ce omul completează e o sursă de erori, nu o feature. Supabase Realtime pe tabela `notifications`, filtrat prin RLS pe destinatar.

### 13.2 Modelul de notificări

Trei mecanisme distincte (§28), trei tabele:

```sql
app.work_queue_items   -- listă de obiecte care așteaptă acțiunea mea → badge + card
app.notifications      -- eveniment punctual, o dată → clopoțel
app.alerts             -- prag depășit, persistă până se rezolvă → banner + card
```

Confuzia dintre ele e cea mai comună greșeală în ERP-uri. `work_queue_items` se **golește prin acțiune** (dacă nu se poate goli, e statistică, nu badge — §3). `alerts` au `resolved_at` și un `resolver` care le închide când condiția dispare.

Canale: în aplicație (toate), push web (faza 2, pentru teren), email (doar pentru ce e cu adevărat urgent și pentru externi). **Regula anti-zgomot** (§28): nu se trimit notificări către teren pentru lucruri care sunt vederi de birou. Se impune în cod: fiecare tip de notificare declară `audience`, iar `field` e o listă scurtă și explicită.

---

## 14. Observabilitate

| Ce | Cum |
|---|---|
| Erori | Sentry (web + worker), cu `request_id` corelat și `actor_id` |
| Log-uri | `pino` JSON structurat, cu `request_id`, `actor_id`, `use_case`, `duration_ms`. Vercel Logs + Better Stack |
| Trasare | OpenTelemetry pe use-case-uri și query-uri lente (>200ms). Opțional în faza 0, obligatoriu din faza 3 |
| DB | `pg_stat_statements` activ; alertă pe query-uri > 1s; monitorizarea conexiunilor pooler |
| Joburi | dashboard intern din tabelele pg-boss: în coadă, eșuate, durată medie. Alertă pe dead-letter |
| Business | metrici care contează operațional: linii de cost fără analitică completă (trebuie să fie 0), rollup-uri divergente (0), mutații de teren nesincronizate > 24h, documente Saga eșuate |

Ultimul rând e cel care contează. Un ERP nu cade cu 500 — cade tăcut, cu cifre care nu se mai potrivesc. **Metricile de integritate a datelor sunt monitorizare de producție**, nu rapoarte.

---

## 15. Testare

### 15.1 Piramida, adaptată

| Nivel | Unelte | Ce acoperă | Cât |
|---|---|---|---|
| **Domain (pur)** | Vitest | rutarea deciziei, plafoane, marjă pe an contractual, indexare, CMP, planul de mutare, coerență temporală | acoperire ~95%, rulează în secunde |
| **DB / RLS** | Vitest + Testcontainers (Postgres) | politici RLS per rol, `REVOKE` pe coloane de preț, triggerul de perioadă închisă, alocatorul de numere, rollup-uri | **obligatoriu**, blocant în CI |
| **Integrare (use-case)** | Vitest + DB efemeră | tranzacții complete: „decide rutarea" creează UL + alocare + folder + legătură, sau nu creează nimic | pe fiecare use-case cu efecte multiple |
| **E2E per persona** | Playwright | fluxurile din Partea C, câte unul per persona | 7 fluxuri, rulate pe PR |
| **Contract (integrări)** | fixture-uri înregistrate | ANAF UBL, formatul Saga, parsarea email | pe fiecare mapper |

### 15.2 Testele care nu sunt negociabile

Trei categorii care blochează merge-ul:

1. **Izolarea prețului.** Test generat automat: pentru fiecare coloană din `information_schema` cu prefix de preț (`price`, `pret`, `cost`, `amount`, `margin`), pentru fiecare rol non-office, un `select` care trebuie să eșueze. O coloană nouă fără `REVOKE` sparge build-ul.
2. **Perioada închisă.** Pentru fiecare tabelă cu `period_id`, `insert`/`update` într-o lună închisă trebuie să ridice `PERIOD_CLOSED`.
3. **Analitica obligatorie.** Linie de cost fără `charged_contract_id`, linie de necesar fără `stage_id` pe o lucrare, factură nerecunoscută fără analitică completă → toate trebuie respinse de DB.

Astea sunt exact cele trei lucruri despre care ambele documente spun „*altfel rapoartele sunt inutile*". Le protejăm cu teste, nu cu convenții.

### 15.3 Date de test

Un seed determinist care construiește scenariul din documente: 2 firme, 1 contract de mentenanță pe 4 ani cu cele 3 componente, 1 contract individual, 20 obiective, 1 lucrare pe 3 luni de Delta, 1 subcontractant, 1 utilaj cu PV deschis. Toate testele E2E pornesc de acolo. Același seed alimentează mediul de demo.

---

## 16. Medii, CI/CD, hosting

### 16.1 Medii

| Mediu | Web | DB | Storage |
|---|---|---|---|
| `local` | `next dev` | Supabase CLI (Docker) | MinIO (compatibil S3) sau bucket R2 de dev |
| `preview` (per PR) | Vercel Preview | Supabase Branch (efemeră, cu seed) | bucket `damina-preview`, prefix per PR |
| `staging` | Vercel | proiect Supabase separat | bucket propriu |
| `production` | Vercel | proiect Supabase, PITR activ | `damina-docs` |

**Supabase Branching** dă o bază efemeră per PR cu migrațiile aplicate — asta face review-ul de schemă real, nu teoretic.

### 16.2 Pipeline

```
push → lint + typecheck (Turbo, doar afectate)
     → test:unit (domain)
     → test:db (Testcontainers: RLS, perioade, grants)
     → build
     → deploy preview + supabase branch + seed
     → test:e2e (Playwright pe preview)
     → [merge] → migrate staging → deploy staging → smoke
     → [tag] → migrate production → deploy production
```

**Migrațiile rulează înainte de deploy**, ca job separat, cu lock advisory ca să nu ruleze două odată. Rollback-ul de cod nu implică rollback de schemă — de aceea migrațiile sunt aditive (expand/contract).

### 16.3 Secrete

Vercel env vars + Supabase Vault pentru credențialele per firmă (SPV, certificate). Nimic în repo. Rotație documentată pentru: service role key, R2 access key, certificate ANAF (expiră anual — intră în modulul de expirări, §16.3, ca orice altă autorizație).

### 16.4 Alternativa self-hosted

Dacă la un moment dat costul sau controlul devine problemă: totul pe un VPS Hetzner (CX32, ~15 €/lună) cu Coolify — Next.js în container, Postgres self-hosted, worker, Caddy pentru TLS. R2 rămâne. Migrarea e realistă pentru că **nu folosim nimic din Supabase în afară de Postgres standard, GoTrue și Realtime** — toate self-hostabile. Decizia 5 din rezumat există exact ca să păstreze ușa asta deschisă.

La 40 de utilizatori, ambele variante funcționează. Recomand cloud gestionat în fazele 0–3, când efortul trebuie să meargă în produs, și reevaluare la faza 4.

---

## 17. Securitate — nivelul de bază

Ce se face **acum**, în faza 0, pentru că e mai ieftin decât retrofit-ul. Deliberat nu includ WAF, SIEM, pentest sau semnătură calificată — alea vin după ce aplicația funcționează.

| Zonă | Măsură | Fază |
|---|---|---|
| **Acces la date** | RLS pe toate tabelele + `force row level security` + roluri Postgres separate + `REVOKE` pe coloanele de preț | 0 |
| **Poarta unică** | Tot accesul la DB prin `withActor`; imposibil de ocolit prin construcție | 0 |
| **Chei** | `service_role` doar în worker și în rute server dedicate; test de build care scanează bundle-ul de client | 0 |
| **Sesiune** | Cookie `httpOnly`+`secure`+`sameSite`, TTL 1h cu refresh, revocare imediată la schimbare de drepturi pe preț | 0 |
| **Parole** | Politica Supabase (min 12 caractere, verificare HIBP activată), parole temporare `must_change` | 0 |
| **MFA** | TOTP obligatoriu pentru administrator și financiar | 0 |
| **Storage** | Fără URL-uri publice; presigned cu TTL 60s la citire, 15 min la scriere; chei UUID fără cale semantică | 0 |
| **Upload** | Validare MIME reală (magic bytes, nu extensie), limite de mărime impuse la complete, `Content-Disposition: attachment` la download | 0 |
| **Link-uri publice (PV)** | Token 32B random, stocat hash-uit, expirare, single-use pe semnare, rate limit pe IP | 4 |
| **Rate limiting** | Pe login, pe rutele publice de PV, pe `/api/field/sync`. Upstash Redis sau limitare la nivel de Postgres | 0 |
| **Headere** | CSP strict (fără `unsafe-inline`, nonce pe scripturi), HSTS, `X-Content-Type-Options`, `Referrer-Policy` | 0 |
| **Injecție** | Query-uri parametrizate exclusiv (Drizzle + `sql` template); zero concatenare | 0 |
| **Audit** | Trigger generic pe tabelele critice, cu motiv obligatoriu pe acțiunile ireversibile | 0 |
| **Backup** | PITR Supabase (7 zile) + dump zilnic în R2, retenție 90 zile, **test de restaurare lunar** | 0 |
| **Date personale** | Pontaje, calificări, SSM = date de angajat. Retenție documentată, export la cerere, ștergere la nevoie | 1 |
| **Dependențe** | Dependabot + `pnpm audit` blocant pe severitate `high` în CI | 0 |
| **Hash de conținut la semnare** | SHA-256 al PDF-ului randat, stocat lângă rândul de semnătură (§19.2 — golul serios) | 4 |

**Un backup netestat nu e backup.** Restaurarea lunară în staging, cu verificare de integritate (rollup-uri vs registru), e o sarcină de calendar, nu o intenție.

---

## 18. Performanță și scalare

Scara e mică, deci secțiunea e scurtă și onestă.

**Ce contează efectiv:**

1. **Ecranul de contract** (§4.3) se randează dintr-o singură interogare pe `component_period_rollup` + una pe alocări. Nu agregă registrul de cost la fiecare afișare. Ținta: < 200 ms.
2. **Editorul de deviz cu 500 poziții** — virtualizare (`@tanstack/react-virtual`), salvare pe linie cu debounce, nu re-render pe tot tabelul.
3. **Registrul de cost cu drill-down** — paginare cursor pe `(effect_date, id)`, niciodată `OFFSET`.
4. **Raportul lunar cu 312 poze** — asincron, obligatoriu. Cu opțiunea de raport web interactiv cu link, în loc de PDF de 400 MB (§20.1).
5. **Sincronizarea de teren** — felia trebuie să rămână sub ~2 MB comprimat. Se monitorizează; dacă crește, se restrânge fereastra temporală (UL active + ultimele 30 zile).
6. **Conexiuni** — serverless × pooler e capcana clasică. Transaction pooling pe Vercel, `max` mic per instanță, worker pe conexiune persistentă separată.

**Ce NU facem:** cache distribuit, read replicas, partiționare, sharding, microservicii, CQRS cu proiecții separate. Toate sunt răspunsuri la probleme pe care sistemul ăsta nu le va avea. Dacă vreodată le are, rollup-urile din §4.7 sunt deja pasul unu către CQRS și se pot extinde fără rescriere.

---

## 19. Sprint 0 — ordinea concretă de execuție

Ce se construiește înainte de primul ecran de business. Fiecare linie e livrabil verificabil.

| # | Livrabil | Verificare |
|---|---|---|
| 1 | Monorepo, Turborepo, tsconfig strict, ESLint cu boundaries, Prettier | `pnpm typecheck && pnpm lint` verde pe repo gol |
| 2 | Supabase local (Docker) + drizzle-kit + prima migrare (companies, persons, periods) | `pnpm db:migrate` de la zero, reproductibil |
| 3 | Rolurile Postgres + `withActor` + primul set de politici RLS | test: `app_field` nu vede rândurile altei firme |
| 4 | Auth: Supabase Auth + custom claims hook + middleware + `packages/auth` | login pe 4 persone, fiecare aterizează în shell-ul ei |
| 5 | Shell de navigare: sidebar, breadcrumb dublu, tab-uri, panou Legături, selector firmă/perioadă | pagina fractală randează două entități diferite din registry |
| 6 | `packages/shared`: Money, Period, Result, AppError, i18n ro-RO | teste unitare pe Money (rotunjire, agregare) |
| 7 | Registrul de cost + rollup-uri + triggere + indecși | test: 10.000 linii inserate, rollup = suma, ecranul < 200 ms |
| 8 | Închiderea de perioadă + triggerul de blocare | test: insert în lună închisă → `PERIOD_CLOSED` |
| 9 | Audit trail generic + motiv obligatoriu | test: update fără motiv pe acțiune ireversibilă → eroare |
| 10 | Serii de documente, alocator gapless | test de concurență: 100 alocări paralele, zero goluri, zero duplicate |
| 11 | R2: presign multipart, complete, download prin proxy, `nodes` + `file_versions` | upload de 200 MB cu rețea întreruptă, reluat, reușit |
| 12 | pg-boss + worker + prima coadă (`files.derive`) + cron de control | thumbnail + EXIF generat automat după upload |
| 13 | CI complet: lint, typecheck, unit, db (Testcontainers), e2e, preview cu branch Supabase | PR verde end-to-end |
| 14 | Sentry, pino, dashboard de joburi, metrici de integritate | eroare provocată apare în Sentry cu `actor_id` |
| 15 | Backup + procedura de restaurare, testată o dată | restaurare în staging, rollup-uri verificate |

**Estimare realistă: 4–6 săptămâni cu 2 developeri.** Pare mult pentru „infrastructură". Sunt însă exact lucrurile despre care ambele documente spun că, dacă nu sunt corecte din faza 0, se rescrie tot: shell-ul recursiv, cele patru spații, izolarea prețului la nivel de date, dubla analitică, închiderea de perioadă.

---

## 20. Riscuri și puncte de decis

### 20.1 Riscuri tehnice

| Risc | Probabilitate | Impact | Mitigare |
|---|---|---|---|
| Sincronizarea offline se dovedește mai grea decât pare | mare | mare | Prototip de sync în sprint 0 pe **un singur** tip de mutație (fișa de intervenție), testat cu avionul pornit. Dacă nu ține, PowerSync intră pentru citiri |
| Formatul de import Saga nu e cel presupus | mare | mediu | **De confirmat cu furnizorul înainte de faza 3** (§24.2). Conectorul e izolat, deci schimbarea costă zile, nu săptămâni |
| API-urile ANAF sunt instabile / prost documentate | mare | mediu | Retry agresiv, stocarea răspunsurilor brute, coadă cu erori vizibile. Nu blochează niciun flux operațional |
| RLS-ul devine greu de raționat pe măsură ce cresc tabelele | medie | mare | Politici scrise ca migrări, un fișier per tabelă, teste per rol. Funcții helper `stable`, nu subquery-uri copiate |
| Performanța RLS pe join-uri complexe | mică | mediu | `pg_stat_statements` de la început; politicile folosesc funcții `stable` cache-uite per statement |
| Editorul de deviz cu 500 poziții devine lent | medie | mediu | Virtualizare din prima versiune, nu ca optimizare ulterioară |
| Portarea celor 3 prototipuri (execuTrack, FleetOps, PV) durează mai mult decât „se portează" | mare | mediu | Tratate ca **rescriere cu specificație validată**, nu ca migrare de cod. Valoarea portată sunt regulile, nu liniile |

### 20.2 Ce trebuie decis înainte de a scrie cod

1. **Formatul de import acceptat de versiunea lor de Saga** (§24.2.1) — blochează estimarea conectorului, nu și fazele 0–2.
2. **Furnizorul de email și metoda de acces** (IMAP cu OAuth vs webhook) — afectează faza 1.
3. **Certificat digital ANAF: cine îl deține, când expiră, e per firmă sau per grup?** — afectează fazele 3 și 5.
4. **Găzduire: cloud gestionat sau VPS propriu?** — recomandarea mea e cloud pentru fazele 0–3, dar dacă există o preferință fermă de control, se decide acum, nu la faza 4.
5. **Politica de retenție pe video** — afectează costul de storage și limitele impuse la upload din faza 0.

Niciunul nu blochează începerea sprintului 0.

---

## Anexă A — Harta pachet ↔ modul funcțional

| Modul (doc. funcțional) | Pachete implicate | Fază |
|---|---|---|
| Shell de navigare, pagina fractală | `ui`, `web/(office)` | 0 |
| Contracte, componente, plafoane, indexare | `domain/contracts`, `services/contracts`, `db` | 0 |
| Obiective, ContractObiectiv, profile de inspecție | `domain/objectives`, `services/objectives` | 0 |
| Unitatea de lucru, promovare | `domain/work-units`, `services/work-units` | 0 |
| Registrul de cost, dubla analitică, rollup-uri | `db` (triggere), `domain/costing`, `services/costing` | 0 |
| Închiderea de perioadă | `db` (triggere), `services/periods` | 0 |
| File management (arbore + R2) | `storage`, `services/files`, `worker/files.derive` | 0 |
| Utilizatori, roluri, personas | `auth`, `db` (RLS, grants) | 0 |
| Cereri, inbox email, decizie de rutare, backlog | `domain/requests`, `services/requests`, `integrations/mail` | 1 |
| Inspecții, intervenții, checklist-uri | `domain/field-work`, `services/field-work` | 1 |
| Aplicația de teren, offline | `web/(field)`, `services/sync` | 1 |
| Raportul lunar | `services/reports`, `worker/reports.monthly` | 1 |
| Devize, mapare N:M, articole normate | `domain/estimates`, `services/estimates` | 2 |
| Etape, Gantt, jurnal, pontaj | `domain/execution`, `services/execution` | 2 |
| Pachete, SL, suplimentări, garanții | `domain/subcontracting`, `services/subcontracting` | 2 |
| Portal subcontractant | `web/(portal)/subcontractor` | 2 |
| Achiziții, 3 canale, PO, recepții | `domain/procurement`, `services/procurement` | 3 |
| Stoc, gestiuni, loturi, CMP, inventare | `domain/inventory`, `services/inventory` | 3 |
| SPV, matching 3-way | `integrations/anaf`, `worker/anaf.spv.pull` | 3 |
| Conector Saga | `integrations/saga`, `worker/saga.export` | 3 |
| Utilaje, flotă, PV, motorină, reparații | `domain/fleet`, `services/fleet` | 4 |
| Unelte, transporturi, deșeuri | `domain/resources`, `services/resources` | 4 |
| Procese verbale, șabloane, semnătură, hash | `services/pv`, `worker/pv.render` | 4 |
| OCR, căutare full-text | `worker/search.index` | 4 |
| e-Factura, garanții, avansuri, cash-flow | `integrations/anaf`, `domain/finance` | 5 |
| Consolidare intercompany | `domain/consolidation` | 5 |
| Portal client | `web/(portal)/client` | 5 |

## Anexă B — Variabile de mediu

```
# Postgres (Supabase)
DATABASE_URL=                  # transaction pooling — web
DATABASE_URL_SESSION=          # session pooling — worker, migrații
# Supabase Auth
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # NUMAI worker + rute /api dedicate
# Cloudflare R2
R2_ACCOUNT_ID= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY=
R2_BUCKET_DOCS= R2_BUCKET_DERIVED= R2_BUCKET_TMP= R2_BUCKET_ARCHIVE=
# Joburi
PGBOSS_SCHEMA=jobs
# Integrări
ANAF_CLIENT_ID= ANAF_CLIENT_SECRET= ANAF_CERT_REF=
MAIL_IMAP_HOST= MAIL_IMAP_USER= MAIL_OAUTH_REFRESH_TOKEN=
FUEL_PRICE_SOURCE_URL=
# Observabilitate
SENTRY_DSN= LOG_LEVEL=
# Aplicație
APP_URL= APP_TIMEZONE=Europe/Bucharest APP_DEFAULT_LOCALE=ro-RO
```

---

# Anexa C — Schema bazei de date, fazele 0–1

Asta e ce se transcrie în Drizzle înainte de prima migrare. Notația e SQL simplificat: tipurile sunt cele reale, dar am omis `not null` unde e evident din context și `created_at/updated_at/created_by` care există **pe toate** tabelele (vezi convenția de la §4.2).

Tabelele deja definite complet în corpul documentului **nu se repetă aici** — sunt marcate cu `→ §x`. O singură sursă de adevăr per tabelă.

## C.0 Tipuri enumerate

```sql
create schema app;  create schema audit;  create schema jobs;

create type app.persona           as enum ('office','field','subcontractor','client');
create type app.office_role       as enum ('pm','devizist','achizitii','magazie','flota','financiar','admin');
create type app.person_category   as enum ('angajat','sef_santier','subcontractant','client_user');

create type app.contract_type     as enum ('mentenanta_multianual','individual_deviz','individual_taxare_inversa');
create type app.component_type    as enum ('mentenanta','lucrari','delta','individual');
create type app.budget_cadence    as enum ('lunar','anual');

create type app.work_unit_type    as enum ('inspectie','interventie','lucrare');
create type app.work_unit_status  as enum ('draft','planificata','in_executie','suspendata','finalizata','inchisa','anulata');
create type app.executor_type     as enum ('echipa_proprie','subcontractant');

create type app.request_type      as enum ('tichet_client','solicitare','constatare_inspectie','propunere_interna',
                                           'solicitare_utilaj','observatie_utilaj');
create type app.request_source    as enum ('email','manual','fisa_inspectie','utilaj');
create type app.request_status    as enum ('neprocesata','in_evaluare','decisa','in_backlog','respinsa','anulata');
create type app.routing_choice    as enum ('interventie_mentenanta','lucrare_delta','lucrare_delta_multi_luna',
                                           'lucrare_componenta_lucrari','contract_individual_nou','amanata_backlog');

create type app.expense_type      as enum ('material','manopera_proprie','servicii_subc','utilaj',
                                           'motorina','transport','reparatii','alte');
create type app.cost_stage        as enum ('angajat','receptionat','consumat','facturat');
create type app.cost_document_type as enum ('bon_consum','situatie_lucrari','factura_furnizor','fisa_motorina',
                                           'fisa_utilaj','pontaj','fisa_interventie','comanda','nir',
                                           'nota_realocare','ajustare_pret','fisa_reparatie');

create type app.period_status     as enum ('open','closing','closed');
create type app.allocation_status as enum ('active','superseded');

create type app.node_kind         as enum ('folder','file');
create type app.node_role         as enum ('root_company','contract','objective','work_unit','stage','system','user');
create type app.file_state        as enum ('uploading','ready','failed','quarantined');
create type app.share_permission  as enum ('read','write','manage');

create type app.location_type     as enum ('magazie_centrala','consignatie','santier','echipa',
                                           'subcontractant','unelte','utilaje');
create type app.checklist_answer  as enum ('ok','nok','na');
create type app.finding_outcome   as enum ('rezolvat_pe_loc','interventie','propunere');
create type app.geo_source        as enum ('exif','device','manual');
```

---

## C.1 Organizație și identitate (faza 0)

```sql
app.companies (
  id uuid pk,
  name text, cui text unique, reg_com text,
  address jsonb, logo_node_id uuid,
  is_group_member boolean default true,
  efactura_config jsonb,                    -- credențiale în Vault, aici doar referințe
  default_indexation_pct numeric(6,4) default 0.0500,
  default_delta_threshold numeric(14,2) default 2000.00,
  is_active boolean default true
);

app.clients (
  id uuid pk, name text, cui text, address jsonb,
  payment_term_days smallint default 70,
  report_template_id uuid,                  -- șablon de raport lunar per client (§8.2 Setări)
  is_intercompany boolean default false,    -- client = firmă din grup (§3)
  intercompany_company_id uuid references app.companies
);

app.subcontractors (
  id uuid pk, name text, cui text, address jsonb,
  specialties text[],                       -- electric, sanitar, constructii
  warranty_retention_pct numeric(6,4),      -- garanție de bună execuție (§10.2)
  is_active boolean default true
);

app.suppliers (
  id uuid pk, name text, cui text, address jsonb,
  default_lead_time_days smallint, is_active boolean default true
);

app.qualifications (                        -- calificări: instalator, electrician, zidar…
  id uuid pk, code text unique, name text
);

app.rate_cards (                            -- ISTORICIZAT (§9) — nu se face UPDATE
  id uuid pk,
  qualification_id uuid → qualifications,
  valid_from date, valid_to date,           -- null = curent
  hourly_salary numeric(14,2),
  tax_coefficient numeric(6,4),             -- taxe
  unproductivity_coefficient numeric(6,4),
  hourly_cost numeric(14,2) generated always as (...) stored,
  exclude using gist (qualification_id with =, daterange(valid_from, valid_to) with &&)
);

app.persons (
  id uuid pk,
  auth_user_id uuid unique,                 -- auth.users; null până la provizionare (§8.3)
  persona app.persona,
  category app.person_category,
  full_name text, email citext, phone text,
  qualification_id uuid → qualifications,
  subcontractor_id uuid → subcontractors,   -- doar persona='subcontractor'
  client_id uuid → clients,                 -- doar persona='client'
  must_change_password boolean default false,
  is_active boolean default true,
  check ((persona = 'subcontractor') = (subcontractor_id is not null)),
  check ((persona = 'client')        = (client_id is not null))
);

app.person_company_access (person_id, company_id, pk(person_id, company_id));
app.person_office_roles  (person_id, role app.office_role, pk(person_id, role));

app.teams (                                 -- echipă, NU per om (§17)
  id uuid pk, company_id uuid, name text,
  lead_person_id uuid → persons,
  location_id uuid → locations,             -- gestiunea echipei
  is_active boolean default true
);
app.team_members (team_id, person_id, valid_from date, valid_to date);
```

**SSM** (§14.4) — blochează asignarea, nu avertizează:

```sql
app.person_authorizations (
  id uuid pk, person_id uuid, kind text,    -- SSM, lucru la înălțime, foc deschis, ISCIR…
  issued_at date, expires_at date,
  document_node_id uuid → nodes,
  index (person_id, expires_at)
);
```

Trigger pe `work_unit_assignments`: refuză inserarea dacă persoana are o autorizație cerută de tipul lucrării, expirată la `data_start`.

---

## C.2 Perioade, serii, audit (faza 0)

| Tabelă | Definită la |
|---|---|
| `app.periods` | **§4.8** |
| `app.document_series` + `app.allocate_document_number()` | **§4.10** |
| `audit.entries` | **§4.11** |

Adăugat aici:

```sql
app.period_close_checks (                   -- checklist-ul de la §15.5, ca date, nu ca cod
  id uuid pk, period_id uuid, check_key text,
  status text,                              -- pending | ok | blocked
  blocking_count integer, detail jsonb,
  evaluated_at timestamptz
);
```

Fiecare `check_key` are un query de validare înregistrat în cod. Ecranul de închidere randează tabela; butonul „Închide luna" e activ doar dacă niciun rând nu e `blocked`.

---

## C.3 Contracte și plafoane (faza 0)

```sql
app.contracts (
  id uuid pk,
  company_id uuid, client_id uuid,
  code text, reference text,
  type app.contract_type,
  starts_on date, ends_on date,
  total_value numeric(14,2),
  monthly_value numeric(14,2),              -- abonament an 1; anii următori în contract_years
  payment_term_days smallint default 70,
  indexation_pct numeric(6,4) default 0.0500,    -- poate fi 0 (§4.1)
  delta_threshold numeric(14,2) default 2000.00, -- prag mentenanță→Delta
  expiry_alert_months smallint default 6,
  owner_person_id uuid → persons,           -- PM, proprietar de P&L (§4.1)
  overhead_pct numeric(6,4),                -- regie, pentru marja netă (§22.5)
  status text,
  unique (company_id, code)
);

app.contract_years (                        -- indexare ISTORICIZATĂ (§22.6)
  id uuid pk, contract_id uuid,
  year_index smallint,                      -- 1..4
  starts_on date, ends_on date,
  monthly_value numeric(14,2),              -- valoarea indexată a anului
  indexation_applied_pct numeric(6,4),
  unique (contract_id, year_index)
);

app.contract_components (
  id uuid pk, contract_id uuid,
  type app.component_type,
  name text,
  budget_cadence app.budget_cadence,        -- mentenanta=lunar, lucrari=anual, delta=lunar
  is_fill_target boolean default false,     -- true DOAR pe Delta — inversează sensul gauge-ului
  unique (contract_id, type)
);

app.component_ceilings (                    -- cele TREI numere separate (§4.2)
  id uuid pk,
  component_id uuid, period_id uuid,        -- pentru Lucrări: și rândul anual, cu period_id=null
  contract_year_id uuid,                    -- setat când cadence='anual'
  allocated_revenue numeric(14,2),          -- venit alocat
  cost_ceiling numeric(14,2),               -- plafon de cost (mentenanță, lucrări)
  revenue_ceiling numeric(14,2),            -- plafon de VENIT (doar Delta, setat manual)
  set_by uuid, set_at timestamptz,
  unique (component_id, period_id, contract_year_id)
);
```

`app.component_period_rollup` → **§4.7**. Delta se urmărește pe `revenue_ceiling` vs venitul alocat prin `funding_allocations`, nu pe consum — de aceea rollup-ul are coloane separate pentru cele două sensuri:

```sql
alter table app.component_period_rollup
  add column allocated_revenue numeric(14,2) default 0;   -- cât s-a "umplut" din Delta
```

---

## C.4 Obiective (faza 0)

```sql
app.objectives (
  id uuid pk,
  code text, name text, kind text,          -- clădire / stație / rezervor / gură de canal
  address jsonb,
  geo_lat numeric(10,7), geo_lng numeric(10,7),   -- pin pe hartă (§18.1.7)
  area_sqm numeric(14,2),
  root_node_id uuid → nodes,
  is_active boolean default true
);
-- Nomenclator COMUN între firme (§3) — fără company_id.

app.checklists (
  id uuid pk, code text, name text, objective_kind text, version smallint, is_active boolean
);
app.checklist_items (
  id uuid pk, checklist_id uuid, position smallint, text text,
  requires_photo boolean default false, is_critical boolean default false
);

app.inspection_profiles (                   -- profil = set de checklist-uri + frecvențe
  id uuid pk, name text, description text
);
app.inspection_profile_items (
  profile_id uuid, checklist_id uuid, frequency_months smallint, pk(profile_id, checklist_id)
);

app.contract_objectives (                   -- legătura E o entitate (§5)
  id uuid pk,
  contract_id uuid, objective_id uuid,
  valid_from date, valid_to date,
  inspection_profile_id uuid → inspection_profiles,   -- profilul stă AICI, nu pe obiectiv
  exclude using gist (contract_id with =, objective_id with =, daterange(valid_from, valid_to) with &&)
);
```

---

## C.5 Unitatea de lucru și finanțarea (faza 0)

```sql
app.work_units (
  id uuid pk,                               -- UUID v7, poate fi generat pe teren
  code text,                                -- L-233, #1841, I-9022 — din document_series
  type app.work_unit_type,
  company_id uuid, objective_id uuid,
  contract_objective_id uuid,
  status app.work_unit_status,
  responsible_person_id uuid,               -- PM / șef de șantier
  executor_type app.executor_type,
  executor_subcontractor_id uuid,
  starts_on date, ends_on date,
  estimated_value numeric(14,2),
  cost_budget numeric(14,2),
  source_request_id uuid → requests,
  promoted_from_id uuid → work_units,       -- intervenție → lucrare (§6): ID-ul se PĂSTREAZĂ,
                                            -- câmpul e pentru cazul rar de scindare
  root_node_id uuid → nodes,                -- folderul auto-generat
  closed_at timestamptz, closed_by uuid,
  unique (company_id, code)
);
-- Finanțarea NU e aici. E în funding_allocations. (§6)

app.work_unit_assignments (
  id uuid pk, work_unit_id uuid, person_id uuid,
  role text,                                -- sef_santier | inspector | echipa
  valid_from date, valid_to date
);

app.work_stages (                           -- etape, doar pe lucrări (§9)
  id uuid pk, work_unit_id uuid,
  position smallint, name text,
  planned_start date, planned_end date,
  material_budget numeric(14,2), labor_budget numeric(14,2),
  pct_of_work numeric(6,4),
  actual_start date, actual_end date,
  check (planned_end >= planned_start)      -- coerență temporală în model (§18.1.8)
);
```

`app.funding_allocations` → **§4.9**.

```sql
app.reallocation_documents (                -- luna închisă → document, nu rescriere (§13.1)
  id uuid pk, company_id uuid, number text,
  period_id uuid,                           -- luna CURENTĂ, unde se emite
  work_unit_id uuid,
  from_contract_id uuid, from_component_id uuid, from_period_id uuid,
  to_contract_id uuid,   to_component_id uuid,   to_period_id uuid,
  amount numeric(14,2),
  reason text not null,
  created_by uuid
);
```

---

## C.6 Registrul de cost (faza 0)

`app.cost_lines` + indecși → **§4.6**. Adăugat:

```sql
app.overhead_snapshots (                    -- regie recalculată lunar (§22.5)
  contract_id uuid, period_id uuid,
  overhead_pct numeric(6,4), direct_cost numeric(14,2), overhead_amount numeric(14,2),
  pk (contract_id, period_id)
);
```

Marja brută = din `cost_lines`. Marja netă = brută + `overhead_snapshots`. Fiecare ecran declară care dintre ele afișează (regula de interfață 9) — se impune prin tipul de retur al use-case-ului, care conține câmpul `margin_basis: 'gross' | 'net'`.

---

## C.7 File management (faza 0)

`app.nodes`, `app.file_versions`, `app.derived_assets`, `app.node_shares` → **§9.2**. Constrângeri adăugate:

```sql
alter table app.nodes
  add constraint uq_node_name unique nulls not distinct (parent_id, name) where deleted_at is null,
  add column node_role app.node_role,       -- pentru folderele auto-generate (Anexa E)
  add column is_system boolean default false;   -- folderele de sistem nu se șterg/redenumesc

create index on app.nodes (work_unit_id) where deleted_at is null;
create index on app.file_versions (node_id, created_at desc);
create index on app.file_versions (captured_at) where geo_lat is not null;
```

---

## C.8 Cereri, decizie de rutare, backlog (faza 1)

```sql
app.requests (
  id uuid pk,                               -- UUID v7, poate veni din teren
  company_id uuid,
  type app.request_type,
  source app.request_source,
  status app.request_status,
  objective_id uuid, contract_id uuid, contract_objective_id uuid,
  title text, description text,
  source_inspection_finding_id uuid,        -- când vine dintr-un punct NOK
  source_equipment_id uuid,                 -- observație pe utilaj (§18.1.3)
  estimated_value numeric(14,2),            -- din catalogul de operațiuni
  sla_due_at timestamptz,                   -- §21 punctul 14
  created_by uuid
);

app.request_emails (                        -- emailul original = dovada (§7)
  id uuid pk, request_id uuid,
  message_id text unique,                   -- deduplicare
  from_address citext, to_address citext, subject text,
  received_at timestamptz,
  body_text text, body_html text,
  raw_node_id uuid → nodes                  -- .eml integral, în R2
);

app.request_estimate_lines (                -- evaluarea din catalog (§10.2)
  id uuid pk, request_id uuid,
  operation_id uuid → operation_catalog,
  quantity numeric(14,4),
  estimated_labor numeric(14,2), estimated_material numeric(14,2)
);

app.request_decisions (                     -- cea mai importantă decizie din firmă
  id uuid pk, request_id uuid,
  choice app.routing_choice,
  system_proposal app.routing_choice,       -- ce a propus sistemul, ca să vezi cât de des se schimbă
  target_contract_id uuid, target_component_id uuid,
  target_periods date[],                    -- 1..3 luni de Delta
  created_work_unit_id uuid,
  reason text not null,
  decided_by uuid, decided_at timestamptz
);

app.backlog_proposals (                     -- combustibilul pentru umplerea Deltei (§10.3)
  id uuid pk,
  request_id uuid, objective_id uuid, contract_id uuid,
  title text, estimated_value numeric(14,2),
  source_kind text,                         -- inspectie | tichet | amanata
  source_inspection_id uuid,
  status text,                              -- open | promoted | dropped | expired
  promoted_work_unit_id uuid,
  valid_until date,
  index (contract_id, status, estimated_value)
);
```

---

## C.9 Catalog de operațiuni (faza 1)

```sql
app.operation_catalog (                     -- ce transformă pragul de 2.000 lei în cifră (§8.5)
  id uuid pk, code text unique, name text, category text,
  standard_hours numeric(14,4),
  qualification_id uuid,
  estimated_labor numeric(14,2),            -- derivat din rate card curent
  estimated_material numeric(14,2),
  is_active boolean
);
app.operation_catalog_materials (
  operation_id uuid, product_id uuid, quantity numeric(14,4), pk(operation_id, product_id)
);

app.operation_actuals (                     -- mecanismul anti-furt (§8.5, §17) — materializat
  operation_id uuid, team_id uuid, period_id uuid,
  executions integer, avg_real_cost numeric(14,2), avg_estimated_cost numeric(14,2),
  pk (operation_id, team_id, period_id)
);
```

`operation_actuals` se întreține prin același tipar de trigger ca rollup-urile: la validarea unei fișe de intervenție, se actualizează rândul. Ecranul din §17 („Echipa A 401 lei · Echipa B 476 lei ⚠") e un `SELECT` pe tabela asta, nu un raport calculat la cerere.

---

## C.10 Inspecții și intervenții (faza 1)

```sql
app.inspections (                           -- extensie 1:1 pe work_units cu type='inspectie'
  work_unit_id uuid pk → work_units,
  checklist_id uuid, checklist_version smallint,
  performed_on date, performed_by uuid,
  effect_date date,                         -- luna de raportare (§11)
  validated_at timestamptz, validated_by uuid
);

app.inspection_answers (
  id uuid pk, work_unit_id uuid,
  checklist_item_id uuid,
  answer app.checklist_answer,
  note text
);

app.inspection_findings (                   -- fiecare NOK are ieșire OBLIGATORIE (§11.2)
  id uuid pk, work_unit_id uuid, answer_id uuid,
  outcome app.finding_outcome not null,     -- not null = regula impusă în DB
  resolution_note text,                     -- dacă rezolvat_pe_loc
  created_request_id uuid,                  -- dacă intervenție
  backlog_proposal_id uuid,                 -- dacă propunere
  estimated_value numeric(14,2)
);
-- Trigger: nu se poate seta inspections.validated_at cât timp există answer='nok'
-- fără rând corespunzător în inspection_findings.

app.interventions (                         -- extensie 1:1 pe work_units cu type='interventie'
  work_unit_id uuid pk,
  source_request_id uuid,
  performed_on date, effect_date date,
  description text,
  declared_hours numeric(14,4),
  operation_id uuid → operation_catalog,    -- pentru comparația așteptat vs real
  validated_at timestamptz, validated_by uuid
);

app.intervention_materials (
  id uuid pk, work_unit_id uuid, product_id uuid, lot_id uuid,
  quantity numeric(14,4), location_id uuid,
  consumption_note_id uuid                  -- bonul de consum generat
);
app.intervention_hours (
  id uuid pk, work_unit_id uuid, person_id uuid, hours numeric(14,4), work_date date
);
```

---

## C.11 Pontaj (faza 1)

```sql
app.timesheets (
  id uuid pk, person_id uuid, work_date date, company_id uuid,
  status text,                              -- draft | submitted | validated
  validated_by uuid, validated_at timestamptz,
  unique (person_id, work_date)
);
app.timesheet_lines (                       -- ziua se ÎMPARTE pe mai multe UL (§9)
  id uuid pk, timesheet_id uuid,
  work_unit_id uuid, stage_id uuid,
  hours numeric(14,4),
  rate_card_id uuid,                        -- înghețat la validare, din rate card-ul zilei
  hourly_cost numeric(14,2)
);
-- Trigger: sum(hours) per timesheet <= 24 și > 0.

app.subcontractor_attendance (              -- instrument de CONTROL, nu de plată (§9)
  id uuid pk, work_unit_id uuid, subcontractor_id uuid,
  work_date date, headcount smallint, declared_by uuid
);
```

---

## C.12 Gestiuni și consum, minimul fazei 1

Modulul complet de stoc e faza 3 (Anexa D). Faza 1 are nevoie doar de gestiunea de echipă și de bonul de consum:

```sql
app.locations (                             -- gestiune = LOC FIZIC (§17)
  id uuid pk, company_id uuid,
  type app.location_type not null,          -- fără "gestiune de contract" în enum, prin construcție
  name text, code text,
  parent_location_id uuid,
  team_id uuid, work_unit_id uuid, subcontractor_id uuid, supplier_id uuid,
  address jsonb, geo_lat numeric(10,7), geo_lng numeric(10,7),
  is_custody boolean default false,         -- consignație: marfa nu e a ta până la consum
  is_active boolean
);

app.products (
  id uuid pk, code text unique, name text, uom text,
  category text, is_lot_tracked boolean default false,
  min_qty numeric(14,4), max_qty numeric(14,4),
  default_supplier_id uuid, is_active boolean
);

app.stock_balances (                        -- întreținut prin trigger, ca rollup-urile
  location_id uuid, product_id uuid, lot_id uuid,
  qty_physical numeric(14,4) default 0,
  qty_reserved numeric(14,4) default 0,
  avg_cost numeric(14,4),                   -- CMP per gestiune (§17)
  pk (location_id, product_id, lot_id)
);
-- qty_available e coloană calculată la citire: physical - reserved. Nu se stochează.

app.stock_movements (                       -- append-only, sursa adevărului pe stoc
  id uuid pk, company_id uuid, period_id uuid,
  document_type text, document_id uuid, document_line_id uuid,
  from_location_id uuid, to_location_id uuid,
  product_id uuid, lot_id uuid,
  quantity numeric(14,4), unit_cost numeric(14,4),
  effect_date date,
  index (product_id, effect_date), index (document_type, document_id)
);

app.consumption_notes (                     -- bon de consum
  id uuid pk, company_id uuid, series text, number text,
  location_id uuid, work_unit_id uuid, stage_id uuid,
  contract_id uuid, component_id uuid, objective_id uuid,   -- contractul e DIMENSIUNE (§17)
  document_date date, effect_date date, period_id uuid,
  issued_by uuid, status text
);
app.consumption_lines (
  id uuid pk, note_id uuid, product_id uuid, lot_id uuid,
  quantity numeric(14,4), unit_cost numeric(14,4)
);
```

---

## C.13 Raportul lunar (faza 1)

```sql
app.monthly_reports (
  id uuid pk, contract_id uuid, period_id uuid,
  status text,                              -- building | review | approved | frozen | sent
  template_id uuid,
  approved_by uuid, approved_at timestamptz,
  frozen_at timestamptz,
  unique (contract_id, period_id)
);

app.monthly_report_versions (               -- versionat și ÎNGHEȚAT la emitere (§20.1)
  id uuid pk, report_id uuid, version smallint,
  pdf_node_id uuid, web_token text,         -- alternativa la PDF de 400 MB
  included_work_unit_ids uuid[],
  photo_count integer, size_bytes bigint,
  generated_at timestamptz, generated_by uuid,
  unique (report_id, version)
);
```

---

## C.14 Sincronizare offline (faza 1)

```sql
app.applied_mutations (                     -- idempotență (§11.3)
  id uuid pk,                               -- = mutation.id generat pe client
  person_id uuid, device_id text,
  type text, applied_at timestamptz,
  result jsonb, error_code text,
  index (person_id, applied_at desc)
);

app.sync_cursors (
  person_id uuid, device_id text,
  last_pulled_at timestamptz, last_cursor text,
  pk (person_id, device_id)
);
```

Retenție `applied_mutations`: 90 zile. Un dispozitiv care revine după 90 de zile face pull complet, nu incremental — cazul e destul de rar cât să nu merite altceva.

---

## C.15 Notificări (faza 0)

```sql
app.work_queue_items (                      -- se GOLEȘTE prin acțiune (§28)
  id uuid pk, person_id uuid, company_id uuid,
  kind text,                                -- sl_de_aprobat, cerere_neprocesata, pv_deschis…
  entity_type text, entity_id uuid,
  created_at timestamptz, resolved_at timestamptz,
  index (person_id, kind) where resolved_at is null
);

app.notifications (                         -- eveniment punctual, o dată
  id uuid pk, person_id uuid, kind text, title text, body text,
  entity_type text, entity_id uuid,
  action_kind text,                         -- aproba | vezi | amana
  read_at timestamptz, created_at timestamptz
);

app.alerts (                                -- prag depășit, PERSISTĂ până se rezolvă
  id uuid pk, company_id uuid, scope_type text, scope_id uuid,
  kind text,                                -- buget_80, delta_sub_prag, lot_expira, revizie_scadenta…
  severity text, payload jsonb,
  raised_at timestamptz, resolved_at timestamptz,
  unique (scope_type, scope_id, kind) where resolved_at is null
);

app.outbox_events (id uuid pk, type text, payload jsonb, created_at, processed_at, error text);
```

`unique … where resolved_at is null` e important: previne 40 de alerte identice pentru același buget depășit.

---

## C.16 Inventarul migrărilor fazei 0

Ordinea, pentru că unele depind de altele:

```
0001_schemas_and_enums
0002_pg_roles_and_grants          -- app_office/app_field/app_subcontractor/app_client/app_service
0003_organization                 -- companies, clients, subcontractors, suppliers, persons, teams
0004_periods_and_series           -- periods, document_series, allocate_document_number()
0005_audit                        -- audit.entries + trigger generic + funcția de atașare
0006_contracts                    -- contracts, contract_years, components, ceilings
0007_objectives                   -- objectives, checklists, profiles, contract_objectives
0008_work_units                   -- work_units, assignments, stages, funding_allocations
0009_cost_ledger                  -- cost_lines, rollup, triggere, indecși, reallocation_documents
0010_period_guard                 -- guard_closed_period() + atașare pe toate tabelele cu period_id
0011_files                        -- nodes, file_versions, derived_assets, node_shares
0012_notifications                -- work_queue, notifications, alerts, outbox
0013_rls_policies                 -- TOATE politicile, un fișier per tabelă
0014_column_grants                -- REVOKE/GRANT pe coloanele de preț
0015_seed_reference               -- enumerări de referință, roluri, tipuri de checklist
```

`0013` și `0014` sunt ultimele intenționat: se rescriu cel mai des în faza 0 și e mai ușor să le rulezi separat decât să le urmărești împrăștiate.

---

# Anexa D — Harta completă a schemei, pe faze

Nume de tabele + relația-cheie + faza. Fără coloane — pentru orientare și pentru estimare, nu pentru transcriere.

## D.1 Faza 0 — Fundația (~32 tabele)

Detaliate în Anexa C.

```
companies · clients · subcontractors · suppliers · qualifications · rate_cards
persons · person_company_access · person_office_roles · person_authorizations · teams · team_members
periods · period_close_checks · document_series · audit.entries
contracts · contract_years · contract_components · component_ceilings · component_period_rollup
objectives · checklists · checklist_items · inspection_profiles · inspection_profile_items · contract_objectives
work_units · work_unit_assignments · work_stages · funding_allocations · reallocation_documents
cost_lines · overhead_snapshots
nodes · file_versions · derived_assets · node_shares
work_queue_items · notifications · alerts · outbox_events
```

## D.2 Faza 1 — Mentenanța (~22 tabele)

```
requests · request_emails · request_estimate_lines · request_decisions · backlog_proposals
operation_catalog · operation_catalog_materials · operation_actuals
inspections · inspection_answers · inspection_findings
interventions · intervention_materials · intervention_hours
timesheets · timesheet_lines · subcontractor_attendance
locations · products · stock_balances · stock_movements
consumption_notes · consumption_lines
monthly_reports · monthly_report_versions
applied_mutations · sync_cursors
```

## D.3 Faza 2 — Lucrările (~24 tabele)

```
devize                     → work_unit_id, kind: client|intern, versionat DOAR clientul (§8.1)
deviz_versions             → istoricul devizului client
deviz_categories           → categorii → operațiuni → poziții
deviz_lines                → COLOANELE DE PREȚ AICI. Grants restrictive.
deviz_line_mappings        → N:M client ↔ intern, cu coeficient (§8.1)
normed_articles            → biblioteca, activul pe termen lung (§8.2 modul 3)
normed_article_components  → material + manoperă + normă de timp
deviz_templates            → șablon pe tip de obiectiv (modul 1)
deviz_import_batches       → import Excel, cu maparea de coloane (modul 4)

packages                   → pachete subcontractant, din devizul intern (§8.3)
package_lines              → doar manoperă; trigger care REFUZĂ linii de material
package_offers             → ofertă per subcontractant, linie cu linie
situatii_lucrari           → SL lunară per pachet
sl_lines                   → contractat/executat/aprobat/facturat cumulat (§10.2)
sl_line_verifications      → ok|suspect + comentariu, linie cu linie, de la șeful de șantier
sl_supplements             → suplimentări: propus → verificat → decis, atomic la acceptare
sl_client                  → SL către client, derivată prin mapping (doar contract individual)

work_journal_entries       → jurnal de șantier pe etapă
work_journal_media         → poze/video, cu secțiunea fixă Înainte/După
material_requirements      → necesarul defalcat pe etape; stage_id OBLIGATORIU
warranties                 → garanții de bună execuție, ambele sensuri (§12.3)
warranty_releases          → scadențar de eliberare
```

**View-urile de teren din faza 2:** `v_sl_lines_field`, `v_package_lines_field`, `v_material_requirements_field` — fără nicio coloană de preț.

## D.4 Faza 3 — Achiziții și stoc (~26 tabele)

```
purchase_requests          → cele 3 canale, ca stări diferite pe aceeași entitate
purchase_request_lines
warehouse_filter_decisions → filtrul de 24h: acopăr din stoc / din retur / trimit mai departe (§13.2)
rfqs · rfq_lines · rfq_responses          → cerere de ofertă + comparare
purchase_orders            → PO
purchase_order_lines       → distribuție analitică OBLIGATORIE pe linie: contract+componentă+UL+etapă
po_confirmations           → termen confirmat de furnizor
receptions · reception_lines · nirs       → recepție → NIR
performance_declarations   → atașate la NIR, pentru cartea tehnică (§21.16)
supplier_invoices · supplier_invoice_lines
invoice_matches            → 3-way: PO ↔ recepție ↔ factură, sau pe cod SL
price_adjustment_notes     → recalcul CMP ÎNAINTE, nu retroactiv (§20.2)

lots                       → loturi + expirare, FEFO
transfers · transfer_lines → aviz de transfer; între firme = VÂNZARE, nu transfer (§3)
returns · return_lines     → aviz de retur
reservations               → marcate pe gestiune, NU mutate; cu expirare
inventories · inventory_lines · inventory_differences
framework_contracts · framework_prices    → contracte cadru, prețuri negociate, lead-time
lead_time_history          → lead-time REAL, nu declarat (§13.3)

saga_export_queue          → §12.3
saga_reconciliation        → raport lunar stoc app vs Saga, per gestiune
```

## D.5 Faza 4 — Resurse (~24 tabele)

```
equipment                  → registru de active, status, contor ore/km
equipment_categories · equipment_activities   → filtrarea după tip de activitate (§18.1.7)
equipment_accessories      → lista bifabilă în PV
equipment_requests         → tip de Cerere, nu entitate separată → FK spre requests
equipment_plannings        → calendar de flotă; validare de suprapunere PE SERVER
planning_bulk_shifts       → decalare în masă, cu numărul afectat afișat înainte
equipment_handovers        → PV predare-primire: UN document, DOUĂ etape
equipment_handover_items   → accesorii predate / returnate
fuel_logs · fuel_prices    → litri × prețul ZILEI (§18.1.6)
equipment_hour_logs        → ore × tarif orar intern
equipment_repairs          → 4 tipuri: intervenție / revizie / gresare / capitală
repair_invoices            → MAI MULTE facturi pe aceeași reparație (§18.1.7)
equipment_observations     → ticket din teren → reparație, legătură în AMBELE sensuri
equipment_immobilizations  → pe durata lor NU se calculează costuri de exploatare
maintenance_schedules      → scadență pe DATĂ **și** pe ORE de contor
equipment_rentals          → utilaje închiriate, zile × chirie/zi

tools · tool_assignments · tool_repairs       → unelte, istoric per unealtă ȘI per om

transports · transport_stops → o coadă centrală, 5 tipuri, cele automate intră singure
waste_records · waste_weighings               → deșeuri reglementate, bon de cântar, SIATD

pv_templates · pv_template_fields             → câmpuri poziționate PROCENTUAL pe pagină
pv_documents · pv_field_values · pv_signatures → cu content_hash SHA-256 (golul din §19.2)
signing_links              → §8.5
```

## D.6 Faza 5 — Financiar și analitic (~16 tabele)

```
client_invoices · client_invoice_lines
efactura_submissions       → index de încărcare, stare, răspuns brut în R2
advances · advance_settlements     → avansuri, decontate pe SL-uri
cash_flow_projections
receipts · payments
intercompany_transactions · consolidation_eliminations   → marja pe grup (§3)
contract_projections       → proiecție pe 4 ani, cu ipoteze EDITABILE de creștere
forecast_snapshots
delta_fill_kpi             → grad de umplere ca KPI urmărit lunar
sla_definitions · sla_breaches
client_portal_access
search_index               → OCR + full-text, tsvector + GIN
saved_reports · report_runs
```

**Total: ~145 tabele pe 5 faze.** Sună mult; pentru un ERP care acoperă contracte, execuție, achiziții, stoc, flotă și facturare, e o schemă compactă. Compresia vine din cele trei decizii de modelare din documentul de arhitectură: **o singură entitate `Cerere` cu tip**, **o singură UL cu trei tipuri**, **un singur registru de cost**. Fără ele ai fi avut 250.

---

# Anexa E — Organizarea storage-ului

## E.1 Cele două lumi, încă o dată

| Întrebare | Răspuns |
|---|---|
| Unde e structura? | **Postgres**, `app.nodes` |
| Unde e conținutul? | **R2**, cheie UUID opacă |
| Cheia din R2 conține calea? | **Niciodată.** `blobs/9f2c.../` — nimic semantic |
| Cum se mută un folder? | `update nodes set parent_id = ...` — zero operații pe R2 |
| Cum se redenumește? | `update nodes set name = ...` — la fel |
| Ce se întâmplă la mutarea unui folder cu 100.000 fișiere? | Un `UPDATE`, ~1 ms |

Consecința practică: **nu există „reorganizarea storage-ului"**. Reorganizezi date în Postgres. R2 e un sac de blob-uri care nu știe și nu trebuie să știe ce reprezintă.

## E.2 Bucket-uri și prefixe

```
damina-docs/                      # sursa de adevăr, nimic nu se șterge automat
  blobs/{version_uuid}                        toate versiunile de fișiere
  eml/{request_uuid}/{message_id}.eml         emailuri originale (dovada solicitării)
  anaf/{submission_uuid}/{request|response}.xml   răspunsuri brute ANAF, integrale
  saga/{export_uuid}.{ext}                    fișierele trimise la Saga

damina-derived/                   # totul regenerabil; se poate șterge fără pierdere
  thumb/{version_uuid}/{size}.webp            160 · 480 · 1200 px
  preview/{version_uuid}/page-{n}.webp        previzualizare PDF/Office
  ocr/{version_uuid}.json                     text extras (faza 4)

damina-tmp/                       # expirare 7 zile, lifecycle rule
  upload/{version_uuid}/part-{n}              părți multipart incomplete
  job/{job_id}/{artifact}                     artefacte intermediare de job

damina-archive/                   # Infrequent Access
  reports/{report_version_uuid}.pdf           rapoarte lunare ÎNGHEȚATE
  audit/{yyyy-mm}.jsonl.gz                    audit trail arhivat
  backup/{yyyy-mm-dd}/dump.sql.gz             dump zilnic Postgres
```

**De ce patru bucket-uri și nu unul cu prefixe:** lifecycle rules și clase de stocare se setează per bucket în R2. `derived` trebuie să poată fi golit fără frică; `archive` trebuie să fie pe IA; `tmp` trebuie să expire automat. Cu un singur bucket, ștergerea greșită a unui prefix e o pierdere reală.

## E.3 Arborele de foldere — ce se creează automat și când

Structura din §19.1 al documentului funcțional, cu evenimentul care o produce:

```
[Firmă]                                    ← la crearea firmei, node_role='root_company'
└── Contracte
    └── 4700 · Apa Nova                    ← la crearea contractului, node_role='contract'
        ├── Contract și acte adiționale
        ├── Obiective
        │   └── Stație pompare Berceni     ← la legarea obiectivului de contract
        │       ├── Documentație tehnică
        │       └── Poze obiectiv
        └── Activitate
            ├── 2026-08                    ← la prima UL din lună (folder de lună)
            │   ├── I-9022 Inspecție…      ← la crearea UL, node_role='work_unit'
            │   │   ├── Fișă
            │   │   └── Poze
            │   ├── #1841 Intervenție…
            │   │   ├── Fișă · Poze · Bonuri de consum
            │   └── L-233 Hidroizolație…
            │       ├── Deviz
            │       ├── Oferte
            │       ├── Avize
            │       ├── Facturi
            │       ├── PV
            │       ├── Poze
            │       │   ├── Înainte
            │       │   ├── Etapa 1        ← la crearea etapei, node_role='stage'
            │       │   ├── Etapa 2
            │       │   └── După
            │       ├── Video
            │       └── Recepții
            └── 2026-09
```

**Cine creează ce, prin ce eveniment:**

| Eveniment | Noduri create |
|---|---|
| Creare firmă | rădăcina firmei + `Contracte` |
| Creare contract | folder contract + cele 3 subfoldere fixe |
| Legare obiectiv la contract | folder obiectiv + `Documentație tehnică` + `Poze obiectiv` |
| Creare UL (orice tip) | folder de lună dacă lipsește + folder UL + subfolderele specifice tipului |
| Creare etapă pe lucrare | `Poze/Etapa N` |
| **Promovare intervenție → lucrare** | folderul rămâne **același nod**, se adaugă subfolderele de lucrare (`Deviz`, `Etape`, …). Nimic nu se mută, nimic nu se copiază — la fel ca ID-ul UL-ului (§6) |
| Mutare de finanțare | **nimic.** Folderul urmează obiectivul și UL-ul, nu contractul care plătește |

Ultimul rând e important și ușor de greșit: arborele e construit pe analitica **„folosit"**, nu pe „descărcat". Dacă folderul s-ar muta când se mută finanțarea, istoricul obiectivului s-ar rupe — exact ce §13.1 spune că nu are voie să se întâmple.

**Foldere de sistem:** `is_system = true`, `node_role <> 'user'`. Nu se pot șterge, redenumi sau muta din interfață. Utilizatorul poate crea foldere proprii **oriunde**, dar cele generate rămân fixe — altfel structura implicită se erodează în 3 luni și rapoartele care caută „folderul PV al lucrării" nu mai găsesc nimic.

Rezolvarea prin `node_role`, nu prin nume: un `select … where work_unit_id = X and node_role = 'pv_folder'` nu se strică dacă cineva traduce sau schimbă eticheta afișată.

## E.4 Maparea artefact → destinație

| Artefact | Node în arbore? | Bucket | Retenție | Cine scrie |
|---|---|---|---|---|
| Poză de teren (inspecție, intervenție, jurnal) | da, în folderul UL | `docs` | permanent | app teren, prin presign |
| Video de șantier | da | `docs` | **configurabil** (implicit 24 luni) | app teren |
| Thumbnail / previzualizare | nu | `derived` | 180 zile de la ultimul acces | worker `files.derive` |
| Aviz fotografiat la recepție | da, folderul UL + link pe NIR | `docs` | permanent | teren sau magazie |
| Deviz Excel importat | da, `Deviz/` | `docs` | permanent | birou |
| PDF de SL generat | da, `PV/` sau `Situații/` | `docs` | permanent | worker |
| PV semnat (final, ars) | da, `PV/` | `docs` | permanent | worker `pv.render` |
| Șablon de PV (PDF sursă) | da, în `Nomenclatoare/Șabloane` | `docs` | permanent | administrator |
| Raport lunar înghețat | da, folderul contractului | `archive` | permanent, IA | worker `reports.monthly` |
| Email original `.eml` | da, folderul cererii | `docs` | permanent (dovadă) | worker `mail.ingest` |
| Atașament de email | da, folderul cererii | `docs` | permanent | worker `mail.ingest` |
| XML e-Factura / răspuns ANAF | nu (referință în DB) | `docs` | permanent | worker `anaf.*` |
| Fișier de export Saga | nu | `docs` | 24 luni | worker `saga.export` |
| Parte multipart incompletă | nu | `tmp` | 7 zile, automat | client |
| Dump de backup | nu | `archive` | 90 zile | job de backup |

**Regula:** dacă un om trebuie să-l găsească vreodată răsfoind, e nod în arbore. Dacă doar sistemul îl citește, e blob cu referință în DB. Poluarea arborelui cu artefacte tehnice e cel mai rapid mod de a-l face inutilizabil.

## E.5 Ciclul de viață al unui fișier

```
1. presign   → file_versions (state='uploading'), părți în damina-tmp
2. complete  → CompleteMultipartUpload → blob în damina-docs/blobs/{uuid}
                state='ready', checksum verificat
                nodes.current_version_id ← versiunea nouă (append-only, nimic nu se suprascrie)
3. derive    → worker: EXIF/geotag → file_versions, thumbnails → damina-derived
4. citire    → /api/files/{versionId} → RLS → presigned GET 60s → 302
5. ștergere  → nodes.deleted_at = now()   (coș de gunoi; numele redevine liber IMEDIAT)
6. golire coș→ blob-urile rămân 30 de zile, apoi job de curățenie le șterge din R2
```

Pasul 6 e intenționat lent. Ștergerea unui folder cu 3.000 de poze e un `UPDATE` instant în Postgres, dar recuperarea trebuie să fie posibilă o lună — la 40 de utilizatori care învață aplicația, ștergerea greșită se va întâmpla.

## E.6 Permisiuni pe fișiere

Golul din prototip (§19.1: „*există o tabelă `node_shares`, dar neactivată*"). Se activează din faza 0.

Moștenire pe arbore, evaluată cu CTE recursiv într-o funcție `stable`:

```sql
create function app.can_access_node(node_id uuid, permission app.share_permission)
returns boolean language sql stable as $$
  with recursive chain as (
    select id, parent_id, work_unit_id, contract_id, objective_id from app.nodes where id = node_id
    union all
    select n.id, n.parent_id, n.work_unit_id, n.contract_id, n.objective_id
    from app.nodes n join chain c on n.id = c.parent_id
  )
  select exists (
    select 1 from chain c
    left join app.node_shares s on s.node_id = c.id
    where
      -- birou: prin apartenența contractului la firmele mele
      (app.current_persona() = 'office' and c.contract_id in (select ...))
      -- teren: prin asignarea pe UL
      or (app.current_persona() = 'field' and c.work_unit_id in (select work_unit_id from app.work_unit_assignments where person_id = app.current_person_id()))
      -- subcontractant: DOAR prin partajare explicită. Izolarea A-vs-B (§21.8)
      or (s.subject_type = 'subcontractor' and s.subject_id = app.current_subcontractor_id()
          and s.permission >= permission)
  )
$$;
```

Politica RLS pe `nodes` și `file_versions` cheamă funcția. **Subcontractantul nu are niciun acces implicit** — nimic nu i se partajează prin moștenire de la contract sau lucrare. Vede doar ce i s-a dat explicit, prin `node_shares`, la crearea pachetului lui.

## E.7 Ce trebuie să nu uiți la implementare

1. **EXIF-ul se extrage server-side, la ingest.** Recompresia pe telefon îl pierde. Coordonatele din `navigator.geolocation` se trimit ca metadate separate, cu `geo_source` distinct — la 700 obiective, dovada trebuie să reziste.
2. **Checksum-ul se verifică la `complete`.** Un upload de 200 MB pe conexiune de șantier se poate corupe fără să dea eroare.
3. **`Content-Disposition: attachment`** pe download, cu `Content-Type` din DB, nu din request. Altfel un HTML încărcat ca „aviz" devine XSS pe domeniul aplicației.
4. **Validarea MIME prin magic bytes**, nu prin extensie sau prin ce declară browserul.
5. **Limita de mărime se verifică la `complete`**, din `ContentLength`-ul real. Verificată doar la presign, e o sugestie.
6. **Numele redevine disponibil la soft-delete**, nu la golirea coșului — constrângerea de unicitate e parțială: `where deleted_at is null`.
7. **Nicio poză din teren nu se pierde dacă app-ul e închis** — coada de media e în IndexedDB, nu în memorie.

---

**Ce ține tot planul, într-o propoziție:** regulile de care depind cifrele — izolarea prețului, închiderea de perioadă, dubla analitică, atomicitatea deciziilor — sunt puse în Postgres și în forma API-ului, nu în disciplina cui scrie următorul query. Restul e aplicație obișnuită, construită incremental pe fazele deja stabilite.
