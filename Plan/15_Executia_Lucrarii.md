# Pasul 15 — Execuția lucrării: Gantt, necesar pe etape, închiderea

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** lucrarea se conduce, nu doar se înregistrează. Graficul arată unde ești, bugetul de etapă arată dacă mai ai bani, necesarul de material poartă etapa, iar închiderea nu se poate face pe jumătate. **Cu asta, faza 2 e completă.**
> **Ultimul pas al fazei 2**, și cel care leagă tot ce s-a construit la 11–14 de ce exista deja din faza 1.

---

## 0. Context de business (esențial)

### Etapele există deja — nu le construi

`app.work_stages` e completă **din pasul 05**: poziție, `planned_start`/`planned_end`, `actual_start`/`actual_end`, `material_budget`, `labor_budget`, `pct_of_work`, cu toate `check`-urile de coerență temporală.

Pasul ăsta nu adaugă coloane acolo. **Construiește ce lipsește în jurul lor:** graficul, comparația buget vs consum real, și legătura obligatorie cu necesarul de material.

### Bugetul pe etapă funcționează doar dacă etapa e pe fiecare linie

Avertismentul e explicit în §9: *„Atenție: funcționează doar dacă **fiecare linie de comandă poartă etapa**. Dacă șeful de șantier comandă «pe lucrare» fără etapă, raportul e gol."*

`cost_lines.stage_id` există și e **obligatoriu prin trigger când UL-ul e lucrare** — asta s-a făcut la pasul 06. Ce lipsește e capătul celălalt: **necesarul de material nu poartă etapa.**

Azi, ecranul de teren `Necesar material` produce un `Request` generic de tip `solicitare`, cu text liber (`apps/web/src/components/field/material-request.tsx`). Nu are linii, nu are etapă. Pentru mentenanță e suficient. **Pentru o lucrare cu buget pe etapă, nu e.**

### Etapa pe necesar, față de bugetul de tapuri

Aici e tensiunea reală a pasului, și decizia e deja luată.

Bugetul de tapuri e **3, blocant în CI la 4**, iar `＋` plus alegerea acțiunii consumă deja două. Ecranul are voie la **o singură atingere**. Un câmp obligatoriu în plus rupe pragul și testul cade — asta e scris în predarea de la 10c-3.

**Decizia utilizatorului (19 august 2026), varianta (a):**

> **Etapa se precompletează cu etapa curentă din grafic** — cea în care cade data de azi — **și se poate schimba dintr-un tap opțional.** Bugetul rămâne 3.

Exact ce cere §9: *„câmpul etapă obligatoriu pe necesarul de materiale, cu default = etapa curentă din grafic."* Obligatoriu în date, precompletat pe ecran. Cele două nu se contrazic.

**Dacă lucrarea n-are etape** (sau UL-ul nu e lucrare), câmpul nu apare deloc — la fel cum face deja `Jurnal` de la 10c-4, care a rezolvat aceeași constrângere.

### Jurnalul există — nu-l reconstrui

**`app.journal_entries` e construită la 10c-4** (migrarea `0033`), cu ecranul de teren în 3 tapuri. Anexa D.3 o listează la faza 2 sub numele `work_journal_entries`; **e aceeași tabelă, făcută mai devreme, la cererea utilizatorului.** Nu o dubla.

Ce lipsește din §9 și se face acum: **secțiunea fixă „Înainte / După" la nivel de lucrare, obligatorie la deschidere și la închidere.**

**Atenție la o constrângere reală:** `journal_entries` e **append-only pentru toată lumea** — `update` și `delete` nu se acordă nimănui, nici biroului, nici lui `app_service`. Deci „Înainte/După" **nu poate fi un câmp editabil**. Se modelează ca o coloană `kind` nouă (`curenta | inainte | dupa`), iar checklistul de închidere cere să existe câte una din fiecare. O corectură rămâne ce e azi: o intrare nouă, cu data ei.

### Închiderea lucrării

Pasul pe care documentul îl numește „necesar, dar nedescris" (§15):

> ajustare stoc rămas pe gestiunea șantierului, retur la magazie, ultimul bon de consum, PV de recepție, blocarea de noi costuri, calculul marjei finale, arhivarea în „proiecte anterioare" ca sursă de copiere pentru devize viitoare.

**`getClosingChecklist` există deja** (`packages/services/src/work-units.ts`) și are trei rânduri marcate `pending_module`:

- `material_return` — retur la magazie; **rămâne `pending_module`**, aprovizionarea e faza 3;
- `pv_receptie` — **rămâne `pending_module`**, PV-ul e faza 4;
- `situatie_lucrari` — situație de lucrări acceptată → **devine rând real acum**.

