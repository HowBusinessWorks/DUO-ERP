# Pasul 01 — Fundația: monorepo, bază de date, storage, joburi, CI

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie o linie de cod. Nu presupune nimic din alte sesiuni.
> **Rezultatul pasului:** un schelet care rulează, se conectează la Postgres cu roluri și RLS pregătite, urcă un fișier în R2, procesează un job în worker și trece CI-ul. **Zero ecrane de business.**

---

## 0. Context minim (ce construim, de fapt)

Damina e un grup de **5 firme** de construcții și mentenanță (București). Construim un ERP intern care acoperă: contracte de mentenanță multianuale, lucrări, achiziții, stoc, flotă, facturare.

Scara reală: **30–40 utilizatori, ~20 concomitent pe mobil**. Sistemul nu cade sub trafic — cade sub **complexitate de date și reguli**. Deci: optimizăm pentru corectitudine și izolare, nu pentru throughput. **Nu** facem cache distribuit, read replicas, partiționare, microservicii.

Patru lucruri din arhitectură determină tot ce urmează și trebuie să fie corecte de la primul commit:

1. **Șeful de șantier nu vede prețuri — la nivel de date, nu de UI.** Se rezolvă cu roluri Postgres separate + `REVOKE` pe coloane + view-uri per persona.
2. **Închiderea de lună blochează modificările** — prin trigger în DB, nu prin verificare în serviciu.
3. **Dubla analitică pe fiecare cost** („folosit" vs „descărcat") — două perechi de coloane de la prima migrare, retrofit-ul e dureros.
4. **Aplicația de teren funcționează offline** — deci ID-urile se generează pe client (UUID v7).

Stack fixat, nu se renegociază: **Next.js 15 (App Router) · Supabase (Postgres 15 + Auth + Realtime) · Drizzle ORM · Cloudflare R2 · pg-boss · pnpm + Turborepo**.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §0 (deciziile), §2 (topologie), §3 (monorepo), §4.1–4.2 (Supabase, convenții de schemă), §5 (`withActor`), §9 (R2), §10 (joburi), §14 (observabilitate), §16 (medii, CI), Anexa B (variabile de mediu), Anexa C.0 (enumerări) |

Restul documentelor **nu sunt necesare** în pasul ăsta.

## 2. Precondiții

Nimic. E primul pas. Verifică doar că ai instalate: Node ≥ 20, pnpm ≥ 9, Docker Desktop, Supabase CLI, Git.

---

## 3. Ce livrezi

### 3.1 Monorepo

```
damina-erp/
├─ apps/
│  ├─ web/                    # Next.js 15, App Router, TypeScript strict
│  │  └─ src/app/
│  │     ├─ (auth)/ (office)/ (field)/ (portal)/ (public)/   # doar layout-uri goale
│  │     └─ api/health/route.ts
│  └─ worker/                 # consumer pg-boss, Node, container
├─ packages/
│  ├─ db/                     # schema Drizzle, migrații, politici, seed, withActor
│  ├─ domain/                 # reguli pure, fără I/O
│  ├─ services/               # use-case-uri (singurul loc cu tranzacții)
│  ├─ contracts/              # scheme Zod
│  ├─ auth/                   # gol în pasul ăsta, doar tipurile Persona/Actor
│  ├─ storage/                # client R2, presign, chei
│  ├─ jobs/                   # definiții de job + client de enqueue
│  ├─ ui/                     # gol în pasul ăsta
│  ├─ i18n/                   # dicționar ro-RO, doar scheletul
│  └─ shared/                 # Money, Period, Result, AppError, uuid v7
├─ tools/{eslint-config,tsconfig}/
├─ supabase/                  # config local + migrații
├─ turbo.json · pnpm-workspace.yaml · .github/workflows/ci.yml
```

**Regula de dependențe** (impusă cu `eslint-plugin-boundaries`, blocantă în CI):

```
ui ──▶ contracts ──▶ shared
web ──▶ services ──▶ domain ──▶ shared
worker ──▶ services            └──▶ db ──▶ shared
web/worker ──▶ auth ──▶ db
```

