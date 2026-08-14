# Damina ERP

ERP intern pentru grupul Damina — 5 firme de construcții și mentenanță, București.
Planul de execuție e în [`Plan/`](Plan/00_README.md); starea curentă, în [`Plan/PROGRESS.md`](Plan/PROGRESS.md).

## Pornire rapidă

```bash
pnpm install                          # Node ≥ 20, pnpm ≥ 9
cp .env.example .env.local            # completează DATABASE_URL* și cheile R2
pnpm db:migrate                       # aplică migrațiile pe baza din .env.local
pnpm --filter @damina/db db:set-runtime-password   # o singură dată per mediu
pnpm dev                              # web pe http://localhost:3000
```

Worker-ul (cozile pg-boss) e un proces separat, în alt terminal:

```bash
pnpm --filter @damina/worker dev
```

Verificare că totul e legat: `curl localhost:3000/api/health` → `db`, `r2` și `worker` pe `ok`.

Reconstruire completă a bazei (**șterge tot**, cere `ALLOW_DB_RESET=true` în `.env.local`):
`pnpm db:reset`

## Ce e unde

| Cale                                    | Ce conține                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/web`                              | Next.js 15, cele 5 route-groups: `(auth) (office) (field) (portal) (public)` |
| `apps/worker`                           | consumer pg-boss, proces persistent                                          |
| `packages/shared`                       | `Money`, `Quantity`, `Period`, `Result`, `AppError`, `uuidv7`                |
| `packages/db`                           | schema Drizzle, migrații, `withActor()` — singura poartă către Postgres      |
| `packages/domain`                       | reguli de business pure, fără I/O                                            |
| `packages/services`                     | use-case-uri; singurul strat care deschide tranzacții                        |
| `packages/storage`                      | client Cloudflare R2, multipart, presign                                     |
| `packages/jobs`                         | definiții de cozi + enqueue tranzacțional                                    |
| `packages/contracts` `ui` `i18n` `auth` | scheme Zod, design system, dicționar ro-RO, identitate                       |

## Comenzi

| Comandă                                  | Ce face                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm lint`                              | ESLint pe tot repo-ul, inclusiv **regula de dependențe** între pachete                      |
| `pnpm typecheck`                         | `tsc --noEmit` pe fiecare pachet                                                            |
| `pnpm test`                              | teste unitare (Vitest)                                                                      |
| `pnpm test:db`                           | migrații de la zero + roluri + RLS, pe Postgres efemer — **necesită Docker, rulează în CI** |
| `pnpm build`                             | build de producție                                                                          |
| `pnpm scan:secrets`                      | verifică că niciun secret nu a ajuns în `.next/static`                                      |
| `pnpm --filter @damina/storage smoke:r2` | upload multipart 20 MB + download + SHA-256                                                 |
| `pnpm --filter @damina/worker ping`      | verifică enqueue-ul tranzacțional (inclusiv rollback)                                       |

## Reguli care nu se negociază

1. **Tot accesul la DB trece prin `withActor()`.** `pool` nu se exportă din `packages/db`. Fără excepții, inclusiv din server actions și din worker.
2. **Nimic prin dashboard-ul Supabase.** Orice schemă, politică sau grant e o migrare versionată în repo.
3. **Migrațiile sunt imutabile după merge.** Corecția e o migrare nouă.
4. **`float` e interzis pe valori monetare**, în DB și în TypeScript. Bani = `numeric(14,2)` + `Money`.
5. **TypeScript `strict`**, `noUncheckedIndexedAccess`, zero `any` în cod de producție.
6. **Zero string-uri de UI hardcodate.** Tot textul trece prin `packages/i18n`.
7. **Limbă:** cod și DB în engleză; domeniu intraductibil în română fără diacritice (`deviz`, `aviz`, `nir`, `pontaj`); UI 100% română cu diacritice.
