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

### Î6 — `citext` și `btree_gist` stau în `public`, nu în `extensions`

Convenția Supabase e schema `extensions`; acolo sunt deja `pgcrypto` și `uuid-ossp`. Noi le-am
pus în `public`, și nu din neatenție.

Rolurile noastre sunt `NOLOGIN` și se intră în ele prin `SET ROLE`. `alter role … set
search_path` se aplică **la conectare**, după utilizatorul de sesiune — deci nu ajunge
niciodată la `app_office` & co. Operatorii `citext = citext` se rezolvă prin `search_path`,
care implicit e `"$user", public`. Din `extensions`, orice `where email = $1` ar fi picat cu
„operator does not exist" pentru fiecare persona.

`btree_gist` nu are problema asta (clasele de operatori implicite se rezolvă după tip, nu după
`search_path`), dar l-am pus în același loc ca să fie o singură regulă.

**Consecință acceptată:** advisor-ul Supabase va semnala `extension_in_public`. `public` rămâne
fără tabele — extensiile adaugă doar tipuri, funcții și clase de operatori — deci invarianta
din pasul 01 se păstrează.

### Î7 — Motivul scris ține până la finalul tranzacției

`app.action_reason` se pune o dată per tranzacție (de `withActor`, din `Actor.reason`, sau de
`app.allow_closed_period_writes()`). Dacă un use-case deschide ușa de avarie și apoi modifică,
în aceeași tranzacție, și altceva care cere motiv, a doua modificare **moștenește** motivul
primei.

**Ales:** îl lăsăm așa. Un use-case = o tranzacție = o unitate de lucru cu un singur motiv, și
asta e chiar modelul dorit. Alternativa — motiv per instrucțiune — ar cere ca fiecare `update`
să și-l seteze pe al lui, ceea ce se uită exact atunci când contează.

**De reevaluat dacă:** apare un use-case care chiar face două acțiuni ireversibile diferite în
aceeași tranzacție. Până acum nu există niciunul.

### Î8 — Numerotarea RLS: `0008`/`0009`, nu `0013`/`0014`

Anexa C.16 pune politicile RLS și `REVOKE`-urile pe coloane ultimele din faza 0. Pasul 02
§3.8–3.9 le cere acum. Cele două nu pot fi ambele adevărate.

**Ales (decizia utilizatorului, 15 august 2026): acum.** Anexa presupunea o fază 0 executată
dintr-o bucată; noi mergem pe pași, iar între pasul 02 și pasul 09 s-ar fi creat zeci de tabele
fără politici. Plasa e testul generic din 02b: orice tabelă din `app` fără RLS sau fără nicio
politică sparge build-ul, deci fiecare pas următor e obligat să-și aducă propriul fișier de
politici.

**Consecință, aflată în pasul 04:** RLS n-a apucat să ia `0008` — pasul 03 l-a luat pentru
nomenclatoare, iar contractele au luat `0009`/`0010`. Vezi Î9.

### Î9 — Numerotarea migrărilor s-a decalat a doua oară

Pasul 04 cere `0011_contracts` și `0012_objectives`. Ele au ieșit `0009` și `0010`, pentru că
drizzle numerotează în ordinea creării și 02b n-a fost încă executat.

**Ales:** urmăm ordinea reală de execuție, nu numerele din plan. **02b ia acum `0011`–`0012`.**
Numerele din documentele de plan trebuie citite ca „migrarea în care se face treaba asta”, nu ca
un identificator. Alternativa — să rezervăm numere goale — ar însemna fișiere de migrare vide în
istoric, iar drizzle nu le acceptă oricum.

**De reevaluat dacă:** vreodată se aplică două migrări cu același număr din ramuri diferite.
Atunci numerotarea trebuie să devină un timestamp, nu un contor.

### Î10 — Motivul scris la plafoane: și la creare, sau doar la modificare?

Regula 7 a pasului 04 spune „modificarea de plafon cere motiv scris”. Verificarea #5 a aceluiași
pas cere însă ca și **prima setare** fără motiv să fie respinsă. Decizia din 02a spune că motivul
se cere la `UPDATE` și `DELETE`, nu la `INSERT` — a crea ceva nu e ireversibil.

**Ales: amândouă, pe straturi diferite.** Baza păstrează regula din 02a (`attach_audit(...,
true)` → motiv la UPDATE/DELETE), iar `setCostCeiling`/`setRevenueCeiling` cer motiv și la
creare, prin schema Zod. Motivul pentru care nu s-a slăbit regula din baza: `attach_audit` e
folosit de zece tabele, iar o a treia variantă de comportament („motiv și la insert”) ar fi
însemnat un parametru în plus pe care fiecare pas viitor trebuie să-l nimerească. Un plafon nu se
setează niciodată din altă parte decât prin cele două use-case-uri.

**De reevaluat dacă:** apare o a doua tabelă la care crearea trebuie justificată. Atunci merită
al treilea mod în `attach_audit`.

### Î11 — Anii contractuali: trigger în bază sau serviciu?

Verificarea #1 spune „se generează **automat** 4 `contract_years`”. Automat pentru cine îl
folosește; întrebarea e unde stă aritmetica.

