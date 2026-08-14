# Pasul 09 — Fișe de lucru: inspecții, intervenții, pontaj, gestiune de echipă, bon de consum

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** activitatea reală de mentenanță produce, în sfârșit, **costuri** în registru. Inspecțiile pe checklist, intervențiile cu materiale și ore, pontajul cu rate card istoricizat și bonul de consum din gestiunea echipei.

---

## 0. Context de business (esențial)

### Inspecția

Verificare pe checklist la un obiectiv. Checklist-ul se încarcă automat din **profilul de inspecție al legăturii contract↔obiectiv** (nu de pe obiectiv — același obiectiv poate fi inspectat diferit pe contracte diferite).

**Regula care ține tot sistemul de propuneri:** fiecare punct **NOK trebuie să aibă o ieșire obligatorie** înainte ca fișa să se poată închide:

```
Punct 7 — Etanșare capac cămin C12         ● OK   ○ NOK
   NOK → ieșire obligatorie:
        ○ Rezolvat pe loc  (descrie ce ai făcut)
        ○ Creează intervenție  →  Cerere tip „constatare"
        ● Propunere pentru mai târziu  →  Backlog, estimat 1.800 lei
```

Fără regula asta, backlogul rămâne gol și Delta se umple reactiv, adică prost.

### Intervenția

Reparație punctuală, tipic sub pragul de 2.000 lei. Fișa se completează pe teren: descriere, materiale consumate (din gestiunea echipei), ore declarate, poze înainte/după.

La validare, sistemul compară automat **consum așteptat (din catalogul de operațiuni) vs consum real** și marchează abaterile mari. E cel mai bun mecanism anti-furt din sistem — și trăiește **pe fișă**, nu într-un raport pe care nu-l citește nimeni.

### `data_efect` — regula care se ratează

O fișă din **28 iulie**, validată pe **3 august**, se raportează în luna clientului. `effect_date` se setează **la validare**, e separată de `document_date`, și toate agregările lunare merg pe ea.

### Pontajul

Ziua unui om **se împarte pe mai multe unități de lucru** — ecranul e proiectat cu ore pe rând, nu cu o singură lucrare per zi. Rate card-ul e **istoricizat**: se aplică automat cel valabil la data pontajului, și se **îngheață** la validare.

Separat: **pontajul de prezență al subcontractanților**, declarat de șeful de șantier, marcat clar ca **instrument de control, nu de plată**.

### Gestiunea = loc fizic

**Nu există „gestiune de contract".** Gestiunea e un loc: magazie centrală, șantier, echipă, subcontractant, unelte, utilaje, consignație. **Contractul e o dimensiune analitică pe document**, nu un depozit. Ecranul de creare gestiune cere obligatoriu un tip din listă și o locație fizică — „gestiune de contract" nu e o opțiune în enum, prin construcție.

Bonul de consum poartă contractul, componenta, obiectivul, UL-ul și etapa. **Costul apare în registru abia la consum**, în stadiul `consumat`.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §9 (execuție), §11 (registrul de cost — recapitulare), §17 (gestiuni — **integral**), §8.5 (catalogul de operațiuni) |
| `Damina_Aplicatie_Structura_Functionala.md` | §11.2 (inspecția), §11.3 (intervenția), §11.6 (pontaj), §13.5 (stoc și gestiuni), §20 (fluxul lunii de mentenanță) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | Anexa C.10 (inspecții și intervenții), C.11 (pontaj), C.12 (gestiuni și consum, minimul fazei 1) |

## 2. Precondiții

Din pașii 01–08: RLS + column grants, audit, perioade cu blocare, contracte + componente + plafoane, obiective + checklist-uri + profile de inspecție, UL cu alocări și etape, **registrul de cost cu rollup-uri**, file management (poze în folderul UL), cereri + backlog + catalog de operațiuni, echipe și calificări cu rate card istoricizat.

---

## 3. Ce livrezi

### 3.1 Inspecții (migrarea `0019_inspections`)

