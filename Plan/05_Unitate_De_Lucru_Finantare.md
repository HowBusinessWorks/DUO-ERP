# Pasul 05 — Unitatea de Lucru, alocarea de finanțare, etape, mutarea finanțării

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** inima modelului. O singură entitate cu trei tipuri (Inspecție / Intervenție / Lucrare), finanțată prin alocări istoricizate, promovabilă fără să-și piardă identitatea, cu finanțarea mutabilă și cu istoric.

---

## 0. Context de business (esențial)

**Unitatea de Lucru (UL)** e entitatea care ține tot sistemul. Are **trei tipuri**, nu trei tabele:

| Tip | Cod | Ce e |
|---|---|---|
| **Inspecție** | `I-9022` | verificare pe checklist la un obiectiv |
| **Intervenție** | `#1841` | reparație punctuală, tipic sub pragul de 2.000 lei |
| **Lucrare** | `L-233` | lucrare cu deviz, etape, subcontractanți |

Motivul unei singure entități: toate trei se leagă la un obiectiv, consumă materiale și manoperă, produc costuri, au poze și documente, aparțin unui contract și unei componente. Diferă doar structura de detaliu.

**În interfață nu apare niciodată cuvântul „Unitate de Lucru"** — apare tipul concret. „UL" e limbaj intern de arhitectură.

### Trei reguli de aur

**1. Finanțarea NU e un câmp pe UL.** E o entitate separată (`funding_allocations`), pentru că:
- o lucrare poate fi finanțată din **Delta pe 3 luni consecutive** (3 alocări, nu una);
- finanțarea se poate muta, iar mutarea trebuie să lase urmă.

**2. Promovarea nu creează un obiect nou.** Când o intervenție se dovedește mai mare decât părea și devine lucrare, **ID-ul se păstrează**. Nu se copiază pozele, nu se re-introduc orele, nu se mută folderul. Se adaugă structura de lucrare (deviz, etape). Câmpul `promoted_from_id` există doar pentru cazul rar de scindare.

**3. Mutarea finanțării se comportă diferit după starea lunii:**

| Starea lunii | Ce se întâmplă |
|---|---|
| **Deschisă** | se rescrie analitica „descărcat" pe liniile de cost existente |
| **Închisă 🔒** | se emite **document de re-alocare** în luna curentă: scoate suma din componenta veche, o pune pe cea nouă; **ambele mișcări rămân vizibile** |

Ce **nu se schimbă niciodată** la mutarea finanțării: data documentului, obiectivul, analitica „folosit". Istoricul obiectivului rămâne intact — asta e proprietatea care nu are voie să se rupă.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §6 (UL, integral), §9 (execuție, lucrări, etape), §13 + §13.1 (alocarea și mutările — **citește de două ori**) |
| `Damina_Aplicatie_Structura_Functionala.md` | §11.1 (vederea unificată, promovarea), §11.4 (tab-urile lucrării), §11.5 (Gantt), §25 (fluxul de mutare a finanțării) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §4.9 (alocări și mutări), Anexa C.5 (schema), Anexa E.3 (foldere automate — doar ca referință; folderele se creează în pasul 07) |

## 2. Precondiții

Din pașii 01–04: `withActor`, RLS + grants, audit cu motiv obligatoriu, `app.periods` + trigger de blocare, `app.document_series` + alocator gapless, shell + `entityRegistry`, contracte cu componente și plafoane, obiective cu `contract_objectives`, persoane și echipe cu autorizații SSM.

---

## 3. Ce livrezi

### 3.1 Schema (migrarea `0013_work_units`)