**Cele trei texte de pe ecran sunt greșite azi și se corectează în pasul ăsta**, chiar și acolo unde
starea nu se schimbă: `material_return` spune „se verifică din pasul 06, când există registrul de cost"
— registrul există din pasul 06, deci fraza promite ceva ce s-a întâmplat deja; `pv_receptie` spune
„documentele de recepție vin în faza 2", dar PV-ul e faza 4. Un rând `pending_module` care arată către
o fază greșită e o promisiune pe care nimeni n-o mai urmărește.

Regula casei: *„un rând de checklist care nu poate cădea niciodată nu se pune pe ecran."* Verifică fiecare rând nou pe care-l adaugi.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §9 (etape, buget, jurnal, pontaj), §15 (fluxul de execuție și închiderea), §13.1 |
| `Damina_Aplicatie_Structura_Functionala.md` | §11 (Activitate), §13.1 (canalele de aprovizionare — **doar ca să știi unde se oprește pasul**) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | Anexa D.3, §4.6–4.7 (registrul de cost, rollup-uri) |
| `Plan/PROGRESS.md` | intrarea „10c-4 — jurnalul de șantier" și „Reguli ale casei" |
| `Plan/11`–`14` | tot |

## 2. Precondiții

- **Pașii 11–14 complete.**
- `app.work_stages` — **există din pasul 05, completă.**
- `app.journal_entries` — **există din 10c-4.**
- `getClosingChecklist` și `closeWorkUnit` — **există din pasul 05.**
- Aplicația de teren, cu `MUTATION_TYPES` și bugetul de tapuri măsurat în `e2e/field/tap-budget.spec.ts`.
- Registrul de cost cu `stage_id` obligatoriu pe lucrări (pasul 06).

**Migrări: `0053`–`0055`.**

---

## 3. Ce livrezi

### 3.1 Necesarul de material pe etape (migrarea `0053_material_requirements`)

```
material_requirements       → work_unit_id, stage_id  ← OBLIGATORIU cand UL-ul
                              e lucrare, prin trigger (tiparul de la cost_lines)
                              company_id, requested_by, requested_at,
                              needed_by date, status:
                              ceruta|in_procesare|acoperita|anulata,
                              notes
material_requirement_lines  → requirement_id, product_id?, free_text?,
                              quantity, uom, position
```

**`product_id` SAU `free_text`**, cu `check` care cere exact unul. Omul din teren nu găsește mereu produsul în nomenclator, iar a-l obliga înseamnă că nu cere nimic — sună la magazie, și trasabilitatea rămâne goală. Textul liber e o intrare validă pe care biroul o rezolvă la procesare.

**Triggerul de etapă** copiază tiparul care există deja pe `cost_lines`: `before insert`, dacă `work_unit.type = 'lucrare'` și `stage_id is null`, refuză. Nu-l scrie ca `not null` — o intervenție n-are etape, iar tabela e comună.

**Migrarea nu rescrie istoricul.** Necesarele făcute în faza 1 sunt `requests` de tip `solicitare` și rămân acolo. Nu le converti: ar însemna să inventezi linii și etape pentru cereri care n-au avut niciodată.

**Mutația `material.request` își schimbă executantul**, nu numele. Azi cheamă `createRequest`; de acum scrie în `material_requirements` când UL-ul e lucrare, și rămâne pe `createRequest` altfel. **Tipul de mutație rămâne același** — telefoanele din teren pot avea în coadă mutații vechi, iar un tip dispărut le-ar bloca definitiv.

**Rulează mutația din rolul `app_field` înainte de a atinge ecranul**, cu payload-ul exact cum îl compune el, inclusiv `stageId` ca șir gol. Regula 1 și 2 din `PROGRESS.md`.

### 3.2 Ecranul de teren, cu bugetul intact

`Necesar material` capătă selectorul de etapă, **precompletat cu etapa curentă**:

- „etapa curentă" = prima etapă unde `planned_start <= azi <= planned_end`; dacă nu se potrivește niciuna, prima neîncheiată (`actual_end is null`);
- selectorul **apare doar** dacă UL-ul e lucrare **și** are etape;
- schimbarea etapei e **un tap opțional**, nu unul obligatoriu.

**Testul de tapuri din `e2e/field/tap-budget.spec.ts` se extinde**, nu se relaxează: acum trebuie să măsoare fluxul și pe o lucrare cu etape, tot **≤ 3 tapuri**. Felia fabricată din `e2e/support/slice.ts` capătă o lucrare cu etape — **nu se populează Dexie de mână**.

Dacă pragul cade, **problema e ecranul, nu pragul.** Nu urca pragul.

### 3.3 Gantt și bugetul de etapă