```sql
app.inspections (                      -- extensie 1:1 pe work_units cu type='inspectie'
  work_unit_id uuid pk,
  checklist_id uuid, checklist_version smallint,
  performed_on date, performed_by uuid,
  effect_date date,                    -- luna de raportare
  validated_at timestamptz, validated_by uuid
);

app.inspection_answers (
  id uuid pk, work_unit_id uuid, checklist_item_id uuid,
  answer app.checklist_answer,         -- ok | nok | na
  note text
);

app.inspection_findings (              -- fiecare NOK are ieșire OBLIGATORIE
  id uuid pk, work_unit_id uuid, answer_id uuid,
  outcome app.finding_outcome not null,   -- rezolvat_pe_loc | interventie | propunere
  resolution_note text,
  created_request_id uuid,             -- dacă intervenție
  backlog_proposal_id uuid,            -- dacă propunere
  estimated_value numeric(14,2)
);
```

**Trigger obligatoriu:** nu se poate seta `inspections.validated_at` cât timp există un `answer = 'nok'` fără rând corespunzător în `inspection_findings`. Regula de business, impusă în DB.

Un punct de checklist cu `requires_photo = true` **blochează** validarea fără poză atașată.

Ieșirea `interventie` creează o **Cerere de tip „constatare"** (pasul 08). Ieșirea `propunere` creează o **propunere în backlog**, cu valoare estimată. Ambele, atomic cu salvarea fișei.

### 3.2 Intervenții (migrarea `0020_interventions`)

```sql
app.interventions (                    -- extensie 1:1 pe work_units cu type='interventie'
  work_unit_id uuid pk,
  source_request_id uuid,
  performed_on date, effect_date date,
  description text, declared_hours numeric(14,4),
  operation_id uuid,                   -- pentru comparația așteptat vs real
  validated_at timestamptz, validated_by uuid
);
app.intervention_materials (id uuid pk, work_unit_id, product_id, lot_id,
                            quantity numeric(14,4), location_id, consumption_note_id);
app.intervention_hours (id uuid pk, work_unit_id, person_id, hours numeric(14,4), work_date date);
```

**La validare, într-o singură tranzacție:**
1. se setează `effect_date` (implicit luna curentă, editabilă de birou);
2. materialele generează **bon de consum** → mișcări de stoc → linii de cost `consumat`;
3. orele generează linii de cost `manopera_proprie`, cu costul din rate card-ul zilei;
4. se actualizează `operation_actuals` (așteptat vs real, per echipă);
5. dacă abaterea depășește pragul configurat → **marcaj vizibil pe fișă** și alertă pentru PM.

### 3.3 Pontaj (migrarea `0021_timesheets`)

```sql
app.timesheets (id uuid pk, person_id, work_date date, company_id,
                status text,           -- draft | submitted | validated
                validated_by, validated_at, unique (person_id, work_date));
app.timesheet_lines (id uuid pk, timesheet_id,
                     work_unit_id, stage_id, hours numeric(14,4),
                     rate_card_id uuid,          -- ÎNGHEȚAT la validare
                     hourly_cost numeric(14,2));
app.subcontractor_attendance (id uuid pk, work_unit_id, subcontractor_id,
                              work_date date, headcount smallint, declared_by uuid);
```

Trigger: `sum(hours)` per pontaj ≤ 24 și > 0. La validare se generează liniile de cost `manopera_proprie`, cu `stage_id` obligatoriu dacă UL-ul e lucrare.

**Ecran de birou:** validare pe săptămână, cu totaluri pe om și pe UL.

### 3.4 Gestiuni, produse, stoc — minimul fazei 1 (migrarea `0022_inventory_minimal`)