`domain` **nu are voie** să importe `db`. `apps/*` **nu au voie** să importe `drizzle` direct.

Task-uri Turborepo: `build`, `dev`, `lint`, `typecheck`, `test`, `test:db`, `db:generate`, `db:migrate`.

### 3.2 `packages/shared` — tipurile de bază

- **`Money`** — wrapper peste `Decimal.js`. Operații: `add`, `sub`, `mul`, `div`, `allocate` (împărțire fără pierdere de bani), `toDbString()` (→ `numeric(14,2)`), `fromDb()`, `format('ro-RO')`. **Interzis** `number` pe valori.
- **`Quantity`** — la fel, dar 4 zecimale.
- **`Period`** — `{ year, month }`, cu `fromDate`, `next`, `prev`, `toKey()` → `"2026-08"`.
- **`Result<T, E>`** — pentru erori așteptate.
- **`AppError`** — cod stabil + payload. Coduri inițiale: `PERIOD_CLOSED`, `PRICE_FORBIDDEN`, `AUTHORIZATION_EXPIRED`, `QUANTITY_EXCEEDS_CONTRACT`, `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`.
- **`uuidv7()`** — generator client-side, ordonat temporal.

### 3.3 Baza de date — doar fundația

Supabase local prin CLI (Docker). Migrațiile se scriu în `packages/db/migrations`, aplicate cu `drizzle-kit migrate`.

**Migrarea `0001_schemas_and_enums`:**

```sql
create schema app;      -- business
create schema audit;    -- jurnale
create schema jobs;     -- pg-boss
-- public rămâne gol
```

Plus **toate** tipurile enumerate din `PLAN_TEHNIC_INFRASTRUCTURA.md` Anexa C.0 (persona, office_role, contract_type, component_type, work_unit_type, request_type, expense_type, cost_stage, cost_document_type, period_status, node_kind, location_type etc.). Le creezi pe toate acum, chiar dacă tabelele vin în pașii următori — costă zero și evită migrări de tip mai târziu.

**Migrarea `0002_pg_roles_and_grants`:**

```sql
create role app_office        nologin;
create role app_field         nologin;
create role app_subcontractor nologin;
create role app_client        nologin;
create role app_service       nologin;

create role app_runtime login password '...';   -- singurul cu care se conectează aplicația
grant app_office, app_field, app_subcontractor, app_client, app_service to app_runtime;

grant usage on schema app to app_office, app_field, app_subcontractor, app_client, app_service;
```

**Migrarea `0003_bootstrap_tables`** — strict minimul ca să existe ceva de testat:

```sql
app.companies (id uuid pk, name text not null, cui text unique, is_active boolean default true,
               created_at timestamptz default now());
```

Atât. Restul organizației vine în pasul 02.

**Convenții obligatorii** (`PLAN_TEHNIC` §4.2): `uuid` v7 pentru PK · `timestamptz` pentru timp tehnic, `date` pentru date de business · `numeric(14,2)` bani · `numeric(14,4)` cantități · `numeric(6,4)` procente (0.0500 = 5%) · enum-uri native Postgres · `snake_case`, tabele la plural, FK `<entitate>_id` · soft-delete (`deleted_at`) pe documente.

### 3.4 `withActor` — singura poartă către Postgres

```ts
// packages/db/src/with-actor.ts
export async function withActor<T>(actor: Actor, fn: (tx: ActorTx) => Promise<T>): Promise<T> {
  return pool.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', ${actor.pgRole}, true)`);
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(actor.claims)}, true)`);
    await tx.execute(sql`select set_config('app.actor_id', ${actor.personId}, true)`);
    if (actor.reason) await tx.execute(sql`select set_config('app.action_reason', ${actor.reason}, true)`);
    return fn(tx as ActorTx);
  });
}
```

Reguli:
- `pool` **nu se exportă** din pachet.
- Există și `withServiceActor(jobName, fn)` pentru worker — setează `app.actor_id` la un ID tehnic identificabil și e obligatoriu auditat.
- O regulă ESLint interzice `import ... from 'drizzle-orm/node-postgres'` oriunde în afara `packages/db`.

