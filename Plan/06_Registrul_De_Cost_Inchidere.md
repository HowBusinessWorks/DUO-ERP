# Pasul 06 — Registrul de cost, dubla analitică, rollup-uri, marjă, închiderea de lună

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** tabela care răspunde la toate întrebările de bani și mecanismul care face ca cifrele lunilor trecute să rămână reproductibile. După pasul ăsta, orice cifră de pe ecran se desface până la documentul sursă.

---

## 0. Context de business (esențial)

### Registrul de cost

**Un singur registru**, nu câte o tabelă per tip de cheltuială. Fiecare linie de cost răspunde la șase întrebări: **când · unde · cine plătește · ce · cât · de unde**.

Din el ies toate rapoartele: consumul unei componente, costul unei lucrări, istoricul unui obiectiv, marja unui contract, comparația estimat vs realizat.

### Dubla analitică — regula care se ratează cel mai des

Fiecare linie de cost poartă **două analitici**, nu una:

| Analitică | Întrebarea | Se schimbă la mutarea finanțării? |
|---|---|---|
| **„folosit"** | unde s-a consumat fizic (obiectiv, UL, etapă) | **niciodată** |
| **„descărcat"** | cine plătește (contract, componentă) | da |

Exemplu real: material luat de pe lucrarea A și pus pe lucrarea B. „Folosit" = A. „Descărcat" = B. Dacă ai o singură analitică, ori istoricul obiectivului e fals, ori raportul de plafon e fals.

**Raportul de reconciliere „folosit ≠ descărcat"** e ecran obligatoriu. Dacă lista crește necontrolat, problema e în firmă, nu în software.

### Stadiile costului

`angajat` → `receptionat` → `consumat` → `facturat`.

**Stadiul `angajat` e cel care face plafonul să se coloreze la lansarea comenzii, nu peste 3 săptămâni când vine factura.** Fără el, PM-ul află că a depășit bugetul după ce e prea târziu.

### `data_efect` ≠ `data_document`

O fișă completată pe 28 iulie dar validată pe 3 august se raportează în **luna clientului**, care poate fi august. Toate agregările lunare merg pe `effect_date`, nu pe `document_date`. Indexarea se face pe `effect_date`.

### Închiderea de lună

Fără închidere, cifrele lunilor trecute nu sunt reproductibile — cineva modifică ceva în urmă și raportul trimis clientului nu se mai potrivește. Checklist-ul de închidere **nu e informativ, e blocant**. Dacă închiderea e opțională, nu se face niciodată.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §11 (registrul de cost — **integral, e cea mai importantă secțiune**), §12 (dubla analitică), §22.5 (regie și marjă netă) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §4.6 (schema + indecși), §4.7 (rollup-uri), §4.8 (închiderea de perioadă), §5.3 (interogări de raportare), Anexa C.6 |
| `Damina_Aplicatie_Structura_Functionala.md` | §15.4 (marjă și plafoane), §15.5 (închidere de perioadă), §7.3 (rapoarte), §11.4 tab-ul Costuri, §24 (fluxul de închidere) |

## 2. Precondiții

Din pașii 01–05: `withActor`, RLS + column grants, audit cu motiv, `app.periods` + `guard_closed_period`, contracte cu componente și plafoane, UL cu alocări de finanțare, etape.

---

## 3. Ce livrezi

### 3.1 Registrul de cost (migrarea `0014_cost_ledger`)

Schema completă e la `PLAN_TEHNIC` §4.6 — o transcrii **integral**, fără să omiți coloane. Structura pe blocuri:

```sql
app.cost_lines (
  id uuid pk, company_id uuid,
  -- CÂND
  document_date date, effect_date date, period_id uuid,     -- period_id derivat prin trigger
  -- UNDE (analitica "folosit")
  used_contract_id, used_component_id, objective_id, work_unit_id, stage_id,
  -- CINE PLĂTEȘTE (analitica "descărcat")
  charged_contract_id, charged_component_id,
  -- CE
  expense_type app.expense_type,        -- material|manopera_proprie|servicii_subc|utilaj|
                                        -- motorina|transport|reparatii|alte
  product_id, qualification_id,
  -- CÂT
  quantity numeric(14,4), uom text, amount numeric(14,2),
  stage app.cost_stage,                 -- angajat|receptionat|consumat|facturat
  -- DE UNDE
  document_type app.cost_document_type, document_id uuid, document_line_id uuid,
  supplier_id, subcontractor_id,
  -- REALOCARE
  reallocation_of_id uuid, is_reallocation boolean default false,
  created_by uuid, created_at timestamptz default now()
);
```