```sql
app.locations (                        -- gestiune = LOC FIZIC
  id uuid pk, company_id uuid,
  type app.location_type not null,     -- magazie_centrala|consignatie|santier|echipa|
                                       -- subcontractant|unelte|utilaje
  name text, code text, parent_location_id uuid,
  team_id, work_unit_id, subcontractor_id, supplier_id,
  address jsonb, geo_lat, geo_lng,
  is_custody boolean default false, is_active boolean
);

app.stock_balances (location_id, product_id, lot_id,
                    qty_physical numeric(14,4) default 0,
                    qty_reserved numeric(14,4) default 0,
                    avg_cost numeric(14,4),          -- CMP per gestiune
                    primary key (location_id, product_id, lot_id));
-- qty_available = physical - reserved, calculat la citire. NU se stochează.

app.stock_movements (                  -- append-only, sursa adevărului pe stoc
  id uuid pk, company_id, period_id,
  document_type text, document_id uuid, document_line_id uuid,
  from_location_id, to_location_id, product_id, lot_id,
  quantity numeric(14,4), unit_cost numeric(14,4), effect_date date
);

app.consumption_notes (                -- bon de consum
  id uuid pk, company_id, series text, number text,
  location_id, work_unit_id, stage_id,
  contract_id, component_id, objective_id,     -- contractul e DIMENSIUNE
  document_date date, effect_date date, period_id, issued_by, status text
);
app.consumption_lines (id uuid pk, note_id, product_id, lot_id,
                       quantity numeric(14,4), unit_cost numeric(14,4));
```

- `stock_balances` se întreține **prin trigger** din `stock_movements`, ca rollup-urile. Job nocturn de verificare (recalcul din mișcări vs solduri) → alertă la divergență.
- **CMP per gestiune**, recalculat la intrare.
- Numărul bonului vine din alocatorul gapless (pasul 02).
- `guard_closed_period` atașat pe `stock_movements` și `consumption_notes`.

Restul modulului de stoc (achiziții, PO, NIR, transferuri, inventare, loturi complete, rezervări) e **faza 3** — nu se construiește aici.

### 3.5 Ecrane

**Inspecția** (`Fișă · Constatări · Costuri · Poze · Documente`) — fișa cu checklist-ul încărcat din profil, cu ieșire obligatorie pe NOK, poze obligatorii unde e cerut.

**Intervenția** (`Fișă · Materiale · Ore · Costuri · Poze · Documente`) — cu bara de comparație **așteptat vs real** vizibilă pe fișă după validare.

**Activitate › Pontaj** — validare săptămânală, totaluri pe om și pe UL, rate card aplicat automat.

**Aprovizionare › Stoc și gestiuni** — filtru pe gestiune, produs, lot; **trei coloane: fizic / rezervat / disponibil**. Tipurile de gestiune ca filtru de nivel înalt.

**Bon de consum** — din intervenție (automat) sau manual din gestiunea echipei, cu analitica completă obligatorie.

**Obiective › Acoperire inspecții** — se **activează cu date reale** (structura există din pasul 04): din N obiective, câte au fost inspectate luna asta, per tip, cu restanțele. **Fără notificări către teren** — măsori fără să hărțuiești.

**Obiectiv › Istoric** — se populează cu inspecțiile, intervențiile și costurile lor, pe analitica „folosit".

**Catalog de operațiuni** — ecranul „realizat vs estimat pe echipe" se **umple cu date reale**.

### 3.6 Validarea de birou și `effect_date`

Ecran de validare în masă pentru PM, la sfârșit de lună: fișele nevalidate, cu posibilitatea de a seta `effect_date` pe lot. **Fișele nevalidate nu produc costuri** și nu intră în raportul lunar — se numără explicit ca „neincluse" pe ecranul de raport (pasul 10).

---

## 4. Reguli care nu se negociază

1. **Fiecare NOK are ieșire obligatorie.** Impusă prin trigger, nu prin validare de formular.
2. **`effect_date` se setează la validare** și e separată de `data_document`. Agregările merg pe ea.
3. **Nu există „gestiune de contract".** Gestiunea e loc fizic; contractul e dimensiune pe document.
4. **Rate card-ul se îngheață la validarea pontajului.**
5. **Ziua se împarte pe mai multe UL.** Un pontaj cu o singură lucrare per zi e un design greșit.
6. **Pontajul de subcontractant e instrument de control, nu de plată** — etichetat ca atare pe ecran.
7. **`stock_movements` e append-only.** Corecția prin mișcare inversă.
8. **Validarea unei fișe = o tranzacție** care produce toate efectele (cost, stoc, actuals) sau niciunul.
9. **Zero prețuri pe orice ecran atins de `field`** — verificat de testul generic.

## 5. Ce NU faci în pasul ăsta

