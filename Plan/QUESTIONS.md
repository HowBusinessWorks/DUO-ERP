# Întrebări deschise

> Regulă din `00_README.md`: dacă ceva nu e specificat în fișierul pasului sau în documentele-sursă,
> **nu se inventează**. Se notează aici și se alege varianta cea mai simplă și reversibilă.

---

## Deschise după pasul 01

### Î1 — Rolul cu care rulează migrațiile în producție

`app_runtime` e `NOINHERIT` și nu poate crea scheme. Migrațiile rulează acum cu rolul
`postgres` al proiectului Supabase. Pentru staging/producție trebuie decis dacă rămâne așa
sau dacă se creează un rol dedicat `app_migrator`.

**Ales provizoriu:** `postgres`, pentru că e reversibil și nu blochează pasul 01.
**De decis la:** primul deploy real (pasul 09-10).

### Î2 — RLS pe `app.companies`

Tabela există din pasul 01, dar RLS nu e activat pe ea. Pasul 01 spune explicit „nu scrii
politici RLS pe tabele care nu există încă — pasul 02", iar inventarul de migrări pune toate
politicile în `0013_rls_policies`.

**Ales provizoriu:** fără RLS pe `companies`, doar grant-uri de tabelă.
**De rezolvat la:** pasul 02, migrarea `0013`. **Nu se pune date reale în tabelă până atunci.**

### Î3 — Numerotarea migrărilor față de Anexa C.16

Inventarul din `PLAN_TEHNIC` Anexa C.16 începe cu `0001_schemas_and_enums`. `drizzle-kit`
numerotează de la `0000` și deține el indexul (`meta/_journal.json`). Numele coincid,
indexul e decalat cu unu.

| Anexa C.16 | În repo |
|---|---|
| `0001_schemas_and_enums` | `0000_schemas_and_enums` |
| `0002_pg_roles_and_grants` | `0001_pg_roles_and_grants` |
| `0003_bootstrap_tables` | `0002_bootstrap_tables` |
| — (nou) | `0003_jobs_runtime_tables` |

**Ales:** se respectă numerotarea drizzle. A o forța ar strica generarea următoarelor migrări.

### Î4 — Unde trăiesc tipurile `Actor` și `PgRole`

Pasul 01 spune că `packages/auth` conține „doar tipurile Persona/Actor". Dar `withActor` din
`packages/db` are nevoie de `Actor`, iar `db` nu are voie să importe `auth` — s-ar închide un
ciclu în graful de dependențe.

**Ales:** `Persona` în `@damina/shared` (frunză, vizibilă de toți), `Actor`/`PgRole` în
`@damina/db`, iar `@damina/auth` le re-exportă pe amândouă. Consumatorii importă din `auth`,
exact cum prevedea planul.

### Î5 — Cuplajul cu schema internă a pg-boss

Enqueue-ul tranzacțional nu poate folosi `boss.send()`, care își deschide propria conexiune.
`packages/jobs/src/enqueue.ts` reproduce interogarea de insert a lui pg-boss
(`plans.insertJobs`, versiunea 10.x) peste tranzacția noastră.

**Risc:** un major nou de pg-boss poate schimba schema.
**Mitigare:** versiunea e pinuită la `^10`, iar `test:db` verifică lanțul complet — dacă
schema se schimbă, CI-ul pică înainte de deploy.

---

## Închise

### Sentry — tăiat din pasul 01

`PLAN_TEHNIC` §14 îl prevede. Decizia utilizatorului (14 august 2026): nu se instalează acum.
Rămân `pino` (loguri JSON structurate cu `request_id`, `actor_id`, `use_case`, `duration_ms`)
și `/api/health`. Se reevaluează la pașii 09-10, când există utilizatori reali pe teren.

### Mediu de dezvoltare — totul în cloud

`PLAN_TEHNIC` §16.1 prevede Supabase CLI pe Docker local și MinIO. Decizia utilizatorului
(14 august 2026): zero Docker local. Se dezvoltă direct pe proiectul Supabase cloud
(un singur proiect, de dev) și pe R2 real. Consecință: `test:db` (Testcontainers) rulează
**doar în CI**, pe GitHub Actions.
