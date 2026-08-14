# Pasul 04 — Contracte, componente, plafoane · Obiective și profile de inspecție

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** motorul de bani al firmei există ca date și ca ecran. Poți deschide un contract de mentenanță pe 4 ani, cu cele trei componente, cu plafoanele lunii, și poți lega obiective de el cu profil de inspecție.

---

## 0. Context de business (esențial pentru pasul ăsta)

Damina lucrează pe **contracte de mentenanță multianuale** (tipic 4 ani, ex. „4700 · Apa Nova") și pe **contracte individuale** (lucrare punctuală, cu deviz sau cu taxare inversă).

Un contract de mentenanță are un **abonament lunar fix** și se desface în **componente**, fiecare cu regula ei:

| Componentă | Ce e | Cadență buget | Sens |
|---|---|---|---|
| **Mentenanță** | activitatea curentă: inspecții, intervenții mici | plafon **lunar de cost** | consumi cât mai puțin |
| **Lucrări** | lucrări mai mari incluse în contract | plafon **anual de cost**, defalcat lunar | consumi cât mai puțin |
| **Delta** | buget de lucrări suplimentare pe care clientul îl plătește oricum | plafon **de VENIT**, lunar, setat manual | **îl umpli** — ce nu umpli, se pierde |

**Delta e inversul intuiției.** Nu e o limită de cheltuială, e un venit disponibil. Dacă la sfârșitul lunii Delta e umplută la 38%, restul e **venit pierdut definitiv** (nu se reportează). De aceea gauge-ul de Delta se umple, nu se golește, și de aceea alerta trebuie să vină **pe 10 și pe 20 ale lunii**, nu la închidere — la închidere e prea târziu.

Cele **trei numere sunt separate** și nu se confundă niciodată:
1. **venit alocat** — cât încasăm pe componenta asta;
2. **plafon de cost** — cât avem voie să cheltuim;
3. **consum real** — cât am cheltuit efectiv.

**Indexarea** e istoricizată pe ani contractuali (tipic 5%, dar poate fi 0). Contractele cu **indexare 0** se degradează cel mai repede — se marchează vizual distinct în listă.

**Obiectivul** (stație de pompare, bazin, clădire, gură de canal — sunt ~700) e **nomenclator comun între cele 5 firme**, nu aparține unui contract. Legătura contract↔obiectiv **e o entitate proprie** (`contract_objectives`), cu valabilitate în timp, pentru că obiectivele intră și ies din contract în cei 4 ani. **Profilul de inspecție stă pe legătură, nu pe obiectiv** — același obiectiv poate avea frecvențe diferite pe contracte diferite.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §4 (contract și plafoane, integral: 4.1, 4.2, 4.3), §5 (obiectiv), §22.6 (marja pe an contractual, indexarea) |
| `Damina_Aplicatie_Structura_Functionala.md` | §8 (contracte, toate tab-urile), §9 (obiective, istoric, acoperire inspecții) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | Anexa C.3 (contracte), C.4 (obiective), §4.7 (rollup-uri — doar ca să înțelegi ce vine în pasul 06) |

## 2. Precondiții

Din pașii 01–03: monorepo, `withActor`, RLS + column grants + testele de izolare a prețului, audit trail, `app.periods` cu trigger de blocare, `app.document_series`, shell de navigare cu `entityRegistry`, selectoare de firmă și perioadă, nomenclatoare (clienți, subcontractanți, calificări, rate cards).

---

## 3. Ce livrezi

### 3.1 Schema — contracte (migrarea `0011_contracts`)

```sql
app.contracts (
  id uuid pk, company_id uuid, client_id uuid,
  code text, reference text,
  type app.contract_type,               -- mentenanta_multianual | individual_deviz | individual_taxare_inversa
  starts_on date, ends_on date,
  total_value numeric(14,2), monthly_value numeric(14,2),   -- abonament an 1
  payment_term_days smallint default 70,
  indexation_pct numeric(6,4) default 0.0500,      -- poate fi 0
  delta_threshold numeric(14,2) default 2000.00,   -- prag mentenanță→Delta
  expiry_alert_months smallint default 6,
  owner_person_id uuid,                 -- PM, proprietar de P&L
  overhead_pct numeric(6,4),            -- regie, pentru marja netă
  status text,
  unique (company_id, code)
);

app.contract_years (                    -- indexare ISTORICIZATĂ
  id uuid pk, contract_id uuid, year_index smallint,   -- 1..4
  starts_on date, ends_on date,
  monthly_value numeric(14,2),          -- valoarea indexată a anului
  indexation_applied_pct numeric(6,4),
  unique (contract_id, year_index)
);

app.contract_components (
  id uuid pk, contract_id uuid,
  type app.component_type,              -- mentenanta | lucrari | delta | individual
  name text,
  budget_cadence app.budget_cadence,    -- lunar | anual
  is_fill_target boolean default false, -- true DOAR pe Delta — inversează sensul gauge-ului
  unique (contract_id, type)
);

app.component_ceilings (                -- cele TREI numere, separate
  id uuid pk, component_id uuid,
  period_id uuid,                       -- null pentru rândul anual (componenta Lucrări)
  contract_year_id uuid,                -- setat când cadence='anual'
  allocated_revenue numeric(14,2),      -- venit alocat
  cost_ceiling numeric(14,2),           -- plafon de COST (mentenanță, lucrări)
  revenue_ceiling numeric(14,2),        -- plafon de VENIT (doar Delta, manual)
  set_by uuid, set_at timestamptz,
  unique (component_id, period_id, contract_year_id)
);
```

**Reguli impuse în DB:**
- `is_fill_target = true` doar pe componenta de tip `delta` (check/trigger).
- `revenue_ceiling` se completează doar pe Delta; `cost_ceiling` doar pe mentenanță/lucrări (check).
- Modificarea unui plafon e **acțiune auditată cu motiv obligatoriu**.
- Plafoanele pe o perioadă închisă nu se pot modifica (trigger-ul de perioadă atașat pe `component_ceilings`).

**Domain pur** (`packages/domain/contracts`, testabil fără DB):
- `applyIndexation(baseValue, pct, yearIndex)` → valoarea anului contractual;
- `buildContractYears(contract)` → cei 4 ani cu aniversare corectă;
- `ceilingUsage({ ceiling, committed, consumed })` → procent + stare (`ok` | `warning` la 80% | `exceeded`);
- `deltaFill({ revenueCeiling, allocatedRevenue })` → grad de umplere + lei rămași + zile rămase din lună.

### 3.2 Schema — obiective (migrarea `0012_objectives`)

```sql
app.objectives (          -- NOMENCLATOR COMUN între firme — fără company_id
  id uuid pk, code text, name text, kind text,     -- clădire / stație / rezervor / gură de canal
  address jsonb, geo_lat numeric(10,7), geo_lng numeric(10,7),
  area_sqm numeric(14,2), root_node_id uuid, is_active boolean default true
);

app.checklists (id uuid pk, code, name, objective_kind, version smallint, is_active);
app.checklist_items (id uuid pk, checklist_id, position, text,
                     requires_photo boolean default false, is_critical boolean default false);

app.inspection_profiles (id uuid pk, name, description);
app.inspection_profile_items (profile_id, checklist_id, frequency_months smallint);

app.contract_objectives (          -- legătura E o entitate
  id uuid pk, contract_id uuid, objective_id uuid,
  valid_from date, valid_to date,
  inspection_profile_id uuid,      -- profilul stă AICI, nu pe obiectiv
  exclude using gist (contract_id with =, objective_id with =,
                      daterange(valid_from, valid_to) with &&)
);
```

Checklist-urile sunt **versionate**: o fișă completată păstrează versiunea cu care a fost completată, ca să rămână interpretabilă peste 2 ani.

### 3.3 Ecranul de contract (tab-uri)

`Prezentare · Componente · Obiective · Activitate · Financiar · Facturare · Subcontractanți · Documente · Setări`

**Prezentare** — ecranul central al firmei. Pentru luna selectată: abonamentul lunar, apoi **o bandă per componentă** cu venit / plafon / angajat / consumat / rest + bara de progres, apoi marja lunii și marja cumulată pe an contractual. Navigare pe luni cu ◀ ▶.

Banda Delta e diferită: arată explicit **lei neumpluți** și link către propunerile din backlog care i-ar putea umple (backlogul vine în pasul 08 — până atunci, link inactiv cu explicație).

**Fiecare componentă e clickabilă** și duce la lista de UL finanțate din ea în luna selectată, **cu totalul care trebuie să dea exact cifra de pe bandă. Dacă nu dă, e bug, și trebuie să se vadă.** (În pasul ăsta nu există UL — lista e goală cu `EmptyState`; legătura se activează în pasul 05.)

**Componente** — cele trei numere separate, editabile după regula temporală proprie:

| Componentă | Unde se setează | Ecran secundar |
|---|---|---|
| Mentenanță | plafon lunar | cumulat pe an |
| Lucrări | plafon anual, defalcat lunar | plan anual vs angajat vs consumat vs rest |
| Delta | plafon de venit lunar, manual | grad de umplere pe an |

**Obiective** — lista `contract_objectives` cu perioada de valabilitate, profilul de inspecție și frecvența. Aici se adaugă și se scot obiective din contract, cu istoric. **Profilul se editează aici, nu pe obiectiv.**

**Financiar** — indexarea pe ani (istoric), comutator marjă brută / netă. Marja reală se calculează în pasul 06 (registrul de cost); aici randezi structura cu zerouri și eticheta corectă.

**Setări** — indexare (%, aniversare, istoric), prag mentenanță→Delta (implicit 2.000 lei), prag de alertă expirare (6 luni), PM proprietar, termen de plată (implicit 70 zile), șablon de raport lunar per client.

Tab-urile `Activitate`, `Facturare`, `Subcontractanți`, `Documente` există în registry cu `EmptyState` explicativ — se populează în pașii lor.

### 3.4 Lista de contracte

Coloane: cod, client, firmă, tip, perioadă, valoare, **an contractual curent (2/4)**, PM, grad de consum, marjă, alertă de expirare. Filtre salvabile. **Semn vizual distinct pentru contractele cu indexare 0.**

### 3.5 Ecranul de obiectiv (tab-uri)

`Prezentare · Istoric · Contracte · Inspecții · Documente · Poze`

**Istoric** — ecranul cerut explicit: transversal peste contracte și peste ani, tot ce s-a întâmplat la obiectivul ăsta, cu costuri, cu total anual și medie lunară. E construit pe analitica **„folosit"** și e **etichetat ca atare pe ecran**. Rămâne intact indiferent de câte ori se mută finanțarea — asta e diferența pe care utilizatorul trebuie s-o vadă. (Se populează din pasul 05/06; acum e schelet cu etichetă corectă.)

**Contracte** — pe ce contracte a fost sau este obiectivul, în timp și simultan, la firme diferite.

**Lista de obiective** are **două vederi comutabile: tabel și hartă**. Pin-ul pe hartă se folosește și la **selecția coordonatelor**, nu doar la afișare.

### 3.6 Acoperire inspecții

Vedere de birou: din N obiective ale contractului, câte au fost inspectate luna asta, per tip de inspecție, cu restanțele listate. **Fără notificări către teren** — măsori fără să hărțuiești. Din listă poți asigna o restanță unei persoane, dacă cineva decide asta. (Datele reale vin în pasul 09; acum randează structura pe baza profilelor și frecvențelor, cu 0 inspecții.)

### 3.7 Alerte și cozi

Se înregistrează în mecanismul din pasul 03:
- `alerts`: contract care expiră în < `expiry_alert_months` (cron zilnic 06:00);
- `alerts`: **grad de umplere Delta sub prag, pe 10 și pe 20 ale lunii, 09:00** — nu la închidere.

---

## 4. Reguli care nu se negociază

1. **Cele trei numere (venit alocat / plafon de cost / consum) nu se amestecă niciodată** — nici în DB, nici pe ecran, nici în numele variabilelor.
2. **Delta e țintă de umplere, nu limită de consum.** Gauge-ul se umple.
3. **Profilul de inspecție stă pe `contract_objectives`**, nu pe obiectiv.
4. **Obiectivele nu au `company_id`** — sunt nomenclator comun.
5. **Indexarea e istoricizată**, nu recalculată din valoarea curentă.
6. **Orice ecran cu cifre declară analitica pe care e construit** („folosit" / „descărcat") și dacă marja e brută sau netă.
7. **Modificarea de plafon cere motiv scris** și e auditată.

## 5. Ce NU faci în pasul ăsta

- Nu creezi unități de lucru, alocări de finanțare, costuri — pașii 05–06.
- Nu implementezi rollup-urile de plafon (`component_period_rollup`) — pasul 06. Aici cifrele de „angajat/consumat" sunt 0.
- Nu construiești facturare, raport lunar, cash-flow.
- Nu construiești devize (faza 2).
- Nu implementezi inspecțiile efective — pasul 09.

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Creezi contract de mentenanță 4 ani, valoare lunară 50.000, indexare 5% | se generează automat 4 `contract_years` cu aniversare corectă și valori indexate (50.000 → 52.500 → 55.125 → 57.881,25) |
| 2 | Creezi contract cu indexare 0 | cei 4 ani au aceeași valoare; în listă apare **marcajul vizual distinct** |
| 3 | Creezi cele 3 componente | Mentenanță și Lucrări cer `cost_ceiling`; Delta cere `revenue_ceiling` și are `is_fill_target = true` |
| 4 | Încerci `is_fill_target = true` pe componenta Mentenanță | respins de DB |
| 5 | Setezi plafon lunar pe Mentenanță fără motiv | respins; cu motiv → rând în `audit.entries` |
| 6 | Setezi plafon pe o lună închisă | eroare `PERIOD_CLOSED`, mesaj în română |
| 7 | Deschizi Prezentare pe august | trei benzi, fiecare cu venit / plafon / angajat(0) / consumat(0) / rest; banda Delta afișează **lei neumpluți** și procent de umplere |
| 8 | Navighezi ◀ ▶ pe luni | cifrele se schimbă cu perioada; luna închisă apare cu 🔒 |
| 9 | Click pe o componentă | ajungi în lista de UL finanțate din ea (goală, cu `EmptyState` corect) |
| 10 | Legi un obiectiv de contract cu valabilitate suprapusă pe același contract | respins de constrângerea `exclude` |
| 11 | Legi același obiectiv la două contracte diferite, simultan | permis (e cazul real), cu profile de inspecție diferite |
| 12 | Deschizi obiectivul → tab Contracte | vezi ambele contracte, cu perioade |
| 13 | Deschizi obiectivul → tab Istoric | ecran gol cu explicație, **etichetat „analitica: folosit"** |
| 14 | Lista de obiective → comuți pe hartă | pin-uri corecte; click pe hartă la creare setează coordonatele |
| 15 | Login ca `field` și ceri `app.contracts` prin API | zero acces la coloanele de valoare (testul generic de izolare a prețului trece) |
| 16 | Acoperire inspecții pe un contract cu 20 obiective și profil trimestrial | tabel cu 20 rânduri, 0 inspecții, restanțe calculate din frecvență |
| 17 | Contract care expiră în 5 luni + cron rulat | apare o alertă, o singură dată (nu 40) |
| 18 | Teste de domain (`applyIndexation`, `ceilingUsage`, `deltaFill`) | rulează fără DB, în milisecunde, acoperire ~95% |

## 7. Definiția de „gata"

- Cele 18 verificări trec.
- Seed-ul determinist include acum: 2 firme, **1 contract de mentenanță pe 4 ani cu cele 3 componente**, 1 contract individual, **20 de obiective**, profile de inspecție cu frecvențe, plafoane setate pe 3 luni. Acest seed alimentează toate testele E2E de acum înainte.
- Contractul și obiectivul sunt înregistrate în `entityRegistry` — **nu s-a modificat shell-ul** ca să existe.