- Nu construiești aplicația de teren offline — pasul 10. Aici fișele se completează din birou (sau din browserul mobil, online), ca să poți testa logica separat de sincronizare.
- Nu construiești achiziții, PO, NIR, recepții, transferuri, inventare, rezervări (faza 3).
- Nu construiești devize, pachete, situații de lucrări (faza 2).
- Nu implementezi loturi cu FEFO complet — doar câmpul `lot_id`, folosit dacă produsul e `is_lot_tracked`.
- Nu construiești raportul lunar — pasul 10.

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Creezi o inspecție pe un obiectiv | checklist-ul se încarcă **din profilul de pe `contract_objectives`**, cu versiunea înregistrată |
| 2 | Același obiectiv pe alt contract | se încarcă **alt checklist**, conform profilului acelui contract |
| 3 | Marchezi un punct NOK și încerci să validezi | **blocat**, cu indicarea punctului fără ieșire |
| 4 | NOK → „Creează intervenție" | apare o Cerere tip „constatare", legată în ambele sensuri |
| 5 | NOK → „Propunere" cu 1.800 lei | apare în backlog, cu `source_kind='inspectie'` și link la inspecție |
| 6 | Punct cu `requires_photo` fără poză | validare blocată |
| 7 | Validezi inspecția cu `performed_on=28.07` în data de 3.08 | `effect_date` propus august; costurile intră în august, `document_date` rămâne 28.07 |
| 8 | Creezi intervenție cu 2 materiale și 6 ore, validezi | într-o tranzacție: bon de consum + mișcări de stoc + linii de cost `consumat` și `manopera_proprie`; soldul gestiunii scade exact |
| 9 | Simulezi eroare la generarea bonului | **nimic** nu s-a scris: fără cost, fără mișcare de stoc, fișa rămâne nevalidată |
| 10 | Intervenție legată de OP-118, cu cost real +18% față de estimat | marcaj vizibil pe fișă + alertă pentru PM; `operation_actuals` actualizat |
| 11 | Consumi mai mult decât ai în gestiune | blocat, cu soldul disponibil afișat |
| 12 | Pontaj cu 26 de ore | respins de trigger |
| 13 | Pontaj cu ziua împărțită pe 3 UL (4+2+2 ore) | 3 linii de cost, fiecare pe UL-ul ei, cu `stage_id` unde UL e lucrare |
| 14 | Pontaj pe o dată cu rate card vechi | se aplică **tariful valabil la acea dată**, nu cel curent; după validare, `rate_card_id` e înghețat |
| 15 | Modifici rate card-ul după validare | costurile deja înregistrate **nu se schimbă** |
| 16 | Încerci să creezi o gestiune „de contract" | imposibil — enum-ul nu conține opțiunea; ecranul cere tip fizic + locație |
| 17 | Deschizi Stoc | trei coloane fizic / rezervat / disponibil, corecte |
| 18 | Rulezi jobul de verificare stoc după coruperea manuală a unui sold | alertă cu produsul, gestiunea și diferența |
| 19 | Validezi o fișă cu `effect_date` într-o lună închisă | eroare `PERIOD_CLOSED`, cu propunerea de a muta `effect_date` în luna curentă |
| 20 | Acoperire inspecții după 8 inspecții din 20 obiective | 8/20, restanțele listate, per tip de inspecție. **Nicio notificare trimisă către teren** |
| 21 | Obiectiv › Istoric | apar toate fișele, cu costuri, total anual și medie lunară, etichetat „folosit" |
| 22 | Contract › Prezentare | banda de Mentenanță arată acum consum real ≠ 0, egal cu suma din drill-down |
| 23 | Login ca `field` pe fișe | vezi cantități și ore, **zero lei**; testul generic de coloane confirmă |
| 24 | Un `select *` pe `intervention_materials` din contextul `field` | **eșuează** (privilegiu revocat pe `unit_cost`) |

## 7. Definiția de „gata"

- Cele 24 de verificări trec.
- Test E2E: „inspecție cu 2 NOK → o intervenție + o propunere în backlog → intervenția validată → cost în registru → cifra apare pe banda contractului".
- Seed-ul include: 2 checklist-uri, 8 inspecții validate pe luni diferite, 3 intervenții, o săptămână de pontaje, o gestiune de echipă cu stoc.
- `operation_actuals` are date reale și ecranul de catalog le afișează pe echipe.