**Conexiuni:** două connection string-uri distincte — `DATABASE_URL` (Supavisor *transaction pooling*, pentru Vercel) și `DATABASE_URL_SESSION` (*session pooling*, pentru worker și migrații — are nevoie de `LISTEN/NOTIFY`).

### 3.5 Storage — Cloudflare R2

`packages/storage`, client S3-compatibil. Patru bucket-uri, create acum:

| Bucket | Conținut | Lifecycle |
|---|---|---|
| `damina-docs` | versiuni de fișiere, PDF-uri finale | fără expirare |
| `damina-derived` | thumbnails, previzualizări | expirare 180 zile |
| `damina-tmp` | uploaduri incomplete, artefacte de job | expirare automată 7 zile |
| `damina-archive` | rapoarte înghețate, audit, backup | Infrequent Access |

API-ul pachetului în pasul ăsta: `createMultipartUpload`, `presignPart`, `completeMultipart`, `presignGet(key, ttl)`, `deleteObject`. **Cheile sunt UUID opac, fără cale semantică** — `blobs/{uuid}`, niciodată `contracte/4700/poze/...`.

Local, dezvoltarea merge pe **MinIO** (Docker) sau pe un bucket R2 de dev — configurabil prin `R2_ENDPOINT`.

### 3.6 Joburi — pg-boss + worker

- pg-boss pe **același Postgres**, schema `jobs`. Motivul: enqueue **tranzacțional** cu mutația — dacă tranzacția face rollback, jobul dispare cu ea.
- `packages/jobs`: definiții tipate (`defineJob<Payload>`), client `enqueue(tx, name, payload, { singletonKey })`.
- `apps/worker`: proces persistent, se conectează pe `DATABASE_URL_SESSION`, rulează ca `app_service`.
- În pasul ăsta implementezi **o singură coadă de test**: `system.ping` — scrie un rând într-o tabelă `jobs.ping_log`. Cozile reale vin în pașii lor.
- Reguli de operare valabile de la început: idempotență prin `singletonKey`, retry exponențial max 5, apoi dead-letter cu alertă.

### 3.7 Observabilitate

- **Sentry** pe web și worker, cu `request_id` și `actor_id` în scope.
- **pino** JSON structurat: `request_id`, `actor_id`, `use_case`, `duration_ms`.
- `pg_stat_statements` activ pe DB.
- Un endpoint `/api/health` care verifică: DB reachable, R2 reachable, worker heartbeat recent.

### 3.8 Chei API și variabile de mediu

Creezi `.env.example` complet (fără valori) și `.env.local` (cu valori de dev, **gitignored**). Lista completă — din `PLAN_TEHNIC` Anexa B:

```
DATABASE_URL=                  # transaction pooling — web
DATABASE_URL_SESSION=          # session pooling — worker, migrații
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # NUMAI worker + rute /api dedicate
R2_ACCOUNT_ID= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= R2_ENDPOINT=
R2_BUCKET_DOCS= R2_BUCKET_DERIVED= R2_BUCKET_TMP= R2_BUCKET_ARCHIVE=
PGBOSS_SCHEMA=jobs
SENTRY_DSN= LOG_LEVEL=
APP_URL= APP_TIMEZONE=Europe/Bucharest APP_DEFAULT_LOCALE=ro-RO
```

Variabilele pentru integrări (ANAF, mail, preț motorină) intră în `.env.example` comentate, ca placeholder — se completează în fazele lor.

**Regulă de securitate, verificată automat:** `SUPABASE_SERVICE_ROLE_KEY` și cheile R2 nu apar niciodată în bundle-ul de client. Scrii un test de build care scanează output-ul `.next/static` după aceste string-uri și **eșuează** dacă le găsește.

### 3.9 CI

`.github/workflows/ci.yml`:

```
push → lint + typecheck (Turbo, doar pachetele afectate)
     → test:unit (Vitest, domain + shared)
     → test:db (Vitest + Testcontainers Postgres: migrații de la zero)
     → build
     → scan de secrete în bundle
```