Ecran nou sub `Activitate › Calendar / Gantt` — intrarea există deja în `navigation.ts`.

Per etapă, unul lângă altul:

```
Etapa 2 · Hidroizolatii        01.09 – 24.09   (in curs, ziua 9 din 24)
Material   buget 42.000   consumat 31.800   76%   ███████░░
Manopera   buget 28.000   consumat 24.100   86%   ████████░
Progres etapei                                     38%
```

**Consumul vine din registrul de cost, filtrat pe `stage_id`.** Progresul vine din etapă. **Cele două nu se deduc unul din altul** — exact regula scrisă la 10e pentru gauge-ul Delta, și din același motiv: divergența e chiar semnalul.

Refolosește ce există: `Gauge` din `@damina/ui` (10e), `consumptionRisk` din domeniu (10e). **Nu scrie a doua funcție care calculează același lucru.**

Bara de trasabilitate de la pasul 11 capătă acum câmpul **„Comandat"**? **Nu** — comanda e faza 3. Rămâne liniuță. Ce se completează acum e „Consumat", din registru.

### 3.4 Înainte / După pe jurnal (migrarea `0054_journal_kind`)

O coloană `kind` pe `journal_entries`: `curenta | inainte | dupa`, `default 'curenta'`.

**`unique (work_unit_id, kind) where kind in ('inainte','dupa')`** — o singură intrare de fiecare fel per lucrare. Append-only rămâne append-only: dacă omul greșește, scrie o intrare `curenta` cu corectura, iar cea fixă rămâne cum a fost. Documentat pe ecran, ca să nu pară un bug.

Ecranul de teren capătă cele două ca acțiuni distincte, **doar pe lucrări**, și doar când lipsesc.

### 3.5 Închiderea lucrării (migrarea `0055_work_closing`)

`getClosingChecklist` capătă rândurile reale ale fazei 2. **Verifică fiecare: poate cădea vreodată?**

| Rând | Stare nouă | Blochează? |
|---|---|---|
| `situatie_lucrari` — toate SL-urile aprobate sau anulate | **real** | da |
| `deviz_frozen` — devizul client are cel puțin o versiune înghețată | **real** | da, doar la contract individual |
| `journal_before_after` — există intrare `inainte` și `dupa` | **real** | da |
| `supplements_decided` — nicio suplimentare rămasă `propusa`/`verificata` | **real** | da |
| `warranties` — garanțiile reținute au scadență | **real, informativ** | **nu** — se eliberează după închidere, e normal |
| `material_return` — retur la magazie | **rămâne `pending_module`**, cu textul corectat pe faza 3 | nu — faza 3 |
| `pv_receptie` | **rămâne `pending_module`**, cu textul corectat pe faza 4 | nu — faza 4 |

**Blocarea de noi costuri după închidere**: trigger pe `cost_lines`, `before insert`, care refuză liniile pe o UL cu `status = 'inchisa'`. **Cu o singură ieșire: stornarea** (`is_reallocation` sau `reallocation_of_id` completat) — altfel o corecție legitimă a unei luni închise devine imposibilă.

**Marja finală** se calculează la închidere și se **memorează** pe UL (`final_margin`, `closed_at`). Aici, spre deosebire de cumulatele de la pasul 13, memorarea e corectă: e o cifră **la un moment dat**, nu un total viu. Recalculată peste doi ani ar da altceva, fiindcă tarifele și regia s-au schimbat.

**Arhivarea ca sursă de copiere**: o UL închisă apare în lista de la „copiere din proiect anterior" (modul 2 de la pasul 11). Nu e tabelă nouă — e un filtru.

---

## 4. Reguli care nu se negociază

1. **Nu atinge `work_stages`.** Există din pasul 05.
2. **Nu recrea jurnalul.** Există din 10c-4, append-only.
3. **Bugetul de tapuri rămâne 3** pentru `Necesar material`, cu etapa precompletată. Dacă pică testul, se repară ecranul.
4. **Etapa e obligatorie prin trigger**, nu prin `not null`.
5. **`material.request` își schimbă executantul, nu numele.**
6. **Consumul și progresul nu se deduc unul din altul.**
7. **După închidere nu se scriu costuri noi**, cu excepția stornării.
8. **Marja finală se memorează.** Cumulatele de SL, nu.
9. **Un rând de checklist care nu poate cădea niciodată nu se pune pe ecran.**

## 5. Ce NU faci în pasul ăsta

