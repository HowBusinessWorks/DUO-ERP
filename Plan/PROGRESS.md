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

*Scris la finalul lui 09b-2, 18 august 2026. Citește-l primul; restul fișierului e istoric.*

### Unde s-a ajuns

Pașii **01, 02, 04, 05, 06 și 07 sunt gata**. Pasul **08** e gata pe 08a + 08b; **08c e sărit
dinadins** (vezi secțiunea lui mai jos). Pasul **09** e tăiat în trei, nu în două:

- **09a — fundația** (schemă, triggere, domain pur, servicii): GATA.
- **09b-1 — fișa de INSPECȚIE** (creare de la obiectiv, tab-urile Fișă și Constatări): GATA.
- **09b-2 — fișa de INTERVENȚIE** (Fișă, Materiale, Ore, bara așteptat vs real): GATA.
- **09b-3 — pontaj, stoc și gestiuni, bon de consum**, apoi validarea de birou în masă,
  acoperirea inspecțiilor, istoricul obiectivului, jobul nocturn de stoc și seed-ul de „gata":
  **următorul lucru.**

Tăierea în bucăți mai mici a fost cerută explicit de utilizator, ca o sesiune să nu se termine
la jumătatea unui pas.

### Ce trebuie să știi înainte de 09b-3

**Rulează fiecare use-case pe date reale înainte să scrii ecranul.** A doua sesiune la rând în
care regula asta a plătit: la 09b-1 a scos patru defecte din 09a, la 09b-2 încă trei, toate
tăcute, niciunul prins de typecheck sau de testele existente. Harness-ul se scrie în
`packages/services/scripts/`, se rulează cu `pnpm exec tsx`, și se **șterge** după.

**Pentru 09b-3, cele două capcane deja cunoscute:**

1. **Drizzle numește TOATE coloanele într-un `insert`**, punând `default` pe cele nedate. Deci un
   `grant insert (coloane)` nu poate fi satisfăcut niciodată prin drizzle dacă lista exclude ceva.
   `intervention_materials` a cerut un `insert` scris de mână (vezi 09b-2). `timesheet_lines` are
   aceeași formă de grant — verifică-l din rolul de teren înainte să construiești pontajul.
2. **Extensiile 1:1 pe `work_units` se nasc din trigger**, nu din serviciu (0028). Dacă adaugi
   alta, urmează tiparul: `after insert … when (new.type = …)`, `on conflict do nothing`, backfill
   cu același cod, plasă la final.

---

## 09b-2 — fișa de intervenție, pe ecran (18 august 2026)

### Ce a intrat

- **Trei tab-uri, o singură componentă.** `InterventionSheet` (Fișă · Materiale · Ore) ține
  întotdeauna fișa întreagă și o trimite întreagă, indiferent de secțiunea afișată. Nu e un
  moft: `saveIntervention` șterge și rescrie liniile într-o tranzacție, deci o acțiune
  „salvează doar materialele" ar fi șters orele omului care era pe celălalt tab.
- `saveInterventionAction` și `validateInterventionAction` în `sheet-actions.ts`, pe aceleași
  două drepturi ca inspecția: `sheets.write` completează, `sheets.validate` închide.
- **Bara așteptat vs real** pe fișă, după validare, cu marcaj când abaterea trece pragul.
  Cifrele vin din `computeVariance`, calculate la validare și scrise pe fișă — ecranul nu le
  recalculează.
- `listTeamOptions(actor, companyIds)` — echipa **și gestiunea ei**, citite împreună: alegerea
  echipei pe fișă decide din ce gestiune ies materialele.
- `listOperations` / `getOperation` au acum `withMoney`, ca restul citirilor.
- Migrările `0027_field_catalog_and_insert_grants` și `0028_intervention_row_by_trigger` —
  amândouă repară, vezi mai jos.
- **7 teste noi de servicii** (`tests/interventions.test.ts`), inclusiv verificarea #9 scrisă
  invers: o validare care cade pe stoc insuficient nu lasă nici bon, nici cost, nici sold mișcat.

### Trei defecte găsite de smoke, niciunul introdus aici

Toate trei pe **drumul terenului** — singurul care nu fusese chemat niciodată:

1. **Terenul nu putea deschide o fișă de intervenție. Deloc.** `getInterventionSheet` face
   `left join app.operation_catalog`, iar catalogul intrase în 0025 ca nomenclator de birou: fără
   politică și fără grant pentru `app_field`. Reparat în `0027`, după tiparul lui `app.products`:
   citire pentru toți, **pe coloane enumerate**, cu `estimated_labor` și `estimated_material`
   rămase la birou și `assert_no_money_leak` chemată a patra oară ca plasă.
2. **Terenul nu-și putea SALVA fișa.** `0026` dăduse `grant insert (coloane)` pe
   `intervention_materials`, ca `unit_cost` să nu poată fi scris de pe teren — dar **drizzle
   numește toate coloanele tabelei în `insert`**, cu `default` pe cele nedate, iar Postgres cere
   privilegiu pe fiecare coloană *numită*. Reparat pe două căi: `created_at` adăugat la grant
   (`0027`, și pe `timesheet_lines` și `inspection_findings`, care au aceeași formă), iar inserția
   materialelor rescrisă **de mână**, cu doar coloanele acordate. Alternativa — să i se dea
   terenului `insert` pe `unit_cost` — ar fi însemnat exact renunțarea la protecția pentru care
   coloana fusese scoasă.
3. **O intervenție creată altfel decât prin `createIntervention` n-avea fișă.** Formularul generic
   de Activitate și decizia de rutare din pasul 08 scriu unitatea, nu și rândul din
   `app.interventions` — iar tab-ul Fișă răspundea „nu există sau nu e vizibilă" pentru o unitate
   care exista și era vizibilă. La 09b-1 aceeași problemă pe inspecții a fost rezolvată **invers**,
   prin interzicerea drumului generic, fiindcă un checklist nu se poate ghici. Fișa de intervenție
   n-are nimic de ghicit, deci aici răspunsul corect e trigger-ul din `0028`, cu backfill și plasă.

### Cum a fost verificat

Harness aruncabil pe Supabase dev (șters după), **24 de verificări, toate verde**: crearea,
citirea, dubla salvare, validarea cu bon + mișcare de stoc + cost + `operation_actuals`, refuzul
celei de-a doua validări, citirea și scrierea din rolul de teren, selectorul de operațiuni fără
bani, `select *` refuzat (#24) și fișa născută pe drumul generic.

În CI rămân cele **7 teste de servicii** care nu ating rețeaua.

**Verificări din pasul 09 acoperite aici:** 8, 9, 10, 23 și 24.

---

## 09b-1 — fișa de inspecție, pe ecran (18 august 2026)

### Ce a intrat

- **Un drum unic de creare.** `createWorkUnitFromForm` **refuză** acum `type='inspectie'`:
  formularul generic de Activitate n-are legătura contract–obiectiv, deci pe drumul lui ar fi ieșit
  o inspecție fără checklist, îndreptabilă doar din bază. Inspecția se deschide din
  **Obiectiv › Inspecții › „Inspecție nouă"** (`NewInspectionDialog`), unde prima întrebare e
  **pe ce contract** — de acolo vine profilul, deci fișa.
- **Tab-ul „Fișă"** pe unitatea de lucru, în locul „Prezentare" când tipul e inspecție. Două tab-uri
  cu **același slug `''`**, despărțite de `visible(session, row)`: pagina de detaliu ia primul tab
  vizibil, iar o inspecție se deschide direct pe fișa ei.
- **Tab-ul „Constatări"** — punctele NOK cu ieșirea lor și linkuri către cererea/propunerea născute.
- `sheet-actions.ts` cu trei acțiuni și **două drepturi**: `sheets.write` completează,
  `sheets.validate` închide. Helperii `canWriteSheets` / `canValidateSheets` în `@damina/auth`.
- `listDocumentSeries(actor, companyId, documentType)` — ecranele **aleg** seria, n-o mai tastează.
- `listContractsForObjective` întoarce acum și `contractObjectiveId`, `companyId`,
  `hasInspectionProfile`.

### Patru defecte reale găsite cablând ecranul — toate din 09a, toate reparate

Niciunul n-ar fi ieșit la iveală fără un ecran care chiar cheamă serviciile. Merită citite ca listă,
pentru că 09b-2 (intervenția) are exact aceleași forme de risc:

1. **`saveInspection` n-a funcționat NICIODATĂ.** `for update` peste un `left join`
   → `FOR UPDATE cannot be applied to the nullable side of an outer join`. E a treia oară când
   `for update` cere aceeași reparație (după `lockOpenIntervention` și `validateOneTimesheet`):
   **lock-ul într-o interogare, join-ul în alta.** Verificările #4–#6 nu fuseseră rulate la 09a, de
   asta a trecut nevăzut. **Rulează fiecare use-case măcar o dată pe date reale înainte de commit.**
2. **Fiecare salvare re-crea cererea/propunerea.** Salvarea rescrie răspunsurile, deci a doua
   salvare a aceleiași fișe ar fi făcut a doua cerere pentru fiecare NOK rămas NOK. Acum legăturile
   existente se citesc **înainte de ștergere** și se reiau, pe cheia `punct + ieșire`: un punct trecut
   din „intervenție" în „propunere" chiar are nevoie de document nou, cel vechi rămâne și se anulează
   din Cereri.
3. **`createRequestTx` primea `''`** pentru `slaDueAt`, `contractId`, `estimatedValue` — exact capcana
   scrisă la 09a despre `recordCostTx`, repetată. `new Date('')` → „Invalid time value". TypeScript
   nu apără: tipul e `z.infer`, deci acceptă șirul gol. **Funcțiile `…Tx` primesc valori DEJA parsate.**
4. **`requests.source_inspection_finding_id` nu se completa niciodată** — coloana există din 08a, dar
   drumul cerere → punctul de fișă era gol, deși verificarea #4 cere legătura **în ambele sensuri**.

### Verificat pe Supabase dev, cu harness aruncabil (șters după)

`A` seria există · `B` fișa vine din profil · `B2` checklist-ul înghețat e cel din profil ·
`D` `check`-ul blochează validarea și spune ce punct · `D2` trigger-ul o refuză și el ·
`E` NOK → intervenție naște o cerere (#4) · `F` **a doua salvare nu mai naște nimic** ·
`F2` legătura se păstrează · `F3` cererea arată înapoi spre constatare · `G` punctul trecut pe OK
lasă cererea în viață.

**Verificarea #2 confirmată separat**: obiectivul `…07000001` e pe două contracte, iar profilele lor
dau **checklist-uri diferite** — `INSP-SP` pe unul, `INSP-BZ` pe celălalt.

### Ce trebuie să știi ca să nu retrăiești

- **Butonul Validează ascultă de `check`-ul de la SERVER, nu de starea din ecran.** Cât timp există
  modificări nesalvate, validarea e oprită cu „salvează întâi". Alternativa — o a treia copie a
  regulii „fiecare NOK are ieșire", în browser — ar fi fost copia care se desincronizează.
- **`withMoney=false` scoate și ieșirea „propunere"**, nu doar cifra: propunerea CERE o valoare
  estimată, iar un câmp de lei pe ecranul terenului e exact scăparea căutată de verificarea #23.
- **Pozele se aleg, nu se încarcă din fișă**: selectorul listează fișierele din folderul `photos` al
  unității (`folderForEntity` + `listChildren`), iar încărcarea rămâne în tab-ul Poze. Zero cod nou
  de upload.
- **Datele de probă nu se pot șterge din rolurile aplicației.** Cererile nu se șterg niciodată (se
  anulează), iar folderul unei unități e `is_system` și trigger-ul refuză ștergerea. Harness-ul a
  lăsat 5 unități „SMOKE 09b" în dev, **anulate**, nu șterse — asta e curățenia pe care o poate face
  și un om. Dacă deranjează, `pnpm db:seed --force`.

### Ce urmează la 09b-2 (intervenția)

`getInterventionSheet`, `listInterventionMaterials`, `listInterventionHours`, `saveIntervention`,
`validateIntervention` există toate. **Verifică-le pe date reale înainte să construiești ecranul** —
`saveIntervention` folosește `lockOpenIntervention` (deja reparat), dar `validateIntervention` e cea
mai lungă tranzacție din pas și n-a fost chemată din aplicație niciodată. Aceleași patru forme de
risc din lista de mai sus.

---

## 09a — fundația fișelor de lucru (18 august 2026)

### Ce a intrat

- **Migrarea `0026_sheets_and_inventory.sql`** — generată cu drizzle-kit din patru fișiere noi de
  schemă (`inventory.ts`, `sheets.ts`, `timesheets.ts`, plus `products.is_lot_tracked`), completată
  dedesubt cu ~700 de linii scrise de mână: triggere, RLS, grant-uri pe coloană, audit.
  **Aplicată pe Supabase dev.** Cele patru migrări cerute de plan (`0019`–`0022` în numerotarea lui)
  sunt **una singură** la noi: sunt tabele care se referă între ele, iar patru migrări ar fi însemnat
  patru rulări de drizzle-kit pentru un singur pas de schemă.
- **Triggere — acolo trăiesc regulile, nu în formulare**:
  `guard_inspection_validation` (NOK fără ieșire → blocat; punct cu `requires_photo` fără poză →
  blocat), `apply_stock_movement` (verifică disponibilul cu `for update`, scade soldul, recalculează
  CMP la intrare), `guard_stock_movement_append_only`, `apply_intervention_actuals`
  (`operation_actuals` întreținut incremental), `guard_timesheet_hours` (constraint trigger amânat,
  pe TOTALUL zilei), `guard_timesheet_line_stage`, `guard_sheet_work_unit_type`,
  `derive_period_from_effect_date`, plus `attach_period_guard` pe stoc și bonuri.
  `app.verify_stock_balances()` recalculează soldurile din mișcări (verificarea #18).
- **`packages/domain/src/sheets/`** — `inspectionValidationCheck` (oglinda regulii 1, ca ecranul să
  spună CE punct blochează înainte de apăsare), `computeVariance` (asteptat vs real, cu prag),
  `rateCardAt` + `timesheetTotals`. **20 de teste noi**, domain 106 → **126**.
- **`packages/services/`** — `inspections.ts`, `interventions.ts`, `timesheets.ts`, `inventory.ts`.
  Plus două funcții tranzacționale exportate din module existente: **`recordCostTx`** (era
  `insertCostLine`, privată) și **`createRequestTx`**.
- **`packages/contracts/`** — `sheets.ts` și `inventory.ts`.
- **`packages/auth`** — patru drepturi noi: `sheets.write` (și teren), `sheets.validate`
  (office, `admin|pm|financiar`), `inventory.read` (și teren), `inventory.write`.
- **Seed**: seria `BC` pentru `bon_consum`, și calificarea șefului de șantier.

### Smoke pe Supabase dev — 21 de verificări, toate verde

Rulat înainte de commit, cu un harness aruncabil (regula casei). Confirmate pe date reale:
**#7** (fișă din 28.07 validată → cost în august), **#8** (bon + mișcări + `consumat` +
`manopera_proprie`, soldul scade exact), **#9** (fișa picată n-a lăsat nicio linie),
**#10** (abaterea calculată + `operation_actuals` la 1 execuție), **#11** (consum peste disponibil
blocat, cu soldul în mesaj), **#12**, **#13** (4+2+2 → 3 linii de cost), **#14** (tarif înghețat),
**#16** (ambele ramuri), **#17**, **#19** (`PERIOD_CLOSED` pe martie închisă).

### Ce trebuie să știi ca să nu retrăiești

- **`for update` nu acceptă nume calificate pe schemă.** Drizzle emite
  `for update of "app"."interventions"`, iar Postgres răspunde „FOR UPDATE must specify unqualified
  relation names". Soluția din `lockOpenIntervention` și `validateOneTimesheet`: **lock-ul într-o
  interogare, join-ul în alta**. E și mai corect — `for update` fără `of` ar fi blocat și rândul din
  `work_units`, pe care nu-l scriem acolo.
- **`recordCostTx` primește valori DEJA parsate**, deci `''` nu se mai transformă în `null`.
  Apelanții trebuie să trimită `null` pentru câmpurile opționale, altfel Postgres cade cu
  `invalid input syntax for type uuid: ""`. `RecordCostInput` e `z.infer` (output), deci TypeScript
  acceptă `''` fără să se plângă — **typecheck-ul nu te apără aici**.
- **Poarta de bani a prins o scăpare reală la prima rulare a migrării**:
  `grant select on app.stock_movements to app_field` includea `unit_cost`.
  `assert_no_money_leak` a oprit migrarea cu numele coloanei. A patra rulare a ei, a patra oară când
  își merită existența. Coloana `variance_pct` e adăugată explicit în listă: nu e în lei, dar spune
  același lucru despre bani, iar euristica pe nume n-o prinde.
- **`app.stock_balances` n-are `insert`/`update` acordat NIMĂNUI** — nici măcar lui `app_service`.
  Soldul e rollup, întreținut exclusiv din trigger `security definer`. Consecință practică:
  ramura „după coruperea manuală a unui sold" din verificarea #18 **nu se poate reproduce din
  aplicație**; cere consolă de bază de date. Am verificat în schimb că `update`-ul e respins.
- **`lot_id` e nullabil, deci cheia naturală a soldului e un index pe expresie**:
  `(location_id, product_id, coalesce(lot_id, uuid-ul nul))`. Fără `coalesce`, două NULL-uri nu sunt
  egale în Postgres și fiecare intrare fără lot ar fi făcut un rând nou. Aceeași expresie apare în
  `on conflict` din trigger — dacă se schimbă una, trebuie schimbată și cealaltă.
- **Prefixele din `raise exception` nu mai sunt identice cu codurile `AppError`.**
  `STOCK_INSUFFICIENT`, `FINDING_REQUIRED`, `PHOTO_REQUIRED` numesc REGULA (log-ul de Postgres
  devine citibil fără cod), iar traducerea spre cele opt coduri se face în `RAISED_PREFIXES` din
  `db-errors.ts`. **Nu inventa coduri noi de `AppError`** — doar prefixe, cu maparea lor.
- **Seed-ul rulează acum `ensureDocumentSeries` și `ensureFieldLeadQualification` ÎNAINTE de
  verificarea „seed-ul există deja".** Motivul e general: fiecare pas nou aduce un tip de document
  numerotat, iar o bază de dev care are deja seed n-ar mai fi căpătat seria — simptomul ar fi apărut
  abia la prima validare de fișă, ca un 404 despre o serie pe care nimeni nu-și amintește că trebuia
  adăugată.
- **Propunerea de backlog născută dintr-un NOK creează și o CERERE.** `backlog_proposals.request_id`
  e `not null`, și e corect: backlogul e o coadă de cereri amânate, iar `promoteBacklog` are nevoie
  de cerere. Cererea intră direct în `in_backlog`, nu în inbox.
- **Salvarea fișei rescrie răspunsurile, dar NU șterge cererile deja născute.** Un punct trecut din
  NOK în OK își pierde legătura; cererea rămâne și se anulează explicit din modulul Cereri. A o
  șterge ar face-o să dispară de sub ochii celui care o tria.

### Ce urmează concret — 09b (ecranele, §3.5 și §3.6)

Toate citirile de care au nevoie ecranele **există deja** în servicii:

| Ecran | Ce cheamă |
|---|---|
| Inspecția (`Fișă · Constatări · Costuri · Poze · Documente`) | `getInspectionSheet` (întoarce și `check`, cu blocajele pe puncte), `saveInspection`, `validateInspection` |
| Intervenția (`Fișă · Materiale · Ore · Costuri · Poze · Documente`) | `getInterventionSheet`, `listInterventionMaterials`, `listInterventionHours`, `saveIntervention`, `validateIntervention` |
| Activitate › Pontaj | `listTimesheetWeek` (are deja `byPerson` și `byWorkUnit`), `saveTimesheet`, `validateTimesheets` |
| Aprovizionare › Stoc și gestiuni | `listStock` (fizic/rezervat/disponibil), `listLocations`, `createLocation` |
| Bon de consum | `createConsumptionNote`, `listConsumptionNotes` |
| Obiective › Acoperire inspecții | `inspectionCoverage` — **fără notificări către teren** |
| Validare de birou în masă (§3.6) | `listUnvalidatedInspections`, `listUnvalidatedInterventions`, `listUnvalidatedTimesheets`, `validateInspections`, `validateTimesheets` |

Trei lucruri de ținut minte când le construiești:

1. **Un modul nou = o intrare în `entityRegistry`**, nu fișiere de pagină. Fișele sunt tab-uri pe
   unitatea de lucru care există deja (`registry/work-units.tsx`), nu entități noi — cheia lor
   primară E `work_unit_id`.
2. **`apps/web` nu poate importa `@damina/domain`.** `inspectionValidationCheck` și `computeVariance`
   sunt deja reexportate din `@damina/services` exact pentru asta.
3. **Citirile au `withMoney`**: `getInspectionSheet`, `getInterventionSheet`,
   `listInterventionMaterials`, `listStock`. Pe `false` nu se CERE coloana de bani din SQL — nu se
   cere și se ascunde. Cerută, un `select` al terenului ar cădea cu „permission denied for column",
   iar ecranul ar părea stricat.

Ce mai rămâne din §3.5 și n-are încă serviciu: **jobul nocturn** care cheamă `verifyStockBalances`
și ridică alerta (funcția și serviciul există; coada și cronul, nu — pe tiparul din
`packages/jobs/src/registry.ts`), și seed-ul cerut de „definiția de gata" (8 inspecții validate pe
luni diferite, 3 intervenții, o săptămână de pontaje, o gestiune de echipă cu stoc).

