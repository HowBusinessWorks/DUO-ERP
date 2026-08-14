# Pasul 08 — Cereri, catalog de operațiuni, decizia de rutare, backlog de propuneri

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** modulul care alimentează tot restul sistemului. Un email de la client devine, în câțiva pași măsurați, o unitate de lucru finanțată corect — sau o propunere în backlog care umple Delta luna viitoare.

---

## 0. Context de business (esențial)

### Cererea — o entitate, mai multe tipuri

Tot ce intră în firmă ca „ceva de făcut" e o **Cerere**, indiferent de sursă:

| Tip | Sursă |
|---|---|
| tichet client | email sau telefon |
| solicitare internă | oricine din firmă |
| constatare din inspecție | punct NOK pe checklist |
| propunere internă | din teren sau de la PM |
| solicitare / observație utilaj | din teren (faza 4) |

O singură entitate cu tip, nu cinci module. Asta e una din cele trei decizii de modelare care fac schema compactă.

### Decizia de rutare — cea mai importantă decizie din firmă

Când vine o cerere, cineva decide **din ce se plătește**. Opțiunile:

| Opțiune | Când |
|---|---|
| Intervenție pe **Mentenanță** | sub pragul de 2.000 lei |
| Lucrare pe **Delta** (1 lună) | peste prag, încape în Delta lunii |
| Lucrare pe **Delta ×2–3 luni** | nu încape într-o lună |
| Lucrare pe componenta **Lucrări** | e prevăzută în contract |
| **Contract individual nou** | e o oportunitate comercială |
| **Amânare → backlog** | nu e urgentă |

**Sistemul propune, omul confirmă sau schimbă, motivând.** Se salvează și propunerea sistemului, și decizia omului — ca să se vadă cât de des diverg. Dacă diverg mereu, regula automată e greșită.

La apăsarea butonului se creează **atomic**: UL + alocarea de finanțare + folderul de documente + legătura înapoi la cerere. Nu există „decis" urmat de cineva care introduce manual rezultatul.

### Catalogul de operațiuni — ce transformă „din ochi" în cifră

Pragul de 2.000 lei e inutil dacă valoarea estimată se dă din ochi. Catalogul de operațiuni standard dă: normă de timp, calificare, materiale tipice, cost estimat.

Bonus, **cel mai bun mecanism anti-furt din sistem**: catalogul acumulează costul **real** mediu per operațiune și per echipă.

```
OP-118 · Înlocuire capac cămin carosabil
Normă de timp     2,5 h · calificare: instalator
Materiale tipice  capac fontă D400 ×1 · mortar ×5 kg
Cost estimat      412 lei   (manoperă 180 · material 232)
Realizat: 34 execuții · cost mediu real 438 lei (+6,3%)
   pe echipe:  Echipa A 401 lei · Echipa B 476 lei ⚠
```

Ultima linie e mai valoroasă decât orice structură de gestiuni. Și trăiește **aici**, pe ecran, nu într-un raport pe care nu-l citește nimeni.

### Backlogul — funcționalitatea cu cel mai bun raport efort/venit

Toate constatările NOK din inspecții și toate cererile amânate ajung în backlog, **cu valoare estimată**, și rămân re-evaluabile. Scopul e unul singur: **umplerea Deltei**.

```
BACKLOG DE PROPUNERI      Contract 4700 ▾    Delta august: 4.100 lei liberi
☐ Înlocuire capac cămin C12      Berceni      1.800 lei   din inspecția 12.07
☐ Reparație tencuială hol        Sediu Vest   2.300 lei   din inspecția 03.08
☐ Revizie tablou electric        Glina        4.000 lei   tichet client 21.07
Selectate: 2 · 4.100 lei · umple Delta la 100%   [Promovează în lucrări]
```

Selectezi propuneri până umpli exact plafonul, apeși un buton, se creează UL-urile și alocările. **Asta e mecanismul care transformă Delta din venit pierdut în venit încasat.**

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §7 (cererea), §8.5 (catalogul de operațiuni), §14 (backlog), §13.2 (filtrul de 24h — context) |
| `Damina_Aplicatie_Structura_Functionala.md` | §10 (integral: inbox, tab-uri, decizie, backlog), §19 (fluxul cap-coadă de la email la lucrare), §17 (catalogul de operațiuni ca nomenclator) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | Anexa C.8 (cereri, decizii, backlog), C.9 (catalog), §12.2 (email — IMAP vs webhook), §6.1 (exemplul de use-case `decideRouting`) |