- **Nu construi comenzile (PO), recepțiile, ofertele sau stocul complet** — faza 3. Necesarul se oprește la `ceruta`; cine îl procesează vine la faza 3.
- **Nu construi PV-ul de recepție** — faza 4.
- **Nu construi facturarea** — faza 5.
- **Nu adăuga acțiuni sub butonul ＋.** Cele patru sunt fixate din 10c-1.
- **Nu converti necesarele vechi** din `requests`.
- **Nu urca pragul de tapuri.**

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Necesar material pe o **lucrare cu etape**, de la `Azi` la trimis | **≤ 3 tapuri**, măsurat în CI |
| 2 | Deschizi ecranul pe o lucrare | etapa curentă e deja aleasă, corect |
| 3 | Schimbi etapa | un tap opțional; totalul rămâne ≤ 4 |
| 4 | Necesar pe o **intervenție** | selectorul de etapă nu apare deloc |
| 5 | Necesar pe o lucrare **fără etape** | idem |
| 6 | `insert` direct în `material_requirements`, lucrare, `stage_id` null | **triggerul refuză** |
| 7 | Linie cu produs din nomenclator | acceptată |
| 8 | Linie cu text liber | acceptată |
| 9 | Linie cu amândouă, sau cu niciunul | refuzată de `check` |
| 10 | Trimiți necesarul offline, apoi revii online | urcă; `material_requirements` are rândul cu etapa |
| 11 | Retrimiți aceeași mutație | un singur efect |
| 12 | Necesare vechi, din faza 1 | **neatinse**, tot în `requests` |
| 13 | Gantt-ul unei lucrări cu 5 etape | toate, cu perioade planificate și reale |
| 14 | Etapă cu buget material 42.000 și consum 31.800 | 76%, din registrul de cost filtrat pe `stage_id` |
| 15 | Etapă cu consum 86% și progres 38% | apare ca divergență, cu același prag ca la 10e |
| 16 | Gantt-ul, dintr-un rol fără `canSeeFinancials` | perioadele se văd, **bugetele nu** |
| 17 | Scrii o intrare `inainte` pe o lucrare | acceptată |
| 18 | Scrii a doua `inainte` pe aceeași lucrare | refuzată de indexul unic |
| 19 | Încerci să editezi o intrare de jurnal | **imposibil** — append-only, nici din birou |
| 20 | Checklist de închidere, cu o SL nedecisă | **blochează**, cu link către ea |
| 21 | Cu o suplimentare rămasă `propusa` | **blochează** |
| 22 | Fără intrare `dupa` în jurnal | **blochează** |
| 23 | Contract individual, deviz client neînghețat | **blochează** |
| 24 | Contract de mentenanță, fără deviz client | **nu blochează** |
| 25 | Cu garanții reținute nescadente | **nu blochează**; apare informativ |
| 26 | Închizi cu toate rândurile verzi | `status = 'inchisa'`, `closed_at`, marja finală memorată |
| 27 | Încerci o linie de cost nouă pe lucrarea închisă | **refuzată de trigger** |
| 28 | Storno pe aceeași lucrare închisă | **acceptat** |
| 29 | Marja finală, recitită peste o săptămână | **aceeași cifră**, deși tarifele s-au schimbat |
| 30 | Pornești deviz nou prin „copiere din proiect anterior" | lucrarea închisă apare în listă |
| 31 | `pnpm e2e` | jobul `taps` verde, cu fluxul nou inclus |

## 7. Definiția de „gata"

- Toate cele 31 de verificări trec. **1 și 3 (tapurile) și 6, 19, 27 (invariantele) sunt blocante în CI.**
- **Test E2E complet al lucrării**, oglinda celui de la faza 1: „deviz → pachet → subcontractant semnează → SL declarată → verificată pe teren, offline → aprobată → suplimentare acceptată → garanție reținută → SL client derivată → lucrarea se închide cu marja finală".
- `material.request` are test din rolul `app_field`, cu payload-ul ecranului, pe ambele ramuri (lucrare cu etape / fără).
- `docs/field-sync.md` reflectă noul executant al lui `material.request`.
- **`PROGRESS.md` capătă o predare rescrisă pentru faza 3**, ca cea de la finalul fazei 1.
- **Cu asta, faza 2 e completă.** Următoarea serie: faza 3 (achiziții și stoc) și faza 4 (resurse), care se pot executa **în paralel**.

---

## Sub-pași

| Sub-pas | Ce | Verificări |
|---|---|---|
| **15a** | Migrarea `0053`, executantul nou al lui `material.request`, ecranul de teren cu etapa precompletată, testul de tapuri lărgit | 1–12, 31 |
| **15b** | Gantt-ul cu buget vs consum, migrarea `0054` (Înainte/După) și acțiunile de jurnal | 13–19 |
| **15c** | Migrarea `0055`, checklistul de închidere real, blocarea costurilor, marja finală, arhivarea, E2E-ul complet | 20–30 |
