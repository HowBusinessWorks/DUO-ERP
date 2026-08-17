# Damina ERP — jurnal de progres

> **Sesiune nouă? Citește întâi „De unde continui" de mai jos.**
>
> **Regulă pentru orice sesiune AI care lucrează la un pas din `Plan/`:**
> - La **început de sesiune**, citește secțiunea pasului tău de mai jos (dacă există) înainte să începi.
> - **După ce termini pasul** (sau o bucată semnificativă din el), adaugă/actualizează intrarea lui.
> - **Ori de câte ori observi ceva relevant** în timpul codării sau testării (o decizie luată, o abatere de la plan, un bug găsit, o presupunere făcută pentru că planul nu specifica) — notează imediat în „Observații", nu la final. Nu aștepta să termini tot pasul.
> - Nu șterge istoricul altor sesiuni. Adaugă, nu suprascrie.
> - Ține fiecare intrare **scurtă și concretă** — fapte, nu narațiune.

---

## De unde continui — predare către sesiunea următoare

*Scris la finalul lui 02c′ (17 august 2026). Citește-l primul; restul fișierului e istoric.*

### Unde s-a ajuns

Pașii **01, 02 și 04 sunt gata**. Pasul **03 e complet ca implementare**, dar are 4 verificări
nerulate. Următorul pas de conținut neînceput e **05 — Unitate de Lucru, finanțare**.

### Primul lucru de făcut, înainte de orice cod

1. `git fetch && git status && git log HEAD..origin/<branch> --oneline` — regula din `CLAUDE.md`,
   care se aplică oricărei modificări de cod, oricât de mică.
2. Verifică tabelul **„Stare care NU trăiește în repo”** de mai sus. Acolo scrie ce e adevărat
   despre mediu și nu se poate afla citind codul: hook-ul activat manual în Supabase, conturile de
   test, porturi ocupate, pragul de teste. **Verifică-l înainte să tragi concluzia că ceva e
   stricat.**

### Datorii deschise, în ordinea în care le-aș lua

| # | Ce | De ce contează |
|---|---|---|
| 1 | **Rotește `SUPABASE_SERVICE_ROLE_KEY`** (Project Settings → API) | A trecut printr-o fereastră de chat pe 17 august. După 02c′ singurul cod care o folosește e `resetMfaFactors` din `apps/web/src/app/api/admin/service.ts`, deci rotația e ieftină acum. |
| 2 | **Playwright** | Neinstalat. Blochează #13 din pasul 03 și clicul pe hartă din 04b (#14). Vezi mai jos ce am aflat despre testarea fără el. |
| 3 | **#8 din pasul 03** — Realtime se autentifică drept `authenticated`, rol fără niciun grant | Decizie deschisă: ori `grant select` pe `work_queue_items`/`notifications` către `authenticated` cu politici proprii, ori se păstrează fallback-ul de 60 s și **se rescrie verificarea** ca să spună adevărul. |
| 4 | **#10 și #14 din pasul 03** | #10: create/edit produs + audit pe date reale — atenție, `audit.entries.table_name` e `app.products`, **cu prefix de schemă**. #14: Lighthouse. |
| 5 | **`pnpm db:generate` e blocat** din 02c | `drizzle-kit` refuză cu „snapshots are pointing to a parent snapshot … collision”. Migrările `0013`–`0015` sunt scrise de mână. Ca să reînvie, cineva trebuie să refacă lanțul `id`/`prevId` din `migrations/meta/`. Până atunci: **scrii migrarea de mână**, adaugi intrarea în `_journal.json` și un `NNNN_snapshot.json` care conține chiar schema nouă (nu o copie oarbă). |

### Lucruri pe care le-am aflat greu și te scutesc de o zi

- **Testele de bază de date rulează DOAR în CI.** Mașina n-are Docker. Consecința practică: scrii
  testul, dai push, și afli abia acolo. La 02c′ un test de guard a picat în CI deși guard-ul
  funcționa — pentru că `DrizzleQueryError` are ca mesaj doar „Failed query: …”. Folosește
  `pgMessage(error)` din `tests/helpers.ts` (există în `packages/db` și, din 02c′, și în
  `packages/services`), sau `sqlstate(error)`. **Nu potrivi pe `String(error)`.**
- **Formularele pe `useActionState` au progressive enhancement** (React 19 emite `$ACTION_REF_1`,
  `$ACTION_1:0`, `$ACTION_KEY` ca input-uri ascunse în HTML-ul randat pe server). Poți deci apela un
  server action prin HTTP, fără browser: citești input-urile ascunse din `<form>`, le pui într-un
  `FormData` împreună cu câmpurile reale și faci POST pe URL-ul paginii. Așa a fost testată limita
  de login la 02c′. **E cea mai bună unealtă până apare Playwright.**
- **Sesiunea se poate fabrica dintr-un script**: `POST /auth/v1/token?grant_type=password` la
  Supabase, apoi cookie-ul `sb-<ref>-auth-token` = `base64-` + JSON-ul răspunsului, tăiat în bucăți
  de 3180 de caractere dacă e lung. Cu el poți lovi orice rută ca orice persona.
- **`getUser()` ≠ `getSession()` ≠ `mfa.listFactors()`.** Primul întreabă serverul Auth; celelalte
  două citesc din cookie. Cookie-ul se scrie la login și nu se rescrie când se schimbă ceva la
  utilizator — de aici un bug real la 02c′. **Unde iei o decizie, întreabă serverul.**
- **`@damina/auth` NU se importă din middleware.** Bariera reexportă `@damina/db`, deci driverul de
  Postgres, deci `node:fs`, care nu există pe Edge. Middleware-ul importă din **`@damina/auth/edge`**.
  Dacă vezi „Reading from node:fs is not handled by plugins”, asta e.
- **Rutele `/api` nu primesc redirect din middleware** pentru poarta de al doilea factor, dinadins:
  un `fetch` urmează redirect-ul și încearcă să citească JSON dintr-o pagină HTML. Orice rută `/api`
  nouă care are nevoie de drepturi își cheamă singură `can()` și `requireMfa()`.
- **Admin API-ul GoTrue nu poate deconecta pe cineva după id.** Dacă vreun pas viitor cere asta,
  răspunsul e `app.revoke_sessions()` din migrarea `0015`, nu Admin API.

### Reguli ale casei care nu se negociază

- **Un modul nou = o intrare în `entityRegistry`**, nu fișiere de pagină. Lista și detaliul sunt
  două pagini fractale pentru tot ERP-ul. Vezi `docs/entity-registry.md`.
- **RLS e primul strat, guard-urile din `packages/auth` al doilea.** Guard-urile dau erori bune
  (403 cu mesaj în română), nu apără. Adevărul despre ce rânduri și ce coloane ies din bază e în
  politici și în grant-urile pe coloană.
- **Nimic din dashboard.** Politici, grant-uri, coloane — totul în migrări versionate. Singura
  excepție cunoscută e activarea hook-ului de token, care nu se poate versiona; de-aia e scrisă în
  tabelul de mai sus.
- **Codurile `AppError` sunt exact acestea:** `PERIOD_CLOSED`, `PRICE_FORBIDDEN`,
  `AUTHORIZATION_EXPIRED`, `QUANTITY_EXCEEDS_CONTRACT`, `VALIDATION_FAILED`, `NOT_FOUND`,
  `FORBIDDEN`, `CONFLICT`. Nu inventa altele — nu există `INTERNAL` sau `CONFIG_MISSING`.
- **Comentariile din cod se scriu fără diacritice; textul de pe ecran, cu diacritice.**
- **Există un agent de design** și utilizatorul a cerut explicit să fie folosit pentru ecrane.
- Înainte de commit: `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm scan:secrets`.
  Ultimul cere un build proaspăt, iar build-ul cade dacă un `next dev` ține `.next` ocupat — oprește
  serverele de dezvoltare înainte.

---

## Stare curentă

