# Damina ERP — jurnal de progres

> **Regulă pentru orice sesiune AI care lucrează la un pas din `Plan/`:**
> - La **început de sesiune**, citește secțiunea pasului tău de mai jos (dacă există) înainte să începi.
> - **După ce termini pasul** (sau o bucată semnificativă din el), adaugă/actualizează intrarea lui.
> - **Ori de câte ori observi ceva relevant** în timpul codării sau testării (o decizie luată, o abatere de la plan, un bug găsit, o presupunere făcută pentru că planul nu specifica) — notează imediat în „Observații", nu la final. Nu aștepta să termini tot pasul.
> - Nu șterge istoricul altor sesiuni. Adaugă, nu suprascrie.
> - Ține fiecare intrare **scurtă și concretă** — fapte, nu narațiune.

---

## Stare curentă

| Pas | Status | Ultima actualizare |
|---|---|---|
| 01 — Fundația | 🟩 gata (15/15, CI verde) | 2026-08-15 |
| 02 — Identitate, acces, RLS | ⬜ neînceput | — |
| 03 — Shell UI, nomenclatoare | ⬜ neînceput | — |
| 04 — Contracte, obiective | ⬜ neînceput | — |
| 05 — Unitate de Lucru, finanțare | ⬜ neînceput | — |
| 06 — Registrul de cost, închidere | ⬜ neînceput | — |
| 07 — File management (R2) | ⬜ neînceput | — |
| 08 — Cereri, rutare, backlog | ⬜ neînceput | — |
| 09 — Fișe de lucru | ⬜ neînceput | — |
| 10 — Teren offline, raport lunar | ⬜ neînceput | — |

Legendă: ⬜ neînceput · 🟨 în lucru · 🟩 gata (toate verificările din pas trec) · 🟥 blocat

**Actualizează tabelul de mai sus de fiecare dată** când schimbi statusul unui pas.

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

*(nicio sesiune n-a lucrat încă aici)*

---

## Pasul 03 — Shell UI, nomenclatoare

*(nicio sesiune n-a lucrat încă aici)*

---

## Pasul 04 — Contracte, obiective

*(nicio sesiune n-a lucrat încă aici)*

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