**Ales: în serviciu, peste `buildContractYears` din `@damina/domain`.** Un trigger plpgsql ar fi
fost a doua implementare a aceleiași reguli — compunerea an de an, rotunjirea la ban, aniversarea
pe 29 februarie — iar două implementări diverg la prima corecție. Atomicitatea o dă tranzacția
din `createContract`: un contract fără ani n-a existat niciodată. Prețul: un `insert` direct în
`app.contracts`, din `psql`, nu produce ani. E acceptabil — nimic din aplicație nu scrie așa, iar
seed-ul trece dinadins prin servicii tocmai ca să nu creeze stări la care aplicația n-ar ajunge.

---

## Deciziile fazei 2 — luate înainte de a scrie planul (19 august 2026)

Cele șase întrebări care blocau redactarea pașilor 11–15. **Toate închise de utilizator. Nu se
redeschid fără el.**

### D1 — Faza 2 se taie în cinci pași

`11` deviz · `12` pachete + portal · `13` situații de lucrări · `14` suplimentări, garanții, SL client ·
`15` execuția și închiderea. Fiecare cu 2–3 sub-pași, ca o sesiune să nu se termine la jumătate —
convenția care a mers la 08, 09 și 10.

### D2 — Etapa pe necesarul de material: precompletată, nu în plus

Tensiunea: §9 cere `stage_id` obligatoriu pe necesar, dar bugetul de tapuri e 3 și blocant în CI, iar
`＋` plus alegerea acțiunii consumă deja două.

**Ales: varianta (a).** Etapa se precompletează cu **etapa curentă din grafic** și se schimbă dintr-un
tap **opțional**. Obligatorie în date (trigger), precompletată pe ecran. Selectorul nu apare deloc dacă
UL-ul nu e lucrare sau lucrarea n-are etape — exact ce face deja `Jurnal` de la 10c-4.
**Pragul nu se urcă.** Dacă testul cade, se repară ecranul. Detalii în `15_Executia_Lucrarii.md` §0.

### D3 — Stadiile de cost ale fazei 2

`cost_stage` are `angajat | receptionat | consumat | facturat`.

**Ales: pachet semnat → `angajat`; SL aprobată → `facturat`.** Manopera de subcontractant nu trece prin
`receptionat` sau `consumat` — nu e marfă, nu intră în gestiune. `facturat` înseamnă aici „datorat și
acceptat", nu „există o factură în sistem".

**Nu se adaugă valori noi în enum**, fiindcă `cost_stage` și `cost_document_type` sunt structuri din
faza 0, iar extinderea lor la fiecare document nou al fazei 2 ar însemna migrări pe fundație.
Singura excepție prevăzută: dacă drill-down-ul de la pasul 06 nu poate distinge pachetul de SL doar din
`document_id`, se adaugă `pachet_subc` — **verificat înainte de a scrie linia de cost**, nu după.

### D4 — Importul Excel intră, ca sub-pas care se poate tăia

Modul 4 din §8.2. Cere o dependență nouă (parser `.xlsx`), dar §10.3 confirmă că a fost testat pe fișiere
reale, cu formatare inconsistentă. **Ales: intră ca `11c`**, ultimul sub-pas al pasului 11 — poziția din
care se poate amâna fără să lase altceva neterminat.

### D5 — Portalul de subcontractant nu cere MFA

Sunt utilizatori externi, provizionați cu parolă temporară afișată o singură dată. **Ales: fără MFA pe
`app_subcontractor`**, dar **schimbarea parolei la prima intrare e obligatorie** — asta înlocuiește al
doilea factor. Nu se construiește nimic pe `MFA_ENFORCED`: e o poartă oprită, nu un drept dat.

### D6 — SL-ul către client intră în faza 2, factura rămâne faza 5

Anexa D.3 pune `sl_client` în faza 2, dar el produce factura, care e faza 5. **Ales: tabela și derivarea
prin mapare intră acum** (pasul 6a din §10.1); emiterea facturii rămâne faza 5. Același tipar ca blocajul
de facturare implementat la raportul lunar înainte să existe ecranul de facturare.

### Contradicția rezolvată pe parcurs — cine vede devizul

`PLAN_TEHNIC` §4.4 dă ca exemplu `GRANT SELECT (…) ON app.deviz_lines TO app_field`. §10.3 din business
spune că șeful de șantier **nu vede devizul deloc**.

**Câștigă business-ul** (ordinea din acest README: business > funcțional > tehnic). `app_field` nu
primește niciun grant pe tabelele de deviz. §4.4 rămâne corect ca descriere a mecanismului; doar exemplul
lui e ales nefericit. Terenul își ia cantitățile din `v_sl_lines_field` și `v_package_lines_field`.

### Ce s-a construit mai devreme decât prevedea Anexa D.3

- **`work_journal_entries`** (D.3, faza 2) = **`app.journal_entries`**, construită la **10c-4**, la cererea
  utilizatorului. **Nu se dublează.** Faza 2 adaugă doar coloana `kind` pentru secțiunea fixă Înainte/După.
- **`work_stages`** e completă din **pasul 05**. Faza 2 construiește Gantt-ul peste ea, nu tabela.
- **`material_requirements`** (D.3, faza 2) **nu exista** — necesarul de teren de azi produce un `Request`
  generic de tip `solicitare`, fără linii și fără etapă. Se construiește la pasul 15.

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
