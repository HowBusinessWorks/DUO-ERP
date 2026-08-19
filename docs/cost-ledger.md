# Registrul de cost

Un singur registru, `app.cost_lines`, pentru toate cheltuielile. Fiecare linie
răspunde la șase întrebări: **când · unde · cine plătește · ce · cât · de unde**.
Toate rapoartele de bani sunt filtre pe tabela asta.

## Cele patru reguli

1. **Două analitici pe fiecare linie.** `used_*` (unde s-a consumat fizic) nu se
   schimbă niciodată; `charged_*` (cine plătește) se rescrie la mutarea
   finanțării. Cu o singură analitică, ori istoricul obiectivului e fals, ori
   raportul de plafon e fals.
2. **Append-only.** `update` și `delete` nu sunt acordate nimănui. Corecția e o
   **linie de storno** — sumă negativă, aceeași componentă. Ambele rămân vizibile.
3. **`period_id` se derivă** din `effect_date`, prin trigger. Aplicația nu-l scrie.
4. **`document_type` + `document_id` obligatorii.** Fără ele cifra nu se poate
   desface până la sursă.

## Cum adaugi un tip de document care produce costuri

Pașii 07–10 aduc bonul de consum, NIR-ul, pontajul, fișa de motorină. Fiecare se
leagă la registru la fel:

1. Adaugă valoarea în enum-ul `app.cost_document_type`
   (`packages/db/src/schema/enums.ts`) — dacă nu e deja acolo; lista acoperă toată
   faza 0, deci probabil este.
2. Scrie liniile la validarea documentului, nu la crearea lui: `document_id` e
   id-ul documentului tău, `document_line_id` id-ul rândului din el.
3. Completează **ambele** analitici. Implicit sunt egale — le desparte doar cine
   are un motiv, iar diferența apare automat în raportul de reconciliere.
4. Alege stadiul: `angajat` la lansarea comenzii (colorează plafonul devreme),
   `receptionat` la NIR, `consumat` la bonul de consum, `facturat` la factură.
   De la `receptionat` în sus, `charged_contract_id` e obligatoriu.
5. Pe o **lucrare**, `stage_id` e obligatoriu — altfel trigger-ul respinge linia.

Nu scrie nimic în `app.component_period_rollup`: se întreține singur, prin
trigger, în aceeași tranzacție.

## Ce se întâmplă la mutarea finanțării

| Luna         | Mecanica                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **deschisă** | `app.recharge_cost_line(linie, contract, componentă, motiv)` rescrie `charged_*`. Rollup-urile ambelor componente se mișcă în aceeași tranzacție. |
| **închisă**  | Liniile rămân datate în luna lor. Se emite **document de re-alocare** în luna curentă, cu două linii noi (`is_reallocation = true`).              |

`app.recharge_cost_line` e singura ușă — `update` nu e acordat niciunui rol. Ea nu
deschide luna închisă: sunt două uși diferite, dinadins.

## Verificarea de integritate

`app.rollup_verify(period)` recalculează rollup-urile din registru și întoarce
**doar diferențele** (componentă, coloană, stocat, așteptat). Jobul nocturn
`rollup.verify` o cheamă și alertează pe ce iese. `null` înseamnă toate lunile.

## Cine vede registrul

Numai biroul. `app_field`, `app_subcontractor` și `app_client` **nu au nicio
politică RLS și niciun grant** pe `cost_lines` sau pe rollup-uri — nu văd niciun
rând, nici măcar filtrat.

Coloanele de bani ale rollup-urilor (`committed`, `received`, `consumed`,
`invoiced`, `allocated_revenue`) **nu sunt prinse** de regexul din
`app.assert_no_money_leak` — se trec explicit în lista funcției. Orice pas care
adaugă o coloană de bani cu nume care nu conține `price|pret|cost|amount|margin|
salary` trebuie să facă la fel.