```sql
app.work_units (
  id uuid pk,                            -- UUID v7, poate fi generat pe teren (offline)
  code text,                             -- L-233, #1841, I-9022 — din document_series
  type app.work_unit_type,               -- inspectie | interventie | lucrare
  company_id uuid, objective_id uuid, contract_objective_id uuid,
  status app.work_unit_status,           -- draft|planificata|in_executie|suspendata|
                                         -- finalizata|inchisa|anulata
  responsible_person_id uuid,            -- PM / șef de șantier
  executor_type app.executor_type,       -- echipa_proprie | subcontractant
  executor_subcontractor_id uuid,
  starts_on date, ends_on date,
  estimated_value numeric(14,2), cost_budget numeric(14,2),
  source_request_id uuid,                -- cererea din care s-a născut (pasul 08)
  promoted_from_id uuid,                 -- doar pentru scindare
  root_node_id uuid,                     -- folderul auto-generat (pasul 07)
  closed_at timestamptz, closed_by uuid,
  unique (company_id, code)
);
-- Finanțarea NU e aici.

app.work_unit_assignments (
  id uuid pk, work_unit_id uuid, person_id uuid,
  role text,                             -- sef_santier | inspector | echipa
  valid_from date, valid_to date
);

app.work_stages (                        -- etape, DOAR pe lucrări
  id uuid pk, work_unit_id uuid, position smallint, name text,
  planned_start date, planned_end date,
  material_budget numeric(14,2), labor_budget numeric(14,2),
  pct_of_work numeric(6,4),
  actual_start date, actual_end date,
  check (planned_end >= planned_start)   -- coerența temporală în model
);

app.funding_allocations (
  id uuid pk, work_unit_id uuid, contract_id uuid, component_id uuid, period_id uuid,
  allocated_amount numeric(14,2), allocated_pct numeric(6,4),
  status app.allocation_status default 'active',   -- active | superseded
  superseded_by uuid references app.funding_allocations,
  reason text not null,
  created_by uuid, created_at timestamptz default now(),
  check (allocated_amount is not null or allocated_pct is not null)
);

app.reallocation_documents (             -- luna închisă → document, nu rescriere
  id uuid pk, company_id uuid, number text,
  period_id uuid,                        -- luna CURENTĂ, unde se emite
  work_unit_id uuid,
  from_contract_id uuid, from_component_id uuid, from_period_id uuid,
  to_contract_id uuid,   to_component_id uuid,   to_period_id uuid,
  amount numeric(14,2), reason text not null, created_by uuid
);
```

**Reguli impuse în DB:**
- Alocările sunt **istoricizate prin `superseded_by`, niciodată prin `UPDATE`**.
- Trigger: suma procentelor active pe o UL × perioadă ≤ 1.
- Trigger: `work_stages` doar dacă `work_units.type = 'lucrare'`.
- Trigger (din pasul 02): asignarea unei persoane cu **autorizație SSM expirată** la `starts_on` e **blocată**, nu avertizată.
- `guard_closed_period` atașat pe `funding_allocations` și pe `reallocation_documents`.
- Codul UL se alocă prin `allocate_document_number` (serie per firmă × tip).

### 3.2 Domain pur — `packages/domain/funding`

Ăsta e locul unde se vede de ce `domain` nu importă `db`:

```ts
export function planFundingMove(input: MoveFundingInput): FundingMovePlan {
  return input.period.status === 'closed'
    ? { kind: 'reallocation-document', entries: buildReversalAndReapply(input) }
    : { kind: 'rewrite-charged-analytics', costLineIds: input.costLineIds, target: input.target };
}
```

Alte funcții pure: `splitAcrossPeriods(amount, periods[])` (Delta pe 2–3 luni), `validateAllocationSum(allocations)`, `canPromote(workUnit)` (ce condiții trebuie îndeplinite ca o intervenție să devină lucrare), `stageScheduleIsCoherent(stages)`.

Toate cazurile din tabelul §13 al documentului de business se acoperă cu teste de domain, **fără să atingă Postgres**.

### 3.3 Use-case-uri (`packages/services/work-units`)

Fiecare use-case = **o tranzacție = o unitate atomică**:

| Use-case | Ce face atomic |
|---|---|
| `createWorkUnit` | UL + cod din serie + alocare(i) de finanțare + asignări + (pasul 07: folder) |
| `promoteToLucrare` | păstrează ID-ul, schimbă tipul, adaugă structura de lucrare, scrie în audit cu motiv |
| `moveFunding` | rulează `planFundingMove`, execută ramura corespunzătoare, motiv **obligatoriu** |
| `allocateFunding` / `reallocate` | alocare nouă + `superseded_by` pe cea veche |
| `createStage` / `reorderStages` | etape cu poziții consistente |
| `closeWorkUnit` | checklist de închidere (blocant) → blochează costuri noi |