Plus: Dependabot activ, `pnpm audit` blocant pe severitate `high`.

---

## 4. Reguli care nu se negociază

1. **Tot accesul la DB prin `withActor`.** Fără excepții, inclusiv din server actions și din worker.
2. **Nimic prin dashboard-ul Supabase.** Ce e făcut prin click nu există în code review și nu ajunge identic în staging.
3. **Migrațiile sunt imutabile după merge.** Corecția e o migrare nouă.
4. **`float` e interzis pe valori monetare**, în DB și în TypeScript. Lint rule dacă e posibil.
5. **TypeScript `strict: true`**, `noUncheckedIndexedAccess: true`. Fără `any` în cod de producție.
6. **Zero string-uri de UI hardcodate.** Chiar dacă `packages/i18n` e aproape gol acum, structura există și se folosește.

## 5. Ce NU faci în pasul ăsta

- Nu creezi tabele de business (contracte, obiective, UL, costuri) — vin în pașii 04–06.
- Nu scrii politici RLS pe tabele care nu există încă — pasul 02.
- Nu construiești ecrane, componente de UI sau design system — pasul 03.
- Nu implementezi autentificarea — pasul 02. Layout-urile celor 4 route-group-uri sunt goale, cu un `<h1>` care spune care e.
- Nu integrezi ANAF, email sau Saga.
- Nu optimizezi nimic. Nu există date.

## 6. Verificare — ce rulezi ca să vezi că e ok

| # | Comandă / acțiune | Rezultat așteptat |
|---|---|---|
| 1 | `pnpm install && pnpm typecheck && pnpm lint` | verde, zero erori |
| 2 | `pnpm db:reset` (drop + migrate de la zero) | rulează complet, reproductibil, fără intervenție manuală |
| 3 | `psql -c "\dn"` | există schemele `app`, `audit`, `jobs`; `public` e gol |
| 4 | `psql -c "select typname from pg_type where typnamespace='app'::regnamespace"` | apar toate enumerările din Anexa C.0 |
| 5 | `psql -c "\du"` | există `app_office`, `app_field`, `app_subcontractor`, `app_client`, `app_service`, `app_runtime` |
| 6 | test: `withActor({pgRole:'app_field'}, tx => tx.execute(sql\`select current_user, current_setting('app.actor_id')\`))` | întoarce `app_field` și actor_id-ul setat |
| 7 | test unitar `Money`: `0.1 + 0.2` prin `Money` | exact `0.30`, nu `0.30000000000000004` |
| 8 | test unitar `Money.allocate(100, [1,1,1])` | `[33.34, 33.33, 33.33]` — suma dă exact 100 |
| 9 | `pnpm dev` + `curl localhost:3000/api/health` | `{ db: "ok", r2: "ok", worker: "ok" }` |
| 10 | script de test: upload multipart de ~20 MB în `damina-tmp`, apoi `presignGet` și download | fișierul descărcat are același SHA-256 |
| 11 | rulezi worker-ul + `enqueue('system.ping')` | rândul apare în `jobs.ping_log` în < 5s |
| 12 | enqueue în tranzacție care face rollback | jobul **nu** se execută (asta validează decizia pg-boss) |
| 13 | `pnpm build` + scan de secrete | `SUPABASE_SERVICE_ROLE_KEY` nu apare în `.next/static` |
| 14 | deschizi `/` , `/office`, `/field` | fiecare randează layout-ul propriu, distinct |
| 15 | push pe o branșă | CI verde end-to-end |

**Test negativ obligatoriu:** un fișier în `apps/web` care importă `drizzle-orm` direct trebuie să **spargă lintul**. Verifică-l o dată, apoi șterge fișierul.

## 7. Definiția de „gata"

- Toate cele 15 verificări trec.
- `pnpm db:reset` reconstruiește baza de la zero pe o mașină curată, fără pași manuali.
- README-ul repo-ului explică în ≤ 20 de linii: cum pornești local, cum rulezi migrațiile, cum pornești worker-ul.
- `.env.example` e complet și comentat.
- Există `Plan/QUESTIONS.md` cu întrebările rămase deschise (dacă sunt).