**Reguli impuse în DB, nu în cod:**

1. **Append-only.** `revoke update, delete on app.cost_lines from app_office, app_field, …`. Singurele `UPDATE`-uri permise sunt cele de re-alocare pe lună deschisă, printr-o funcție `security definer` care scrie **obligatoriu** în audit. Corecțiile se fac prin **linii de storno**, ca în contabilitate.
2. **Analitica „descărcat" e obligatorie** pentru orice linie cu `stage <> 'angajat'`: `check (charged_contract_id is not null)`.
3. **`stage_id` obligatoriu dacă UL-ul e lucrare** — trigger, pentru că depinde de tipul UL-ului.
4. **`period_id` derivat automat** din `effect_date` + `company_id`, prin trigger. Nu se completează din aplicație.
5. **`document_type` + `document_id` obligatorii** pe fiecare linie, cu integritate verificată — fără ele, cifra nu se poate desface (principiul I3).

**Indecșii** (proiectați din întrebările reale, nu inventați) — transcrie-i pe toți din §4.6. Ultimul e cel elegant:

```sql
create index on app.cost_lines (used_contract_id)
  where used_contract_id is distinct from charged_contract_id;
```

Raportul „folosit ≠ descărcat" devine un scan pe un index care conține **exact anomaliile**, nimic altceva.

### 3.2 Rollup-uri de plafon (migrarea `0015_rollups`)

§8.2 din documentul funcțional: *„fiecare componentă e clickabilă și duce la lista de UL finanțate din ea, cu totalul care trebuie să dea exact cifra de pe bandă. Dacă nu dă, e bug, și trebuie să se vadă."*

Asta **exclude cache-ul eventual-consistent**. Soluția: tabelă de rollup întreținută prin **trigger, în aceeași tranzacție cu linia de cost**.

```sql
app.component_period_rollup (
  component_id uuid, period_id uuid,
  committed numeric(14,2) default 0,   -- angajat
  received  numeric(14,2) default 0,
  consumed  numeric(14,2) default 0,
  invoiced  numeric(14,2) default 0,
  allocated_revenue numeric(14,2) default 0,   -- cât s-a „umplut" din Delta
  primary key (component_id, period_id)
);

app.overhead_snapshots (               -- regie recalculată lunar
  contract_id uuid, period_id uuid,
  overhead_pct numeric(6,4), direct_cost numeric(14,2), overhead_amount numeric(14,2),
  primary key (contract_id, period_id)
);
```

Trigger `after insert or update of stage, amount on cost_lines` → `insert … on conflict … do update` cu delta. La câteva sute de linii pe zi, invizibil.

Aceeași mecanică pentru: gradul de umplere Delta (venit alocat per lună, din `funding_allocations`).

**Job de control obligatoriu — `rollup.verify`, nocturn 02:00:** recalculează rollup-urile din registru și compară. Diferență ≠ 0 → **alertă**. Așa afli de bug-uri de trigger în ziua în care apar, nu în luna în care le vezi în factură.

### 3.3 Închiderea de perioadă — ecranul și mașina de stări

Mecanica DB există din pasul 02. Acum construiești **fluxul**: `open → closing → closed`.

```
ÎNCHIDEREA LUNII · August 2026 · Damina SRL
☐ Pontaje validate                    ⚠ 4 zile nevalidate  [Vezi]
☐ Bonuri de consum emise              ⚠ 2 lucrări fără bon  [Vezi]
☐ Recepții înregistrate               ✓
☐ SL-uri aprobate                     ⚠ 1 în așteptare      [Vezi]
☐ Facturi SPV alocate                 ⚠ 3 nerecunoscute     [Vezi]
☐ Rapoarte lunare trimise             ✓
☐ Export Saga confirmat               ✓
[Închide luna]  → blochează data_efect în luna asta
                → costurile mutate ulterior cer document de re-alocare
```