## 2. Precondiții

Din pașii 01–07: RLS + audit, perioade, contracte cu componente și plafoane, obiective cu `contract_objectives`, UL cu alocări de finanțare, registrul de cost cu rollup-uri (pentru „cât e liber în Delta"), file management (folderul cererii), notificări și cozi de lucru, worker pg-boss.

---

## 3. Ce livrezi

### 3.1 Schema (migrarea `0017_requests`)

```sql
app.requests (
  id uuid pk,                        -- UUID v7, poate veni din teren
  company_id uuid, type app.request_type, source app.request_source,
  status app.request_status,         -- neprocesata|in_evaluare|decisa|in_backlog|respinsa|anulata
  objective_id, contract_id, contract_objective_id,
  title text, description text,
  source_inspection_finding_id uuid, source_equipment_id uuid,
  estimated_value numeric(14,2),
  sla_due_at timestamptz,
  created_by uuid
);

app.request_emails (                 -- emailul original = DOVADA solicitării
  id uuid pk, request_id uuid,
  message_id text unique,            -- deduplicare
  from_address citext, to_address citext, subject text, received_at timestamptz,
  body_text text, body_html text,
  raw_node_id uuid                   -- .eml integral, în R2, permanent
);

app.request_estimate_lines (
  id uuid pk, request_id uuid, operation_id uuid,
  quantity numeric(14,4), estimated_labor numeric(14,2), estimated_material numeric(14,2)
);

app.request_decisions (
  id uuid pk, request_id uuid,
  choice app.routing_choice,
  system_proposal app.routing_choice,      -- ce a propus sistemul
  target_contract_id, target_component_id,
  target_periods date[],                   -- 1..3 luni de Delta
  created_work_unit_id uuid,
  reason text not null,
  decided_by uuid, decided_at timestamptz
);

app.backlog_proposals (
  id uuid pk, request_id uuid, objective_id uuid, contract_id uuid,
  title text, estimated_value numeric(14,2),
  source_kind text,                        -- inspectie | tichet | amanata
  source_inspection_id uuid,
  status text,                             -- open | promoted | dropped | expired
  promoted_work_unit_id uuid, valid_until date,
  index (contract_id, status, estimated_value)
);
```

### 3.2 Catalogul de operațiuni (migrarea `0018_operation_catalog`)

```sql
app.operation_catalog (
  id uuid pk, code text unique, name text, category text,
  standard_hours numeric(14,4), qualification_id uuid,
  estimated_labor numeric(14,2),      -- derivat din rate card curent
  estimated_material numeric(14,2), is_active boolean
);
app.operation_catalog_materials (operation_id, product_id, quantity numeric(14,4));

app.operation_actuals (               -- mecanismul anti-furt, MATERIALIZAT
  operation_id uuid, team_id uuid, period_id uuid,
  executions integer, avg_real_cost numeric(14,2), avg_estimated_cost numeric(14,2),
  primary key (operation_id, team_id, period_id)
);
```

`operation_actuals` se întreține **prin același tipar de trigger ca rollup-urile**: la validarea unei fișe de intervenție se actualizează rândul. Ecranul cu „Echipa A 401 lei · Echipa B 476 lei ⚠" e un `SELECT` pe tabela asta, nu un raport calculat la cerere. (Fișele de intervenție vin în pasul 09 — pregătește trigger-ul și punctul de apel acum, testabil cu date inserate manual.)

### 3.3 Domain pur — `packages/domain/requests`

```ts
routeRequest({ request, ceilings, deltaFree, threshold }): RoutingProposal
```

Funcție **pură**, care întoarce propunerea sistemului + motivul + opțiunile alternative cu explicația pentru care fiecare e sau nu disponibilă („✗ peste pragul de 2.000"). Toate cazurile din §7 și din anexa de acoperire se testează aici, **fără DB**.

Alte funcții: `estimateFromCatalog(lines, rateCard)`, `selectBacklogToFill(proposals, freeAmount)` (knapsack simplu — combinația care umple cel mai bine plafonul), `splitDeltaAcrossPeriods(value, periods)`.

### 3.4 Inbox de email

**Opțiunea recomandată: IMAP polling** pe cutia existentă, job la 5 minute. Zero schimbări la furnizorul de email, zero DNS, funcționează cu Microsoft 365 / Google Workspace prin OAuth. (Alternativa — inbound webhook — e mai curată tehnic dar cere control pe DNS și o adresă nouă, deci schimbă obiceiul clientului.)

Coada `mail.ingest` în worker:
1. citește mesajele noi, **deduplicare pe `Message-ID`**;
2. creează `Cerere` în stare `neprocesată`;
3. salvează **`.eml` integral în R2, permanent** — e dovada solicitării clientului;
4. atașamentele intră ca `file_versions` în folderul cererii;
5. **fără parsare inteligentă** (decizie explicită). Singura automatizare: dacă expeditorul e cunoscut, clientul și contractul se precompletează.

Toate credențialele stau în Supabase Vault, per firmă.

### 3.5 Ecrane

**Cereri › Inbox** — ecran de triere pe două coloane: stânga emailul original, dreapta formularul (obiectiv, contract, tip, descriere, valoare estimată). **Ținta e 30 de secunde per email** — proiectează ecranul pentru asta (focus automat, taste rapide, precompletare, salvare cu `Ctrl+Enter`).

**Pagina de cerere** — tab-uri `Prezentare · Constatare · Evaluare · Decizie · Documente`.

**Evaluare** — se calculează valoarea estimată **din catalogul de operațiuni**: alegi operațiunea și cantitatea, sistemul scoate norma de timp, materialele tipice și costul estimat.

**Decizie** — ecranul central:

```
Valoare estimată: 3.400 lei          Contract 4700 · Delta liber: 4.100 lei
Sistemul propune:  ▶ LUCRARE MICĂ pe DELTA (august)
                     3.400 ≤ 4.100 disponibil · umple Delta la 94%
Alte opțiuni:      ○ Intervenție pe Mentenanță   ✗ peste pragul de 2.000
                   ○ Lucrare pe componenta Lucrări
                   ○ Împărțită pe 2–3 luni de Delta
                   ○ Oportunitate → contract individual nou
                   ○ Amână → backlog de propuneri
Motiv: ______________________________         [Decide și creează UL]
```

Cifra „Delta liber" vine din rollup-uri (pasul 06) — **live, niciodată cache-uită**.

**Cereri › Backlog de propuneri** — ecranul de umplere a Deltei, cu selecție multiplă, total cumulat live, procent de umplere și buton `[Promovează în lucrări]` care creează UL-urile și alocările **într-o singură tranzacție**.

**Cereri › Decizii de rutare (jurnal)** — toate deciziile, cu propunerea sistemului alături de alegerea omului, cu motivul și autorul. Un indicator: procentul în care omul a schimbat propunerea.

**Nomenclatoare › Catalog de operațiuni** — CRUD + ecranul cu realizat vs estimat pe echipe.

### 3.6 Cozi, notificări, joburi

- Badge **Cereri** în sidebar = cereri `neprocesată` + `in_evaluare` care așteaptă de la mine.
- Cron zilnic 09:00 — **filtrul de 24h**: cererile nedecise curg automat mai departe, conform regulii lor.
- Cron pe **10 și 20 ale lunii, 09:00** — alertă „grad de umplere Delta sub prag", **cu link direct în backlog, filtrat pe contractul respectiv**. Alerta fără link e inutilă.
- `sla_due_at` pe tichetele de client → alertă înainte de depășire.
- Propunerile din backlog cu `valid_until` depășit → `expired`, nu șterse.

### 3.7 Legături (reciproce)

Cerere → UL creată · obiectiv · contract · **emailul original** · propunerea din backlog.
UL → cererea de origine (`source_request_id`, deja în schema din pasul 05).
Obiectiv → cererile lui.

---

## 4. Reguli care nu se negociază

1. **O singură entitate `Cerere` cu tip.** Nu module separate pe sursă.
2. **Decizia creează atomic UL + alocare + folder + legătură.** Dacă una eșuează, nu se creează nimic.
3. **Motivul deciziei e obligatoriu** și se salvează cu autor și dată.
4. **Se salvează și propunerea sistemului**, nu doar alegerea omului.
5. **Emailul original rămâne permanent** în R2. E dovada.
6. **Fără parsare inteligentă de email** în faza asta.
7. **Fiecare punct NOK din inspecție are ieșire obligatorie** — dintre care una e backlogul (se impune în pasul 09; aici pregătești capătul de intrare).
8. **Alerta de Delta vine pe 10 și pe 20**, nu la închidere. La închidere e prea târziu.

## 5. Ce NU faci în pasul ăsta

- Nu implementezi fișele de inspecție/intervenție — pasul 09 (dar `source_inspection_finding_id` există și se leagă atunci).
- Nu construiești aplicația de teren — pasul 10.
- Nu implementezi solicitările de utilaj (faza 4) — tipul există în enum, ecranul nu.
- Nu implementezi SLA-uri complexe — doar `sla_due_at` + alertă.
- Nu faci clasificare automată sau NLP pe emailuri.

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Trimiți un email pe cutia monitorizată | în ≤ 5 min apare o Cerere `neprocesată`; `.eml` e în R2; atașamentele sunt în folderul cererii |
| 2 | Trimiți același email de două ori | o singură Cerere (dedup pe `Message-ID`) |
| 3 | Email de la un expeditor cunoscut | clientul și contractul sunt precompletate |
| 4 | Triezi o cerere din inbox, cronometrat | flux complet în < 30s, fără să atingi mouse-ul mai mult de o dată |
| 5 | Evaluezi cu 2 operațiuni din catalog | valoarea estimată = suma manoperă + material, calculată din rate card-ul curent |
| 6 | Cerere de 1.500 lei | sistemul propune **Intervenție pe Mentenanță** |
| 7 | Cerere de 3.400 lei, Delta liber 4.100 | propune **Delta august**, cu „umple Delta la 94%" |
| 8 | Cerere de 12.000 lei, Delta liber 4.100 | propune **split pe 2–3 luni** sau componenta Lucrări; opțiunea „Delta o lună" apare marcată ✗ cu motivul |
| 9 | Decizi fără motiv | blocat |
| 10 | Apeși „Decide și creează UL" | **atomic**: UL + alocare(i) + folder + legătură; cererea devine `decisa` |
| 11 | Simulezi eroare la crearea folderului | **nimic** nu s-a creat: fără UL, fără alocare, cererea rămâne `in_evaluare` |
| 12 | Decizie cu split pe 3 luni de Delta | 3 alocări, câte una pe lună, sumele corecte |
| 13 | Amâni o cerere | apare în backlog cu valoare estimată și `source_kind='amanata'` |
| 14 | Backlog: selectezi propuneri | totalul cumulat și procentul de umplere se actualizează live |
| 15 | „Promovează în lucrări" pe 2 propuneri | 2 UL-uri + 2 alocări, într-o singură tranzacție; propunerile devin `promoted` cu `promoted_work_unit_id` |
| 16 | Promovezi propuneri peste plafonul liber al Deltei | avertisment explicit cu suma depășită, decizie conștientă (nu blocaj tăcut) |
| 17 | Deschizi jurnalul de decizii | vezi propunerea sistemului vs alegerea omului, motivul, autorul, și procentul de divergență |
| 18 | Cron pe 10 ale lunii cu Delta la 38% | alertă cu **link direct în backlog filtrat pe contract**; a doua rulare nu duplică alerta |
| 19 | Propunere cu `valid_until` trecut | devine `expired`, rămâne vizibilă cu filtru |
| 20 | Login ca `field` pe modulul Cereri | vezi doar cererile legate de UL-urile tale, **fără valori estimate în lei** |
| 21 | Teste de domain pe `routeRequest` | toate cazurile din anexa de acoperire trec, fără DB |
| 22 | Adaugi 20 de execuții reale pe OP-118 (date inserate) | ecranul catalogului arată cost mediu real, abaterea %, și defalcarea pe echipe cu ⚠ |

## 7. Definiția de „gata"

- Cele 22 de verificări trec.
- Fluxul cap-coadă „email → cerere → evaluare → decizie → UL finanțată" e acoperit de **un test E2E Playwright** care rulează pe fiecare PR.
- Seed-ul include: catalog cu ~10 operațiuni, 5 propuneri în backlog, 3 cereri în stări diferite.
- `docs/routing.md` documentează regula de propunere automată, ca să poată fi ajustată fără arheologie în cod.