| Pas | Status | Ultima actualizare |
|---|---|---|
| 01 — Fundația | 🟩 gata (15/15, CI verde) | 2026-08-15 |
| 02 — Identitate, acces, RLS | 🟩 **gata** (19/19 verificări; 02a–02d + 02c′) | 2026-08-17 |
| 03 — Shell UI, nomenclatoare | 🟨 în lucru (cod complet, 4 verificări de rulat: #8, #10, #13, #14) | 2026-08-15 |
| 04 — Contracte, obiective | 🟩 gata, cu o excepție (clicul pe hartă, #14, neconfirmat în browser) | 2026-08-16 |
| 05 — Unitate de Lucru, finanțare | ⬜ neînceput | — |
| 06 — Registrul de cost, închidere | ⬜ neînceput | — |
| 07 — File management (R2) | ⬜ neînceput | — |
| 08 — Cereri, rutare, backlog | ⬜ neînceput | — |
| 09 — Fișe de lucru | ⬜ neînceput | — |
| 10 — Teren offline, raport lunar | ⬜ neînceput | — |

Legendă: ⬜ neînceput · 🟨 în lucru · 🟩 gata (toate verificările din pas trec) · 🟥 blocat

**Actualizează tabelul de mai sus de fiecare dată** când schimbi statusul unui pas.

---

## Stare care NU trăiește în repo

Lucruri adevărate despre mediul în care rulează proiectul, dar pe care nu le poate afla nimeni
citind codul. Se pierd la fiecare schimbare de sesiune dacă nu sunt scrise aici. **Verifică-le
înainte să tragi concluzia că ceva e stricat.**

| Fapt | Detaliu |
|---|---|
| **Hook-ul de token e activat** în proiectul Supabase `cspjtesltraiaveypuya` | Authentication → Hooks → *Customize Access Token (JWT) Claims* → `app.custom_access_token_hook`. **Nu e versionat.** Un proiect Supabase nou pornește fără el, iar login-ul pică atunci cu „hook neactivat” — mesaj deliberat distinct de „contul nu e configurat”. |
| `.env.local` (rădăcină, gitignored) are `SUPABASE_SERVICE_ROLE_KEY` și `SEED_USER_PASSWORD` | Fără prima, `pnpm db:seed:users` nu pornește. A doua ține parola conturilor de test stabilă între rulări. Ambele lipsesc pe o mașină nouă. |
| Cheia de service a trecut printr-o fereastră de chat pe 17 august 2026 | **De rotit** din Project Settings → API. |
| `pnpm db:generate` **nu mai rulează** din 02c | `drizzle-kit` refuză: „0012, 0013, 0014 snapshots are pointing to a parent snapshot … which is a collision”. Migrările `0013`–`0015` sunt scrise de mână, iar snapshot-urile lor sunt copii. Din 02c′, `0015_snapshot.json` conține totuși coloana nouă, deci nu minte despre schemă. Ca să reînvie `db:generate`, cineva trebuie să refacă lanțul de `id`/`prevId` din `meta/`. |
| Andrei nu mai are factor TOTP | L-am inrolat ca să testez #16 și l-am șters la final — cheia era la mine, iar lăsat acolo l-ar fi blocat în afara contului. **La următorul login va fi pus să configureze verificarea în doi pași**, ceea ce e chiar comportamentul cerut de #16. |
| Conturile de test | `andrei.ionescu@damina.test` (birou, pm+admin, 2 firme) · `marius.sef@damina.test` (teren, o singură firmă) · `contact@instalprest.test` (subcontractant) · `dispecerat@apanova.test` (client). Se recreează cu `pnpm db:seed && pnpm db:seed:users`. |
| Portul 3000 poate avea un server pornit dinaintea lui 02c | Rulează cod vechi: `/login` dă **404** pe el, ceea ce arată exact ca o rută lipsă. Dacă apare, pornește pe alt port sau oprește-l. |
| Prag de teste: **242** | 110 unitare (`shared` 39 · `domain` 29 · **`auth` 33** · `storage` 6 · `i18n` 3) + 91 `packages/db` + 41 `packages/services`. Baza de 225 e confirmată în CI `32009107114`, pe `d0d5d39`; 02c′ adaugă 14 unitare (rulate local) și 3 de bază de date (**nerulate local**, mașina n-are Docker). Testele de bază de date rulează **doar în CI** — mașina de dezvoltare n-are Docker. Dacă numărul scade fără explicație, s-a pierdut ceva. |
| Docker nu există pe mașina de dezvoltare | Testele de bază de date rulează **doar în CI**. Verificările pe date reale se fac pe Supabase dev, în blocuri anulate la final. |

---

## Pasul 01 — Fundația

### 2026-08-14 — [status: în lucru]

**Ce s-a executat:**
- Monorepo pnpm + Turborepo **în rădăcina repo-ului**, lângă documente (nu în subfolder `damina-erp/`).
- `tools/tsconfig` (strict, `noUncheckedIndexedAccess`) și `tools/eslint-config` (flat config, ESLint 9).
- `packages/shared`: `Money`, `Quantity`, `Period`, `Result`, `AppError` (8 coduri), `uuidv7`, `Persona`. Plus `@damina/shared/logger` (pino), pe export separat ca să nu ajungă în bundle-ul de client. **39 de teste unitare, toate trec.**
- `packages/db`: schema Drizzle, 4 migrări, `withActor()` / `withServiceActor()`, `jobs-runtime.ts`. Scripturi: `db:migrate` (cu advisory lock), `db:reset` (blocat de `ALLOW_DB_RESET`), `db:set-runtime-password`.
- `packages/storage`: client R2, multipart cu retry per parte, presign, chei UUID opace. Script `smoke:r2` pentru verificarea #10.
- `packages/jobs`: `defineJob`, coada `system.ping`, **enqueue tranzacțional**.
- `packages/{domain,services,contracts,auth,ui,i18n}`: schelete cu limitele deja impuse. `services` are `checkHealth()`.
- `apps/web`: Next.js 15, 5 route-groups, `/api/health`. `apps/worker`: pg-boss, heartbeat la 30s.
- CI GitHub Actions (4 joburi) + Dependabot. `.env.example` complet și comentat. README. `Plan/QUESTIONS.md`.

**Migrări scrise** (numerotarea e a lui drizzle, decalată cu unu față de Anexa C.16 — vezi Î3 din QUESTIONS.md):
- `0000_schemas_and_enums` — schemele `app`/`audit`/`jobs` + **toate cele 26 de enum-uri** din Anexa C.0
- `0001_pg_roles_and_grants` — cele 5 roluri persona (NOLOGIN) + `app_runtime` (LOGIN NOINHERIT, fără parolă)
- `0002_bootstrap_tables` — `app.companies` + grant-uri minime
- `0003_jobs_runtime_tables` — `jobs.ping_log`, `jobs.worker_heartbeat`, `jobs.grant_queue_access()`

**Verificări din pas care trec / nu trec:**
- [x] #1 `pnpm install && pnpm typecheck && pnpm lint` — verde, 12/12 pachete
- [x] #2 `pnpm db:reset` — baza se reconstruiește de la zero; `jobs.ping_log` a revenit la 0 rânduri, deci ștergerea a fost reală
- [x] #3 schemele `app`/`audit`/`jobs` există, `public` are 0 tabele — confirmat pe Supabase
- [x] #4 toate cele **26 de enumerări** din Anexa C.0 — confirmat pe Supabase
- [x] #5 cele 6 roluri există, `app_runtime` e NOINHERIT — confirmat pe Supabase
- [~] #6 `withActor` → `app_field` + `actor_id` — test scris; rulează în CI (Testcontainers)
- [x] #7 `Money`: `0.1 + 0.2` → exact `0.30`
- [x] #8 `Money.allocate(100, [1,1,1])` → `[33.34, 33.33, 33.33]`, suma exact 100
- [x] #9 `/api/health` → `{db: ok, r2: ok, worker: ok}`, HTTP 200
- [x] #10 upload multipart 20 MB + `presignGet` + SHA-256 — **trece pe R2 real**, cheia `erp-test/tmp/smoke/{uuid}`
- [x] #11 `enqueue('system.ping')` → rând în `jobs.ping_log` în < 1s
- [x] #12 enqueue în tranzacție cu rollback → jobul **nu** s-a executat
- [x] #13 `pnpm build` + scan de secrete — build verde (7 rute), scanner verificat și pozitiv, și negativ
- [x] #14 `/`, `/office`, `/field` randează layout-uri distincte — confirmate în output-ul de build
- [ ] #15 CI verde end-to-end — **necesită push pe GitHub**
- [x] **Test negativ:** import de `drizzle-orm` în `apps/web` sparge lintul. Confirmat și că `boundaries` prinde importurile *între pachete* (`app-web` → `domain` respins). Fișierul de test a fost șters.

**Observații / decizii luate / abateri de la plan:**
- **Sentry: tăiat.** Decizia utilizatorului. Rămân pino + `/api/health`. Vezi QUESTIONS.md.
- **Zero Docker local.** Decizia utilizatorului: dezvoltare direct pe Supabase cloud (un proiect de dev) și R2 real, nu Supabase CLI + MinIO ca în §16.1. Consecință: `test:db` rulează **doar în CI**.
- **Regula de lint pentru drizzle e în două trepte**, ca în textul planului: driverul (`drizzle-orm/node-postgres`, `pg`) e interzis peste tot în afară de `packages/db`; în `apps/*` e interzis **tot** drizzle. `packages/jobs` folosește `sql` din drizzle ca să compună enqueue-ul peste tranzacția primită.
- **`eslint-plugin-boundaries` are nevoie de `eslint-import-resolver-typescript`** ca să vadă importurile `@damina/*`. Fără el verifica doar importurile relative — adică nimic din ce contează.
- **Importurile relative sunt fără extensia `.js`.** Cu extensii, webpack-ul lui Next nu rezolvă sursa TypeScript din pachetele workspace.
- `pnpm` blochează deja importurile nepermise la typecheck (pachetul nu e în `node_modules`-ul consumatorului). Boundaries e a doua plasă, pentru cazul în care cineva adaugă dependența în `package.json`.
- `app.companies` **nu are RLS** încă — intenționat, vine în pasul 02 (`0013_rls_policies`). Nu se pun date reale până atunci.
- Enqueue-ul reproduce SQL-ul intern al pg-boss 10.x. Cuplaj asumat, acoperit de `test:db`.

**Ce rămâne pentru sesiunea următoare:**
1. Utilizatorul completează `.env.local`: connection string-urile Supabase (transaction + session pooling), `APP_RUNTIME_PASSWORD`, cheile și numele bucket-urilor R2.
2. `pnpm db:migrate` → apoi verificările #2, #9, #10, #11, #12 local.
3. Push pe GitHub → verificările #3-#6 și #15 (CI cu Testcontainers).
4. Abia după ce toate 15 trec, statusul devine 🟩 și se poate începe pasul 02.

---

### 2026-08-15 — [status: în lucru]

**Ce s-a executat:**
- `.env.local` creat (gitignored). `APP_RUNTIME_PASSWORD` generat local, 24 de octeți random.
- **Proiect Supabase: `DUO-ERP` / `cspjtesltraiaveypuya`**, org Damina, eu-west-1, **Postgres 17.6**. Verificat prin MCP că e complet gol: zero tabele, zero roluri `app_*`, nicio schemă neașteptată. `NEXT_PUBLIC_SUPABASE_URL` și cheia publishable completate din MCP.
- **R2 provizoriu:** un singur bucket, `greekleads-financials`, partajat cu altă aplicație. Tot ce scriem stă sub prefixul `erp-test/`. Cele patru variabile `R2_BUCKET_*` pointează la același bucket.
- `packages/storage/scripts/ensure-buckets.ts` — creează bucket-urile lipsă + lifecycle (tmp 7 zile, derived 180 zile). Nu s-a putut folosi acum: tokenul R2 disponibil e limitat la un singur bucket (403 la orice `CreateBucket`). Rămâne pentru pasul 07.
- **Verificarea #10 trece pe R2 real.**

**Bug găsit și reparat:** `R2_KEY_PREFIX` era citit înainte ca `.env.local` să fie încărcat, pentru că încărcarea era leneșă, în clientul S3 — iar cheile se generează *înainte* de a atinge clientul. Rezultat: primul smoke test a scris `tmp/smoke/...` în loc de `erp-test/tmp/smoke/...`, adică în afara prefixului (fișierul a fost șters de script în `finally`). Încărcarea mediului a fost extrasă în `packages/storage/src/env.ts`, folosit acum de `keys.ts` și `client.ts` deopotrivă. **6 teste noi** blochează regresia.

**Observații:**
- Postgres e **17.6**, nu 15 ca în PLAN_TEHNIC. Nimic din ce folosim nu se schimbă.
- Proiectul din `new-erp/file-management/.env.local` (`zrdcqbgqjvuiaqjgnduc`) **nu** e al DUO-ERP. Connection string-urile lui au fost șterse din `.env.local` ca să nu migreze nimeni acolo din greșeală.
- Migrațiile **nu** se aplică prin MCP: drizzle ține jurnalul în `drizzle.__drizzle_migrations`, iar aplicarea pe altă cale l-ar desincroniza față de ce face CI-ul. MCP-ul se folosește pentru verificare și `get_advisors`, nu pentru DDL.

**Conectarea la Supabase — capcana de host.** Hostul direct `db.<ref>.supabase.co` nu răspunde (publică doar AAAA, iar mașina n-are rută IPv6). Pooler-ul proiectului e **`aws-1-eu-west-1.pooler.supabase.com`** — nu `aws-0`, cum e la proiectele mai vechi din același cont — cu userul `postgres.cspjtesltraiaveypuya`. Ambele porturi răspund: 6543 transaction, 5432 session.

**Al doilea bug găsit:** `/api/health` raporta `r2: down` deși R2 funcționa. Verificarea folosea `ListBuckets`, care cere drepturi pe tot contul — deci ar fi picat tocmai la configurația cea mai sigură, cu un token limitat la bucket-urile lui. Acum face `HeadBucket` pe bucket-ul de documente.

**Al treilea, găsit prin `db:reset`:** reset-ul șterge rolurile, migrarea îl recreează pe `app_runtime` **fără parolă** (parola nu are ce căuta într-o migrare versionată). Baza arăta perfect, dar aplicația n-ar mai fi putut să se conecteze. `db:reset` rulează acum și `set-runtime-password` la final, sau avertizează explicit dacă `APP_RUNTIME_PASSWORD` lipsește.

**Ce rămâne:**
1. Commit + push pe GitHub → verificările #6 și #15 (CI cu Testcontainers). Sunt singurele rămase.
2. Când toate 15 trec, statusul devine 🟩 și se poate începe pasul 02.

---

### 2026-08-15 — [status: în lucru] — primul CI, roșu, reparat

Primul push a lăsat CI-ul roșu. `quality` și `build` au trecut; au picat `database` și `audit`.

**Verificarea #6 a trecut din prima:** toate cele 8 teste `withActor` sunt verzi. Rolul chiar se schimbă în tranzacție și `app.actor_id` chiar ajunge la destinație.

**Două teste picate — ambele bug-uri în teste, nu în schemă:**
- *Enumerările din Anexa C.0.* Testul făcea `order by typname` în SQL și compara cu o listă sortată în JS. Cele două sortări nu coincid: colația bazei decide. În `C`, `person_category` vine înaintea lui `persona` (underscore-ul, `0x5F`, e sub `a`); în `en_US`, colația ignoră underscore-ul la nivel primar și ordinea se inversează. Containerul de test și Supabase nu au aceeași colație, deci testul ar fi fost instabil oriunde. Sortarea s-a mutat integral în JS.
- *`app_field` nu poate scrie în `companies`.* Testul cerea un mesaj `/permission denied/i`, dar Drizzle îmbracă erorile driverului într-un `DrizzleQueryError` al cărui mesaj e doar `Failed query: ...`. Textul original stă în `cause`. Se verifică acum **SQLSTATE `42501`** (`insufficient_privilege`), scos recursiv din lanțul de `cause` — cod, nu text, deci nu depinde nici de `lc_messages` și nu poate trece din greșeală pe altă eroare (o constrângere încălcată, de exemplu).

**Auditul — 9 vulnerabilități `high`/`critical`.** Rezolvate chirurgical, fără upgrade de Next:
- `drizzle-orm` urcat de la `^0.44.2` la `^0.45.2` în **ambele** pachete care îl declară (`db` **și** `jobs` — advisory de SQL injection prin identificatori neescapați).
- `pnpm.overrides` în rădăcină pentru `handlebars ^4.7.9` (critical, tranzitiv prin `eslint-plugin-boundaries`), `postcss ^8.5.26` (Next 15.5 pinuiește exact `8.4.31`) și `sharp ^0.35.3`. Motivul fiecăruia și condiția de ștergere sunt în `README.md`, secțiunea „Override-uri de securitate" — `package.json` nu acceptă comentarii.
- Rămân 3 vulnerabilități sub prag (1 low, 2 moderate), toate în tooling de build. Gate-ul CI a rămas la `high`, neschimbat.

Build-ul trece cu override-urile puse, deci `postcss` 8.5 și `sharp` 0.35 nu supără Next 15.

**PR-urile Dependabot** (eslint 10, globals 17, `@next/eslint-plugin-next` 16) sunt roșii din aceeași cauză. Le lăsăm; se refac singure după ce `main` e verde.

**Rezultat (run `31873514952`, commit `89a05e9`): toate cele 4 joburi verzi.** Testele de bază de date 14/14, cu migrațiile aplicate de la zero într-un Postgres efemer. **Verificările #6 și #15 bifate — pasul 01 e complet, 15/15.**

Notă de proces: între timp a apărut `CLAUDE.md` în rădăcină, cu regula de verificare `git fetch` înainte de orice editare. Fix-ul ăsta a fost integrat prin `pull --rebase`, fără suprapuneri de fișiere.

**Datorie tehnică lăsată în urmă, de reluat:**
- Acțiunile GitHub (`checkout@v4`, `setup-node@v4`, `pnpm/action-setup@v4`) rulează pe Node 20, care e depreciat. Warning, nu eroare, dar va deveni blocant.
- 3 vulnerabilități sub pragul `high` (`esbuild` prin `drizzle-kit`, `uuid` prin `testcontainers`), toate în tooling de build.
- Cele 3 `pnpm.overrides` se șterg când dependințele-părinte urcă singure — condițiile sunt în `README.md`.

---

## Pasul 02 — Identitate, acces, RLS

Pasul e împărțit în patru sub-etape, fiecare cu commit și CI verde propriu (decizia
utilizatorului, 15 august 2026). Motivul: dacă schema de organizație e greșită, vrem să aflăm
înainte să construim RLS, auth și ecrane peste ea.

| Sub-etapă | Conținut | Verificări | Stare |
|---|---|---|---|
| **02a** | Organizație, perioade, serii, audit (migrările `0004`–`0007`) | 5–11 | 🟩 gata |
| **02b** | RLS + izolarea prețului (`0011`–`0012`) | 1–4 | 🟩 gata |
| **02c** | Supabase Auth, JWT hook, `packages/auth`, rutare pe personas | 12–15 | 🟩 gata |
| **02c′** | MFA TOTP, rate limit pe login, revocare de sesiune | 16, 18 | 🟩 gata |
| **02d** | Ecran de administrare | 17, 19 | 🟩 gata |

> **02d e mai mic decât scria inițial.** Sub-etapa avea trei livrabile — ecran, seed determinist,
> `docs/security.md` — iar **ultimele două s-au livrat deja în 02c**: `pnpm db:seed:users` creează
> câte un utilizator per persona, iar `docs/security.md` a căpătat secțiunea despre hook și
> claim-uri. **Rămâne doar ecranul.** Nu rescrie seed-ul.
>
> Trei lucruri de stabilit la începutul sesiunii de 02d, înainte de prima linie de cod:
>
> 1. **Unde stă apelul de Admin API.** Regula 6 din §4 al pasului spune „`SUPABASE_SERVICE_ROLE_KEY`
>    doar în worker și în rute `/api` dedicate”, iar provizionarea de cont din ecran ar chema-o
>    dintr-un server action. Tehnic e tot cod de server, dar litera regulii spune altceva: ori rută
>    `/api/admin/provision` dedicată, ori se relaxează regula **în scris**, cu motivul. Decizia se
>    ia acum, nu la jumătatea implementării.
> 2. **#19 e pe jumătate demonstrat.** 02b a confirmat în bază că `financiar` nu citește
>    `audit.entries` iar `admin` da, și `permissions.test.ts` o susține în cod. 02d închide
>    jumătatea de ecran, nu toată verificarea.
> 3. **Ecranul se randează din `PERMISSION_MATRIX`** (`packages/auth/src/permissions.ts`), inclusiv
>    lista de drepturi REFUZATE — `capabilitiesOf()` întoarce ambele liste tocmai pentru asta.
>    Cerința §3.10 e explicită: ecranul spune ce NU vede rolul, nu doar ce vede.
>
> Adaugă și **lista de persoane în formularul de contract** (câmpul PM, gol din 04b). E puțin peste
> serviciul care se construiește oricum, și e ultimul lucru care ține 04b legat de pasul 02.

### 2026-08-15 — [status: în lucru] — 02a, baza de date

**Migrări noi:**
- `0004_organization` — cele 11 tabele din Anexa C.1 plus extinderea lui `companies`. Generată
  cu drizzle, apoi completată de mână cu ce el nu poate exprima: extensiile, constrângerea
  `exclude` de pe `rate_cards` și funcțiile SSM.
- `0005_periods` — `periods`, `period_close_checks`, triggerul generic de blocare și ușa unică
  de avarie.
- `0006_document_series` — seriile plus alocatorul fără goluri.
- `0007_audit` — `audit.entries`, triggerul generic de diff și `app.attach_audit()`. Scrisă
  integral de mână: schema `audit` nu e sub drizzle (`schemaFilter: ['app']`).

**Decizii de business luate cu utilizatorul:**
- `hourly_cost = salariu × (1 + taxe) × (1 + neproductivitate)`, înmulțire în cascadă. Cu 30 lei,
  0.45 și 0.15 → **50.03 lei/oră**. Coeficienții sunt fracții, nu multiplicatori.
- `numbered_document_type` acoperă toată faza 0 (13 valori), nu doar cele 8 confirmate în §14 —
  o valoare nefolosită nu costă nimic, o migrare de tip în fiecare pas costă.

**Decizii tehnice, documentate în `QUESTIONS.md`:** Î6 (extensiile în `public`), Î7 (motivul
ține cât tranzacția), Î8 (RLS la `0008`, nu la `0013`).

**Alte lucruri stabilite pe parcurs:**
- `withActor` completează acum singur `persona` și `person_id` în `request.jwt.claims`, peste ce
  a trimis apelantul. Politicile RLS și triggerul de audit citesc din același loc, iar un apelant
  care uită câmpurile nu mai poate produce rânduri de audit fără autor.
- Motivul scris se cere la `UPDATE` și `DELETE`, nu la `INSERT`. A crea ceva nu e ireversibil;
  altfel deschiderea lunilor și adăugarea unui tarif nou ar fi cerut justificare degeaba.
- `app.attach_audit` și `app.attach_period_guard` nu se acordă niciunui rol. Un rol care poate
  detașa triggere își poate șterge urmele.
- `next_number` nu are `update` acordat nimănui: se mișcă doar prin alocator.
- Containerul de test a urcat de la Postgres 15 la **17**, ca Supabase. Un test care trece pe 15
  și pică pe 17 e cel mai prost fel de test.

**Capcană evitată:** `citext` pus în schema `extensions`, cum e convenția Supabase, ar fi rupt
orice `where email = $1` pentru toate cele patru persone — operatorii se rezolvă prin
`search_path`, iar `alter role … set search_path` nu ajunge la roluri `NOLOGIN` în care se intră
prin `SET ROLE`. Detaliile în `QUESTIONS.md` Î6.

**Verificat pe Postgres 17 real (Supabase dev), într-un bloc anulat la final** — deci baza a
rămas goală: `hourly_cost` = 50.03 · `exclude` blochează intervalele suprapuse · `check`-ul de
persona blochează · `PERIOD_CLOSED: luna 01/2026 este inchisa` · ușa de avarie trece și lasă
motivul în jurnal · `changed` conține doar câmpul modificat · numerele ies `TST-000001`,
`TST-000002` · tariful nu se poate modifica fără motiv.

**Rezultat: CI verde, 39/39 teste** (run `31875863298`). Verificările **5–11 sunt bifate**, iar
suita de bază de date a crescut de la 14 la 39 de teste, în 6 fișiere.

Un singur test a picat la primul push, și e o lecție de reținut: inventarul de enumerări din
`schema.test.ts` e **exhaustiv**, deci un enum în plus îl pică exact ca unul lipsă. Orice pas
care adaugă tipuri trebuie să adauge și acolo. Nu e o bătaie de cap — e testul care face
imposibil să apară un tip în bază fără ca cineva să-l fi vrut acolo.

**02a e gata. Următorul: 02b — RLS pe toate tabelele din `app` + izolarea prețului.**

### 2026-08-16 — [status: gata] — 02b, RLS pe toată schema și izolarea prețului

**Migrări noi:**
- `0011_rls_policies` — funcțiile de identitate, `enable` + `force row level security` pe
  **toate cele 30 de tabele** din `app`, politicile per tabelă, plus RLS pe `audit.entries`.
- `0012_price_isolation` — `revoke` pe `app.companies` și grant pe cele 9 coloane
  necomerciale; `revoke` explicit pe `rate_cards`, `contract_years`, `component_ceilings`;
  o poartă la migrare care caută singură coloanele de bani scăpate.

**Verificări din pas care trec / nu trec:**
- [x] #1 test generat din catalog: nicio coloană `price|pret|cost|amount|margin|salary` nu e
  vizibilă lui `app_field`/`app_subcontractor`/`app_client`; fiecare din cele trei chiar
  primește `42501` pe `rate_cards.hourly_cost`
- [x] #2 zero tabele din `app` fără `rowsecurity` — și zero fără `force`
- [x] #3 zero tabele cu RLS și fără nicio politică
- [x] #4 `app_field` cu acces la firma A vede A și **nu** vede B — zero rânduri, nu eroare.
  La fel pentru contracte: `stranger 0 / owner 1`
- [x] (bonus) izolarea subcontractant ↔ subcontractant, `financiar` nu citește jurnalul iar
  `admin` da, un `pm` nu poate crea firme
- [ ] CI — **nu s-a putut rula local, nu există Docker pe mașină.** Verificările de mai sus au
  fost rulate pe **Supabase dev (Postgres 17.6)**, într-un bloc anulat la final, plus
  `pnpm db:migrate` + `pnpm db:seed --force` reale.

**Cum s-au dat cele trei straturi din §3.9, în ordinea lor:**

1. **Coloana.** `app.companies` era acordată întreagă tuturor personelor încă din `0002`, iar
   între timp a căpătat `default_indexation_pct`, `default_delta_threshold` și
   `efactura_config`. Acum terenul are grant pe 9 coloane de identitate. `is_active` e printre
   ele dinadins: selectorul de firmă filtrează pe ea, iar o coloană citită într-un `where` cere
   exact același privilegiu ca una din `select`.
2. **Rândul.** Politicile, pe cinci tipare: scop pe firmă · scop prin părinte
   (`contract_in_scope` și frații lui) · nomenclator comun · personal (`person_id = eu`) ·
   propria fișă (subcontractant/client).
3. DTO-urile Zod există deja din pașii 03–04.

**Decizii luate / abateri de la plan:**

- **Politicile stau în migrare, nu în `packages/db/policies/`** cum cere §3.8. Un director de
  fișiere ar fi trebuit oricum concatenat într-o migrare ca să fie versionat; fișierul unic
  ține politica lângă `grant`-ul care o însoțește. Rețeta de tabelă nouă e în `docs/security.md`.
- **`app.has_office_role()` citește DOAR claim-ul.** Nu e o scurtătură de performanță:
  `person_office_roles` e ea însăși sub RLS, iar politica ei ar chema înapoi funcția →
  „infinite recursion detected in policy”, adică o eroare care apare exact în producție.
- **`app.current_company_ids()` are trei surse**: claim → `person_company_access` → *(admin
  fără nicio firmă)* tot grupul. Regula a treia nu deschide nimic — un admin poate oricum să-și
  scrie singur rândul de acces — dar fără ea prima instalare n-ar putea fi configurată, și tot
  ea e ce ține harness-urile de test și sesiunea de dezvoltare (`companyIds: []`) funcționale.
- **Politica `definer`, pe fiecare tabelă.** `force row level security` se aplică ȘI
  proprietarului, iar jumătate din mecanica pașilor 02a–04 trăiește în funcții
  `security definer` care rulează ca el: alocatorul de numere face `update` pe serie,
  `app.period_of` creează luna lipsă, triggerul de audit scrie în jurnal. Fără politica asta,
  toate ar fi picat pe Supabase (unde proprietarul nu e superuser) și ar fi trecut în CI (unde
  e) — cel mai prost fel de divergență posibil.
- **`audit.entries` primește RLS fără `force`**, singura excepție. Cu `force` ar fi trebuit să-i
  dăm proprietarului o politică de *scriere* pe jurnal, iar o politică de scriere pe jurnal e
  exact lucrul care nu trebuie să existe.
- **`app.rls_enable()` rămâne în bază după migrare**, dinadins: pașii 05–10 adaugă tabele, iar
  rețeta din `docs/security.md` are nevoie de ea.
- **Crearea unei firme e rezervată rolului `admin`** (`with check app.has_office_role('admin')`).
  Un PM primește `42501`. Consecință în teste: actorul de birou al harness-urilor e acum admin.
- **Portalurile nu mai văd nomenclatorul intern.** `clients` și `subcontractors` se filtrează la
  propria fișă, iar produsele/calificările rămân vizibile tuturor personelor interne.

**Capcane întâlnite:**
- `aclexplode(coalesce(relacl, '{}'::aclitem[]))` pică cu `22023 ACL arrays must be
  one-dimensional` — un array gol are `ndims = 0`. Scanul de coloane de bani folosește
  `has_column_privilege(rol, oid, attnum, 'select')`, care merge și când interoghezi despre un
  rol al cărui membru nu ești (contrar temerii inițiale) și prinde și drepturile moștenite.
- Prima rulare de `db:migrate` a picat pe capcana de mai sus, în `0012`. Drizzle rulează **toate**
  migrările în aceeași tranzacție, deci `0011` a fost și el anulat — baza n-a rămas pe jumătate.

**Ce a trebuit atins în afara pasului:**
- `packages/db/tests/helpers.ts` — actorii de test primesc claim-uri (`office_roles`,
  `company_ids`, `personId` impus). `officeActor()` e admin, `fieldActor({companyIds})` primește firme.
- `packages/services/tests/helpers.ts` — la fel.
- Trei teste existente citeau rânduri ca `app_field` sau ca alt om decât proprietarul cozii;
  acum primesc firma, respectiv persoana potrivită. Nicio aserție n-a fost slăbită.

**Ce rămâne pentru sesiunea următoare:**
1. Push → CI: testele de bază de date urcă de la 182 la **194** (12 teste noi în `rls.test.ts`).
   E singura verificare a lui 02b nerulată, pentru că mașina n-are Docker.
2. 02c — Supabase Auth, JWT hook (care umple `company_ids`, `office_roles`, `subcontractor_id`),
   `packages/auth`, rutarea pe personas. Politicile îl așteaptă deja.
3. 02d — ecranul de administrare, seed determinist cu câte un utilizator per persona.

### 2026-08-17 — [status: în lucru] — 02c, scheletul de autentificare

Pasul 02c a fost tăiat în două (decizia utilizatorului, 17 august 2026): **scheletul** acum —
hook de token, `packages/auth`, login, rutare pe personas — iar **MFA TOTP, rate limit pe login
și revocarea sesiunii la retragerea accesului la prețuri** într-o sesiune separată. Motivul e
mărimea: pasul întreg n-ar fi încăput într-o sesiune fără să se rupă la mijloc.

**Ce s-a executat:**

- **`0013_auth_hook`** — `app.custom_access_token_hook(event jsonb)`, `security definer`, care
  citește `persons` + `person_office_roles` + `person_company_access` și pune în JWT exact
  claim-urile pe care le citesc funcțiile din `0011`. Plus `app.clear_must_change_password()`.
  Blocurile care ating `supabase_auth_admin` sunt condiționate — rolul există doar pe Supabase,
  ca publicația Realtime din `0008`.
- **`packages/auth`** — `sessionFromClaims()` (JWT → `Session`), `permissions.ts` cu matricea
  rol × use-case (12 drepturi, 4 grupuri) și guard-urile `requirePersona` / `requireOfficeRole` /
  `requireCapability`. **18 teste noi**, primele din pachet.
- **`apps/web`** — `@supabase/ssr`, middleware de sesiune, ecranele `/login`, `/resetare`,
  `/parola-noua`, ruta `/auth/confirm` pentru linkurile din email, chip de utilizator cu ieșire
  din cont în bara de sus și în shell-ul de teren.
- **`pnpm db:seed:users`** — patru conturi prin Admin API (birou, teren, subcontractant, client),
  legate de persoane cu id fix. Idempotent; a doua rulare doar resetează parolele.

**Verificări din pas care trec / nu trec:**
- [x] hook-ul emite claim-urile corecte — confirmat pe Supabase real, într-un bloc anulat la
  final: `persona`, `person_id`, `office_roles: [pm, admin]`, `company_ids` cu ambele firme,
  `damina_status: ok`. Un `user_id` necunoscut primește `damina_status: unlinked` și **niciun**
  claim de identitate.
- [x] `supabase_auth_admin` poate executa hook-ul, `authenticated` nu — verificat cu
  `has_function_privilege`.
- [x] `pnpm typecheck` 12/12 · `pnpm lint` verde · `pnpm build` verde (15 rute, middleware 108 kB)
  · **95 de teste unitare** (76 → 95)
- [ ] #12–#15 (login pe cele patru personas, redirect, parolă temporară) — **blocate pe două
  lucruri care nu se pot face din cod:** activarea hook-ului în dashboard-ul Supabase și
  `SUPABASE_SERVICE_ROLE_KEY` în `.env.local`.

**Observații / decizii luate / abateri de la plan:**

- **Sesiunea de dezvoltare nu mai e drumul implicit.** Regula nouă (`devSessionAllowed()`):
  e activă doar dacă Supabase **nu** e configurat și nu suntem în producție, sau dacă
  `ALLOW_DEV_SESSION=1` e pus explicit. Motivul e practic: cu ea activă lângă Auth configurat,
  n-am putea testa niciodată login-ul — sesiunea implicită ne-ar duce direct în aplicație.
  Middleware-ul citește **același** predicat, ca să nu existe două păreri despre cine e logat.
- **Promisiunea din pasul 03 s-a ținut:** `apps/web/src/lib/session.ts` e singurul fișier de
  deasupra care s-a schimbat. Shell-ul, registry-ul și cele 15 tab-uri n-au fost atinse.
- **`Session` a căpătat trei câmpuri** — `subcontractorId`, `clientId`, `mustChangePassword` —
  și `actorFor` trimite acum și `subcontractor_id` / `client_id` către RLS. Un `null` se comportă
  ca o absență (funcția cade pe `app.persons`), dar setul de claim-uri văzut de politici e acum
  identic cu cel din token.
- **Middleware-ul nu poate importa `@damina/auth`** — pachetul re-exportă din `@damina/db`, deci
  ar fi tras `pg` și `drizzle` în bundle-ul de Edge. De aceea harta rute ↔ persone stă în
  `apps/web/src/lib/personas.ts`, fără dependințe de framework, folosită și de middleware, și de
  layout-uri. Verificarea e dublă dinadins (§3.7): middleware-ul se bazează pe un `matcher` care
  se poate strica; layout-ul nu poate fi ocolit.
- **Biroul primește tot ce nu e revendicat de altă persona**, nu o listă albă de prefixe. O listă
  albă ar fi trebuit actualizată la fiecare modul nou din pașii 05–10, și ar fi fost uitată exact
  când contează. Spațiile înguste (`/field`, `/portal/*`) sunt cele enumerate.
- **`canSeeFinancials` și `canEditNomenclature` citesc acum din matrice**, nu din liste proprii.
  Erau două locuri care puteau spune lucruri diferite despre același drept.
- **Erorile de login sunt patru, nu una.** „Contul nu e legat de nicio persoană”, „persoana e
  dezactivată”, „hook-ul nu e activat în proiect” și „sesiune coruptă” se rezolvă de oameni
  diferiți, în locuri diferite. Un singur „nu poți intra” i-ar fi trimis pe toți la administrator,
  care în două din patru cazuri n-are ce face.
- **Email sau parolă greșite dau același mesaj**, dinadins: două mesaje distincte spun unui
  atacator care adrese sunt conturi reale. La fel, resetarea de parolă răspunde identic și când
  adresa nu există.
- **Ordinea la schimbarea parolei e obligatorie**: parolă nouă la GoTrue → flag stins în bază →
  `refreshSession()`. Fără ultimul pas, claim-ul din token ar rămâne `must_change_password: true`
  și middleware-ul ar trimite omul înapoi la același ecran, la nesfârșit.
- **`use server` nu poate exporta obiecte.** `EMPTY_FORM_STATE` a trebuit mutat în
  `form-state.ts` — build-ul a picat prima oară exact pe asta. Tot ce se exportă dintr-un fișier
  de server actions capătă un endpoint, iar o constantă n-are ce fi chemată prin rețea.
- **`packages/services/tsconfig.json` include acum și `scripts/**`.** Cele două seed-uri nu erau
  typecheck-uite deloc.
- **`packages/auth` are pentru prima oară `vitest`.** Pachetul avea doar `typecheck`.
- **Realtime-ul (#8 din pasul 03) rămâne nevalidat.** Tabelele sunt acordate rolurilor `app_*`,
  nu lui `authenticated`, deci un canal Realtime deschis cu sesiunea utilizatorului n-ar trece de
  RLS. Se rezolvă separat, nu prin simpla existență a sesiunii.

**Ce rămâne pentru sesiunea următoare:** *(toate cele trei puncte s-au făcut în aceeași zi — vezi
intrarea de mai jos)*
1. **Utilizatorul:** activează hook-ul în Supabase (Authentication → Hooks → *Customize Access
   Token (JWT) Claims* → `app.custom_access_token_hook`) și pune `SUPABASE_SERVICE_ROLE_KEY` în
   `.env.local`.
2. `pnpm db:seed && pnpm db:seed:users` → verificările #12–#15 pe cele patru personas.
3. Push → CI.

### 2026-08-17 — [status: gata] — 02c, parcursul pe conturi reale

Hook-ul a fost activat de utilizator în dashboard (Authentication → Hooks → *Customize Access
Token (JWT) Claims* → `app.custom_access_token_hook`), iar `SUPABASE_SERVICE_ROLE_KEY` a intrat
în `.env.local`. Cele patru conturi au fost create cu `pnpm db:seed:users`.

**Verificări din pas care trec / nu trec:**
- [x] #12 login `office` → aterizează în `/panou`, vede „Andrei Ionescu · pm, admin” în bară și
  selectorul cu ambele firme
- [x] #13 login `field` → `/field`; `/panou` și `/contracte` dau **redirect**, nu 403. Zero cifre
  în lei pe ecranul de teren.
- [x] #14 `subcontractor` și `client` — fiecare doar în portalul lui, cu redirect din toate
  celelalte spații
- [x] #15 cu `must_change_password` toate rutele duc la `/parola-noua`, iar ecranul spune că
  parola primită e temporară. Un `update` direct pe `app.persons` din rolul `app_field` e refuzat
  cu **`42501`**; `app.clear_must_change_password()` stinge flagul și numai pe el.
- [x] fără sesiune, orice rută privată → `/login?next=…`; `/login`, `/resetare` și `/api/health`
  rămân publice

Matricea completă, cu cele patru conturi × șase rute:

| persona | `/` | `/panou` | `/contracte` | `/field` | `/portal/subcontractor` | `/portal/client` |
|---|---|---|---|---|---|---|
| office | → /panou | **200** | **200** | → /panou | → /panou | → /panou |
| field | → /field | → /field | → /field | **200** | → /field | → /field |
| subcontractor | → portal/sub | → portal/sub | → portal/sub | → portal/sub | **200** | → portal/sub |
| client | → portal/client | → portal/client | → portal/client | → portal/client | → portal/client | **200** |

**Trei buguri găsite la parcurs, toate reparate:**

1. **GoTrue refuză `client_id: null`.** Hook-ul emitea cheile opționale mereu, iar GoTrue
   validează claim-urile înainte să semneze: `client_id` e nume rezervat în specificație și cere
   `string`. Rezultatul — **trei din patru persone primeau 500 la login**, iar contul de client
   mergea, pentru că el e singurul cu valoare acolo. Genul de bug care trece de orice test scris
   pe cazul fericit. Reparat în **`0014_auth_hook_null_claims`**: cheile opționale se emit doar
   când au valoare. Semantica nu se schimbă — `app.current_client_id()` trata deja cheia lipsă la
   fel ca `null`. `actorFor` face acum la fel, ca cele două drumuri către RLS să arate identic;
   **un test nou** blochează regresia.
2. **`apps/web` nu citea deloc `.env.local`.** Next încarcă `.env*` doar din directorul
   aplicației, iar noi ținem un singur fișier, în rădăcină. Deci `NEXT_PUBLIC_SUPABASE_URL`
   lipsea, `supabaseConfig()` întorcea `null`, iar aplicația cădea pe sesiunea de dezvoltare —
   `/panou` răspundea **200 fără nicio sesiune**. Nu se văzuse pentru că lipsa configurației
   aprinde exact mecanismul care face totul să pară că merge. Reparat în `next.config.ts`, care
   încarcă acum fișierul din rădăcină înainte de build (`NEXT_PUBLIC_*` se inlocuiesc la
   compilare, deci trebuie să fie în mediu dinainte).
3. **Scanerul de secrete verifica doar jumătate.** Caută valoarea unei variabile numai dacă o
   găsește în `process.env`; rulat local nu o avea, deci verifica doar *numele* și raporta
   „curat” cu convingere. A devenit important odată cu reparația 2, care pune cheia de service în
   mediul build-ului. Scanerul își încarcă acum singur `.env.local`. Verificat în ambele sensuri:
   curat pe bundle-ul real, și **respinge build-ul** când cheia e plantată intenționat în
   `.next/static`.

**Observații:**

- Verificările s-au putut face fără browser, construind cookie-ul `sb-<ref>-auth-token` exact cum
  îl scrie `@supabase/ssr` (prefix `base64-`, tăiat în bucăți peste 3180 de caractere) din
  răspunsul lui `/auth/v1/token`. Aceeași metodă ca la parcursul lui 04b, extinsă la sesiuni
  reale.
- Portul 3000 era ocupat de un server pornit anterior, care rula codul vechi; parcursul s-a făcut
  pe 3100. Merită știut, pentru că un `/login` care dă 404 arată exact ca o rută lipsă.
- `SEED_USER_PASSWORD` e fixată în `.env.local`, deci rulările următoare ale seed-ului nu mai
  schimbă parola conturilor de test.
- **Cheia de service a trecut prin chat** la configurare — de rotit din Project Settings → API.

### 2026-08-17 — [status: gata] — 02d, ecranul de administrare

**Decizia luată înainte de prima linie de cod:** apelul de Admin API stă într-o **rută
`/api/admin/provision`**, nu într-un server action. Regula 6 din §4 nu e despre unde se execută
codul — un server action e tot cod de server — ci despre unde se poate **căuta**: cu cheia de
service într-un singur fișier, un `grep` peste `apps/web` dă un răspuns complet la „cine o
atinge”. Cu ea într-un server action, următorul care are nevoie de Admin API o importă în al
doilea, apoi în al treilea.

**Ce s-a executat:**

- **`packages/contracts/src/admin.ts`** — `personInputSchema` (cu cele două `refine` care repetă în
  română `check`-urile `persons_subcontractor_consistent` / `_client_consistent`),
  `officeRolesInputSchema`, `companyAccessInputSchema`, `provisionAccountInputSchema`, plus
  etichetele de persona / categorie / rol.
- **`packages/services/src/admin.ts`** — `listPersons` / `getPerson` / `createPerson` /
  `updatePerson`, `setOfficeRoles` și `setCompanyAccess` (ambele ca **set complet**, nu diferență),
  `linkAuthUser` și `listPersonOptions`. Rolurile și firmele se agregă în interogare, cu coloana
  exterioară scrisă **calificat** (`app.persons.id`) — capcana de subinterogare corelată din 04a.
- **`packages/services/src/audit.ts`** — `listRecentAuditEntries`, jurnalul global.
- **`apps/web/src/app/api/admin/provision/route.ts`** — singurul fișier din `apps/web` care atinge
  `SUPABASE_SERVICE_ROLE_KEY`. Parola se generează acolo, se întoarce o singură dată și nu se scrie
  nicăieri.
- **`apps/web/src/registry/administrare.tsx`** — o intrare în registry, **zero fișiere de pagină**:
  lista de utilizatori, vederile *Matricea de drepturi* · *Audit trail* · trei plasate „din faza 1”,
  și cele cinci tab-uri ale persoanei (Prezentare · Roluri · Acces pe firme · Cont · Istoric).
- **`components/admin/`** — `permission-matrix.tsx` (randată din `PERMISSION_MATRIX`, cu coloanele
  rolului evidențiate și cu drepturile **refuzate** afișate explicit, §3.10), `checkbox-set.tsx`,
  `provision-account.tsx`, `audit-feed.tsx`.
- **Câmpul PM din formularul de contract** e populat (`listPersonOptions`) — ultimul lucru care
  ținea 04b legat de pasul 02.
- **`NAVIGATION`: administrarea trece pe faza 0.** Cele trei sub-secțiuni care nu există încă
  (firme, praguri, integrări) **nu s-au șters**: sunt vederi care randează „din faza 1”. Fără ele,
  intrările de meniu ar fi căzut tăcut pe tabelul de utilizatori — un link care duce altundeva
  decât spune e mai rău decât unul care spune că nu e gata.

**Verificări din pas care trec / nu trec:**
- [x] **#17** parcurs complet pe conturi reale: fără sesiune → **401**; ca teren → **403** cu mesaj;
  ca admin prima oară → **200 + parola**; a doua oară → **409** „are deja cont”. **Refresh-ul
  paginii nu mai conține parola** (căutată literal în HTML-ul randat), iar lista arată badge-ul
  „Parolă temporară”. Persoana de test și contul ei GoTrue au fost șterse la final.
- [x] **#19** cu rolurile lui Andrei puse temporar pe `financiar`: `/administrare`, `?view=audit`,
  fișa persoanei și tab-ul Istoric răspund toate cu refuz, cu motivul modulului; `/administrare`
  **lipsește din sidebar**. Rolurile s-au restaurat prin `setOfficeRoles`, adică prin drumul pe care
  îl folosește chiar ecranul.
- [x] `pnpm typecheck` 12/12 · `pnpm lint` verde · `pnpm build` verde (**16 rute** — a apărut doar
  `/api/admin/provision`; entitatea n-a adăugat niciuna) · **96 de teste unitare**, neschimbate ·
  `pnpm scan:secrets` curat pe bundle-ul real, cu cheia de service prezentă în mediul build-ului.
- [x] Gărzile din servicii, verificate pe Supabase real: un om de **teren** nu poate primi roluri de
  birou, un **client** nu poate primi acces pe firme din grup.
- [ ] Cele **10 teste noi** din `packages/services/tests/admin.test.ts` — scrise, **nerulate local**
  (mașina n-are Docker). Se validează la primul CI; testele de servicii ar trebui să urce 27 → 37.

**Trei buguri găsite la parcurs, toate reparate:**

1. **`occurred_at` din jurnal venea ca ȘIR, nu ca `Date`.** Interogările pe `audit.entries` trec
   prin `tx.execute` — SQL scris de mână, pentru că schema `audit` nu e sub drizzle — iar pe drumul
   ăla valoarea nu mai trece prin parserul de coloană. Tipul declarat în `execute<...>()` spunea
   `Date` și nimeni nu-l contrazicea: TypeScript are încredere în ce scrii acolo. Consecința:
   `Intl.format` pe un șir dă `RangeError: Invalid time value`, iar `.toISOString()` nu există pe
   el. **Bugul e în cod livrat la pasul 02a** și lovea și `AuditTrail`, tab-ul de Istoric al
   oricărei entități — nu se văzuse pentru că se randase doar pe rânduri fără intrări de jurnal.
   Conversia se face acum o dată, în serviciu.
2. **O închidere pasată unei componente de client.** `save={(values) => actiune({ personId, ... })}`
   scris într-o componentă de server pică la randare cu „Functions cannot be passed directly to
   Client Components”: o închidere nu se serializează, un server action da, pentru că e o referință.
   `CheckboxSet` primește acum **referința** acțiunii plus `personId` și `payloadKey`, și compune
   corpul cererii de partea clientului.
3. **Textul de refuz al unui modul mințea.** Cât timp exista un singur modul cu `canRead`
   (tarifele), motivul stătea scris în pagina de listă. Al doilea modul l-a făcut fals: unui
   `financiar` i se spunea că „tarifele conțin salarii și cost orar” când încerca să deschidă
   administrarea. Motivul e acum al entității (`readDeniedReason`), iar ambele pagini generice îl
   citesc de acolo.

**Observații / decizii luate:**

- **Persoana și contul sunt lucruri diferite, și ecranul o arată.** Formularul nu atinge parola și
  nu cunoaște `auth_user_id`; tab-ul „Cont de login” e singurul care vorbește despre GoTrue. Un om
  intră în nomenclator înainte să existe motiv să se logheze.
- **Rolurile și firmele se salvează ca SET, nu ca diferență.** Un API de tip „adaugă rolul X” ar fi
  cerut ecranului să calculeze singur ce trebuie șters — un al doilea loc care poate greși, și o
  cursă când doi administratori au ecranul deschis simultan.
- **Butonul de salvare e inactiv cât timp nimic nu s-a schimbat**, și spune de ce. Fără asta, un
  ecran cu șapte căsuțe invită la „salvez ca să fiu sigur”, iar fiecare apăsare lasă un rând de
  audit care nu spune nimic.
- **Motivul scris e fix la roluri și acces, nu cerut de la om.** Operația e „am pus ce vezi”, iar
  cine/când/ce-era-înainte sunt deja în jurnal. Un câmp de motiv la fiecare bifă ar fi produs o mie
  de rânduri cu „actualizare”.
- **Un cont GoTrue orfan se leagă, dar NU i se schimbă parola.** Altfel ecranul ăsta ar fi devenit o
  unealtă de preluat conturi existente. Răspunsul spune explicit că parola a rămas cea veche și
  trimite la „Am uitat parola”.
- **Dialogul cu parola are `isDirty` permanent**, deci Escape și butonul de închidere cer
  confirmare. Nu e un artificiu: pe ecran chiar sunt date care se pierd la închidere.
- **Ecranul de drepturi arată și ce NU deschide un rol**, plus personele care pot avea dreptul —
  `financials.read` are `personas: ['office']`, deci nu ajunge niciodată la teren, indiferent ce rol
  i-ai da. Fără coloana aia, tabelul ar fi promis ceva ce baza refuză.
- **`/administrare` lipsește din sidebar** pentru cine n-are dreptul: filtrarea din layout se face
  pe `canRead` din registry, deci a funcționat pentru modulul nou fără nicio linie în plus.
- Parcursul s-a făcut din nou fără browser, cu cookie-ul `sb-<ref>-auth-token` construit din
  răspunsul lui `/auth/v1/token`, ca la 02c. **Porturile 3000 ȘI 3100 erau ocupate** de servere
  vechi; parcursul a rulat pe 3211 și 3212.

**Ce rămâne pentru sesiunea următoare:**
1. ~~Push → CI.~~ **Făcut**, run `32009107114` verde pe `d0d5d39`. Serviciile au urcat 27 → **38**
   (nu 37 — `admin.test.ts` are 11 teste, nu 10, cum estimasem), totalul **225**.
2. ~~**02c′**~~ — **făcut**, vezi intrarea următoare. Cu el, pasul 02 e închis.
3. Playwright — încă neinstalat; blochează #13 din pasul 03 și clicul pe hartă din 04b.
4. Decizia despre **#8** (Realtime vs. `authenticated`), rămasă deschisă din pasul 03.

### 2026-08-17 — [status: gata] — 02c′, al doilea factor, revocarea și limita la login

Cu asta **pasul 02 se închide**: toate cele 19 verificări au trecut.

**Ce s-a livrat**

- **#16 — TOTP obligatoriu pentru `admin` și `financiar`.** `aal` intră în `Session` (claim nativ
  GoTrue, nu al hook-ului nostru), politica stă lângă matricea de drepturi în
  `packages/auth/src/permissions.ts` (`MFA_REQUIRED_ROLES`, `requiresMfa`, `mfaSatisfied`,
  `requireMfa`), middleware-ul oprește un `aal1` obligat pe **orice** rută, iar ecranul
  `/doi-pasi` face și înrolarea, și provocarea. Ecranul e proiectat de agentul de design.
- **#18 — revocarea sesiunii la retragerea accesului la prețuri.** `/api/admin/roles` compară
  dreptul `financials.read` **înainte și după** salvare, întrebând matricea de două ori, și taie
  sesiunea doar la pierdere.
- **Rate limit pe login**, 10 încercări / 10 minute, pe cheia IP + email.
- **Bonus, nu din plan:** `/api/admin/account` cu `revoke` (scoate-l afară acum) și `mfa-reset`
  (telefon schimbat). Fără a doua, un `admin` care-și schimbă telefonul e blocat definitiv, iar
  dacă e singurul administrator, aplicația e blocată cu el. Un mecanism obligatoriu fără cale de
  ieșire nu e o măsură de securitate, e o capcană.

**Planul spunea „prin Admin API”. Admin API-ul nu poate.**

`auth.admin.signOut(jwt)` cere **access token-ul** omului, nu id-ul lui — pe ecranul de
administrare n-ai token-ul altcuiva. Prima versiune chema `signOut(userId, 'global')` și primea
`invalid JWT: token contains an invalid number of segments`, adică exact ce trebuia. Endpoint-urile
care ar fi făcut-o după id (`DELETE /admin/users/{id}/sessions`, `POST .../logout`, `.../sign_out`)
răspund toate **404**. Nu există.

Ce există e mai direct: sesiunile stau în `auth.sessions`, iar GoTrue verifică la fiecare
`GET /user` dacă sesiunea din claim-ul `session_id` mai există. Șters rândul, următorul apel
întoarce **403 `session_not_found`**, iar refresh token-ul cade în cascadă. Verificat pe proiectul
real înainte de a scrie o linie de migrare. Și pentru că `apps/web` cheamă `getUser()` la fiecare
cerere prin middleware, „imediat” nu e o promisiune, e o consecință.

De aici migrarea **`0015`**: `app.revoke_sessions(uuid)`, `security definer`, cu guard propriu
(`app.has_office_role('admin')` — o funcție care șterge sesiuni și se încrede în apelant ar fi o
unealtă de deconectare a oricui), tolerantă la lipsa schemei `auth` din CI prin `to_regclass`.

**Consecință asupra deciziei de la începutul sesiunii:** revocarea nu mai are nevoie de cheia de
service, deci ruta `/api` nu mai e o necesitate tehnică. A rămas fiindcă e o singură ușă — acolo se
calculează ce drept s-a pierdut și tot acolo se taie sesiunea. `saveOfficeRoles` a fost **șters**,
nu lăsat lângă: două uși către aceeași operație, din care una nu revocă nimic, ar fi însemnat că
securitatea depinde de care din ele nimerește următorul ecran.

**Coloana `persons.sessions_revoked_at`** nu e decor. `audit.entries` se scrie **numai** din
trigger-ul de pe o tabelă auditată (0007), deci o revocare care n-ar atinge nicio coloană n-ar lăsa
urmă nicăieri. Verificat în jurnal: trei rânduri, cu actor și cu motivul din care se vede pe ce ușă
a intrat („modificare roluri de birou” / „închidere de sesiuni” / „resetare verificare în doi pași”).

**Trei lucruri găsite testând, nu citind**

1. **`mfa.listFactors()` minte.** Citește lista din utilizatorul aflat în sesiune, adică **din
   cookie** — iar cookie-ul se scrie la login și nu se rescrie când se înrolează un factor. A doua
   deschidere a ecranului vedea lista goală, încerca `enroll` și primea 422 „friendly name already
   exists”; omul primea „nu am putut porni configurarea” la **fiecare refresh**. Acum se citește din
   `getUser()`, care întreabă serverul — aceeași regulă ca peste tot unde se ia o decizie.
2. **Middleware-ul redirecta și cererile `/api`.** Comentariul meu din rută spunea că nu o face;
   testul a arătat 307 în loc de 403. Un `fetch` urmează redirect-ul, primește 200 și încearcă să
   citească JSON dintr-o pagină HTML. Acum `/api` e scutit explicit, iar rutele răspund 403 cu mesaj.
3. **`@damina/auth` nu poate fi importat din middleware.** Bariera reexportă `@damina/db`, deci
   driverul de Postgres, deci `node:fs` — care nu există pe Edge. Build-ul a căzut cu
   „Reading from node:fs is not handled by plugins”. `actorFor` s-a mutat în `actor.ts`, iar
   `@damina/auth/edge` e jumătatea care poate rula oriunde. **Regula: middleware-ul importă din
   `@damina/auth/edge`, restul din `@damina/auth`.**

**Verificat pe conturi reale** (server pe 3310, cu un generator TOTP scris pentru ocazie)

- #16: admin pe `aal1` → 307 către `/doi-pasi` de pe `/panou`, `/administrare` și `/`; ecranul dă QR
  + cheie și **rezistă la reîncărcări**; cod TOTP corect → `aal2` → `/panou` și `/administrare` 200,
  iar `/doi-pasi` redirectează înapoi; cod greșit → 422.
- #18: victima cu `pm` vede `/panou` și `/contracte`; administratorul îi scoate rolul → `revoked=1`;
  **următoarea ei cerere → 307 către `/login`**; refresh token → 400. Rol dat înapoi → `revoked=0`;
  rol adăugat în plus → `revoked=0`. Se taie doar la pierdere.
- Porți: fără sesiune 401 · teren 403 · **admin fără `aal2` 403** pe ambele rute · cerere invalidă
  400 · pe sine, refuz cu mesaj propriu pentru fiecare acțiune.
- Rate limit, prin formularul de login trimis ca de la un browser fără JS: primele 10 „parolă
  greșită”, a 11-a și a 12-a „prea multe încercări”; alt IP trece; alt cont de pe același IP trece;
  un login **reușit** șterge contorul.
- Gate-uri: `typecheck` 12/12 · `lint` · 110 teste unitare · `build` (19 rute: +`/doi-pasi`,
  +`/api/admin/roles`, +`/api/admin/account`) · `scan:secrets` curat.

**Observații**

- Formularele pe `useActionState` **au** progressive enhancement (React 19 emite `$ACTION_REF_`), și
  de aia limitatorul a putut fi testat prin HTTP, fără browser. Merită ținut minte: e o cale de
  testare pentru orice server action din formular, cât timp Playwright lipsește.
- Terenul de test a fost curățat: contul și persoana de test șterse, factorul TOTP de pe contul lui
  Andrei șters.

**Ce rămâne pentru sesiunea următoare:**

1. ~~Push → CI.~~ **Făcut.** Primul run (`32013932083`) a picat pe UN test: cel de guard din
   `revokeSessions`. Guard-ul funcționa — `DrizzleQueryError` are ca mesaj doar „Failed query: …”,
   deci potrivirea pe `String(error)` nu vedea niciodată mesajul bazei. Reparat cu `pgMessage()`,
   adăugat în `packages/services/tests/helpers.ts`. **Regulă: nu potrivi pe textul erorii de la
   suprafață; folosește `pgMessage()` sau `sqlstate()`.**
2. **Cheia de service tot n-a fost rotită** (a trecut printr-un chat pe 17 august). Cu 02c′,
   singurul cod care o mai folosește e `resetMfaFactors` — rotația e ieftină acum.
3. Pasul 02 e închis. Următorul pas de conținut e cel din plan după 04; Playwright (#13, clicul pe
   hartă din 04b) și decizia despre **#8** (Realtime vs. `authenticated`) rămân deschise.

---

## Pasul 03 — Shell UI, nomenclatoare

> **Patru verificări rămân deschise: #8, #10, #13, #14.** Ce trebuie știut despre ele înainte de a
> le lua în lucru:
>
> - **#8 (badge-ul crește fără refresh) NU s-a deblocat cu 02c**, deși așa scria când a fost
>   amânată. Nu-i lipsește o sesiune Supabase — îi lipsește o decizie. Tabelele sunt acordate
>   rolurilor `app_*`, iar Realtime se autentifică drept `authenticated`, care n-are niciun grant
>   la noi. Deci ori se acordă `select` pe `work_queue_items` și `notifications` și lui
>   `authenticated`, cu politici proprii scrise pentru el, ori badge-ul rămâne pe fallback-ul de
>   60 s din `live-sync.tsx` și verificarea se rescrie. **Nu o trata ca pe „mai rulează o dată”.**
> - **#10** (produs creat/editat apare imediat + audit) — de rulat pe baza reală. Atenție:
>   trigger-ul din `0007` compune numele cu schema, deci în `audit.entries` se caută
>   `app.products`, nu `products`. Aici a fost un test roșu în pasul 04.
> - **#13** (Playwright, 1200 px / 390 px) și **#14** (Lighthouse) — Playwright nu e în repo.
>   Când intră, închide și clicul pe hartă din 04b #14, singura verificare a pasului 04 rămasă
>   neconfirmată în browser.

### 2026-08-15 — [status: în lucru] — shell fractal, design system, nomenclatoare

**Ce s-a executat:**

- **`packages/ui` — design system.** `tokens.css` (Tailwind v4 `@theme`: paletă petrol
  în oklch, scară tipografică de ERP 11/13/14/16/20/24, umbre în două straturi, cifre
  tabulare global, un singur inel de focus). Componente: `Button` `Badge` `CountBadge`
  `Banner` `Card` `Table` `Tabs` `ProgressBar` `EmptyState` `Dialog` `Form`+`Field`
  `Input`/`Select`/`Textarea`/`DateInput`/`Checkbox` `Money` `Stat` `Skeleton` `Toast`.
  Zero dependințe de UI în afară de `react-hook-form`, `clsx`, `tailwind-merge`,
  `lucide-react` — fără Radix: `<dialog>` nativ dă capcană de focus, `inert` și strat
  de sus gratis, iar tab-urile sunt rute, nu stare de client.
- **`packages/i18n`** — dicționar ro-RO complet cu diacritice, `t()` tipizat
  (`TranslationKey` = uniunea căilor de frunză, deci o cheie greșită **nu compilează**)
  + test care scanează `apps/web/src` și `packages/ui/src` pentru chei lipsă. 3/3 verzi.
- **`packages/db`** — `app.products` + cele patru tabele de notificări din Anexa C.15,
  migrarea `0008_nomenclature_and_notifications`. Enum nou: `alert_severity` (adăugat și
  în inventarul din `schema.test.ts`). Scris de mână peste ce generează drizzle: unic
  case-insensitive pe `products.code`, **unicul parțial `alerts (scope_type, scope_id,
  kind) where resolved_at is null`**, indecși parțiali pentru cozi/necitite, grant-uri,
  `attach_audit('app.products')`, adăugarea în publicația `supabase_realtime` (bloc `do`,
  trece fără efect în Postgres-ul din CI). **8 teste noi** în `notifications.test.ts`.
- **`packages/services`** — `nomenclature` (CRUD pe 6 nomenclatoare, 23505/23P01 traduse
  în română), `notifications` (cele 3 mecanisme, API-uri deliberat diferite),
  `context` (firme + starea lunii per firmă), `search` (7 grupuri, în paralel), `audit`.
- **`packages/auth`** — `Session`, `actorFor`, `canSeeFinancials`, `canEditNomenclature`.
- **`apps/web`** — shell-ul în cinci benzi, `entityRegistry`, pagina fractală, Ctrl+K,
  clopoțel, selectoare de firmă/lună, panou de Legături, `createAction`, Panou,
  shell de teren și portaluri.

**Verificări din pas care trec / nu trec:**
- [x] #1 două entități în registry cu tab-uri diferite randează fără cod de pagină nou —
  6 entități, zero fișiere de pagină per entitate
- [x] #2 selectorul de firmă persistă (cookie, un an) și se reflectă în tot ce e sub el
- [x] #3 lacătul 🔒 apare pe orice ecran care depinde de lună; scrierile sunt dezactivate
  **cu explicație**, nu doar gri
- [x] #4 modala nu se închide la click în afară; Escape trece prin aceeași poartă;
  `isDirty` cere confirmare
- [x] #5 orice listă are `EmptyState` — impus de tipuri, nu de disciplină
- [x] #6 Ctrl+K cu grupuri și prefixe (`/` și `>` se rezolvă local, fără rețea)
- [x] #7 tab-urile financiare lipsesc din DOM pentru rolurile fără drept, iar ruta lor
  răspunde „nu ai acces” (filtrarea e înainte de randare, nu în CSS)
- [x] #9 două alerte identice pe același scope → un singur rând (test de bază de date)
- [x] #11 rate card cu interval suprapus → mesaj în română, nu stack trace
- [x] #12 `(field)` are shell propriu, zero cifre în lei, banner de sincronizare
- [ ] #8 badge-ul crește fără refresh — cod livrat (`live-sync.tsx`, Realtime + fallback
  60 s), dar Realtime cere sesiune Supabase, deci se validează la 02c
- [ ] #10 produs creat/editat apare imediat + audit — de rulat pe baza de date reală
- [ ] #13 test Playwright la 1200 px și 390 px — Playwright nu e încă în repo
- [ ] #14 Lighthouse pe o listă — de rulat

**Observații / decizii luate / abateri de la plan:**

- **Numerotarea migrărilor.** Pasul ăsta a luat `0008`, deci **02b (RLS + izolarea
  prețului) se mută pe `0009`–`0010`**. Drizzle numerotează în ordinea creării; nu era
  loc de rezervat.
- **Sesiunea e provizorie.** 02c (Supabase Auth, JWT hook) nu e făcut, iar shell-ul se
  construiește peste identitate. Sesiunea vine dintr-un cookie de dezvoltare, cu un
  administrator implicit când lipsește — **doar sub `NODE_ENV !== 'production'`**, sau
  cu `ALLOW_DEV_SESSION=1` în `apps/web/.env.local` (necesar ca un `next build && next
  start` local să fie utilizabil; fișierul e ignorat de git, nu ajunge în deploy).
  Contractul e ales ca să nu ceară rescrieri: tot ce e deasupra consumă `Session`, iar
  02c schimbă **un singur fișier**, `apps/web/src/lib/session.ts`.
- **Contextul stă în cookie, nu în URL**, deși planul spune „URL + cookie”. Motivul: în
  Next 15 layout-urile nu primesc `searchParams`, iar shell-ul (sidebar, badge-uri,
  bară de sus) trăiește în layout. Cu contextul în URL, layout-ul și pagina ar citi din
  două surse și s-ar contrazice exact în cazul care contează — omul schimbă luna și
  sidebar-ul rămâne pe cea veche. Prețul: un link copiat nu poartă contextul.
- **Rutele nomenclatoarelor sunt plate** (`/produse`, nu `/nomenclatoare/produse`).
  Gruparea e vizuală, în sidebar. Asta face ca `/produse/{id}/istoric` să aibă exact
  forma pe care o va avea `/contracte/{id}/plafoane` în pasul 04 — un singur șablon.
- **Fără temă întunecată.** Token-urile sunt gata pentru ea (nicio culoare nu e scrisă
  într-o componentă), dar varianta nu se livrează nevalidată pe ecrane reale.
- **`Money` refuză `number` la nivel de tip.** `Stat` cere `context`. `Tabs` nu are
  `disabled`. `EmptyState` nu are câmpuri opționale pentru titlu și corp. Regulile din
  §30 sunt impuse de semnături, nu de review.
- **`text-sm` = 13px, `text-base` = 14px** — scara e mai strânsă decât implicitul
  Tailwind. Un ERP arată 40 de rânduri pe ecran, nu o pagină de marketing.
- **Bivarianța din `registry/types.ts`** e ce ține registry-ul tipizat fără `any`.
  Detaliile în `docs/entity-registry.md`.

**Ce rămâne pentru sesiunea următoare:**
1. `pnpm db:migrate` pe Supabase dev → verificările #8, #10 pe date reale.
2. Push → CI (testele de bază de date urcă de la 39 la 47).
3. Playwright pentru #13, Lighthouse pentru #14.
4. 02b (RLS, migrările `0009`–`0010`) și 02c (auth), care închid și #8.

---

## Pasul 04 — Contracte, obiective

Pasul e împărțit în două sub-etape, fiecare cu commit și CI verde propriu (decizia
utilizatorului, 15 august 2026). Motivul: pasul e de ~3x volumul pasului 03, iar dacă schema de
contract e greșită nu vrem să fi construit deja 15 ecrane peste ea.

| Sub-etapă | Conținut | Verificări | Stare |
|---|---|---|---|
| **04a** | Migrările `0009`–`0010`, domain pur, servicii, alerte cron, seed determinist | 1–6, 10, 11, 15–18 | 🟩 gata |
| **04b** | Ecranele: contract (9 tab-uri), obiectiv (6), hartă, acoperire inspecții | 7–9, 12–14 | 🟩 gata (#14 doar parțial în browser) |

### 2026-08-15 — [status: în lucru] — 04a, schema și motorul de bani

**Ce s-a executat:**

- **`0009_contracts`** — `contracts`, `contract_years`, `contract_components`,
  `component_ceilings`. Scris peste ce generează drizzle: trigger-ul `check_ceiling_kind`,
  atașarea auditului și a gărzii de perioadă, **grant-urile pe coloană** și reparația
  auditului (mai jos).
- **`0010_objectives`** — `objectives`, `checklists`, `checklist_items`,
  `inspection_profiles`, `inspection_profile_items`, `contract_objectives`. Adăugat de mână:
  unicul case-insensitive pe `objectives.code`, constrângerea `exclude` de pe legătură,
  audit și grant-uri.
- **`packages/domain/contracts`** — `applyIndexation`, `buildContractYears`, `contractYearAt`,
  `ceilingUsage`, `deltaFill`, plus aritmetica de date (`addYears`, `previousDay`).
  **28 de teste, fără bază de date, în 12 ms.**
- **`packages/contracts`** — scheme Zod pentru contract, componentă și cele **două** feluri de
  plafon (cost / venit), obiectiv, legătură, profil, fișă.
- **`packages/services`** — `contracts.ts` (CRUD, plafoane cu upsert, `getContractOverview`),
  `objectives.ts` (CRUD, legături, `getInspectionCoverage`), `contract-alerts.ts`.
- **`packages/jobs` + `apps/worker`** — cozile `contracts.expiryScan` (zilnic 06:00) și
  `contracts.deltaFillScan` (**pe 10 și pe 20, 09:00**), programate cu `boss.schedule()` pe
  fusul aplicației.
- **Seed determinist** (`pnpm db:seed`): 2 firme, 2 contracte, 4 componente, 20 obiective,
  22 legături, 2 profile cu frecvențe, plafoane pe 3 luni + planul anual.

**Verificări din pas care trec / nu trec:**
- [x] #1 contract 4 ani, 50.000, 5% → `50.000 → 52.500 → 55.125 → 57.881,25`, aniversări
  corecte inclusiv `2028-02-29`. **Confirmat pe datele reale din seed.**
- [x] #2 indexare 0 → cei 4 ani au aceeași valoare
- [x] #3 cele 3 componente, cu `is_fill_target` derivat din tip
- [x] #4 `is_fill_target` pe Mentenanță → respins de DB (confirmat pe Postgres 17 real)
- [x] #5 plafon fără motiv → respins; cu motiv → rând în `audit.entries`
- [x] #6 plafon pe lună închisă → `PERIOD_CLOSED: luna 08/2026 este inchisa`
- [x] #10 legătură suprapusă pe același contract → `23P01`, mesaj în română
- [x] #11 același obiectiv pe două contracte simultan, cu profile diferite → permis
- [x] #15 `app_field` citește contractul, dar **fiecare** coloană comercială e refuzată cu
  `42501`, la fel `select *`, `contract_years` și `component_ceilings`. Confirmat rulând ca
  rol `app_field` pe Supabase real.
- [x] #16 20 obiective cu profil trimestrial → 20 de rânduri, 0 inspecții, restanțe din frecvență
- [x] #17 contract care expiră în 5 luni + 3 rulări de scan → **o singură alertă**
- [x] #18 testele de domain rulează fără DB, în milisecunde
- [ ] #7, #8, #9, #12, #13, #14 — ecrane, deci 04b
- [x] Seed-ul din §7 există și trece prin servicii, nu prin `insert` direct

**Bug găsit în cod deja livrat (pasul 02a):** `audit.record_change()` derivă `record_id` din
coloana `id` a rândului, iar trei tabele auditate n-au coloana asta —
`person_company_access`, `person_office_roles`, `team_members`. Consecința: **orice `insert` în
ele eșua cu 23502**. Verificat pe Supabase înainte de reparație. Nu s-a văzut până acum pentru
că niciun test și niciun ecran nu scrisese în ele; seed-ul pasului 04 le atinge pe toate trei.
Reparat în `0009` printr-un `create or replace`: când rândul n-are `id`, `record_id` se derivă
din `md5` al rândului întreg — pe tabele de legătură pură toate coloanele *sunt* cheia, deci
hash-ul rândului e hash-ul cheii, stabil între INSERT și DELETE. **3 teste noi** blochează
regresia.

**Al doilea bug, prins de primul CI și de departe cel mai urât:** într-un `select` fără join,
drizzle randează o coloană interpolată (`${schema.objectives.id}`) ca `"id"`, **fără prefix de
tabelă**. Într-o subinterogare corelată, `"id"` se leagă atunci de tabela dinăuntru: condiția
`co.objective_id = "id"` devine `co.objective_id = co.id`, mereu falsă, iar contorul iese **0 în
tăcere**. Aceeași greșeală era în `contractSelection` și în `listChecklists`; acolo n-a explodat
doar pentru că interogările au join-uri, caz în care drizzle califică. Reparat scriind coloana
exterioară calificat (`app.objectives.id`), cu comentariu la ambele locuri. Lecția: o
subinterogare corelată nu se scrie niciodată cu interpolare de coloană.

**Al treilea bug, în teste:** actorul de test avea `personId` inventat, iar
`component_ceilings.set_by` are cheie străină către `app.persons`. Jurnalul de audit
supraviețuiește (`actor_id` n-are FK, dinadins), dar prima scriere care păstrează autorul cade.
Harness-ul provizionează acum o persoană reală la migrare.

**Al patrulea bug, tot în teste:** o aserție cerea ca o legătură cu `valid_to` în **viitor** să
nu mai fie curentă. E pe dos — un obiectiv anunțat că iese luna viitoare e încă în contract azi.

**Al cincilea bug, găsit de propriul test de domain:** `applyIndexation` construia factorul ca
`Money.of(1).add(Money.of(pct))`. `Money` are două zecimale prin definiție, deci 3,5% devenea
4%. Corectat: creșterea se calculează ca **sumă în lei, rotunjită la ban** (`v + v × pct`), ceea
ce e și mai aproape de realitate — indexarea se negociază ca „creștem cu 2.500 lei”.

**Observații / decizii luate / abateri de la plan:**

- **Numerotarea s-a decalat a doua oară.** Planul cere `0011`/`0012`; au ieșit `0009`/`0010`.
  **02b ia acum `0011`–`0012`.** Vezi Î9 din QUESTIONS.md.
- **Izolarea prețului se face pe COLOANĂ, nu prin RLS** (decizia utilizatorului). Precondiția
  §2 a pasului cerea 02b, care nu e făcut. `app.contracts` acordă celor trei persone
  non-birou exact 13 coloane; cele 5 comerciale (`total_value`, `monthly_value`,
  `indexation_pct`, `delta_threshold`, `overhead_pct`) lipsesc din grant. Politicile RLS pe
  rânduri rămân în 02b și doar strâng peste.
- **Anii contractuali se generează în serviciu, nu într-un trigger.** Aritmetica are un
  singur loc: `buildContractYears`. Vezi Î11.
- **`is_fill_target` nu e câmp de formular.** Se derivă din tip, în `createComponent`, iar baza
  impune egalitatea `is_fill_target = (type = 'delta')`. E singurul comutator din tot pasul
  care inversează sensul unui indicator pe ecran; bifat greșit, Delta s-ar desena ca limită de
  cheltuială.
- **`ceilingUsage` și `deltaFill` sunt două funcții, nu una cu un `boolean`.** Un parametru care
  inversează sensul ar fi exact felul în care cele două citiri ajung amestecate.
- **`deltaFill` întoarce și `expectedPercent`** — ritmul la umplere uniformă. Fără el, „38%” nu
  spune nimic: e excelent pe 12 și dezastruos pe 28. Alerta de pe 10 și 20 se ia pe diferența
  dintre cele două, nu pe un prag fix.
- **Plafonul e ori lunar, ori anual**, impus cu `num_nonnulls(...) = 1`, iar unicitatea
  scope-ului cu `unique nulls not distinct` — fără el, două rânduri anuale ar trece amândouă.
- **Plafoanele anuale nu sunt blocate de luna închisă**, intenționat: planul anual nu e o cifră
  a lui august.
- **Testele de servicii au acum infrastructură proprie** (decizia utilizatorului):
  `packages/services/{tests,vitest.db.config.ts}`, container propriu, aceleași migrări din
  `packages/db`. `packages/db` nu poate importa `services` fără să închidă un ciclu. CI-ul
  pornește acum **două** Postgres-uri efemere, în paralel. Infrastructura se refolosește la
  pașii 05–10, care sunt aproape numai servicii.
- **`no-restricted-imports` are o excepție nouă**: `packages/*/tests/global-setup.ts` poate
  importa driverul. Un harness care ridică o bază de la zero n-are cum să n-o facă.
- Contractele au **`company_id`**, spre deosebire de nomenclatoare. Toate listele cer explicit
  `companyIds`; o selecție goală întoarce zero rânduri, nu „toate”.

**Al șaselea bug, moștenit: `main` era roșu de la pasul 03.** Testul „modificarea unui produs
ajunge în audit” căuta `table_name = 'products'`, dar trigger-ul din `0007` compune numele cu
schema — `app.products`. Deci nu găsea niciodată rândul. Confirmat că nu e regresie: aceeași
singură eroare pe run-ul `31880570041`, pe commit-ul `7c8ab7f`, dinaintea pasului 04. Reparat.

**Rezultat: toate cele 4 joburi verzi** (run `31884687256`).

| Suită | Înainte | Acum |
|---|---|---|
| Teste unitare (shared, domain, i18n, storage) | 48 | **76** (+28 domain) |
| Teste de bază de date — `packages/db` | 47 | **79** (9 fișiere) |
| Teste de bază de date — `packages/services` | — | **27** (2 fișiere, infrastructură nouă) |
| **Total** | 95 | **182** |

**Ce rămâne pentru sesiunea următoare (04b):**
1. Contractul și obiectivul în `entityRegistry`, **fără să se atingă shell-ul** — §7 al pasului.
2. Prezentare cu cele trei benzi (#7), navigare pe luni (#8), componentă clickabilă (#9).
3. Obiectiv: tab Contracte (#12), tab Istoric etichetat „analitica: folosit” (#13).
4. Lista de obiective cu comutator tabel/hartă, Leaflet + tile-uri OSM (#14).
5. Acoperire inspecții pe ecran (serviciul există deja și e testat).

### 2026-08-16 — [status: în lucru] — 04b, ecranele

**Ce s-a executat:**

- **Contractul și obiectivul sunt în `entityRegistry`, fără să se atingă shell-ul** — §7 al
  pasului. Build-ul o confirmă: **tot 12 rute**, aceleași ca înainte. Două entități noi cu 15
  tab-uri între ele, zero fișiere de pagină. Ce a trebuit adăugat s-a adăugat în
  `registry/types.ts`, unde beneficiază toate entitățile deodată — nu s-a ocolit registry-ul.
- **`registry/contracts.tsx`** — cele 9 tab-uri. Prezentare cu bandă per componentă, Componente cu
  plafoane editabile (lunar + plan anual), Obiective cu legături și acoperire, Financiar cu
  indexarea istoricizată și comutator marjă brută/netă, Setări cu pragurile și audit trail-ul.
  Vederi de listă: Toate · Plafoane · Portofoliu · Cadru furnizori · Subcontractanți.
- **`registry/objectives.tsx`** — cele 6 tab-uri, plus vederile Tabel · Hartă · Acoperire
  inspecții · Profile de inspecție.
- **Hartă Leaflet** (`components/objective/objective-map.tsx`), o singură componentă și pentru
  afișare, și pentru selecția coordonatelor. Tile-uri OSM, foaia de stil din pachet.
- **`contract-actions.ts`** — plafoane (cost și venit, două acțiuni separate), legături de
  obiectiv, schimbarea profilului. Toate cer motiv scris.

**Verificări din pas care trec / nu trec:**
- [x] §7 contractul și obiectivul în registry, **shell-ul neatins** — confirmat de build
- [~] #7 trei benzi cu venit/plafon/angajat(0)/consumat(0)/rest, Delta cu lei neumpluți — cod
  livrat, de confirmat pe seed
- [~] #8 navigare ◀ ▶ pe luni, lună închisă cu 🔒 — idem
- [~] #9 click pe componentă → lista de UL, goală cu `EmptyState` — idem
- [~] #12 obiectiv → tab Contracte, ambele contracte cu perioade — idem
- [~] #13 obiectiv → tab Istoric, etichetat „analitica: folosit” — idem
- [~] #14 comutator tabel/hartă, click pe hartă la creare setează coordonatele — idem
- [x] `pnpm typecheck` 12/12 · `pnpm lint` verde · `pnpm build` verde · 76 teste unitare

**Bug găsit în cod deja livrat (pasul 03), reparat:** server action-urile trimiteau spre servicii
valorile **deja transformate** de Zod, iar serviciile le re-parsau cu aceeași schemă. Schemele au
transformări (`'' → null`), iar rezultatul lor nu mai trece a doua oară prin ele: orice câmp
opțional lăsat gol — `category` la produs, `cui` la furnizor — ar fi picat la re-parsare cu
`ZodError`, adică 500, nu mesaj în română. Nu se văzuse pentru că niciun test nu salva un
nomenclator cu un câmp opțional gol. Reparat generic: `createAction` dă acum lui `run` și valoarea
brută, iar serviciile o primesc pe aceea. Parsarea are un singur loc — serviciul.

**Observații / decizii luate / abateri de la plan:**

- **Vederile de listă sunt în URL, nu în cookie.** Firma și luna sunt context global și stau în
  cookie; vederea e a ecranului, deci se poate da bookmark și trimite pe chat. Cheia unei vederi e
  și sub-slugul ei de navigare, așa că `/contracte/plafoane` din sidebar redirectează la
  `?view=plafoane` în loc să caute un contract cu id-ul „plafoane” și să dea 404. Intrările de
  meniu prevăzute în §3 rămân navigabile fără a doua pagină de listă.
- **Tab-urile primesc sub-segmente.** `/contracte/{id}/componente/{componentId}` e cifra desfăcută
  (I3), nu o pagină nouă. Același mecanism ține comutatorul brută/netă din Financiar: e o rută, ca
  linkul trimis pe chat să deschidă exact cifra pe care a văzut-o expeditorul.
- **Antetul poate fi asincron.** Barele de progres ale contractului se calculează din plafoanele
  lunii selectate, iar luna vine din context, nu din rând. Antetul și tab-ul Prezentare cer
  aceleași cifre și sunt randate în paralel, deci `getContractOverview` e memoizat cu `cache()` —
  altfel ecranul central al firmei ar face de două ori același set de interogări și ar putea afișa
  două adevăruri.
- **Tonul barei de Delta e dat EXPLICIT**, și e inversul celui implicit. `ProgressBar` colorează
  peste 80% în portocaliu, ceea ce e corect pentru consum și fix pe dos pentru umplere: o Delta
  umplută 90% ar fi arătat ca o depășire de buget. Singurul loc din tot pasul unde se scrie `tone`
  împotriva regulii implicite, și motivul e comentat acolo.
- **Consum și marjă în listă sunt „—”, nu 0.** Rollup-urile vin în pasul 06. Un zero inventat s-ar
  citi ca o cifră reală; liniuța spune că nu se știe încă, iar `notice`-ul listei spune de ce.
- **Control de formular nou: `geo`.** Un singur control pentru pereche, nu două câmpuri de text —
  latitudinea și longitudinea nu au sens separat, iar baza le cere pe amândouă sau pe niciuna.
  Clicul pe hartă scrie în câmpuri cu `shouldDirty`, altfel o coordonată pusă doar de pe hartă n-ar
  fi cerut confirmare la închiderea formularului, adică munca omului s-ar fi pierdut tăcut.
- **Obiectivele fără coordonate se numără sub hartă.** Un obiectiv care lipsește de pe hartă pentru
  că n-are pin arată identic cu unul care nu există — și atunci nimeni nu-i completează
  coordonatele.
- **`leaflet` e dependință nouă** în `apps/web` (fără `react-leaflet`: harta se conduce imperativ,
  o dependință în loc de două). Se încarcă dinamic în `useEffect` — modulul atinge `window` la
  import. **Atenție:** adăugarea lui a stricat cache-ul `.next` și build-ul a picat cu
  `Cannot find module './115.js'`; se repară ștergând `apps/web/.next`.
- **Acoperirea inspecțiilor stă sub lista de obiective a contractului**, nu într-un tab propriu:
  lista de tab-uri din §3.3 e explicită și n-are unul. Vederea `/obiective/acoperire` e alegătorul
  de contract — frecvențele stau pe legătură, deci un tabel global ar fi trebuit să aleagă una din
  frecvențele aceluiași obiectiv și să le ascundă pe celelalte.

**Ce rămâne pentru sesiunea următoare:**
1. `pnpm db:seed` + parcurs pe date reale: verificările #7, #8, #9, #12, #13, #14.
2. Push → CI (testele de bază de date sunt neatinse, ar trebui să rămână 182).
3. Playwright pentru #13 din pasul 03 (1200 px / 390 px) — acum există și ecrane cu hartă.
4. Lista de persoane în formularul de contract (câmpul PM e gol până la 02d).

### 2026-08-16 — [status: gata] — 04b, parcursul pe date reale

**Ce s-a executat:**

- Push pe `main` (`fca60ec`) → **CI verde, toate cele 4 joburi**, 182 de teste de bază de date
  neatinse, ca prevăzut.
- Parcurs pe seed, prin randarea reală a paginilor, pe contractul `4700` și obiectivul `OB-001`.

**Verificări din pas care trec / nu trec:**
- [x] #7 cele trei benzi pe Mar 2026: Mentenanță `30.000 / 18.000 / 0 / 0 / rest 18.000`,
  Lucrări `14.000 / 9.500 / 0 / 0 / rest 9.500`, Delta `plafon 20.000 · umplut 7.600 ·
  neumplut 12.400 · 38%`, cu „12.400,00 RON se pierd dacă luna se închide așa”. Pe o lună fără
  plafoane setate banda spune „Plafon nesetat”, nu 0 — corect.
- [x] #8 navigarea pe luni schimbă contextul global; pe o lună închisă apar lacătul, titlul
  „Luna e închisă…” și bannerul „Luna ianuarie 2026 este închisă”. Verificat închizând temporar
  ianuarie 2026 și redeschizând-o după.
- [x] #9 click pe componentă → `/contracte/{id}/componente/{componentId}`, `EmptyState` cu
  „Nicio unitate de lucru finanțată din Mentenanță” și `Total: 0,00 RON · analitica: folosit`.
- [x] #12 obiectivul e pe **2 contracte simultan**, cu perioadele lor (`4700` din 01 mar. 2026
  fără sfârșit, `5100` 01 apr. → 31 oct. 2026), la firme diferite.
- [x] #13 tab-ul Istoric e etichetat „analitica: **folosit** — nu pe «descărcat»”.
- [~] #14 comutatorul tabel/hartă merge (vederea `?view=harta` randează „21 obiective pe
  hartă”, coloana Coordonate are pin doar unde există). **Clicul pe hartă la creare n-a fost
  confirmat în browser** — extensia Chrome nu era conectată, iar Playwright nu e încă instalat.
  Rămâne singura verificare a pasului confirmată doar din cod.

**Trei buguri găsite la parcurs, toate reparate:**

1. **Seed-ul nu era repetabil, deși se declara determinist.** `createContract` și
   `createInspectionProfile` își generează singure id-ul, deci `IDS.contractMaintenance` și
   `IDS.profile*` nu ajungeau niciodată în baza de date. Consecința: `exists()` întorcea mereu
   `false`, `wipe()` nu ștergea nimic, și a doua rulare cădea cu `CONFLICT: Există deja un
   contract cu codul 4700`. Reparat: `createContract` acceptă un `id` impus din afară (îl
   folosește doar seed-ul), iar `wipe()` caută contractele și profilele după **cheia naturală**
   — cod + firmă, respectiv nume — ca să prindă și ce au lăsat rulările vechi. `wipe()` șterge
   acum rândurile de profil după **ambele** capete, profil și fișă; altfel fișele rămâneau
   referite și ștergerea cădea cu `23503`.
2. **`deltaFill` spunea „mai ai o zi” pe o lună deja încheiată.** Pe o lună trecută serviciul
   trimite ultima ei zi ca `asOf`, iar `daysLeft` numără ziua curentă inclusiv — corect doar
   când ea chiar e azi. Pe o lună închisă nu mai e nimic de umplut. Adăugat `monthEnded` în
   `DeltaFillInput`, pus de serviciu din comparația perioadei cu luna curentă; **un test nou**
   blochează regresia (`daysLeft` 0, ritm cerut 100%).
3. **Un UUID brut pe ecran.** Banda Delta afișa „Legătura e pregătită pe contractul
   `01950000`…” — un fragment de id care nu spune nimic nimănui. Scos; propoziția despre pasul
   08 rămâne.

**Observații:**

- Contextul de lună fiind în cookie (`damina_ctx`), parcursul s-a putut face fără browser,
  cerând paginile cu cookie-ul pus pe luna dorită. E o consecință utilă a deciziei din 04b, nu
  ceva construit pentru asta.
- Plafoanele din seed stau pe **03–05/2026**, iar aplicația se deschide pe luna curentă, deci
  pe august benzile arată „Plafon nesetat”. Nu e bug — dar la primul parcurs arată gol.

**Ce rămâne pentru sesiunea următoare:**
1. Playwright: #13 din pasul 03 (1200 px / 390 px) **și** clicul pe hartă din #14, singura
   verificare rămasă neconfirmată în browser.
2. Lista de persoane în formularul de contract (câmpul PM e gol până la 02d).
3. Pasul 05 — Unitate de Lucru, finanțare.

---

## Pasul 05 — Unitate de Lucru, finanțare

*(nicio sesiune n-a lucrat încă aici)*

---

## Pasul 06 — Registrul de cost, închidere

*(nicio sesiune n-a lucrat încă aici)*

---

## Pasul 07 — File management (R2)

*(nicio sesiune n-a lucrat încă aici)*

---

## Pasul 08 — Cereri, rutare, backlog

*(nicio sesiune n-a lucrat încă aici)*

---

## Pasul 09 — Fișe de lucru

*(nicio sesiune n-a lucrat încă aici)*

---

## Pasul 10 — Teren offline, raport lunar

*(nicio sesiune n-a lucrat încă aici)*

---

## Format pentru o intrare nouă (copiază șablonul ăsta sub pasul potrivit)

```
### 2026-08-14 — [status: în lucru / gata / blocat]

**Ce s-a executat:**
- ...

**Verificări din pas care trec / nu trec:**
- [x] #1 ...
- [ ] #7 ... — nu trece încă, motiv: ...

**Observații / decizii luate / abateri de la plan:**
- ...

**Ce rămâne pentru sesiunea următoare:**
- ...
```