- Checklist-ul e **date, nu cod**: fiecare rând e un `check_key` în `app.period_close_checks`, cu un **query de validare înregistrat în cod**. În `closing`, query-urile rulează și fiecare rând nebifat întoarce **lista de obiecte de rezolvat, cu link**.
- Butonul „Închide luna" e activ **doar dacă niciun rând nu e `blocked`**.
- Verificările pentru module care nu există încă (SL, SPV, Saga) se înregistrează ca `not_applicable` cu explicație — se activează automat când modulul lor apare. **Registrul de check-uri e extensibil**, asta e cerința de design.
- Trecerea la `closed` e o tranzacție care: setează statusul, îngheață rapoartele lunii, marchează exporturile confirmate, scrie în audit **cu motiv obligatoriu**.
- După închidere: lacăt 🔒 în selectorul de perioadă (există din pasul 03), tot ce e în luna aia e read-only, mutările de finanțare comută automat pe mecanica de re-alocare (există din pasul 05).
- **Redeschiderea lunii** e o acțiune de administrator, cu motiv obligatoriu, auditată, cu avertisment explicit despre consecințe.

### 3.4 Ecrane de cifre

**Tab-ul Costuri pe orice UL** — toate liniile cu `work_unit_id` = UL-ul, grupabile pe tip de cheltuială, etapă, lună, stadiu. **Fiecare linie duce la documentul sursă** (I3): „Consumat 18.100 lei" → listă de linii → linia „bon de consum #4412" → bonul → produsul → NIR-ul → factura. **Fără fundătură.**

**Bani › Marjă și plafoane** — vedere transversală peste contracte, pe analitica **„descărcat"**, etichetată ca atare pe ecran. Comutator **marjă brută (doar directe) / marjă netă (cu regie)**, vizibil permanent — altfel două ecrane dau două cifre. Regia: un coeficient % pe costul direct al fiecărei UL, configurabil per contract, recalculat lunar. Fără chei complicate.

**Bani › Reconciliere „folosit vs descărcat"** — toate liniile unde cele două analitici diferă, cu totaluri pe contract.

**Contract › Prezentare** — se **activează cifrele reale** din rollup-uri (în pasul 04 erau 0). Ecranul se randează dintr-o **singură interogare pe `component_period_rollup`** + una pe alocări. Nu agregă registrul la fiecare afișare. Ținta: **< 200 ms**.

**Obiectiv › Istoric** — se populează pe analitica **„folosit"**, cu total anual și medie lunară.

**Panou › Rapoarte** — listă de rapoarte salvate + constructor simplu peste registru. **Fiecare raport declară în antet pe care analitică e construit.** Rapoarte standard livrate acum: consum pe componentă · istoric obiectiv · re-alocările lunii · marjă pe an contractual · reconciliere folosit/descărcat.

### 3.5 Interogări de raportare

Pentru drill-down-uri și agregări pe 6 dimensiuni, Drizzle devine incomod. Regula: **SQL brut, parametrizat, în fișiere `.sql` versionate**, tipat manual cu Zod la ieșire. Sunt ~20 în tot sistemul; merită scrise de mână și citite ca SQL.

Paginare **cursor pe `(effect_date, id)`**, niciodată `OFFSET`.

### 3.6 Metrici de integritate (monitorizare de producție, nu rapoarte)

Un ERP nu cade cu 500 — cade tăcut, cu cifre care nu se mai potrivesc. Deci se monitorizează permanent:

- linii de cost fără analitică completă → **trebuie să fie 0**;
- rollup-uri divergente față de registru → **0**;
- linii cu `used ≠ charged` fără document de re-alocare → 0;
- perioade rămase în `closing` peste 48h.

Dashboard intern + alertă în Sentry.

---

## 4. Reguli care nu se negociază