### Datorie de igienă, nu de la pasul 09

`pnpm lint` **pică pe 3 erori** în `Initial_Context/refrence-apps/utilaje-app/api/index.js` — fișier
netrackat, adăugat în afara pașilor. Ori intră în `eslint.config.mjs` ca ignorat, ori în
`.gitignore`. Codul pasului 09 trece lintul curat.

---

## 08c — SĂRIT dinadins (decizia utilizatorului, 18 august 2026)

**Nu e uitat, e amânat.** Utilizatorul a ales să treacă direct la pasul 09 după ce s-a verificat
concret că 09 nu depinde de nimic din ce rămâne nefăcut.

### De ce se poate sări

Tot ce cere 09 din 08 (`Plan/09_Fise_De_Lucru.md` §2, §3, verificările #4–#5) există deja din 08a/08b:
`createRequest` pentru cererea tip „constatare" din punctele NOK, propunerile de backlog cu
`source_kind='inspectie'`, catalogul de operațiuni cu `operation_actuals` pentru „consum așteptat vs
real". 08c nu adaugă decât un **producător nou de cereri** (emailul) peste un model care e gata —
deci se poate face oricând mai târziu **fără să se rescrie nimic din 09**.

### Ce s-a făcut totuși, înainte de a trece mai departe

Cele două bucăți din 08c care nu cereau nicio decizie de arhitectură:

- **Verificarea #19 — expirarea propunerilor.** Coadă nouă `requests.expireBacklog` în
  `packages/jobs/src/registry.ts`, cron zilnic **05:00** (înaintea alertelor de contract, ca
  backlogul să fie deja curat când se uită cineva la el), handler în
  `apps/worker/src/handlers/requests.ts`. Use-case-ul e `runBacklogExpiry(actor, asOf?)` din
  `packages/services/src/requests.ts` — deschide tranzacția în jurul lui `expireBacklogProposals`,
  care exista de la 08a fără să-l cheme nimeni. Ziua e **parametru, nu `now()` în SQL**.
  Backlogul are acum și filtrul `?status=expired`: propunerea expirată **rămâne vizibilă**, nu se
  șterge, dar nu mai stă în lista de umplere — și nu se poate promova.
- **Verificarea #18 — linkul din alerta de Deltă.** `scanDeltaFill` trimite acum la
  `/cereri?view=backlog&contract={id}`, nu la fișa contractului. Ca să fie posibil, **`renderView`
  primește un al patrulea parametru, `search`** (`apps/web/src/registry/types.ts`), iar `BacklogFill`
  are `initialContractId`. Regula generală, dacă mai apare cazul: **o selecție care trăiește doar în
  starea componentei nu poate fi ținta unui link** — dacă vreo alertă trebuie să aterizeze pe un
  ecran deja filtrat, filtrul se mută în URL.

### Ce a rămas deschis din 08c

| Rămas | Ce blochează |
|---|---|
| Coada `mail.ingest` — IMAP la 5 min, dedup pe `Message-ID`, `.eml` în R2, atașamente ca `file_versions` | verificările **#1, #2, #3**. ~80% din efortul pasului. Cere dependențe noi în `apps/worker` (client IMAP + parser). |
| Credențialele cutiei, per firmă | **decizie de arhitectură nedată** — planul zice „Supabase Vault", dar nu există tabelă de conturi de email și nicio folosire de Vault în repo. Întreabă înainte să construiești. |
| `request_id` pe `app.nodes` + rolul `request` în `node_role` | dosarul propriu al cererii. Până atunci tab-ul *Documente* al cererii duce la dosarul UL-ului create din ea. Migrare nouă, pe tiparul din `0021_files.sql`. |
| Filtrul de 24h (cron zilnic 09:00) | **regula de business nu e specificată nicăieri** — §3.6 zice doar „curg automat mai departe, conform regulii lor", iar trimiterea din §1 e despre magazie, nu despre cereri. **Nu ghici**: alertă către PM? trecere automată în backlog? escaladare? |
| Test E2E Playwright pe fluxul cap-coadă | „definiția de gata" a pasului 08. Playwright e neinstalat — datoria #4. |

**Consecința de ținut minte:** „definiția de gata" a pasului 08 rămâne **nebifată**. E datorie
curată și izolată, nu o crăpătură în fundație.

---

## 08b — ecranele (18 august 2026)

### Ce a intrat

- **`apps/web/src/registry/requests.tsx`** — două intrări noi în registry (`cereri`, `operatiuni`),
  **zero fișiere de pagină**. Al treilea pas la rând în care testul din `registry/types.ts` trece.
  Ecranul de Decizie — cel mai complicat din pas — e un **tab**, nu o pagină proprie.
- **Vederile listei de cereri** (`?view=…`, aceleași sub-secțiuni care erau deja în `navigation.ts`):
  `inbox` (triere pe două coloane, `Ctrl+Enter`, țintă 30 s), `backlog` (umplerea Deltei),
  `rutare` (jurnalul de decizii cu procentul de divergență). Toate ies din **același `load`**, deci
  numărul de cereri nu poate diferi între ele.
- **Componente de client**: `decision-screen`, `backlog-fill`, `inbox-triage`, `evaluation-editor`,
  `operation-materials` în `apps/web/src/components/request/`.
- **Citiri noi în `packages/services/src/requests.ts`**: `listRequests`, `getRequest`,
  `getRequestEmail`, `listEstimateLines`, `routingContext`, `proposeRouting`, `listRoutingDecisions`
  (cu `divergencePercent`), `listDecisionsForRequest`, `listBacklogProposals`, `deltaFreeForContract`,
  `suggestBacklogFill`. Plus use-case-ul **`triageRequest`** (completează cererea și o trece în
  `in_evaluare`; nu primește `companyId`/`source` — nu se schimbă la triere).
- **`packages/services/src/operations.ts`** — CRUD pe catalog, materialele tipice, `operationActuals`.
- **`packages/auth`** — trei drepturi noi: `requests.read` (și teren), `requests.triage`,
  `requests.decide`. Al treilea e de greutatea lui `contracts.write`: decizia **creează** unitatea de
  lucru și îi alocă banii.
- **`docs/routing.md`** — regula de propunere automată, scrisă ca să poată fi ajustată fără
  arheologie în cod (cerută explicit de „definiția de gata").
- **Seed**: 10 operațiuni, 2 calificări cu tarif, 4 produse, 3 cereri în stări diferite (una cu email
  original) și 5 propuneri în backlog. Flag nou **`pnpm db:seed --requests`**, ca `--costs`.

### Ce trebuie să știi ca să nu retrăiești

- **`apps/web` NU are voie să importe `@damina/domain`** — `eslint-plugin-boundaries` o taie
  (`web ──▶ services ──▶ domain`). Prima variantă chema `routeRequest` din registry și
  `selectBacklogToFill` din componenta de client; ambele au trecut în `services`
  (`proposeRouting`, `suggestBacklogFill`). **A ieșit mai bine, nu doar conform**: serverul citește
  liberul lunii în același apel cu propunerea, deci ecranul nu poate afișa o cifră și trimite alta.
  Totalul cumulat din backlog și previzualizarea din Evaluare rămân în browser — sunt adunări, iar
  cifra care ajunge în bază vine din `evaluateRequest`.
- **„Delta liber" are o singură definiție**: plafonul lunii minus
  `component_period_rollup.allocated_revenue`. Aceeași în `routingContext`, `deltaFreeForContract` și
  `freeRoom` (verificarea de plafon din `promoteBacklog`). Predarea de la 08a spunea „`unfilled` din
  `deltaFill`" — **acela e alt număr** (folosește `component_ceilings.allocated_revenue`, setat
  manual, pentru alerta de ritm din pasul 06). Dacă ecranul ar folosi definiția aia, ar promite loc
  pe care `promoteBacklog` îl refuză.
- **Tab-ul `Documente` al cererii NU folosește `<EntityDocuments>`**, contrar predării de la 08a:
  `app.nodes` n-are coloană `request_id` și enum-ul `node_role` n-are `request`. Dosarul propriu al
  cererii (`.eml` + atașamente) vine cu **08c**, unde chiar are ce ține; până atunci tab-ul duce la
  dosarul unității de lucru create din cerere — cel care există, construit de triggerele din 07a.
- **`estimated_labor` din catalog nu se tastează**: `createOperation`/`updateOperation` o derivă din
  norma de timp × costul orar al calificării, din tariful în vigoare **azi**, și o **stochează** (o
  cerere evaluată azi nu-și schimbă cifra mâine). Fără tarif curent, operațiunea nu se salvează.
- **Lista de materiale e cantitativă, nu valorică.** Nu există preț de referință per produs în bază
  (vine cu aprovizionarea, faza 3), deci `estimated_material` rămâne scris de om.
- **Seed-ul citește calificările și produsele înapoi după cod, nu după id-ul fix.** Baza de dev avea
  deja o calificare cu codul `INST`, scrisă de mână; `on conflict do nothing` a sărit tăcut peste
  inserare și tariful a căzut cu `23503` — o eroare de cheie străină care nu spunea nimic despre
  cauză.
- `translateOperationError` se uită la **SQLSTATE**, nu la textul erorii: `DrizzleQueryError`
  ambalează mesajul Postgres, iar potrivirea pe text nu prinde niciodată constrângerea. (A picat un
  test exact pe asta.)

### Ce NU a intrat, dinadins

- Verificările #1–#3 și #18 (email, dedup, precompletare din expeditor, cronul de pe 10/20) sunt
  **08c** — nu se pot rula fără ingestia IMAP.
- #4 (cronometrarea trierei sub 30 s), #14 și #17 se pot verifica pe ecran, dar **nu au încă test
  E2E Playwright**; „definiția de gata" a pasului 08 îl cere pentru fluxul cap-coadă.
- #22 e implementat și testat pe date inserate manual; execuțiile reale vin cu fișele de intervenție
  (pasul 09), care atașează trigger-ul pe `operation_actuals`.

### Ce urmează concret — 08c

*(**Sărit.** Vezi secțiunea „08c — SĂRIT dinadins" de la începutul fișierului: două bucăți din
tabelul de mai jos — expirarea propunerilor și linkul din #18 — au intrat totuși; restul e amânat.
Recunoașterea de mai jos rămâne valabilă pentru sesiunea care îl va face.)*

§3.4 și §3.6 din `Plan/08_Cereri_Rutare_Backlog.md`.

**Recunoaștere făcută la finalul lui 08b — citește-o înainte să estimezi.** Pasul e mai mic decât
pare: infrastructura de cozi și cronuri există din 04 și 07, iar două din cele patru cronuri cerute
de §3.6 rulează deja. Ce rămâne, în ordinea greutății:

| De făcut | Stare acum | Efort |
|---|---|---|
| **Coada `mail.ingest`** — IMAP polling la 5 min, dedup pe `Message-ID`, `.eml` în R2, atașamente ca `file_versions` | **nimic**; cere dependențe noi în `apps/worker` (client IMAP + parser de mesaj) | mare — e ~80% din pas |
| **Credențialele cutiei, per firmă, în Supabase Vault** | **nimic**; nu există tabelă de conturi de email și nici vreo folosire de Vault în repo | mediu, și e o **decizie de arhitectură** (întreabă utilizatorul) |
| **`request_id` pe `app.nodes` + rolul `request` în `node_role`** + folderul cererii în `ensure_folder` | **nimic**; migrare nouă, pe tiparul din `0021_files.sql` | mic-mediu |
| **Filtrul de 24h** (cron zilnic 09:00) | **nimic** | mic ca *cod*, dar **regula nu e specificată** — vezi mai jos |
| **Expirarea propunerilor** (`valid_until` trecut → `expired`) | `expireBacklogProposals(tx, asOf)` există în `requests.ts` de la 08a, **niciun job n-o cheamă** | foarte mic — o coadă în `packages/jobs/src/registry.ts`, un handler, o linie în `SCHEDULED_JOBS` |
| **Alerta de Deltă pe 10 și 20** (verificarea #18) | **rulează deja** din pasul 04: coada `contracts.deltaFillScan`, cron `0 9 10,20 * *`, handler în `apps/worker/src/handlers/contract-alerts.ts`, dedup prin `raiseAlert` | foarte mic — vezi mai jos |

Trei lucruri concrete de știut:

- **#18 e aproape gata.** Singurul lucru care lipsește e linkul: `scanDeltaFill` din
  `packages/services/src/contract-alerts.ts` pune `href: '/contracte/{id}'`, iar planul cere **link
  direct în backlog filtrat pe contract**. Ecranul de backlog din 08b ține contractul în starea
  componentei, nu în URL (`renderView` nu primește `searchParams`) — deci ori se schimbă `href`-ul în
  `/cereri?view=backlog&contract={id}` **și** `BacklogFill` citește parametrul, ori se mută selecția
  de contract în URL. A doua variantă e mai curată și e o schimbare de vreo 20 de linii.
- **Filtrul de 24h nu e specificat nicăieri.** §3.6 spune doar „cererile nedecise curg automat mai
  departe, conform regulii lor". Trimiterea din §1 e la `Initial_Context/DaminaStructuraCapCoada
  FInal.md` §13.2, dar acolo filtrul de 24h e despre **magazie și achiziții** (Canal C), nu despre
  cereri — deci nu se poate transpune direct. **Întreabă utilizatorul ce înseamnă „curg mai departe"**
  pentru o cerere nedecisă: alertă către PM? trecere automată în backlog? escaladare? Nu ghici — e o
  regulă de business, nu un detaliu de implementare.
- **`putObject` există deja** în `@damina/storage`, deci `.eml`-ul integral se scrie din worker fără
  nimic nou. Atașamentele au nevoie de drumul complet de fișiere (`completeUpload` + `files.derive`),
  care e tot gata din 07.

Ordinea recomandată: migrarea (`request_id` pe noduri) → `mail.ingest` → Vault → cronurile mici
(expirare, 24h) → linkul din #18. Primele două merită o sesiune proprie; restul încap împreună.

### Ce a intrat la 08a

- **Migrarea `0025_requests_and_catalog.sql`** — `app.requests`, `request_emails`,
  `request_estimate_lines`, `request_decisions`, `backlog_proposals` (Anexa C.8) și
  `app.operation_catalog`, `operation_catalog_materials`, `operation_actuals` (Anexa C.9). Generată
  cu `drizzle-kit generate`, completată dedesubt cu FK-urile tăiate din 05/07
  (`work_units.source_request_id`, `request_emails.raw_node_id` — cicluri de import evitate, ca la
  `contract_objectives.root_node_id`), RLS, audit și grant-uri. **Aplicată pe Supabase dev.**
- **`packages/domain/src/requests/`** — `routeRequest` (propunerea + toate alternativele cu motiv,
  pur, fără DB), `estimateFromCatalog`, `selectBacklogToFill` (knapsack exact în cenți, sub 200 de
  itemi). 13 teste, toate verde.
- **`packages/services/src/requests.ts`** — `createRequest`, `evaluateRequest`, `decideRouting`
  (atomic: UL + alocări + legătură, sau propunere de backlog — niciodată ambele), `promoteBacklog`
  (mai multe propuneri → mai multe UL-uri, o tranzacție). Verificat pe Supabase dev: creare atomică,
  **rollback complet la lună închisă** (#11), amânare → backlog (#13), promovare multiplă (#15).
- **`packages/contracts/src/requests.ts`** — `decideRoutingInputSchema` reutilizează
  `createWorkUnitInputSchema` întreg pentru `creation`, ca să nu existe două validări pentru „cum
  arată o unitate de lucru nou-creată".

### Ce NU a intrat, dinadins (rămâne pentru 08b/08c)

- Niciun ecran. Inbox, Decizie, Backlog, jurnalul de decizii, Catalog de operațiuni — toate din
  §3.5 — sunt neatinse.
- Inbox-ul de email (IMAP, `.eml` în R2), cronurile (filtrul de 24h, alerta de Deltă pe 10/20,
  expirarea propunerilor) — `expireBacklogProposals` există în `requests.ts` ca funcție gata de
  agățat pe un job, dar **niciun job nu o cheamă încă**.
- `operation_catalog` nu are încă rânduri de CRUD/ecran; catalogul cu ~10 operațiuni din seed
  (cerut la „definiția de gata") vine odată cu ecranul.
- Trigger-ul care întreține `operation_actuals` la validarea unei fișe de intervenție — pasul 09.

### O decizie de model, netrivial din plan

`request_decisions.target_periods` e `date[]` (luni calendaristice, prima zi a lunii), **nu**
`period_id[]`. Planul nu spune explicit ce reprezintă coloana; alocările de finanțare (care chiar
folosesc `period_id`) sunt sursa de adevăr, iar `decideRouting` rezolvă `period_id → date` printr-un
`select` pe `app.periods` înainte de insert. Dacă vreun ecran viitor vrea să afișeze „Delta pe 3
luni: august, septembrie, octombrie", cifra vine deja formatată de-acolo.

### Capcane găsite la 08a, ca să nu le retrăiești

- **Pool-ul de sesiune Supabase (15 conexiuni) s-a umplut** cu `node.exe` orfan de la sesiuni
  anterioare — `pnpm db:migrate` cădea cu `EMAXCONNSESSION` chiar și izolat. S-a rezolvat cu
  `taskkill /F /IM node.exe` (aprobat explicit de utilizator). Dacă reapare, verifică întâi câte
  procese `node.exe` sunt deschise înainte să presupui o problemă de schemă.
- **Rularea completă a suitei `packages/services`** (nu doar `requests.test.ts`) scoate 8 timeout-uri
  în `cost.test.ts` și `objectives.test.ts` — **contenție pe pool, nu regresie**: fișierele izolat
  trec. Suita completă locală, cu `TEST_DATABASE_URL`, are nevoie de mai mult de 15 conexiuni
  simultane când vitest paralelizează fișierele; CI-ul (Testcontainers, fără limita de 15) nu are
  problema asta.
- `allocateCode` din `work-units.ts` a fost făcută `export`, ca `decideRouting`/`promoteBacklog`
  să-și țină toate scrierile în ACEEAȘI tranzacție (`withActor` deschide o tranzacție nouă la fiecare
  apel — a chema `createWorkUnit` din interiorul altui `withActor` ar fi folosit o conexiune
  DIFERITĂ din pool, deci n-ar mai fi fost atomic). Orice use-case viitor care trebuie să compună
  „creează UL" cu altceva, în aceeași tranzacție, ar trebui să facă la fel — nu să cheme
  `createWorkUnit` direct. **De la 08a′ soluția e alta și mai bună: `createWorkUnitTx(tx, actor,
  values, id, opts)`**, corpul lui `createWorkUnit` extras pe o tranzacție dată. Compune „creează
  UL" cu orice altceva FĂRĂ să pierzi regulile lui. Nu mai reimplementa insert-urile.

### 08a′ — reparațiile din `Plan/08a_REVIEW.md` (18 august 2026)

Review-ul lui 08a a găsit 6 blocante și 7 importante. **Toate rezolvate**, cu teste de regresie.
Ce trebuie să știi ca să nu le reintroduci:

- **`selectBacklogToFill` face DP pe LEI, nu pe cenți.** Pe cenți, un plafon de 100.000 lei aloca
  ~10 MB de `choice` **per propunere** — ~660 MB la cincizeci, iar ecranul cheamă funcția la fiecare
  bifă. Rotunjirea e asimetrică dinadins (capacitatea în jos, valorile în sus): selecția poate rămâne
  sub plafon cu bănuți, dar nu-l poate depăși. Peste bugetul de celule (`MAX_CELLS`) cade pe greedy
  și spune asta prin `BacklogSelection.exact`.
- **`promoteBacklog` verifică plafonul** (`freeRoom`: plafon de venit/cost minus
  `component_period_rollup.allocated_revenue`). Peste plafon → `CONFLICT` cu suma depășită în
  `payload.over`; trece doar cu `acceptOverCeiling: true`. Asta e verificarea #16.
- **`decideRouting` cere precondiții**: cererea se citește cu `for update` (`lockOpenRequest`), stare
  în `neprocesata`/`in_evaluare`, și firma UL-ului **trebuie** să fie firma cererii. Fără ele, aceeași
  cerere putea fi decisă de două ori — adică același plafon cheltuit de două ori.
- **`splitDeltaAcrossPeriods(value, periods)`** e în `@damina/domain` și e sursa de adevăr a
  împărțirii pe luni (verificarea #12). `RoutingOption.split` o poartă deja spre ecran. **Nu e**
  `splitAcrossPeriods` din `funding/` — aceea taie proporțional, asta umple fiecare lună până la
  liberul ei. Ecranul de decizie din 08b o folosește; nu recalcula feliile în UI.
- Accesul terenului la cereri e documentat acum în `docs/security.md` („Ce vede terenul din cereri").

### Ce urmează concret — 08b

*(Făcut. Vezi secțiunea „08b — ecranele" de mai sus. Două lucruri din paragraful de mai jos s-au
dovedit greșite la implementare și sunt corectate acolo: „Delta liber" **nu** e `unfilled` din
`deltaFill`, iar tab-ul `Documente` **nu** poate folosi `<EntityDocuments>` încă.)*

Citește §3.5 din `Plan/08_Cereri_Rutare_Backlog.md`. Ecranul de Decizie e central: citește
`routeRequest` din `@damina/domain` cu `deltaFreeByPeriod` calculat din rollup-urile pasului 06
(„Delta liber" = `unfilled` din `deltaFill`, pasul 06), construiește `DecideRoutingInput.creation`
din alegerea omului și cheamă `decideRouting`. Tab-ul `Documente` al cererii se activează cu
`<EntityDocuments>`, ca la orice entitate — vezi `docs/files.md`.

### Unde s-a ajuns

Pașii **01, 02, 04, 05, 06 și 07 sunt gata**. Pasul **03** e complet ca implementare, cu 4
verificări nerulate. **Următorul pas e 08 — cereri, rutare, backlog** (`Plan/08_Cereri_Rutare_Backlog.md`),
care n-a fost atins de nicio sesiune.

Din pasul 07 rămâne o singură verificare deschisă, #7: reluarea per parte funcționează și e
verificată, dar **întreruperea reală de rețea** în timpul unui upload cere Playwright.

### Ce trebuie să știi despre pasul 07, ca să nu recitești tot

| Sub-etapă | Ce a intrat |
|---|---|
| **07a** | `0021_files` — `nodes`, `file_versions`, `derived_assets`, `node_shares`; arborele din Anexa E.3 construit de **triggere**, în aceeași tranzacție cu entitatea; `app.can_access_node()`; backfill cu plasă |
| **07b** | presign/complete cu retry per parte, descărcare prin `/api/files/[versionId]`, cozile `files.derive` (EXIF + 3 miniaturi WebP) și `files.cleanup`; `0022` + `0023` (reparații, vezi mai jos) |
| **07c-1** | `/documente` (explorer + coș), tab *Documente* prin registry pe contract/obiectiv/UL/etapă, uploaderul cu retry per parte, video până la 4 GB; migrarea `0024` (dosare de obiectiv suprapuse) |
| **07c-2** | galeria (vedere a explorerului) cu geotag și oră, tab-ul *Poze*, previzualizare `inline` pentru poze și PDF, partajarea din interfață, istoricul de versiuni |

**Patru reguli ale arborelui, dacă nu citești altceva:**

1. **Arborele se generează prin trigger**, nu din aplicație. Un import, un script sau o rută nouă îl
   capătă fără să știe că există. La fel ca `period_id` pe registrul de cost.
2. **Arborele e construit pe analitica „folosit".** Mutarea finanțării **nu** atinge niciun nod.
   Rutarea unei unități pe alt contract, în schimb, îi *mută* folderul — un `update parent_id`.
3. **Folderele de sistem nu se șterg, redenumesc, mută** (`is_system`), iar căutarea lor se face pe
   `node_role`, niciodată pe nume.
4. **Ștergerea e `deleted_at`**, iar numele redevine liber imediat. Rândurile pleacă din bază doar
   prin jobul nocturn, la 30 de zile — și `delete` pe `app.nodes` nu e acordat nimănui în afara
   worker-ului.

Detaliile sunt în `docs/files.md` (≤ 80 de linii).

### Ce urmează concret — pasul 08

`Plan/08_Cereri_Rutare_Backlog.md`, neatins. Citește-l întâi: e primul pas care nu mai construiește
pe ceva pe jumătate.

Ce ți-a lăsat pasul 07 și îți va folosi:

- **Un modul nou = o intrare în `entityRegistry`.** Cererile sunt o entitate ca oricare alta; lista
  și detaliul există deja, fractale. Vezi `docs/entity-registry.md`.
- **Tab-ul `Documente` se activează dintr-o singură linie** pe orice entitate nouă:
  `<EntityDocuments ctx scope role basePath sub />`. Are nevoie doar de un `node_role` propriu și de
  o `build_*_tree` în migrare — rețeta e în `docs/files.md`, în ≤ 15 linii.
- **Arborele se construiește din triggere.** O entitate nouă își capătă folderul fără ca ruta care o
  creează să știe că există foldere. Dar atenție la lecția din `0024`: dacă noul rol se repetă sub
  același părinte, **cheia lui trebuie să intre în căutarea din `ensure_folder`**, altfel a doua
  entitate primește folderul primeia, în tăcere.

### Două bug-uri vechi reparate la 07c-1 — nu le reintroduce

1. **`ensure_folder` suprapunea dosarele obiectivelor.** Căuta folderul existent pe
   `(părinte, rol, work_unit_id, stage_id)`, fără `objective_id` — iar toate obiectivele unui
   contract au același părinte și același rol. Al doilea obiectiv primea folderul primului: pe dev,
   120 de legături și 40 de foldere. Reparat în `0024`, cu backfill și cu plasă. **O funcție
   idempotentă care se uită la prea puține coloane nu face duplicate — face suprapuneri**, care
   sunt mai greu de văzut și mai rele.
2. **Mărimea anunțată nu era verificată** la `complete` (verificarea #8 din plan): se putea declara
   1 KB și urca 6 MB. Plafonul pe tip prindea doar exagerările. Acum egalitate strictă.

### Verificări din pașii anteriori care NU sunt complet închise

| Pas | # | Ce lipsește |
|---|---|---|
| 06 | **11** | Drill-down-ul merge până la identitatea documentului. Documentele-sursă apar la 09–10. |
| 06 | **19** | Comutatorul brut/net merge, dar **`overhead_snapshots` nu e populat de nimeni periodic**. Vezi datoria 2. |
| 06 | **21** | Indexul de cursor măsurat la 10.000 de linii, nu la 100.000. Planul e însă independent de volum. |
| 07 | **7** | Reluarea per parte există în client și merge; **întreruperea reală de rețea** cere Playwright. Singura verificare deschisă din pasul 07. |

### Datorii deschise, în ordinea în care le-aș lua

| # | Ce | De ce contează |
|---|---|---|
| 1 | **Rotește `SUPABASE_SERVICE_ROLE_KEY`** (Project Settings → API) | A trecut printr-o fereastră de chat pe 17 august. Singurul cod care o folosește e `resetMfaFactors` din `apps/web/src/app/api/admin/service.ts`. |
| 2 | **Jobul lunar de regie** | `recomputeOverheadSnapshot` există și e acordată doar lui `app_service`, dar n-o cheamă nimeni. Fără ea, marja netă e marjă brută cu altă etichetă. |
| 3 | **CORS pe bucket-ul R2 `docs`** | Uploadul din browser NU merge fără el: `PUT` de pe originea aplicației și **`ExposeHeaders: ETag`**. Fără ETag expus, clientul se oprește la prima parte — cu mesaj explicit, dar se oprește. Verificat până acum doar din Node, unde CORS nu se aplică. |
| 4 | **Playwright** | Neinstalat. Blochează #13 din pasul 03, clicul pe hartă din 04b (#14) și partea de client din #7 și #20. |
| 5 | **#8 din pasul 03** — Realtime se autentifică drept `authenticated`, rol fără niciun grant | Ori `grant select` pe `work_queue_items`/`notifications` cu politici proprii, ori se păstrează fallback-ul de 60 s și **se rescrie verificarea** ca să spună adevărul. |
| 6 | **#10 și #14 din pasul 03** | #10: create/edit produs + audit pe date reale — `audit.entries.table_name` e `app.products`, **cu prefix de schemă**. #14: Lighthouse. |
| 7 | **Miniaturi pentru video** | `files.derive` produce miniaturi doar pentru imagini; pentru restul iese tăcut, dinadins. PDF-ul se rezolvă acum prin previzualizarea `inline`, deci rămâne doar video. Se adaugă când apare nevoia reală (raportul lunar, pasul 10). |

**Datoria `pnpm db:generate` rămâne plătită.** Migrările `0016`–`0021` au fost **generate**. `0022` și
`0023` sunt scrise de mână **pentru că nu schimbă schema** — doar funcții, politici și grant-uri;
snapshot-urile lor sunt copii ale precedentului, ca lanțul drizzle-kit să rămână întreg. **Nu scrie
migrări de mână când schimbi tabele** — scrie schema Drizzle, generează, apoi completează dedesubt.

### Starea bazei de dezvoltare

- Migrările **`0017`–`0024` sunt aplicate** pe Supabase dev.
- **pg-boss a fost pornit prima dată pe 18 august**: schema `jobs` există acum, cu cele 6 cozi
  (`system.ping`, `contracts.expiryScan`, `contracts.deltaFillScan`, `rollup.verify`, `files.derive`,
  `files.cleanup`). Înainte de asta nu exista deloc.
- Seed: 10.000 de linii de cost pe lunile deschise din 03–05/2026, plus arborele de fișiere
  backfillat. Seed-ul leagă acum unitățile de lucru de contract (`contractObjectiveId`), deci
  folderele lor stau sub `Activitate` al contractului, nu al firmei.
- **300 de poze cu EXIF** (`teren-001.jpg` … `teren-300.jpg`) în folderul `Poze` al lucrării
  `01950000-…-000008000001`, urcate pentru verificarea #20, cu miniaturile lor în `derived`. Se pot
  șterge oricând; sunt un fișier de 9 KB, repetat.
- **Resturi de la harness-uri**: firme cu nume `Smoke06b …`, `Damina Fisiere …`, plus câteva foldere
  și fișiere de probă în R2 (bucket-ul `docs`) și miniaturi în `derived`. Nu deranjează.
- Bază curată: `pnpm db:reset`. `--force` nu mai poate reface seed-ul.

### Cum rulezi testele fără Docker

Mașina n-are Docker, deci până la 07a orice greșeală se afla abia în CI, șase minute mai târziu.
Acum există o portiță, în `tests/global-setup.ts` din **ambele** pachete:

```
TEST_DATABASE_URL=<url-ul de session pooling>  pnpm exec vitest run
```

Suita rulează pe baza indicată în loc de container. **Ce NU verifică** e exact lucrul cel mai valoros
al containerului — că migrările reconstruiesc baza de la zero — deci în CI variabila rămâne
nesetată, și acolo se dă verdictul. Testele lasă în urmă rândurile lor, iar două presupun o bază
goală și pică pe dev fără să fie stricate: „100 de alocări în paralel" (epuizează pool-ul către
Supabase) și „metricile de integritate sunt zero" (dev are 10.000 de linii de cost).

Pentru ce atinge R2 sau rețeaua nu există teste în CI, dinadins: se verifică prin harness-uri de
smoke aruncabile, pe dev, cu bucket real. Așa au ieșit la iveală cele trei bug-uri de mai sus.

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
- **Ecranele se verifică fără browser, cu un harness de 150 de linii.** Pornești `next dev`, fabrici cookie-ul de sesiune (mai jos), ceri paginile cu `fetch` și afirmi pe HTML-ul randat: „codul `L-000001` apare", „tab-ul Deviz NU apare pe inspecție", „cuvântul «Unitate de Lucru» nu apare nicăieri". Așa s-au bifat #11, #14 și #15 la 05c, 22 de verificări într-o rulare.
  **Ce prinde**: rutare, drepturi, ce ajunge în DOM, texte interzise, redirecturi. **Ce nu prinde**: click, hover, focus, layout — alea rămân pentru Playwright (datoria #2). Un lucru la care să te aștepți: rolul `admin` cere al doilea factor, deci fără `MFA_ENFORCED=0` harness-ul primește 307 pe tot, iar simptomul arată exact ca „ecranul e stricat".
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

- **Harness-ul de smoke pe Supabase dev bate CI-ul ca viteză de învățare.** La 06a am dat push cu
  două bug-uri de fixture și le-am aflat în CI, 6 minute mai târziu. La 06b am rulat întâi aceleași
  scenarii printr-un script `tsx` peste use-case-urile reale, pe baza de dev: a prins ambele capcane
  (o alocare scrisă direct într-o lună închisă; seria `NRA` lipsă) **înainte** de push, iar CI-ul a
  ieșit verde din prima. Costul e ~80 de linii de script care se aruncă.
- **`explain analyze` înainte de a adăuga un index, nu după.** Indexul de cursor din `0020` a apărut
  dintr-o măsurătoare (`seq scan` + `top-N heapsort`, 5,35 ms la 10.000 de linii), nu dintr-o
  presimțire. Aceeași măsurătoare a dat și cifra care justifică rollup-urile: 0,076 ms din rollup
  față de 10–11 ms agregând registrul, la 5.000 de linii pe lună.
- **Ecranele se pot verifica fără browser și fără sesiune Supabase**: pornești `next dev` cu
  `ALLOW_DEV_SESSION=1` și `MFA_ENFORCED=0`, apoi ceri paginile cu `Invoke-WebRequest` și afirmi pe
  HTML. Contextul de lună și de firmă se pune fabricând cookie-ul `damina_ctx` — e JSON simplu.
  **Atenție la o capcană:** React sparge textul interpolat (`analitica: {x}`) cu comentarii HTML,
  deci `Contains('analitica: folosit')` dă fals negativ. Caută bucăți care nu trec prin interpolare.
- **`[module]/page.tsx` acceptă doar vederile DECLARATE** în `list.views`; una nedeclarată cade tăcut
  pe vederea implicită. Așa a picat prima variantă de `?view=marja-neta`, și e garda bună — dar când
  o vezi, semnul e „lipsește din `views`", nu „e stricat ecranul".

- **O politică RLS care lipsește la SCRIERE nu dă eroare — atinge zero rânduri.** Asta a ținut
  `complete` nefuncțional la 07b: `app.file_versions` avea `select` și `insert`, dar nu `update`, iar
  fișierele rămâneau tăcut `uploading` cu tipul declarat de client. Un `insert` fără `update` pe
  aceeași tabelă e aproape sigur o scăpare. `0023` se termină cu o plasă care verifică asta.
- **`defineJob` rulează la ÎNCĂRCAREA modulului.** O validare care cade acolo nu strică un job, ci
  întregul `import '@damina/jobs'` — deci worker-ul nu mai pornește deloc, iar simptomul nu seamănă
  cu cauza. Merită ținut minte pentru orice validare pusă la nivel de modul.
- **`next dev` nu e o măsurătoare.** La 300 de rânduri arăta 9 s; aceeași pagină, pe build de
  producție, 2,2 s — din care 1,5 s e overheadul oricărei pagini (shell + drumurile la Supabase din
  eu-west-1). Diferența e de zece ori, și e exact genul de cifră după care cineva rescrie un ecran
  care nu avea nimic. **Dacă vrei o cifră de randare, fă build.**
- **Într-o funcție „ensure", căutarea trebuie să compare EXACT valoarea pe care ar insera-o.**
  `ensure_folder` inserează analitica moștenită din părinte (`coalesce(argument, părinte)`), dar
  căuta după argument. Prima variantă a reparației din `0024` a picat imediat pe `Fișă`: se cheamă
  cu `p_objective => null`, dar există în bază cu obiectivul moștenit. Cele două expresii trebuie
  scrise o singură dată, în variabile, și folosite în amândouă locurile.
- **Sesiunea de dezvoltare (`ALLOW_DEV_SESSION=1`) NU poate scrie fișiere.** `personId`-ul ei nu
  există în `app.persons`, iar `nodes.created_by` are cheie străină — deci `presign` cade cu 500 și
  `23503`. Ecranele se citesc cu ea, dar orice harness care **scrie** are nevoie de o sesiune
  fabricată din grantul de parolă (rețeta e mai sus).
- **ETag-ul unei părți e vizibil în browser doar dacă bucket-ul îl expune** (`ExposeHeaders: ETag`).
  Din Node nu se vede problema — CORS nu se aplică acolo — deci uploadul poate arăta perfect în
  harness și să se oprească la prima parte în browser. Clientul spune exact asta când se întâmplă.
- **Un pachet pe care nimic din CI nu-l importă nu e testat, oricâte teste ar avea repo-ul.**
  `@damina/jobs` arunca la import de la pasul 04 și s-a aflat abia la 07b, când `files.ts` l-a adus
  în lanțul serviciilor.
- **În `sql` de la drizzle, o listă JS devine `(a, b, c)`, nu un array Postgres.** Deci `= any(${ids})`
  dă `cannot cast type record to uuid[]`; forma corectă e `in ${ids}`. Cu `${ids}::uuid[]` doar muți
  eroarea, n-o repari.
- **Verificările de scară se scriu ca invariant, nu ca cronometru.** Mutarea unui folder cu 1.000 de
  fișiere se testează prin „un singur rând atins", nu prin milisecunde: pe un container în CI, cifra
  n-ar însemna nimic, dar invariantul cade dacă cineva rescrie mutarea ca parcurgere de subarbore.
- **Un eșec de decodare e permanent, unul de rețea e trecător.** În `files.derive`, `catch`-ul e
  strâns exact în jurul apelului `sharp`: citirea din R2 și scrierea în bază rămân în afara lui,
  fiindcă alea chiar merită reîncercate. Fără separarea asta, o poză stricată se reia de trei ori.

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
- **`MFA_ENFORCED=0` e o poartă oprită, nu un drept dat.** Nu construi nimic pe el: niciun cod nu trebuie să întrebe „e MFA oprit?" ca să decidă altceva decât banda de avertizare. Dacă un ecran începe să se comporte diferit după comutator, comutatorul a devenit o a doua configurație de securitate — exact ce nu trebuie.
- **Un rând de checklist care nu poate cădea niciodată nu se pune pe ecran.** La 06b am scris o
  verificare de închidere pe care `check`-ul din 0017 o face imposibilă; am aruncat-o. Oamenii învață
  repede să nu mai citească rândurile care sunt mereu verzi, și atunci nu le mai citesc nici pe cele
  care contează. Verificarea a rămas ca metrică de integritate, unde e la locul ei.
- **Eticheta de analitică de pe un ecran cu bani se verifică odată cu cifra.** La 06c, Contract ›
  Prezentare scria „folosit" peste niște cifre care sunt pe „descărcat". O etichetă greșită e mai rea
  decât una lipsă: se citește ca fiind verificată.
- **Tipul unui fișier se decide din conținut, nu din extensie și nu din ce declară browserul.**
  `sniffMime` din `@damina/shared` e listă **albă**: ce nu e recunoscut se respinge. O listă neagră
  se ocolește cu următorul format inventat.
- **Antetele cu care se servește un fișier vin DIN BAZĂ**, acoperite de semnătura URL-ului. Un HTML
  urcat ca „aviz.pdf" nu trebuie să poată fi servit ca HTML, oricât ar insista clientul.
- **Coloanele derivate nu sunt evenimente de audit.** `audit.record_change` scoate `root_node_id` din
  diferență înainte de verificarea „un UPDATE care nu schimbă nimic". Un jurnal în care jumătate din
  intrări sunt scrise de sistem devine un jurnal pe care nu-l mai citește nimeni.
- **Rulează smoke-ul pe dev înainte de push, nu CI-ul după.** La 06a și 07a am aflat greșeli în CI;
  la 06b și 07b le-am prins înainte, cu ~100 de linii de script aruncabil, iar CI-ul a ieșit verde
  din prima. Costul e mic, câștigul e de șase minute per greșeală.
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
| 05 — Unitate de Lucru, finanțare | 🟩 **gata** (05a + 05b + 05c; 18/19 — #17 cere ecranul de teren, pasul 10) | 2026-08-17 |
| 06 — Registrul de cost, închidere | 🟩 **gata** (06a + 06b + 06c, CI verde; #11 parțial — cere documentele din 09–10) | 2026-08-17 |
| 07 — File management (R2) | 🟩 **gata** (07a–07c-2; 20/21 — #7 cere Playwright pentru întreruperea reală de rețea) | 2026-08-18 |
| 08 — Cereri, rutare, backlog | 🟨 în lucru (08a + 08b gata: schemă, domain, servicii, ecrane; **08c** email+cronuri neatins) | 2026-08-18 |
| 09 — Fișe de lucru | 🟨 în lucru (**09a**, **09b-1** inspecția și **09b-2** intervenția: gata; **09b-3** pontaj, stoc, bon de consum: neatins) | 2026-08-18 |
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
| `pnpm db:generate` **merge din nou**, din 05a | Era blocat din 02c de trei snapshot-uri (`0013`–`0015`) cu `id`/`prevId` copiate din `0012`. Lanțul a fost refăcut la 05a; `0016` e generată cu drizzle. |
| Andrei nu mai are factor TOTP | L-am inrolat ca să testez #16 și l-am șters la final — cheia era la mine, iar lăsat acolo l-ar fi blocat în afara contului. **La următorul login va fi pus să configureze verificarea în doi pași** — ceea ce e chiar comportamentul cerut de #16 — **dacă `MFA_ENFORCED` nu e `0`** (vezi rândul de mai jos). |
| Conturile de test | `andrei.ionescu@damina.test` (birou, pm+admin, 2 firme) · `marius.sef@damina.test` (teren, o singură firmă) · `contact@instalprest.test` (subcontractant) · `dispecerat@apanova.test` (client). Se recreează cu `pnpm db:seed && pnpm db:seed:users`. |
| Portul 3000 poate avea un server pornit dinaintea lui 02c | Rulează cod vechi: `/login` dă **404** pe el, ceea ce arată exact ca o rută lipsă. Dacă apare, pornește pe alt port sau oprește-l. |
| Prag de teste: **~518** (neconfirmat încă în CI) | La 09a: `domain` 106 → **126** (+20, `sheets/` — inspecție, abatere, pontaj). La 08b: `domain` 104 → **106** (+2, `isCommercialOpportunity`), `packages/services` 116 → **131** (+8 în `requests.test.ts`, +7 în `operations.test.ts` — fișier nou). La 08a′ (reparațiile din review): `domain` 95 → **104** (+9, `backlog`/`routing`), `packages/services` 106 → **116** (+10, `requests.test.ts`). La 08a: `domain` 82 → 95 (+13, `requests/`), `packages/services` 102 → 106 (+4, `requests.test.ts`), restul neschimbat. Cele 4 noi verificate manual pe Supabase dev cu `TEST_DATABASE_URL` (vezi mai jos), nu încă printr-un push. Praguri anterioare: 242 (02c′), 329 (05a), 364 (06c), **445** (07c-2, confirmat CI `32108456833`). Dacă numărul scade fără explicație, s-a pierdut ceva. |
| **`pnpm db:seed --force` nu mai poate șterge tot**, din 05b | Alocările de finanțare nu se șterg (trigger), iar prin FK nici contractul. Seed-ul verifică și **se oprește cu mesaj** dacă există unități de lucru de seed, trimițând la `pnpm db:reset`. Nu e un bug — e regula pasului 05, care ajunge și la unealta de dezvoltare. |
| **Martie 2026 e ÎNCHISĂ la firma A pe Supabase dev**, din 05c | Închisă dinadins, ca ecranul de re-alocări să aibă ce arăta: mutarea finanțării intervenției `IV-000001` de acolo a emis `NRA-000001` în august. Dacă un ecran refuză o scriere pe martie, ăsta e motivul — nu un bug. |
| **Aplicația e deployată pe Vercel**, pe același proiect Supabase (`cspjtesltraiaveypuya`) | Deci datele de pe dev sunt aceleași care se văd în aplicația deployată — inclusiv seed-ul și luna închisă de mai sus. `next.config.ts` încarcă `.env.local` din rădăcina repo-ului, fișier care pe Vercel **nu există**: toate variabilele trebuie puse în Project Settings. |
| **`MFA_ENFORCED=0` pe deploy-ul de test** — pus în Vercel de utilizator și **confirmat că merge**, 17 august 2026 | Oprește **poarta** de al doilea factor, ca testarea să nu ceară un cod de 6 cifre la fiecare intrare. Nu atinge drepturile: `requiresMfa()` răspunde în continuare `true` pentru un admin. Cât timp e pornit, shell-ul de birou arată o **bandă roșie** pe fiecare ecran — dacă o vezi în capturi sau în HTML, nu e un bug de stil, e comutatorul. Detaliile în `docs/security.md`. |
| Rolurile lui Andrei sunt `pm` + `admin` | Le-am dus temporar la `pm` la 05c, ca să pot trece de poarta de MFA fără TOTP, și **le-am restaurat la final**. Dacă găsești altceva, s-a oprit o sesiune la mijloc. |
| **`git push` poate cădea cu „Repository not found"** deși repo-ul există | Remote-ul e **privat** (`SurviveANDcraft/DUO-ERP`) și e vizibil doar contului GitHub `SergioFir`. Mașina are două conturi în `gh`, iar git folosește Windows Credential Manager, **nu** tokenul lui `gh` — deci `gh auth switch` singur nu rezolvă, și nici `git -c credential.helper='!gh auth git-credential'`. GitHub nu distinge „n-ai acces" de „nu există", de aceea mesajul minte. **Nu trage concluzia că repo-ul a fost șters sau redenumit:** verifică `gh api user --jq .login`, apoi `gh repo view SurviveANDcraft/DUO-ERP --json name,visibility`. Fă commit local ca munca să fie în siguranță și cere utilizatorului să se logheze — o rezolvă în câteva secunde. |
| Docker nu există pe mașina de dezvoltare | Testele rulează în CI. Local există portița `TEST_DATABASE_URL`, adăugată la 07a — vezi „Cum rulezi testele fără Docker" din predare. Verificările pe date reale se fac pe Supabase dev. |
| **R2 e configurat real în `.env.local`**, verificat la 07b | Cele patru bucket-uri (`docs`, `derived`, `tmp`, `archive`) au credențiale valide, deci harness-urile de smoke urcă și descarcă efectiv. **CI-ul nu are credențiale R2 și nu trebuie să aibă**: nu există acolo teste care ating rețeaua, dinadins. |
| **pg-boss a rulat prima dată pe dev pe 18 august 2026** | Schema `jobs` există acum, cu cele 6 cozi (`system.ping`, `contracts.expiryScan`, `contracts.deltaFillScan`, `rollup.verify`, `files.derive`, `files.cleanup`). Înainte nu exista deloc — de aceea nu se observase că enqueue-ul din aplicație era rupt. Worker-ul se pornește cu `pnpm --filter @damina/worker dev`. |

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

### 2026-08-17 — [addendum la 02c′] — `MFA_ENFORCED=0`, pentru deploy-ul de test

Cerut de utilizator după 05c, când a încercat să vadă ecranele noi pe Vercel: rolul `admin` cere
TOTP (regula din 02c′), Andrei n-are factor înrolat, deci era trimis la `/doi-pasi` la fiecare
intrare. Pe un mediu de test asta nu face testarea mai sigură — o face să nu se mai facă.

**Ce s-a executat:** `mfaBypassed()` în `packages/auth/src/permissions.ts`, citit de `mfaSatisfied()`
— deci de toate cele trei locuri care aplicau poarta (middleware, login, `requireMfa()` din rutele
`/api/admin`). Plus banda roșie în shell-ul de birou, `.env.example` și `docs/security.md`.
**Două teste noi** (auth: 33 → 35).

**Trei lucruri de reținut:**

- **Oprește poarta, nu drepturile.** `requiresMfa()` întoarce în continuare `true` pentru un admin,
  iar ecranul de administrare spune în continuare adevărul despre rol. Unul din cele două teste noi
  blochează exact distincția asta — dacă cineva „simplifică" mai târziu făcând `requiresMfa()` să
  răspundă `false`, testul cade.
- **Nu se blochează pe `NODE_ENV === 'production'`**, deși ăsta era reflexul: pe Vercel `NODE_ENV` e
  `production` pe **toate** deploy-urile, inclusiv preview. Verificarea ar fi fost ori inutilă, ori ar
  fi blocat exact mediul pentru care comutatorul există. Garanția e deci **vizibilă** (banda), nu
  ascunsă. Abaterea a fost spusă utilizatorului explicit, nu strecurată.
- **O blocare tare rămâne posibilă** dacă apare un al doilea proiect Vercel: refuz pe hostul de
  producție. Acum există unul singur, deci n-ar fi apărat nimic și ar fi blocat totul.

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
   *(Adăugat după push: CI `32014280507` verde — servicii **41**, db 91, unitare 110, total
   **242**, exact cifra prezisă.)*
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

Pasul e tăiat în trei sub-etape (decizia utilizatorului, 17 august 2026), fiecare cu commit și CI
verde propriu: **05a** schema + domain pur · **05b** use-case-uri + seed · **05c** ecranele, cu
agentul de design. Motivul e mărimea: 19 verificări, 5 tabele, 6 use-case-uri și 7 ecrane nu încap
într-o sesiune.

### 2026-08-17 — [status: gata] — 05a, schema și domain-ul pur

**Migrare nouă: `0016_work_units`** (nu `0013` ca în textul pasului — numerotarea drizzle e la 15).
Cele 5 tabele din Anexa C.5 plus tot ce drizzle nu poate exprima:

- **8 triggere.** Etapele doar pe lucrări, și reversul (o lucrare cu etape nu se mai poate întoarce
  la intervenție) · coerența alocării (firma unității = firma contractului = firma lunii, componenta
  aparține contractului) · suma procentelor active ≤ 1 · imutabilitatea alocării · imutabilitatea
  documentului de re-alocare · coerența documentului + luna-țintă deschisă · autorizația SSM la
  asignare.
- **RLS pe toate cele 5 tabele**, cu `force`, prin `app.rls_enable`. Două funcții noi de scop:
  `app.work_unit_in_scope()` și `app.work_unit_assigned_to_me()`.
- **Grant-uri pe coloană** pentru teren și subcontractant: toate coloanele **în afară de**
  `estimated_value`, `cost_budget` (pe unitate) și `material_budget`, `labor_budget` (pe etapă).
- **`app.assert_no_money_leak(text[])`** — poarta din `0012`, scoasă într-o funcție reutilizabilă.
  Rămâne în bază pentru pașii 06–10.

**Pachet nou: `packages/domain/funding`** — `planFundingMove`, `describeFundingMove`,
`splitAcrossPeriods`, `allocatedTotal`, `validateAllocationSum`, `canPromote`,
`stageScheduleIsCoherent`, `physicalProgress`. **Domain-ul a urcat de la 29 la 82 de teste.**

**Verificări din pas care trec / nu trec:**

Rulate **pe Supabase dev (Postgres 17.6) real**, într-un bloc anulat la final — plus `pnpm db:migrate`
efectiv aplicat:

- [x] **#1** Delta pe 3 luni → **3 rânduri**, suma exact `34800.00`
- [x] **#2** 60% + 50% pe aceeași UL și lună → respins, mesajul spune `110.00%`
- [x] **#3** rescrierea sumei unei alocări → `CONFLICT: … nu se rescrie, se supersedeaza
  (s-a incercat: allocated_amount)`; supersedarea trece și lasă rândul vechi marcat; **supersedarea
  fără motiv scris e respinsă de audit**
- [x] **#9** etapă pe inspecție → `VALIDATION_FAILED: etapele exista doar pe lucrari, iar unitatea …
  este inspectie`
- [x] **#10** etapă cu `planned_end < planned_start` → `work_stages_planned_range`
- [x] **#12** SSM expirat la `starts_on` → `AUTHORIZATION_EXPIRED: persoana … nu are la 03.08.2026
  autorizatiile: ssm (expirata la 31.12.2025)` — **spune ce autorizație și când a expirat**
- [x] **#16** alocare într-o lună închisă → `PERIOD_CLOSED: luna 08/2026 este inchisa`
- [x] **#17** (jumătatea de bază de date) zero coloane de bani ale pasului vizibile lui
  `app_field`/`app_subcontractor`/`app_client`, dar codul unității rămâne vizibil terenului
- [x] **#18** toate cazurile din §13 și §13.1, fără Postgres — **46 de teste noi de domain**
- [x] (bonus) a doua alocare **activă** pe aceeași componentă × lună → respinsă de indexul unic
  parțial; RLS aprins + `force` + politici pe toate cele 5 tabele
- [x] `pnpm typecheck` 12/12 · `pnpm lint` verde · `pnpm test` verde · `pnpm build` verde ·
  `pnpm scan:secrets` curat
- [x] **#13** coduri consecutive la creare în paralel — trei tranzacții simultane primesc
  `…-000001`, `…-000002`, `…-000003`. Confirmat în CI.
- [x] Cele **34 de teste noi** din `packages/db/tests/work-units.test.ts` — suita de bază de date a
  urcat de la 91 la **125**. **CI verde, toate 4 joburile** (run `32018805393`, commit `df22558`).
  Pragul total: **329**.

**Două bug-uri de test, găsite la primul CI** (123/125 treceau din prima):
1. `muncitor` nu e valoare din `app.person_category` — lista are `angajat`, `sef_santier`,
   `subcontractant`, `client_user`.
2. Mai instructiv: `overrides.amount ?? '12500.00'` trata `null` ca **absent**, deci testul „nici
   sumă, nici procent" trimitea de fapt o sumă și nu verifica nimic. **`??` nu se poate folosi când
   `null` e o valoare cu sens** — și în tabela asta chiar e: o alocare exprimată în procent n-are
   sumă. Genul de test care trece verde fără să verifice ce spune.

**Observații / decizii luate / abateri de la plan:**

- **`pnpm db:generate` a fost reparat înainte de orice cod** (datoria #5 din predarea lui 02c′).
  Cauza: `0013`–`0015` aveau `id`/`prevId` copiate din `0012`, deci trei snapshot-uri arătau spre
  același părinte. Un lanț nou de `id`-uri, 8 linii de diff, și migrarea `0016` a putut fi
  **generată**, nu scrisă de mână. Merita făcut aici: o migrare de 5 tabele scrisă manual e exact
  locul unde apare o coloană care nu se potrivește cu schema TypeScript.
- **Codurile de UL trec prin `numbered_document_type`** (decizia utilizatorului): trei valori noi —
  `lucrare`, `interventie`, `inspectie`. Refolosesc alocatorul gapless din 02a. **Consecință de
  formă:** ies `L-000233`, nu `L-233`, pentru că alocatorul face `lpad(…, 6, '0')`. Convenția e
  schimbabilă cât timp tabelele sunt goale; după primul cod emis, nu. Inventarul de enum-uri din
  `schema.test.ts` **n-a trebuit atins** — el listează tipuri, nu valori.
- **`work_units` a căpătat o coloană `name`**, care nu e în Anexa C.5. Vederea unificată (§3.4) cere
  explicit coloana „denumire"; fără ea lista ar arăta numai coduri.
- **`guard_closed_period` NU se atașează pe `work_units`**, doar pe `funding_allocations` și
  `reallocation_documents`. O unitate de lucru n-are lună proprie, iar starea ei se schimbă și după
  ce luna în care a început s-a închis — o lucrare din august se finalizează în septembrie, și e
  cazul normal. Verificarea #16 trece deci **prin alocare**: `createWorkUnit` e o singură tranzacție
  care scrie și finanțarea, iar finanțarea e cea care are lună.
- **Regula 3 („alocările nu se fac UPDATE") e impusă cu un trigger, nu prin convenție.** Litera
  verificării #3 spune „niciun `UPDATE` pe rândul vechi", dar supersedarea *este* un update al
  statusului. Citirea onestă: se pot schimba **doar** `status` și `superseded_by`; suma, componenta,
  luna și motivul sunt istorie. Comparația se face pe `to_jsonb(row)` fără cele două chei mutabile,
  nu coloană cu coloană — așa o coloană adăugată la pașii 06–10 intră automat sub regulă.
- **`app.assert_authorizations_valid` a fost rescrisă** (semnătura neschimbată, deci apelanții din
  0004 rămân valabili). Mesajul spune acum, pentru fiecare tip: lipsește / a expirat la data X /
  e emisă abia la X. Fără asta, verificarea #12 („mesaj care spune ce autorizație **și când a
  expirat**") n-ar fi fost adevărată.
- **Asignarea nu folosește `app.guard_person_authorizations` din 0004**, deși funcția a fost scrisă
  exact pentru asta. Ambalajul generic citește data din rândul care se scrie, iar aici data care
  contează stă pe **părinte**: întrebarea e „avea omul SSM valabil când începe lucrarea", nu „acum".
  Trigger propriu, cu `coalesce(valid_from, work_units.starts_on, current_date)`.
- **Se cere `ssm` și numai `ssm`.** Autorizațiile de specialitate (înălțime, ISCIR, electrician)
  depind de ce se execută, nu de faptul că cineva e asignat — se cer pe operație, în pasul 09, unde
  există fișa care spune ce se face.
- **Regexul de bani din `0012` are o gaură reală:** prinde `price|pret|cost|amount|margin|salary`,
  deci `cost_budget` și `allocated_amount`, dar **nu** `estimated_value`, `material_budget`,
  `labor_budget`. Numele de coloană nu e un mecanism de securitate, e o euristică. De aceea
  `app.assert_no_money_leak()` primește o listă explicită de coloane suplimentare, iar `0016` o
  cheamă cu cele trei. **Pașii următori care adaugă bani trebuie să facă la fel.**
- **Grant-ul răspunde înaintea trigger-ului**, și e ordinea bună. `delete` pe alocări și
  `update`/`delete` pe documentele de re-alocare nu sunt acordate nimănui, deci refuzul vine cu
  `42501`, nu cu mesajul de business. Triggerele de imutabilitate acoperă **cealaltă** cale: funcțiile
  `security definer`, care rulează ca proprietarul și trec pe lângă orice grant. Testele verifică
  `42501` acolo unde privilegiul răspunde primul — nu mesajul, care nu se mai vede.
- **Subcontractantul vede unitățile pe care le execută el**, prin `executor_subcontractor_id`, pe
  aceleași coloane fără bani ca terenul. **Clientul nu primește nimic** pe UL: pasul nu cere niciun
  ecran de client, iar un grant nefolosit e un grant uitat.
- **Terenul are doar `select`** pe cele trei tabele vizibile. Crearea de pe teren (offline) e pasul
  10; până atunci un `insert` din `app_field` primește `42501`, verificat.
- **`work_unit_assignments` are o constrângere `exclude`** pe (unitate, persoană, rol, interval): un
  om nu poate avea de două ori același rol pe intervale suprapuse. Rolul intră în cheie dinadins —
  același om poate fi simultan inspector și echipă, și e cazul real la o firmă mică.
- **`describeFundingMove` există ca să nu fie două păreri.** Ecranul trebuie să anunțe mecanica
  *înainte* de confirmare (§3.4); dacă ar calcula-o singur, ar putea promite o ramură și tranzacția
  ar executa cealaltă. Un test compară cele două pe toate cele trei stări de lună.
- **`closing` se tratează ca `closed`** la mutarea finanțării. O lună în curs de închidere are deja
  raportul în verificare, iar o rescriere în timpul verificării e cel mai prost moment posibil.
- **`physicalProgress` spune dacă procentul e ponderat sau presupus.** „50% executat" dintr-o
  numărare de etape și „50%" din ponderi scrise de PM nu sunt aceeași afirmație, deși arată identic.
- **Capcană de plpgsql, prinsă pe date reale:** în `raise exception`, `%%%` se citește „`%` literal,
  apoi placeholder" — deci mesajul ar fi ieșit `%110.00`, nu `110.00%`. Semnul de procent se lipește
  la **argument**, nu la șablon.
- **Etapele au voie să se suprapună în timp**, și `stageScheduleIsCoherent` nu verifică asta
  dinadins: pe un șantier zugrăvitul începe într-o cameră în timp ce instalațiile se termină în alta.

**Ce rămâne pentru sesiunea următoare:** *(05b s-a făcut în aceeași zi — vezi intrarea de mai jos)*
1. **05b** — `packages/services/work-units`, peste domain-ul care e deja gata. Nu rescrie
   `planFundingMove`: serviciul execută ramura, nu o alege.
2. **05c** — ecranele, cu agentul de design.

### 2026-08-17 — [status: gata] — 05b, use-case-urile

**Ce s-a executat:**

- **`packages/contracts/src/work-units.ts`** — DTO-urile Zod. Două reguli ale pasului se citesc
  direct din forma lor: `workUnitInputSchema` **n-are `contractId`** (finanțarea nu e câmp pe UL),
  iar `reason` din `moveFundingInputSchema` e obligatoriu **fără implicit**. Plus etichetele de tip,
  status, executant și rol — „Unitate de Lucru" nu apare în niciuna.
- **`packages/services/src/work-units.ts`** — `createWorkUnit` (unitate + cod din serie + alocări +
  asignări, **o singură tranzacție**), `promoteToLucrare`, `moveFunding`, `previewFundingMove`,
  `allocateFunding`, `createStage` / `reorderStages`, `getClosingChecklist` / `closeWorkUnit`, plus
  citirile de care are nevoie 05c: `listWorkUnits` (vederea unificată, cu filtre pe finanțare),
  `listAllocations`, `listStages`, `listAssignments`, `getStageOverview`,
  `listReallocationDocuments`.
- **`packages/services/src/db-errors.ts`** — traducerea `P0001` → `AppError` într-un singur loc, cu
  listă închisă de prefixe. Cele trei copii vechi de `sqlstate` (`contracts`, `objectives`, `admin`)
  **au rămas pe loc**; migrarea lor e curățenie separată, nu parte din pas.
- **Seed** — o lucrare pe 3 luni de Delta, o intervenție, o inspecție, cu etape și asignări, plus
  seriile de numerotare la ambele firme și Marius Dobre cu autorizație SSM valabilă.

**Verificări din pas care trec / nu trec:**

- [x] **#4** promovarea păstrează **`id`-ul și codul**, schimbă tipul, lasă motivul în audit, iar
  alocarea rămâne același rând — nu o copie
- [x] **#5** lună deschisă → alocarea nouă activă, cea veche `superseded` cu `superseded_by` pus
- [x] **#6** lună închisă → `NRA-000001` în luna **curentă**, cu ambele capete și autorul
- [x] **#7** fără motiv → nu se salvează nimic, alocarea rămâne singura și activă
- [x] **#8** după mutare: același obiectiv, același cod, aceeași dată de start; istoricul
  obiectivului are exact același număr de unități
- [x] **#14** suma alocărilor active pe componentă × lună **dă exact** cifra de pe bandă — verificat
  pe Supabase dev, pe toate cele trei luni de Delta din seed (7.600 · 15.200 · 3.100)
- [x] **#19** checklist-ul de închidere blochează, fiecare rând blocant are link, iar rândurile
  modulelor viitoare apar dezactivate cu explicație — nu lipsesc
- [x] `pnpm typecheck` 12/12 · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm scan:secrets` —
  toate verzi. **CI verde** (run `32021200540`, commit `4634b6b`), servicii 41 → **74** de teste.
- [x] Seed-ul rulează cap-coadă pe Supabase dev: `L-000001`, `IV-000001`, `I-000001`, progres fizic
  25% ponderat, grafic coerent
- [ ] **#11, #15 (ecranul), #17** — cer interfață; rămân pentru 05c

**Observații / decizii luate / abateri de la plan:**

- **Cele două ramuri ale mutării diferă mai mult decât scria în plan.** Pe **luna închisă alocarea
  veche NU se atinge** — nu e o scutire, e chiar regula: o lună raportată nu se rescrie, iar
  `guard_closed_period` ar refuza oricum `update`-ul, pentru că rândul poartă luna închisă. Se emite
  documentul în luna curentă și se deschide alocarea nouă pe luna țintă. Pe **luna deschisă**, în
  schimb, supersedarea e chiar ce cere verificarea #5.
- **`costLineIds` e listă goală, și planul o spune cinstit.** Registrul de cost vine la pasul 06;
  ramura „rescrie descărcat" n-are ce rescrie acum. Efectul verificabil al lui #5 e supersedarea, și
  ea se întâmplă.
- **`moveFunding` cere luna curentă deschisă**, altfel refuză cu mesaj. Documentul de re-alocare se
  emite acolo, iar o firmă care n-a deschis luna n-are unde să-l pună.
- **Intervenția cere finanțare de la primul rând; inspecția și lucrarea, nu.** O intervenție e o
  cheltuială care se face acum, deci cineva a aprobat-o de undeva. O lucrare începe ca draft,
  înainte de deviz.
- **Cifrele din seed nu sunt la întâmplare:** alocările pe Delta sunt exact veniturile alocate pe
  cele trei luni, deci verificarea #14 e adevărată **prin construcție**, nu prin coincidență.
- **Codurile ies `L-000001` / `IV-000001` / `I-000001`.** Seriile sunt distincte pe tip dinadins —
  vezi bug-ul 2 mai jos.
- **`previewFundingMove` există ca să nu fie două păreri.** Ecranul anunță mecanica înainte de
  confirmare (§3.4); dacă ar calcula-o singur, ar putea promite o ramură și tranzacția ar face
  cealaltă. Un test compară anunțul cu execuția pe toate cele trei stări de lună.

**Trei buguri găsite la primul CI, toate reparate** (70 din 73 de teste treceau din prima):

1. **`reorderStages` folosea poziții negative temporare** — pe care chiar
   `work_stages_position_positive` le interzice. `check`-ul se aplică **și** valorilor intermediare,
   nu doar celor finale; comentariul meu explica de ce negativele „nu se ciocnesc cu nimic", și
   exact acela era motivul pentru care nu funcționau. Acum decalajul e peste maximul existent, deci
   pozitiv, cu gardă pentru `smallint`.
2. **Contorul de serie e per (firmă, TIP, serie), dar codul e unic pe (firmă, cod).** Două tipuri
   configurate cu același text de serie produc amândouă `X-000001`, și al doilea cade. Mesajul spune
   acum **cauza** — „seria e folosită și de alt tip" — nu simptomul: unitatea care ocupă deja codul e
   de alt tip și arată nevinovată, deci „cod duplicat" l-ar trimite pe om să caute în locul greșit.
3. **Un test crea alocarea direct în luna închisă**, ceea ce e corect respins (#16). Ordinea reală e
   alta: aloci cât luna e deschisă, luna se închide, mutarea vine după.

**Ce rămâne pentru sesiunea următoare:** *(05c s-a făcut în aceeași zi — vezi intrarea de mai jos)*
1. **05c** — ecranele, cu skill-ul de design.
2. Verificările **#11**, **#15**, **#17**.

### 2026-08-17 — [status: gata] — 05c, ecranele

Skill-ul de design (`llm-designer`) a fost încărcat înainte de prima linie de UI, cum a cerut
utilizatorul.

**Ce s-a executat — trei intrări în `entityRegistry`, ZERO fișiere de pagină:**

- **`activitate`** — vederea unificată peste cele trei tipuri, cu filtre (tip, status, obiectiv,
  responsabil, executant, **contract/componentă/lună prin alocările active**), plus pagina de
  detaliu cu **trei seturi de tab-uri**, unul pe fiecare tip.
- **`etape`** — aceeași pagină fractală, **un nivel mai jos**. Etapa are antet, tab-uri proprii,
  legături și breadcrumb care urcă la lucrare. Asta e verificarea #11, și e testul real al pasului 03.
- **`bani`** — *Re-alocările lunii*, cu număr, unitate, de la, la, valoare, cine a decis, de ce.
  Celelalte sub-secțiuni **n-au fost șterse**: sunt vederi care spun din ce fază vin.

**O completare în `registry/types.ts`**, exact felul pe care `docs/entity-registry.md` îl cere în loc
de o a doua pagină de detaliu: **`visible(session, entity)` primește acum și rândul.** Fără el,
singurele variante erau un tab „nu se aplică tipului ăsta" — adică tab-ul gri pe care §30.5 îl
interzice — sau a doua pagină de detaliu, pe care o interzice și mai apăsat.

**Verificări din pas care trec / nu trec** — rulate pe **aplicația care rulează**, cu sesiuni reale
fabricate din `/auth/v1/token` (22 de verificări, toate verzi):

- [x] **#11** etapa are pagina ei, cu tab-urile ei (Prezentare · Materiale · Manoperă · Costuri ·
  Istoric), navigabile, cu breadcrumb care urcă la lucrare
- [x] **#14** (jumătatea de UI) banda unei componente duce la ce se plătește din ea, cu total
- [x] **#15** `NRA-000001` apare în *Bani › Re-alocările lunii*, cu Mentenanță → Delta, 840 lei,
  Andrei Ionescu, și motivul scris
- [x] **#6 end-to-end prin aplicație**: martie 2026 închisă pe dev, iar mutarea finanțării
  intervenției a emis documentul în luna curentă — deci ramura de lună închisă merge pe drumul real,
  nu doar în test
- [x] cele **trei seturi de tab-uri**: lucrarea are Deviz/Etape/Situații și n-are Constatări;
  inspecția are Constatări și n-are Deviz/Etape
- [x] **„Unitate de Lucru" nu apare nicăieri pe ecran** — căutat literal în HTML-ul randat
- [x] coloana *Consumat* arată „—", nu zero
- [x] eticheta **„Delta ×3 luni"** apare pe lucrarea din seed
- [x] terenul e redirectat din ecranele de birou (rutarea din 02c, neatinsă)
- [x] `pnpm typecheck` 12/12 · `lint` · `test` · `build` · `scan:secrets` — **CI verde**
  (run `32024540915`, commit `8f17b7b`)
- [ ] **#17** (jumătatea de UI) — **cere ecranul de teren, care e pasul 10.** Jumătatea de bază de
  date e demonstrată la 05a: RLS pe asignare + grant-uri pe coloană, cu `42501` pe coloanele de bani.
  §3.4 al pasului nu cere niciun ecran de teren.

**Observații / decizii luate:**

- **Rutele au rămas 16.** Trei module noi, zero fișiere de pagină: build-ul arată tot `/[module]` și
  `/[module]/[id]/[[...tab]]`. Promisiunea pasului 03 se ține și la al treilea pas care o testează.
- **Cele două bare, una lângă alta.** A doua e zero și **spune de ce** („registrul de cost intră în
  pasul 06"). Un zero fără explicație s-ar citi ca „n-am cheltuit nimic", care e altceva decât „nu se
  poate calcula încă". Coloana *Consumat* din listă merge mai departe și arată „—", ca la contracte.
- **Graficul de etape: datele se scriu ca TEXT**, nu doar ca poziție a barei. O bară spune „cam
  pe-aici", iar raportul de lună are nevoie de ziua exactă — și informația care se vede doar la hover
  nu există nici pe telefon, nici pentru cititorul de ecran. Graficul e un `<table>` cu `caption`, iar
  barele sunt `aria-hidden`: ele ilustrează, nu informează.
- **Zero animație.** Nimic nu se desenează la scroll și nimic nu pulsează. Regula din skill: dacă
  utilizatorul nu se mișcă, interfața nu se mișcă.
- **Ecranul de mutare anunță mecanica înainte de confirmare**, din `previewFundingMove` — aceeași
  sursă pe care o citește execuția. Sub câmpuri scrie ce **nu** se schimbă niciodată (data
  documentului, obiectivul, analitica „folosit"), pentru că lista aia e motivul pentru care mutarea e
  sigură.
- **Confirmarea promovării arată listele „ce se păstrează / ce se adaugă"** venite din `canPromote`,
  ca ecranul să nu poată spune altceva decât face serviciul. Aici se traduc doar cheile.
- **`promotionCheckFor` în servicii:** `apps/web` **nu are voie** să importe `domain` (regula de
  boundaries, verificată în CI), iar ecranul are nevoie de exact același răspuns pe care îl dă
  serviciul — altfel ar arăta butonul „Promovează" pe o unitate care apoi refuză.
- **Creare din ecran, cu formular plat.** `createWorkUnitInputSchema` are liste imbricate, iar un
  formular declarat ca date nu le poate exprima. `workUnitFormSchema` + `createWorkUnitFromForm` e un
  **adaptor**, nu al doilea use-case: compune și cheamă `createWorkUnit`. Două drumuri de creare ar fi
  însemnat că al doilea uită o regulă. Nu are `update`: codul se alocă o dată, iar finanțarea se
  **mută**, cu motiv scris, din ecranul ei.
- **`listPeriodOptions` întoarce implicit doar lunile deschise.** Un `select` care ar oferi o lună
  închisă ar promite ceva ce baza refuză, iar omul ar afla abia din eroare.
- **Capcană de mediu:** `UseFormReturn` importat direct din `react-hook-form` în `apps/web` se
  rezolvă la **altă copie** a pachetului decât cea folosită de `@damina/ui`, și tipurile nu se mai
  potrivesc. Se importă din `@damina/ui`, care îl reexportă tocmai pentru asta.
- **Andrei nu poate intra în ecranele de birou fără al doilea factor** (rolul `admin` îl cere, din
  02c′). Verificările s-au făcut lăsându-i temporar doar rolul `pm` — care are `financials.read` și nu
  cere MFA — prin `setOfficeRoles`, adică prin ușa pe care o folosește chiar ecranul. Rolurile au fost
  **restaurate la final**.

**Un bug găsit la verificarea pe ecrane** (nu la typecheck): grupul de legături **„Etape"** se randa
pe toate cele trei tipuri, gol pe inspecții. Un „Etape (0)" pe o inspecție nu e o absență, e o
afirmație falsă — sugerează că inspecțiile au etape, doar că asta n-are. Acum apare doar pe lucrări.

**Ce rămâne pentru sesiunea următoare:** pasul **06 — Registrul de cost, închiderea**. Vezi tabelul
din predarea de la începutul fișierului: toate locurile care așteaptă cifrele de cost sunt deja pe
ecran, cu eticheta corectă.

---

## Pasul 06 — Registrul de cost, închidere

Pasul e tăiat în trei sub-etape (decizia utilizatorului, 17 august 2026), pe propunerea din predarea
sesiunii anterioare: **06a** schema de cost + rollup-uri · **06b** use-case-uri, jobul de control și
checklist-ul de închidere · **06c** ecranele. Motivul e mărimea: 21 de verificări, un registru cu 28
de coloane, rollup-uri întreținute prin trigger și șase ecrane nu încap într-o sesiune.

### 2026-08-17 — [status: gata] — 06a, schema de cost și rollup-urile

**Două migrări noi: `0017_cost_ledger` și `0018_rollups`.** Amândouă **generate** cu
`pnpm db:generate`, cu completările scrise de mână dedesubt — datoria plătită la 05a ține.

`app.cost_lines`, 28 de coloane, plus tot ce drizzle nu exprimă:

- **7 indecși**, fiecare din câte o întrebare reală de la §11, nu inventați. Cel de plafon a fost
  refăcut de mână cu `include (amount, stage)` — drizzle nu exprimă `INCLUDE`, iar aici răspunsul
  iese din index fără să atingă tabela. Cel de reconciliere e parțial și conține **exact anomaliile**:
  `where used_contract_id is distinct from charged_contract_id`.
- **4 triggere.** `period_id` derivat din `effect_date` · coerența liniei (firmă, etapă doar pe
  lucrări și obligatorie acolo, etapa să fie a unității de pe linie, componenta să aparțină
  contractului de pe **aceeași** analitică) · append-only · blocarea lunii închise, prin
  `attach_period_guard`.
- **RLS cu `force`**, o singură politică: `office`. Terenul, subcontractantul și clientul nu primesc
  **nicio** politică și niciun grant — regula 7 din pas, spusă de două ori dinadins.
- **`app.recharge_cost_line()`** — ușa unică prin care o linie își schimbă analitica „descărcat".
- **`app.rollup_verify(period)`** — recalculează din registru și întoarce doar diferențele.

**Verificări din pas care trec / nu trec:**

Rulate **pe Supabase dev (Postgres 17.6) real**, într-un bloc anulat la final — plus `pnpm db:migrate`
efectiv aplicat:

- [x] **#1** linie `consumat` fără `charged_contract_id` → respinsă de `check`; aceeași linie
  `angajat` trece (la comandă încă nu se știe bugetul)
- [x] **#2** linie pe lucrare fără `stage_id` → `VALIDATION_FAILED: lucrarea … cere etapa pe fiecare
  linie de cost`; reversul (etapă pe intervenție) → respins; etapa altei lucrări → respinsă
- [x] **#3** linie fără `document_id` → `23502`
- [x] **#4** `effect_date` în august → `period_id` se completează singur cu august, **chiar dacă
  aplicația trimite altă lună**; `document_date` în iulie rămâne în iulie
- [x] **#5** / **#6** `update` și `delete` nu sunt acordate **nimănui**, nici `app_service`
- [x] **#7** corecția prin storno: trei linii rămân vizibile, rollup-ul dă suma corectă
- [x] **#8** (jumătatea de bază de date) rollup = suma din registru, verificat cu interogare
  independentă **și** cu `app.rollup_verify` → zero divergențe. Seed-ul de 10.000 de linii e la 06b.
- [x] **#9** rollup corupt manual → `rollup_verify` întoarce componenta, coloana, stocat și așteptat
- [x] **#12** insert într-o lună închisă → `PERIOD_CLOSED: luna 07/2026 este inchisa`
- [x] **#13** (jumătatea de bază de date) `recharge_cost_line` rescrie `charged_*`, **`used_*` și
  `document_date` rămân neatinse**, iar rollup-urile ambelor componente se mișcă în aceeași tranzacție
- [x] **#15** linia mutată pe alt contract intră în raportul de reconciliere; înainte de mutare nu era
- [x] **#20** `app_field` nu vede niciun rând și nicio coloană din registru sau din rollup-uri
- [x] `pnpm typecheck` 12/12 · `pnpm lint` verde · `pnpm test` verde · `pnpm build` verde ·
  `pnpm scan:secrets` curat
- [x] Cele **21 de teste noi** din `packages/db/tests/cost-ledger.test.ts` — suita de bază de date a
  urcat de la 125 la **146**. **CI verde, toate 4 joburile** (run `32030892549`, commit `869b54f`).

**Două bug-uri de test, găsite la primul CI** (142/146 treceau din prima), amândouă în test, nu în schemă:
1. `contract_components` are unic pe **(contract, tip)**, deci trei teste care își făceau fiecare câte
   o componentă „lucrări" pe același contract se călcau în picioare. Fiecare își ia acum contractul ei.
2. Terenul nu primește „zero rânduri" pe `cost_lines`, ci **42501**: n-are nici măcar `select` pe
   tabelă, deci interogarea moare înainte să ajungă la RLS. Așteptarea corectă e **mai tare** decât cea
   scrisă în verificarea #20 — o listă goală se poate obține și dintr-un filtru greșit; privilegiul
   lipsă, nu.

**Observații / decizii luate / abateri de la plan:**

- **Numerotarea migrărilor:** `0017` și `0018`, nu `0014`/`0015` ca în textul pasului — drizzle e la 16.
- **`amount` NU are `check (>= 0)`.** Semnul are înțeles: o linie de storno e negativă, și de aceea
  corecția e o linie în minus, nu un `update`. Un `check` pe pozitiv ar fi făcut regula 1 imposibilă.
- **`charged_contract_id` e obligatoriu de la `receptionat` în sus, nu de la prima linie.** La
  `angajat` se știe ce se comandă înainte să se știe pe ce buget cade; o comandă lansată nu așteaptă
  decizia de rutare. Litera verificării #1 vorbește doar de `consumat`, dar `check`-ul e scris pe
  `stage <> 'angajat'`, ca în PLAN_TEHNIC.
- **`period_id` e nullabil în Drizzle și `not null` în bază.** Triggerele `before` rulează înaintea
  verificării constrângerilor, deci valoarea există întotdeauna; tipul TypeScript spune astfel
  adevărul despre ce trimite aplicația la `insert`, adică nimic.
- **Ușa de rescriere e o funcție, nu un grant.** `update` nu se acordă niciunui rol, deci singura cale
  e `app.recharge_cost_line`, `security definer`. Ea **nu** deschide luna închisă — mutarea pe o lună
  raportată cade cu `PERIOD_CLOSED` și trebuie să treacă prin documentul de re-alocare. Două uși
  diferite, dinadins. `moveFunding` din 06b o cheamă pentru fiecare id din `costLineIds`.
- **Trigger-ul de append-only compară `to_jsonb(row)` fără cele două chei mutabile**, ca la alocări în
  0016 — deci o coloană adăugată la pașii 07–10 intră automat sub regulă.
- **Ramura lui de mesaj („s-a incercat: …") e momentan inaccesibilă din aplicație**, pentru că niciun
  rol n-are `update`, iar singura funcție `security definer` care scrie schimbă doar `charged_*`.
  Rămâne ca plasă pentru funcțiile definer din 06b–10, care rulează pe lângă orice grant.
- **`allocated_revenue` se recalculează întreg, nu prin deltă**, spre deosebire de coloanele de cost.
  Alocările active pe o componentă × lună sunt unități, nu mii: unde recalculul e ieftin, el e și
  răspunsul corect — o deltă greșită o dată rămâne greșită până la jobul de verificare.
- **Alocarea în procent contribuie cu `pct × estimated_value` al unității**, iar o unitate fără
  valoare estimată contribuie cu zero. Nu inventăm o cifră pentru că ecranul ar arăta mai plin.
- **`app.rollup_apply_cost` și `app.rollup_recompute_allocated` s-au luat de la `public`** și s-au dat
  doar lui `app_service`: sunt `security definer`, deci cine le poate chema poate schimba cifra de pe
  ecran fără urmă în registru. Triggerele nu sunt afectate — Postgres verifică dreptul de execuție pe
  funcția de trigger la **crearea** trigger-ului, nu la fiecare rând.
- **Poarta de bani a prins ceva real.** Regexul din 0012 nu vede `committed`, `received`, `consumed`,
  `invoiced`, `allocated_revenue` — toate sunt bani cu alt nume. Sunt trecute explicit în lista lui
  `app.assert_no_money_leak`. **Pașii următori care adaugă bani trebuie să facă la fel.**
- **`app.period_close_checks` acceptă doar `pending|ok|blocked`** (constrângere din 0005), dar pasul
  cere și `not_applicable` / `pending_module` pentru modulele care nu există încă. **Migrarea care
  lărgește `check`-ul e treaba lui 06b**, împreună cu registrul de check-uri.
- Documentat în `docs/cost-ledger.md`: cele patru reguli, cum se leagă un tip nou de document, ce se
  întâmplă la mutarea finanțării, și cine vede registrul.

---

### 2026-08-17 — [status: gata] — 06b, use-case-urile și închiderea

**Pachet nou de use-case-uri: `packages/services/cost.ts`** — `recordCost`, `stornoCost`,
`rechargeCostLines`, `costLineIdsForMove`, `listCostLines` (paginare **cursor**, niciodată `OFFSET`),
`costBreakdown`, `listReconciliation`, `verifyRollups`.

**`moveFunding` nu mai minte.** `costLineIds: []` a devenit lista reală: liniile din luna și
componenta din care se mută. Pe ramura lunii deschise ele trec prin `app.recharge_cost_line`, **în
aceeași tranzacție** cu supersedarea alocării. Rezultatul are un câmp nou, `rechargedCostLines`.

**Închiderea de lună** (`packages/services/period-close.ts`): `open → closing → closed`, cu
redeschidere de administrator. Checklist-ul e **date**, cu registrul de verificări în cod și
`app.period_close_checks` ca stare.

**Jobul `rollup.verify`**, cron `0 2 * * *`, plus cele patru metrici de integritate din §3.6.

**Migrare nouă: `0019_period_close_checks`** — cele cinci stări ale unui rând de checklist.

**Verificări din pas care trec / nu trec:**

Rulate pe **Supabase dev (Postgres 17.6) real**, prin use-case-uri, nu prin SQL:

- [x] **#9** rollup corupt → `rollup_verify` îl găsește; jobul ridică alertă cu componenta și diferența
- [x] **#13** mutarea pe lună deschisă rescrie `charged_*` pe linii, `used_*` și `document_date` rămân,
  ambele rollup-uri se mișcă în aceeași tranzacție
- [x] **#14** mutarea pe lună închisă: document de re-alocare, **zero linii rescrise**
- [x] **#15** linia mutată pe alt contract apare în reconciliere; înainte de mutare, nu
- [x] **#16** o comandă lansată și nelămurită blochează închiderea, cu contor și link; butonul e
  inactiv, **și serviciul refuză din nou** — butonul inactiv e comoditate, regula e în `closePeriod`
- [x] **#17** închiderea cere motiv, îl scrie în audit, iar scrierile ulterioare în lună eșuează
- [x] **#18** redeschiderea fără motiv e blocată; cu motiv, trece
- [x] **#8** (jumătatea de volum) seed cu **10.000 de linii**: `sum(amount)` din registru =
  `sum(committed+received+consumed+invoiced)` din rollup-uri, la leu — `548360.00` — și
  `rollup_verify()` întoarce **zero** divergențe
- [x] `pnpm typecheck` 12/12 · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm scan:secrets` — verzi
- [x] Cele **18 teste noi** din `packages/services/tests/cost.test.ts` — suita de servicii a urcat de
  la 74 la **92**. **CI verde din prima, toate 4 joburile** (run `32033174957`, commit `a18b99f`).
  Niciun bug la primul CI, spre deosebire de 06a: scenariile fuseseră rulate întâi prin harness-ul de
  pe Supabase dev, iar cele două capcane de acolo (alocare într-o lună deja închisă, serie `NRA`
  lipsă) au fost prinse înainte de push.

**Observații / decizii luate / abateri de la plan:**

- **Storno-ul nu primește suma din afară.** O ia din linia stornată și o inversează — o sumă scrisă a
  doua oară de mână e o sumă care se poate scrie greșit a doua oară. Se inversează **și cantitatea**:
  altfel „câte bucăți am consumat" ar aduna bucățile stornate peste cele reale, deși banii s-ar fi
  anulat. Storno-ul unui storno e refuzat: corecția se face pe linia originală.
- **Serviciul face cele două analitici egale când apelantul nu le desparte.** Implicit sunt egale
  (§12); cine le desparte o face explicit, și atunci linia intră singură în raportul de reconciliere.
- **Rândul de checklist „linii fără analitică «descărcat»" a fost ARUNCAT.** `check`-ul din 0017 îl
  face imposibil, iar un rând care nu poate cădea niciodată e un rând pe care oamenii învață să nu-l
  mai citească. În locul lui: **comenzile lansate care n-au ajuns la recepție**, grupate pe document,
  cu sold ≠ 0. Rămâne ca metrică de integritate (§3.6), unde e la locul ei.
- **Soldul, nu numărul de linii.** Registrul fiind append-only, o comandă anulată nu dispare: se
  eliberează cu o linie negativă pe același stadiu. Dacă rândul ar număra linii `angajat`, ar rămâne
  roșu pentru totdeauna — adică ar face închiderea imposibilă.
- **`recordCost` nu primește `periodId` și nu poate.** Îl pune trigger-ul din `effect_date`; îl
  primești înapoi în rezultat, ca să nu-l recalculeze apelantul.
- **Alertele de rollup se grupează pe componentă**, nu pe coloană: patru coloane divergente pe aceeași
  componentă sunt o singură problemă. Alerta se închide singură — indexul unic parțial din 0008.
- **Seed-ul a căpătat `--costs`.** Liniile de cost nu se pot șterge, deci `--force` nu le poate reface,
  iar `db:reset` șterge tot — inclusiv ce ai construit de mână pe ecran. `--costs` adaugă doar
  registrul peste un seed existent. Scrie **numai în lunile deschise** dintre 03–05/2026: dacă cineva
  a închis martie ca să încerce ecranul de închidere, seed-ul n-are voie să treacă peste asta.
- **Ce rămâne pentru 06c:** verificările **#10** (Prezentare sub 200 ms, o singură interogare pe
  rollup), **#11** (drill-down până la document), **#19** (comutatorul brut/net) și **#21** (100.000
  de linii, prima pagină sub 500 ms). Toate trei cer ecranul; datele pentru ele există deja.
- **Regia (`overhead_snapshots`) e scrisă, dar încă nu o populează nimeni.** Recalcularea lunară e a
  worker-ului și intră tot la 06c, împreună cu comutatorul de marjă care o afișează.

---

### 2026-08-17 — [status: gata] — 06c, ecranele

**Decizia utilizatorului:** ecranele s-au făcut **fără agentul de design**, pe tiparul din 05c.
Regula casei („există un agent de design și se folosește pentru ecrane") rămâne valabilă; aici a fost
suspendată explicit, pentru că 05c lăsase deja tiparul, iar contextul de registry și use-case-uri era
proaspăt. **Nici skill-ul `llm-designer` n-a fost încărcat**: catalogul lui de anti-tipare
(gradiente, scroll-jacking, aglomerare de CTA-uri) e despre pagini de prezentare, iar ecranele astea
stau într-un design system existent, cu token-uri și componente care impun deja regulile din §30.

**Ecrane livrate:**

| Unde | Ce s-a schimbat |
|---|---|
| **Tab-ul Costuri**, pe unitate și pe etapă | Trei straturi, în ordinea întrebărilor: *cât* (patru stadii), *pe ce* (fel de cheltuială), *din ce document*. Analitica declarată pe ecran: **folosit**. |
| **Bani › Marjă** | Venit alocat − cost direct − regie, per contract. Comutatorul brut/net e **chiar comutatorul de vederi al listei** — vizibil permanent, în același loc ca toate celelalte. |
| **Bani › Folosit vs descărcat** | Liniile unde analiticele diferă, cu totalul mutat. Fără filtru implicit care să scurteze lista. |
| **Bani › Închidere de perioadă** | Checklist blocant per firmă, cu contor și link pe fiecare rând; butoanele *Începe închiderea* / *Închide luna* / *Redeschide luna*, ultimele două cu motiv obligatoriu. |
| **Contract › Prezentare** | Cifrele reale din rollup-uri, plus *Marja lunii* și *Cost direct în lună*. |
| **Obiectiv › Istoric** | Total anual, medie lunară și număr de unități, pe analitica **folosit**. |
| **Panou › Rapoarte** | Cele cinci rapoarte standard, fiecare cu analitica declarată în antet, plus cele **patru metrici de integritate** din §3.6. |

**Verificări din pas care trec / nu trec:**

Rulate în browser-ul serverului (harness-ul de fetch peste `next dev`, cu sesiune de dezvoltare), pe
**datele de seed cu 10.000 de linii**:

- [x] **#10** Prezentarea contractului se randează dintr-o **singură interogare pe rollup**.
  Măsurat cu `explain analyze` pe luna cu date: **0,076 ms**. Aceeași întrebare pusă direct
  registrului — adică ecranul pe care NU l-am construit — costă **10–11 ms la 5.000 de linii pe
  lună**, și crește liniar. Ținta de „sub 200 ms" e despre asta; restul timpului de pagină e rețea
  către Supabase și `next dev`, nu interogarea.
- [x] **#11** Drill-down: „Consumat” → liniile unității → linia cu documentul ei (tip + număr).
  **Parțial, și se vede pe ecran de ce:** documentele sursă (bon de consum, NIR, pontaj) apar la
  pașii 09–10. Lanțul e complet până la identitatea documentului; ultima verigă n-are încă unde să
  ducă, și ecranul spune asta în loc să dea un link mort.
- [x] **#15** Reconcilierea arată exact liniile mutate, cu ambele capete și cu totalul.
- [x] **#16** Ecranul de închidere arată rândul blocat cu contor și link, iar butonul e inactiv, cu
  motivul scris în `disabledReason` — nu gri și mut.
- [x] **#19** Comutatorul brut/net schimbă cifrele **și** eticheta; ambele vederi declară baza.
- [x] **#21** Paginarea cursor: `explain analyze` a arătat `seq scan` + `top-N heapsort`, **5,35 ms**
  la 10.000 de linii — corect ca rezultat, dar liniar, deci ~50 ms la o sută de mii. Cu indexul nou
  `cost_lines_cursor_idx` (migrarea `0020`): **0,108 ms**, `index scan`, fără sortare. Cost de
  ~50× mai mic și, mai important, **constant pe pagină** în loc de proporțional cu tot ce e în urmă.
- [x] `pnpm typecheck` 12/12 · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm scan:secrets` — verzi.
- [x] **CI verde, toate 4 joburile** (run `32036049849`, commit `1a8fbbb`). Testele de bază de date și
  de servicii n-au fost modificate la 06c (146 + 92), dar migrarea `0020` trece prin ele.

**Notă de proces:** rezultatul CI n-a putut fi citit imediat — API-ul GitHub Actions a întors `404`
pe `/actions/runs` și pe `/commits/{sha}` timp de câteva minute, deși `gh auth status` era valid și
rate-limit-ul intact. `/commits/{sha}/status` răspundea în același timp cu `pending`. S-a rezolvat de
la sine. **Dacă se repetă: nu e nimic stricat în repo — se reîncearcă peste câteva minute.**

**Migrare nouă: `0020_cost_cursor_index`** — adăugată **după măsurătoare**, nu din precauție.

**Observații / decizii luate / abateri de la plan:**

- **Comutatorul de marjă e comutatorul de vederi, nu unul propriu.** Prima variantă avea butoane
  desenate în ecran; se ajungea la două mecanisme pentru același lucru și la două locuri în care
  omul trebuie să se uite. Efect secundar util: `?view=marja-neta` a picat prima oară tăcut, pentru
  că `[module]/page.tsx` acceptă doar vederile **declarate** — exact garda care trebuia să existe.
- **Eticheta de analitică de pe Contract › Prezentare era greșită și a fost corectată.** Scria
  „folosit”; benzile și rollup-urile sunt pe **descărcat**. O etichetă greșită pe un ecran de bani e
  mai rea decât lipsa ei, pentru că se citește ca fiind verificată.
- **Textele „vine în pasul 06” au fost înlocuite peste tot**, nu doar unde apar cifrele noi. Un
  ecran care promite un pas deja făcut e o minciună care se descoperă singură.
- **Lista de contracte NU calculează consumul pe rând**, dinadins: ar fi o interogare de rollup per
  contract, la fiecare afișare. Cifrele lunii stau în *Bani › Marjă*, într-o singură trecere, iar
  coloanele listei spun unde să te uiți.
- **Ecranul de închidere se randează per firmă**, nu pe grup: luna e a firmei, iar două firme pot fi
  în stări diferite în aceeași lună calendaristică.
- **Constructorul de rapoarte peste registru (§3.4) NU s-a făcut** și scrie pe ecran că vine cu
  exporturile, în faza 3. Cele cinci rapoarte standard sunt trimiteri către ecranele care produc
  cifrele — un raport care ar recalcula altfel aceeași întrebare ar fi a doua sursă de adevăr.
- **Ce rămâne pentru pasul următor:** documentele care produc costuri (09–10) închid ultima verigă
  a lui #11, iar recalcularea lunară a regiei (`recomputeOverheadSnapshot`) trebuie legată la un job
  — funcția există și e acordată doar worker-ului, dar nimeni n-o cheamă încă periodic.

---

## Pasul 07 — File management (R2)

*Tăiat în trei sub-etape, ca pasul 06: **07a** schema + arborele automat ·
**07b** upload/download + worker · **07c** ecranele.*

### 2026-08-18 — [status: gata] — 07a, schema și arborele care se face singur

**Ce a intrat**

- `packages/db/src/schema/files.ts` — `nodes`, `file_versions`, `derived_assets`,
  `node_shares`. Migrarea `0021_files`, generată și completată dedesubt.
- Arborele din Anexa E.3, construit de **triggere**, în aceeași tranzacție cu
  entitatea: firmă → contract → legare obiectiv → unitate de lucru → etapă.
- `app.can_access_node(nod, permisiune)` — o poartă, trei surse (birou prin
  firmă, teren prin asignare, subcontractant **doar** prin `node_shares`).
- Backfill peste datele existente, cu plasă: migrarea cade dacă rămâne vreo
  unitate sau vreo legare fără folder.
- `docs/files.md` (≤ 40 de linii) și 16 teste noi în `packages/db/tests/files.test.ts`.

**Decizii care se abat de la plan, și de ce**

- **`node_role` are 23 de valori, nu 7.** Cele șapte schițate în pasul 01
  (`root_company|contract|objective|work_unit|stage|system|user`) fac regula
  „caută folderul pe rol, nu pe nume" imposibil de aplicat: toate subfolderele
  unei lucrări ar fi avut rolul `system`, deci `where work_unit_id = X and
  node_role = 'pv'` n-ar fi avut ce întreba. Enumul a fost recreat în `0021`
  (nicio linie nu-l folosea încă).
- **`root_node_id` a fost mutat de pe `objectives` pe `contract_objectives`.**
  Folderul obiectivului stă sub contract, iar același obiectiv poate fi pe două
  contracte — coloana de pe `objectives` ar fi trebuit să aleagă arbitrar unul
  dintre foldere. Stătea nefolosită din pasul 04. Consecință de dus la 07c:
  tab-ul *Documente* pe obiectiv trebuie să aleagă contractul din context.
- **Numele folderului de contract e „cod · client"**, fiindcă `app.contracts`
  n-are coloană `name`. Se resincronizează la schimbarea codului sau a
  clientului; redenumirea clientului nu propagă încă.
- **Există un `Activitate` și la nivel de firmă**, nu doar sub contract: o
  inspecție poate exista înaintea rutării (pasul 08) și trebuie să aibă unde
  să-și țină pozele. Când primește contract, folderul ei **se mută** — un singur
  `update parent_id`.
- **`nodes.created_by` e nullabil, și e null pe tot ce generează sistemul.** Nu e
  adevărat că folderele le-a făcut cine a apăsat „salvează" pe contract, iar
  varianta cu autor pica la prima generare dintr-un job sau dintr-un test.

**Ce a găsit harness-ul înainte de push**

Am adăugat o portiță în `tests/global-setup.ts` (ambele pachete): cu
`TEST_DATABASE_URL` setat, suita rulează pe baza indicată în loc de container.
Mașina n-are Docker, deci până acum orice greșeală se afla în CI, șase minute mai
târziu. A prins imediat trei lucruri:

1. `ensure_folder` pica pe FK-ul `created_by` când actorul n-are rând în
   `app.persons` → de aici decizia cu `created_by` null.
2. Completarea lui `root_node_id` producea **o a doua intrare de audit** la
   fiecare unitate de lucru creată (testul de promovare din 05a a căzut), iar pe
   `contract_objectives` — auditată cu motiv obligatoriu — cerea un **motiv
   scris pentru ceva ce n-a făcut niciun om**. Prima variantă a fost să fabric
   motivul și să-l pun la loc; s-a înlocuit cu ceva onest: `audit.record_change`
   scoate `root_node_id` din diferență **înainte** de verificarea „un UPDATE care
   nu schimbă nimic nu e un eveniment". Coloanele derivate nu sunt evenimente.
3. Două teste ale mele erau greșite, nu implementarea: „mută folderul" îl muta
   unde era deja (deci guard-ul n-avea ce respinge), iar actorul de teren avea
   `companyIds: []`, ceea ce îl scotea din raza lui `work_unit_assigned_to_me`.

**Ce am mai reparat pe drum**

- `scripts/migrate.ts` afișa doar „Failed query: …". Acum scrie și `cause`, adică
  mesajul Postgres. Fără el, depanarea unei migrări de 1000 de linii înseamnă
  înjumătățirea fișierului cu mâna.
- Seed-ul lăsa `contractObjectiveId` gol pe toate unitățile de lucru, deci
  arborele de probă atârna de firmă, nu de contract. Acum leagă.

**Verificări din pasul 07 acoperite aici:** 1, 2, 3, 4, 5, 14, 15, 16 — plus
regula 8 (finanțarea nu atinge arborele) și guard-ul de ciclu, care nu erau pe
listă. Restul așteaptă 07b (upload/download, worker) și 07c (ecrane).

**Suite:** 162 de teste de bază de date (146 + 16), 92 de servicii.

---

### 2026-08-18 — [status: gata] — 07b, uploadul, descărcarea și worker-ul

**Ce a intrat**

- `packages/services/src/files.ts` — presign, complete, download, miniaturi,
  organizare (creare / redenumire / mutare / coș / restaurare), partajare,
  curățenie.
- Rutele `/api/files/presign`, `/api/files/complete`, `/api/files/[versionId]`
  și `/api/files/[versionId]/thumb/[variant]`.
- Cozile `files.derive` (EXIF + 3 miniaturi WebP) și `files.cleanup` (nocturn,
  03:30), cu handler în worker.
- `packages/shared/src/magic.ts` — recunoașterea tipului din conținut, scrisă de
  mână, fără dependență. Listă **albă**: ce nu e recunoscut e respins.
- Dependențe noi, doar în worker: `sharp` și `exifr`.
- Drepturile `files.read` / `files.write` / `files.share`.
- Migrările `0022_jobs_schema_usage` și `0023_file_write_policies` — amândouă
  repară bug-uri, vezi mai jos.

**Trei bug-uri vii, găsite de smoke, niciunul introdus de 07b**

1. **`@damina/jobs` arunca la import.** Verificarea numelui de coadă din
   `defineJob` cerea segmente `[a-z0-9]`, dar două cozi din pasul 04 se cheamă
   `contracts.expiryScan` și `contracts.deltaFillScan`. Cum `defineJob` rulează
   la încărcarea modulului, **worker-ul nu mai pornea deloc**. Nu observase
   nimeni pentru că nimic din ce rulează în CI nu importa pachetul; s-a văzut
   când `files.ts` l-a adus în lanțul de import al serviciilor.
2. **Enqueue-ul din aplicație n-a funcționat niciodată.**
   `jobs.grant_queue_access()` dădea drepturi pe tabelele din schema `jobs`, dar
   niciodată `usage` pe schema însăși — deci orice `enqueue` făcut de un rol de
   aplicație cădea cu „permission denied for schema jobs". Toate cozile de până
   acum porneau din cron, din worker, care rulează cu rolul proprietar;
   `files.derive` e prima pusă la coadă **din cererea unui om**.
3. **`complete` nu-și putea termina treaba.** Migrarea 0021 dăduse pe
   `app.file_versions` politici de `select` și `insert`, dar niciuna de
   `update`. Cu `force row level security`, un `update` fără politică nu dă
   eroare: **atinge zero rânduri**. Fișierul rămânea la nesfârșit `uploading`,
   cu tipul și mărimea declarate de client — exact cele două valori pe care
   pasul se laudă că nu le crede. `0023` adaugă politicile și, la final, o plasă
   care refuză migrarea dacă vreo tabelă de fișiere rămâne fără politică de
   scriere pentru birou.

**Ce a mai ieșit la iveală**

- `cleanupFiles` folosea `= any(${array})`; în `sql` de la drizzle o listă JS
  devine `(a, b, c)`, nu un array — deci `cannot cast type record to uuid[]`.
- Curățenia trebuie chemată cu actorul de **serviciu**: `delete` pe `app.nodes`
  nu e acordat nimănui altcuiva. Din interfață, ștergerea e `deleted_at`.
- O imagine pe care decodorul n-o poate citi e un eșec **permanent**: `catch`-ul
  e strâns exact în jurul apelului `sharp`, ca citirea din R2 și scrierea în bază
  — singurele care merită reîncercate — să rămână în afara lui.

**Cum a fost verificat**

Două harness-uri pe mediul de dezvoltare, cu **bucket R2 real**:

- 18 verificări pe upload/download — multipart, tip real vs declarat, mărime
  reală vs declarată, HTML redenumit `.pdf`, sumă de control greșită, TTL de
  60 s, `Content-Type` și `Content-Disposition` din bază, numele eliberat la
  ștergere.
- 8 verificări pe worker, cu o poză reală generată cu EXIF: cele trei miniaturi,
  data capturii, coordonatele (44.425, 26.103 — București) cu `geo_source='exif'`,
  aparatul în `exif jsonb`, miniatura descărcată și confirmată WebP.

În CI rămân testele care **nu** ating rețeaua: 6 unitare pe magic bytes și 10 de
servicii pe arbore, coș, partajare și curățenie. Printre ele, verificarea #6 —
mutarea unui folder cu 1.000 de fișiere — scrisă nu ca măsurătoare de timp (pe un
container n-ar însemna nimic), ci ca **un singur rând atins**. Dacă cineva
rescrie vreodată mutarea ca parcurgere de subarbore, testul cade indiferent de
cât de rapidă e mașina.

**Verificări din pasul 07 acoperite aici:** 6, 7 (parțial — reluarea per parte e
proiectată și presemnată, dar întreruperea reală de rețea cere clientul din 07c),
8, 9, 10, 11, 12, 13, 17, 18. Rămân pentru 07c: 19, 20 și #21 (uploadul din
teren, care cere ecranul).

**Suite:** 162 de bază de date, 102 de servicii (92 + 10), plus 6 unitare noi.

### 2026-08-18 — [status: gata] — 07c-1, explorerul, uploadul și tab-ul Documente

**Ce a intrat**

- **`/documente`** — explorerul: firimituri, navigare pe `?node=`, folder nou,
  redenumire, mutare, ștergere, coș de gunoi cu restaurare. Când contextul are mai
  multe firme, se alege firma întâi: arborele e al unei firme, nu al omului.
- **`components/files/file-explorer.tsx`** — **o singură** componentă, montată în
  două locuri. Se randează pe server (navigarea e navigare adevărată, iar HTML-ul
  se poate verifica fără browser); client sunt doar zona de upload și dialogurile.
- **Tab-ul `Documente`** pe contract, obiectiv, unitate de lucru și **etapă** —
  prin registry, patru intrări, zero pagini noi. Verificarea #19.
- **Uploaderul** (`upload-zone.tsx`): drag & drop, `presign` → PUT per parte →
  `complete`, **retry per parte** (3 încercări, pauză crescătoare), progres real
  cu `XMLHttpRequest`, renunțare cu `abort`.
- **Video până la 4 GB** (era 500 MB): `uploadPartBytes` și `uploadTtlSeconds`
  calculează partea (8/16/32 MB) și TTL-ul (15 min – 12 h) din mărimea fișierului.

**Două bug-uri vechi, găsite de harness — nu le reintroduce**

1. **Un contract cu 20 de obiective avea UN SINGUR folder de obiectiv.**
   `app.ensure_folder` căuta pe `(părinte, rol, work_unit_id, stage_id)` — fără
   `objective_id`. Toate obiectivele unui contract au același părinte și același
   rol, deci al doilea primea folderul primului: pe dev, **120 de legături → 40 de
   foldere**. Reparat în `0024`, cu backfill și cu plasă. Aceeași familie ca
   bug-ul de RLS din `0023`: **n-a dat eroare nicăieri, doar a suprapus dosare.**
   Plasa numără obiective distincte, nu legături — același obiectiv relegat de
   același contract în două perioade e un singur dosar, corect.
   **Prima variantă a reparației a picat pe testul de arbore**, și merită ținut minte de ce:
   funcția inserează analitica *moștenită din părinte*, dar căuta după *argument*. `Fișă` se
   creează cu `p_objective => null` și există în bază cu obiectivul moștenit — deci nu se mai
   găsea. Acum ambele folosesc aceleași trei variabile.
2. **Verificarea #8 nu trecea.** `complete` verifica plafonul pe tip, dar nu și
   mărimea reală față de cea anunțată: se putea declara 1 KB și urca 6 MB.
   Acum egalitate strictă — clientul știe exact cât are fișierul lui.

**Decizii luate**

- **`/documente` e pagină proprie, nu intrare în `entityRegistry`** (aprobat).
  Pagina fractală randează liste de rânduri; asta e navigare într-un arbore, iar
  `ListQuery` are căutare și vedere, nu un nod curent. Precedent: `panou/rapoarte`.
- **Nodul curent stă în `?node=` pe `/documente`, dar în segmente pe tab-uri**
  (`/activitate/{id}/documente/{nod}`): pagina fractală **nu primește
  `searchParams`**, dar primește `sub`. De aici `FileExplorer` ia `href` ca funcție.
- **Tab-ul obiectivului alege contractul.** Dosarul stă pe legătura
  obiectiv×contract; cu un singur contract alegerea e tăcută, cu mai multe se cere.
- **Suma de control doar sub 32 MB** (aprobat): peste, serverul ar descărca înapoi
  din R2 tot ce s-a urcat, ca s-o verifice.
- **Drag & drop înseamnă „trage fișiere din sistem"**, nu „trage un rând peste un
  folder". Mutarea se face din dialog, cu părintele și folderele surori ca ținte.
  Mutarea prin tragere cere înlocuirea componentei `Table` — nu merită încă.

**Cum a fost verificat**

- 15 verificări pe ecrane, fără browser (`next dev` + `curl`, afirmații pe HTML):
  explorer, navigare, coș, tab-ul Documente pe toate cele patru entități,
  navigarea în tab pe segmente, zero URL-uri R2 în HTML.
- **#21**, ca `field`, cu sesiune fabricată din grantul de parolă: `presign` în
  UL-ul lui → 200; într-o UL neasignată → **404, „Folderul inexistent"** (RLS,
  zero rânduri — nu un `if` din aplicație).
- Upload cap-coadă pe R2 real: 9 MB în 2 părți, `complete` → `image/jpeg`,
  9.437.184 octeți. Și controlul care a scos bug-ul #2 de mai sus.
- 11 teste de servicii pe fișiere (10 + regresia pentru dosarele suprapuse).

**Verificări acoperite:** 19, 21, 8 (reparată). Rămân pentru 07c-2: **20**
(galeria), partea de client a lui **7** (întreruperea reală de rețea cere
Playwright), și partajarea din interfață.

### 2026-08-18 — [status: gata] — 07c-2, galeria, previzualizarea, partajarea, versiunile

**Ce a intrat**

- **Galeria** (`photo-gallery.tsx`) — vedere a explorerului, nu al doilea ecran:
  citește ACELEAȘI rânduri ca tabelul, deci nu pot arăta lucruri diferite.
  `thumb160` în grilă, `thumb1200` în lightbox, `loading="lazy"`, ora și geotagul
  pe fiecare poză, cu sursa coordonatelor. Săgeți și Escape de la tastatură.
- **Tab-ul `Poze`** pe inspecție/intervenție și pe obiectiv — deschide direct
  galeria. Pe lucrare rămâne ascuns dinadins: acolo pozele au faze
  (`Înainte`/`Etapa N`/`După`), iar faza e informația care contează, deci se
  răsfoiesc din `Documente`.
- **Previzualizarea** — rută nouă `/api/files/[versionId]/preview`, `inline`, TTL
  de 15 minute. Dispoziția **nu** e parametru: `previewUrl` o acordă doar pozelor
  și PDF-urilor, comparând cu tipul din magic bytes.
- **Partajarea din interfață** — dialog pe folderul curent: cu cine, ce
  permisiune, cine are deja acces, retragere. Drept propriu (`files.share`), nu
  cel de scriere.
- **Istoricul de versiuni** — deschizi un fișier în explorer și vezi versiunile,
  fiecare descărcabilă. `uploading` și `failed` se arată, nu se ascund.
- **`listShares` întoarce acum și numele** (join pe persoane/subcontractanți). O
  listă de partajări cu id-uri e o listă pe care nimeni n-o poate audita.
- **`nodeSummary`** — un nod, singur. Explorerul află din `kind` dacă arată copiii
  sau versiunile; „lista de copii a ieșit goală" ar fi confundat un folder gol cu
  un fișier.
- **`listChildren` are acum plafon** (200 de rânduri) și `countChildren` lângă el.
  Până acum n-avea niciunul: un folder cu 3.000 de poze — cazul din plan — ar fi
  randat 3.000 de rânduri. Sub listă scrie „se văd primele N din M", cu link care
  ridică plafonul.

**Decizii luate**

- **`<img>`, nu `next/image`, în toată galeria.** Optimizatorul lui Next ar
  descărca fișierul **pe server** ca să-l reprelucreze — exact ce nu face pasul
  ăsta. În plus, miniaturile sunt deja WebP redimensionat, făcut o dată de worker.
- **Nodul curent în URL și pentru fișiere.** `?node={idFișier}` arată versiunile.
  Alternativa (dialog client) ar fi însemnat o a doua cale de citire, neverificabilă
  fără browser.
- **`ContractPicker` extras** — `Documente` și `Poze` ale obiectivului aleg
  contractul la fel, fiindcă amândouă trăiesc pe legătura obiectiv×contract.

**Cum a fost verificat**

- **Verificarea #20, pe date reale**: 300 de poze cu EXIF (dată + GPS București),
  urcate prin API-ul real, derivate de worker. Galeria cere **doar** `thumb160` —
  harness-ul verifică explicit că nu există niciun `src` către original — plus
  `loading="lazy"`, ora și coordonatele pe fiecare.
- 17 verificări pe ecrane, fără browser: comutatorul de vedere, tab-ul `Poze` pe
  inspecție (și **absența** lui pe lucrare), previzualizarea (302), versiunile cu
  versiunea curentă marcată, butonul de partajare, zero URL-uri R2 în HTML.
- Lanțul EXIF → worker confirmat cap-coadă: `geo_source='exif'`, coordonatele
  44.4268 / 26.1025, 3 miniaturi per poză.

**Cifrele de scară, măsurate pe build de PRODUCȚIE** (dev-ul minte urât aici — la
300 de rânduri arăta 9 s, adică de zece ori peste realitate):

| | randare | peste referință |
|---|---|---|
| `/panou` (referință) | 1550 ms | — |
| tabel, 200 de rânduri | 2177 ms | +630 ms |
| tabel, 317 de rânduri | 2246 ms | +700 ms |
| galerie, 304 poze | 2127 ms | +580 ms |

Deci ~2 ms pe rând, iar interogarea e 1,8 ms cu totul (`nodes_parent_idx`, index
scan). **Nu era o problemă de performanță** — dar plafonul rămâne, fiindcă la
3.000 de poze aceleași 2 ms/rând înseamnă 6 s și 6 MB de HTML.

**Datorie plătită:** `pnpm install` rulat, deci `sharp`/`exifr` există local și
`pnpm typecheck` trece complet pe mașina asta, nu doar în CI.

**Verificări acoperite:** 20. Pasul 07 e închis, cu o singură excepție: partea de
client a lui **#7** — întreruperea reală de rețea în timpul unui upload — care
cere Playwright.

---

## Pasul 08 — Cereri, rutare, backlog

*(nicio sesiune n-a lucrat încă aici)*

---

## Pasul 09 — Fișe de lucru

### 2026-08-18 — 09a, fundația [status: gata]

Detaliile complete sunt în secțiunea **„09a — fundația fișelor de lucru"** din predarea de la
începutul fișierului. Pe scurt: migrarea `0026` (aplicată pe dev), triggerele care țin regulile 1–8
ale pasului, `packages/domain/src/sheets/` cu 20 de teste, patru module noi de servicii, patru
drepturi noi. Smoke pe Supabase dev: 21 de verificări, toate verde. Ecranele (§3.5, §3.6) sunt 09b.

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