### 3.4 Ecrane

**Activitate › Vederea unificată** — o singură listă peste toate cele trei tipuri. Filtre: tip, status, contract, componentă, obiectiv, responsabil, perioadă, executant (echipă proprie / subcontractant). Coloane comune: cod, tip, denumire, obiectiv, contract+componentă, status, valoare, consumat, responsabil.

De aici pornește **promovarea**: buton „Promovează în lucrare" pe o intervenție, cu ecran de confirmare care arată explicit **ce se păstrează** (id, poze, ore, consumuri) și **ce se adaugă** (deviz, etape). Nimic nu se rescrie.

**Pagina de UL** — prin `entityRegistry`, cu tab-uri diferite pe tip:

- Inspecție: `Fișă · Constatări · Costuri · Poze · Documente`
- Intervenție: `Fișă · Materiale · Ore · Costuri · Poze · Documente`
- Lucrare: `Prezentare · Deviz · Etape · Jurnal · Materiale · Manoperă · Subcontractanți · Situații · Costuri · PV-uri · Documente · Închidere`

În pasul ăsta implementezi complet: **Prezentare, Etape, Închidere** și scheletul cu `EmptyState` pentru restul (se umplu în pașii 06–10 și în faza 2).

**Prezentare (lucrare)** — cele două bare de progres, una lângă alta: **progres fizic (din etape) vs consum financiar**. Divergența dintre ele e semnalul de risc și se marchează vizual. Plus: alocările de finanțare active (poate fi „Delta ×3 luni"), responsabili, perioadă, obiectiv.

**Etape** — listă + Gantt. Fiecare etapă: denumire, ordine, perioadă planificată, buget de material, buget de manoperă, procent din lucrare. **Etapa e clickabilă și are propria pagină cu propriile tab-uri** (recursivitate — se face prin același registry, e testul real al pasului 03).

**Închidere** — checklist **blocant**, nu informativ, cu link direct la ce trebuie rezolvat. Rândurile care depind de module viitoare (retur la magazie, PV, SL) apar dezactivate cu explicație, nu lipsesc.

**Mutarea finanțării** — buton pe orice UL, ecran care se comportă diferit după starea lunii:

```
MUTĂ FINANȚAREA · Intervenția #1841
De la:  Contract 4700 · Mentenanță · august 2026
La:     Contract 4700 · Delta ▾    · august 2026 ▾
Costuri deja înregistrate: 800 lei — se mută cu unitatea de lucru
Motiv (obligatoriu): ______________________________
 LUNA E DESCHISĂ  → se rescrie „descărcat" pe liniile existente
 LUNA E ÎNCHISĂ 🔒 → document de re-alocare în luna curentă, ambele mișcări vizibile
Nu se schimbă niciodată: data documentului, obiectivul, analitica „folosit"
```

Ecranul afișează **explicit care dintre cele două mecanici se va aplica**, înainte de confirmare.

**Bani › Re-alocările lunii** — listă obligatorie: valoare, de la ce componentă, la ce componentă, cine a decis, de ce. Dacă lista e lungă în fiecare lună, decizia inițială de rutare se ia prost — și asta e o problemă de proces, pe care ecranul trebuie s-o facă vizibilă.

**Calendar / Gantt general** — toate lucrările active pe o axă de timp, cu etapele lor, filtrabile pe contract, PM, șef de șantier.

### 3.5 Legături (reciproce, obligatoriu)

UL → contract, componentă, obiectiv, cererea de origine, etape, alocări, documente, costuri.
Contract → UL-urile finanțate din fiecare componentă (**activează acum linkul din pasul 04**).
Obiectiv → toate UL-urile, în tab-ul Istoric (**se populează acum**, pe analitica „folosit").

---

## 4. Reguli care nu se negociază

1. **Finanțarea nu e câmp pe UL.** Dacă apare `contract_id` pe `work_units` ca sursă de finanțare, e greșit.
2. **Promovarea păstrează ID-ul.** Nimic nu se copiază, nimic nu se mută.
3. **Alocările nu se fac `UPDATE`** — se supersedează.
4. **Mutarea finanțării cere motiv scris** și e auditată. Fără motiv, nu se salvează.
5. **Analitica „folosit" nu se schimbă niciodată la mutare.** Istoricul obiectivului e sacru.
6. **Etapele există doar pe lucrări.**
7. **Coerența temporală se impune în model**, nu prin instruire: fără finalizare înaintea începutului, fără două documente deschise pe același obiect.

## 5. Ce NU faci în pasul ăsta

- Nu creezi registrul de cost — pasul 06. „Consumat" e 0 peste tot, dar structura și etichetele sunt corecte.
- Nu creezi folderele automate de documente — pasul 07 (lasă `root_node_id` null și un TODO marcat).
- Nu implementezi cererile și decizia de rutare — pasul 08. UL-urile se creează manual, din ecran.
- Nu implementezi fișele de inspecție/intervenție — pasul 09.
- Nu construiești devize, pachete, situații de lucrări (faza 2).

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Creezi o lucrare finanțată din Delta pe 3 luni | **3 rânduri** în `funding_allocations`, suma = valoarea, UL-ul afișează „Delta ×3 luni" |
| 2 | Aloci 60% + 50% pe aceeași UL și perioadă | respins de trigger (suma > 1) |
| 3 | Modifici o alocare | vechea devine `superseded`, apare una nouă `active`; **niciun `UPDATE` pe rândul vechi** |
| 4 | Promovezi o intervenție cu 5 poze și 12 ore în lucrare | **același `id` și același `code` context**; pozele și orele sunt intacte; tipul e `lucrare`; audit are rândul cu motiv |
| 5 | Muți finanțarea pe **lună deschisă** | ecranul anunță „se rescrie descărcat"; după confirmare, alocarea nouă e activă, cea veche supersedată |
| 6 | Muți finanțarea pe **lună închisă** | ecranul anunță „document de re-alocare"; se creează rând în `reallocation_documents` **în luna curentă**, cu ambele mișcări vizibile |
| 7 | Muți finanțarea fără motiv | blocat, mesaj clar în română |
| 8 | După mutare, deschizi tab-ul Istoric al obiectivului | **absolut nimic nu s-a schimbat** acolo |
| 9 | Adaugi etapă pe o inspecție | respins de DB |
| 10 | Creezi etapă cu `planned_end < planned_start` | respins de `check` |
| 11 | Deschizi pagina unei etape | pagina are propriile tab-uri, prin același template (recursivitate confirmată) |
| 12 | Asignezi pe UL o persoană cu autorizație SSM expirată la `starts_on` | **blocat**, cu mesaj care spune ce autorizație și când a expirat |
| 13 | Creezi 3 UL-uri în paralel pe aceeași firmă și tip | coduri consecutive, **zero goluri, zero duplicate** |
| 14 | Contract › Componente → click pe Delta august | lista de UL finanțate din ea; suma valorilor **dă exact** cifra de pe bandă |
| 15 | Deschizi Bani › Re-alocările lunii | apare re-alocarea de la punctul 6, cu de la / la / cine / de ce |
| 16 | Creezi UL într-o lună închisă | eroare `PERIOD_CLOSED` |
| 17 | Login ca `field` pe o UL neasignată ție | nu o vezi (RLS pe asignare); pe una asignată, o vezi **fără nicio cifră în lei** |
| 18 | Teste de domain: toate cazurile din §13 (lună deschisă/închisă, split pe perioade, sumă de procente) | trec fără DB |
| 19 | Închizi o lucrare cu rânduri de checklist nerezolvate | butonul e blocat, fiecare rând are link la ce trebuie rezolvat |

## 7. Definiția de „gata"

- Cele 19 verificări trec.
- Seed-ul include acum: **1 lucrare pe 3 luni de Delta**, 1 intervenție, 1 inspecție, cu asignări și etape.
- `packages/domain/funding` are acoperire ~95% pe toate ramurile din §13.
- UL-ul, etapa și lista unificată sunt înregistrate în `entityRegistry` — shell-ul nu s-a modificat.