1. **Registrul e append-only.** Corecția = storno, nu `UPDATE`.
2. **Ambele analitici, pe fiecare linie.** Fără excepții.
3. **`period_id` se derivă din `effect_date`**, prin trigger. Aplicația nu îl scrie.
4. **Rollup-urile se întrețin în aceeași tranzacție** cu linia de cost. Fără cozi, fără eventual consistency.
5. **Fiecare linie are `document_type` + `document_id`.** Dacă o cifră nu se poate desface, e bug.
6. **Fiecare ecran cu cifre declară analitica și baza marjei.**
7. **`app_field` nu are nicio politică RLS pe `cost_lines`** — deci nu vede nimic. Nici măcar filtrat.
8. **Checklist-ul de închidere e blocant**, cu link pe fiecare rând.

## 5. Ce NU faci în pasul ăsta

- Nu creezi documentele care generează costuri (bon de consum, NIR, factură, pontaj) — pașii 09–10 și fazele 3–5. Aici testezi cu linii inserate direct și cu un use-case generic `recordCost`.
- Nu construiești facturarea către client sau raportul lunar — pasul 10.
- Nu implementezi conectorul Saga (faza 3), dar **lași `check_key`-ul în registrul de închidere**.
- Nu optimizezi prematur: nu partiționezi, nu adaugi cache distribuit.

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Inserezi linie cu `stage='consumat'` fără `charged_contract_id` | respins de `check` |
| 2 | Inserezi linie pe o lucrare fără `stage_id` | respins de trigger |
| 3 | Inserezi linie fără `document_type`/`document_id` | respins |
| 4 | Inserezi linie cu `effect_date` în august | `period_id` se completează singur cu august |
| 5 | `UPDATE` direct pe `cost_lines` ca `app_office` | **respins** (privilegiu revocat) |
| 6 | `DELETE` pe `cost_lines` | respins |
| 7 | Corectezi o sumă greșită | se face prin linie de storno; ambele rămân vizibile |
| 8 | Inserezi 10.000 de linii de cost în seed | rollup-ul = suma exactă din registru, verificat cu query independent |
| 9 | Rulezi `rollup.verify` după o coruptere manuală a rollup-ului | alertă generată, cu componenta și diferența |
| 10 | Deschizi Contract › Prezentare cu 10.000 de linii în DB | **< 200 ms**, o singură interogare pe rollup (verifică în log-ul de query-uri) |
| 11 | Click pe „Consumat 18.100 lei" | listă de linii → click pe o linie → documentul sursă. **Fără fundătură**, până la capăt |
| 12 | Insert în lună închisă | eroare `PERIOD_CLOSED` |
| 13 | Muți finanțarea pe lună deschisă (pasul 05) | `charged_*` se rescrie pe linii; `used_*` **neschimbat**; rollup-urile ambelor componente se actualizează în aceeași tranzacție |
| 14 | Muți finanțarea pe lună închisă | apar linii de re-alocare cu `is_reallocation = true`; luna închisă rămâne neatinsă |
| 15 | Deschizi raportul de reconciliere | apar exact liniile cu `used ≠ charged`, nimic altceva |
| 16 | Deschizi ecranul de închidere cu 4 pontaje nevalidate | rândul e `blocked`, are contor și link; butonul „Închide luna" e **inactiv** |
| 17 | Rezolvi tot și închizi luna | status `closed`, lacăt în selector, rând în audit **cu motiv**; orice scriere ulterioară în luna aia eșuează |
| 18 | Redeschizi luna ca admin fără motiv | blocat |
| 19 | Comutator marjă brută/netă | cifrele se schimbă, eticheta de pe ecran se schimbă, ambele sunt corecte față de `overhead_snapshots` |
| 20 | Login ca `field`, cerere pe `cost_lines` | zero rânduri și zero coloane de sumă accesibile |
| 21 | Test de performanță: drill-down pe 6 dimensiuni cu 100.000 de linii | paginare cursor, prima pagină < 500 ms, fără `OFFSET` în plan |

## 7. Definiția de „gata"

- Cele 21 de verificări trec; 1–7, 12, 16–17 sunt **blocante în CI**.
- `rollup.verify` rulează ca job programat și e vizibil în dashboard-ul de joburi.
- Cele 4 metrici de integritate sunt expuse și alertează.
- Documentat în `docs/cost-ledger.md`: cum se adaugă un tip de document care produce costuri (≤ 20 linii) — pașii următori se vor sprijini pe asta.
