# Pasul 12 — Pachete de subcontractant și portalul lor

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** PM-ul grupează linii din devizul intern în pachete, le trimite la subcontractanți, iar aceștia intră în aplicație — **prima dată în tot proiectul când `app_subcontractor` are date reale** — și negociază linie cu linie. Pachetul acceptat produce prima linie de cost `angajat` din faza 2.
> **Riscul pasului nu e tehnic, e de izolare.** Un subcontractant care vede pachetul altuia e un incident, nu un bug.

---

## 0. Context de business (esențial)

### Ce e un pachet

Din devizul intern, PM-ul selectează linii și le grupează în **pachete** pe meserie: electric, sanitar, construcții (§8.3). Pachetul se trimite ca cerere de ofertă către **unul sau mai mulți** subcontractanți.

Subcontractantul face una din trei: acceptă prețul propus de tine, ofertează al lui, sau comentează linie cu linie.

**Pachetul acceptat devine baza pentru situațiile de lucrări lunare** (pasul 13). Fără el, n-ai contra ce să declari cantități.

### Regula care se impune în bază, nu în ecran

**Materialele nu intră NICIODATĂ într-un pachet de subcontractant.** Subcontractanții facturează **doar manoperă** (§8.3). Anexa D.3 e explicită: `package_lines` are „trigger care REFUZĂ linii de material".

Nu o implementa doar ca filtru în interfață. Un `insert` scris de mână, un import, sau un ecran viitor scris de altcineva ocolesc filtrul. Triggerul nu se ocolește.

### Cine vede prețul — a doua persona care îl vede

Până acum în proiect, prețul era o chestiune binară: biroul vede, terenul nu. Pasul ăsta introduce a treia poziție (§10.3):

| | PM | Șef de șantier | **Subcontractant** |
|---|---|---|---|
| Prețuri | vede tot | nu vede deloc | **vede — negociază pe el** |
| Deviz | creează, editează | nu vede | **nu vede** |
| Pachetul lui | vede tot | vede cantitățile | **vede tot, inclusiv prețul** |
| Pachetul altui subcontractant | vede | — | **nu vede nimic** |

**Izolarea A-față-de-B e constrângere de arhitectură, nu setare** (§21 punctul 8, confirmat de două prototipuri diferite). Se face cu RLS pe `subcontractor_id = app.current_subcontractor_id()`, nu cu un filtru în query.

### Provizionarea de conturi

Când PM-ul asignează un subcontractant care nu are cont, **sistemul îl creează automat**, cu o parolă temporară afișată **o singură dată** pe ecranul PM-ului (§10.3, `PLAN_TEHNIC` §8.3). Fără flux de invitații pe email — modelul validat în teren spune că nu e nevoie de el.

**Decizia utilizatorului (19 august 2026): portalul de subcontractant NU cere MFA.** Sunt utilizatori externi, cu parolă temporară. În schimb, **schimbarea parolei la prima intrare e obligatorie** — asta e ce înlocuiește al doilea factor aici. Nu construi nimic pe `MFA_ENFORCED`: e o poartă oprită, nu un drept dat (regula casei).

### Prima linie de cost a fazei 2

**La semnarea pachetului se scrie în registrul de cost, cu `stage = 'angajat'.**

Ăsta e stratul „angajat" pe care §21 punctul 7 îl cere explicit: *„altfel afli de depășire cu 3 săptămâni întârziere"*. Un pachet semnat de 80.000 lei e bani angajați din secunda semnării, nu de la prima factură.

`expense_type = 'servicii_subc'`, `document_type` — vezi decizia din §3.4.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §8.3 (pachete), §10.3 (modelul validat, provizionarea), §11 (registrul de cost), §21 punctele 7 și 8 |
| `Damina_Aplicatie_Structura_Functionala.md` | §12.2 (fluxul pe ecrane, pasul 1), §27.1 (portalul subcontractant, cele 7 ecrane) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §4.3 (roluri), §4.5 (RLS, rândul „Pachete și SL-uri"), §8.3 (provizionarea), §7.1 (route groups) |
| `Plan/11_Deviz_Articole_Normate.md` | tot — pachetul iese din devizul intern |

## 2. Precondiții

- **Pasul 11 complet.** `deviz_lines` cu `kind = 'intern'` există și are linii.
- `app_subcontractor` ca rol Postgres — **există din migrarea `0001`, nu-l recrea.**
- `session.subcontractorId` și claim-ul `subcontractor_id` — **există din pasul 02** (`packages/auth/src/session.ts`).
- Ruta `/portal/subcontractor` cu `EmptyState` — **există**, se înlocuiește conținutul.
- `app.subcontractors` (nomenclator, pasul 03) și `app.document_series` (pasul 02).
- Registrul de cost și `withActor` (pasul 06).

**Migrări: `0043`–`0045`.**

---

## 3. Ce livrezi

### 3.1 Schema (migrarea `0043_packages`)

```
packages        → work_unit_id, deviz_id (intern), company_id, code, name,
                  trade (electric|sanitar|constructii|altele), status:
                  draft|trimis|ofertat|acceptat|semnat|anulat,
                  subcontractor_id (null pana la acceptare),
                  signed_at, signed_by, retention_pct (garantia, pasul 14)
package_lines   → package_id, deviz_line_id (FK spre devizul INTERN),
                  position, name, uom, quantity_contracted,
                  unit_price, total  ← PRET, vizibil si subcontractantului
package_offers  → package_id, subcontractor_id, status:
                  invitat|ofertat|acceptat|respins, sent_at, responded_at
                  unique (package_id, subcontractor_id)
package_offer_lines → offer_id, package_line_id, offered_price, comment,
                  unique (offer_id, package_line_id)
```

**Triggerul care refuză materialul.** `before insert or update on package_lines`: dacă `deviz_line_id` arată către o linie cu `material_cost > 0`, refuză cu mesaj explicit. O linie mixtă se sparge în deviz înainte, nu se strecoară în pachet.

**Atenție, aici e o întrebare de business încă deschisă (D7 din `QUESTIONS.md`), de răspuns înainte de 12a.**
Devizul intern are patru feluri de cost (pasul 11 §3.1): material, manoperă, **utilaj, transport**. Regula
„doar manoperă" scrisă ca `labor_cost > 0 and material_cost = 0` refuză și o poziție curat de utilaj sau
de transport, care nu e material. Dacă subcontractantul nu primește niciodată utilaj/transport, condiția
strictă e corectă și trebuie scrisă așa **dinadins**; dacă primește, condiția e `material_cost = 0` și
atât. Nu ghici la implementare — întreabă, apoi scrie decizia în `QUESTIONS.md` și în `PROGRESS.md`.

**`package_offer_lines` e a patra tabelă, peste cele trei din D.3.** Motivul: §8.3 cere ca subcontractantul să poată **oferta și comenta linie cu linie**. Fără tabela asta, oferta ar fi un singur preț pe pachet, adică exact granularitatea pe care modelul validat o respinge (§10.3: „verificarea e linie cu linie, nu în bloc" — și negocierea la fel).

### 3.2 RLS — partea care contează cel mai mult

| Tabelă | `app_office` | `app_subcontractor` | `app_field` |
|---|---|---|---|
| `packages` | prin firmă | **doar cele unde `subcontractor_id` = al lui, SAU are o ofertă invitată** | citire fără preț, prin `v_package_lines_field` |
| `package_lines` | prin firmă | prin pachetul lui | **doar prin view, fără `unit_price`/`total`** |
| `package_offers` | prin firmă | **doar `subcontractor_id` = al lui** | niciun acces |
| `package_offer_lines` | prin firmă | prin oferta lui | niciun acces |

**View-ul `v_package_lines_field`**, cu `security_invoker = on`: `id, package_id, deviz_line_id, position, name, uom, quantity_contracted`. Fără nicio coloană de preț. `packages/db` îl expune ca schemă Drizzle separată, deci **TypeScript-ul nu cunoaște `unit_price` în contextul field**.

Politica de izolare A-vs-B se scrie o dată, peste `app.current_subcontractor_id()`.

**Funcția EXISTĂ deja — `0011_rls_policies.sql:110`. Nu o recrea.** Politicile RLS din `0016_work_units.sql`
și `0021_files.sql` se sprijină pe ea; un `create or replace` cu altă definiție le-ar schimba tăcut
comportamentul. Refolosește-o ca atare și verifică doar un lucru înainte de a scrie politicile: dacă
întoarce `null` (persona nu e subcontractant), politica **nu trebuie să lase nimic să treacă** —
`null = uuid` e `null`, nu `false`, și un `where` cu `null` filtrează corect, dar scrie condiția explicit
ca să nu depindă de subtilitate.

### 3.3 Provizionarea de conturi (migrarea `0044_subcontractor_accounts`)

`provisionSubcontractorAccount(actor, subcontractorId, personName, email)`:

1. creează persoana și utilizatorul Supabase, cu parolă temporară generată;
2. leagă `person → subcontractor` (coloană nouă pe `app.persons`, `subcontractor_id`);
3. marchează `must_change_password = true`;
4. întoarce parola **o singură dată**, în răspunsul use-case-ului.

**Parola nu se loghează, nu se salvează, nu se trimite pe email.** Apare pe ecranul PM-ului, cu buton de copiere, și atât. La al doilea request nu mai e disponibilă — asta e chiar comportamentul cerut.

Middleware-ul: o sesiune cu `must_change_password` merge **doar** pe ecranul de schimbare a parolei. Orice altă rută redirectează acolo.

### 3.4 Linia de cost la semnare

**Decizia (19 august 2026): pachetul semnat scrie `stage = 'angajat'`.**

```
company_id       ← al lucrarii
document_date    ← data semnarii
effect_date      ← idem (trigger-ul deduce period_id)
used_*           ← contractul/componenta lucrarii, obiectiv, work_unit, stage_id
charged_*        ← OBLIGATORIU: contractul si componenta care finanteaza
                   lucrarea. Se citesc de pe UL, nu se cer de la om.
expense_type     ← 'servicii_subc'
amount           ← totalul pachetului acceptat
stage            ← 'angajat'
document_type    ← 'situatie_lucrari'   (vezi mai jos)
document_id      ← package_id
subcontractor_id ← al lui
```

**`charged_*` nu poate rămâne gol, deși check-ul din bază l-ar accepta.** `cost_lines_charged_required`
(`0017:30`) permite `NULL` pe stadiul `angajat` — dar **rollup-ul de plafon nu**: `app.rollup_apply_cost`
iese din prima instrucțiune când componenta e `null` (`0018_rollups.sql:56`), iar funcția de reconciliere
ignoră la fel liniile fără componentă (`:222`). Un pachet de 80.000 lei semnat cu `charged_*` gol ar fi
**invizibil în plafon** — adică exact depășirea pe care pasul promite că o previne, și exact ce cere
verificarea #13. Componenta se știe întotdeauna: o lucrare pe care se semnează un pachet are deja
finanțare (pasul 05). Dacă nu are, semnarea se oprește, nu scrie o linie oarbă.

**`document_type` refolosește `situatie_lucrari`, nu adaugă o valoare nouă în enum.** Motivul: `cost_document_type` e un **enum** din faza 0 (`0000_schemas_and_enums.sql:14`), iar a-l extinde pentru fiecare document nou al fazei 2 înseamnă o migrare de tip pe fundație la fiecare pas — mai scumpă decât ar fi pe o tabelă, fiindcă un `alter type` nu se dă înapoi. Perechea `document_type + document_id` rămâne suficientă pentru drill-down, fiindcă `document_id` arată neambiguu către `packages`.

**Dacă la implementare drill-down-ul de la pasul 06 (verificarea #11) nu poate distinge pachetul de SL** din `document_id`, atunci adaugă valoarea `pachet_subc` în enum, cu migrare separată, și scrie de ce în `PROGRESS.md`. Verifică asta **înainte** de a scrie linia de cost, nu după.

La anularea unui pachet semnat: **linie de storno, în minus, nu `update`** (regula 1 a pasului 06).

### 3.5 Ecrane

**Birou** — pachetele ca tab pe UL-ul de tip `lucrare`, prin `entityRegistry`:

- selectarea liniilor din devizul intern și gruparea în pachet;
- invitarea unuia sau mai multor subcontractanți;
- comparația ofertelor **linie cu linie**, cu evidențierea diferenței față de prețul propus;
- acceptarea unei oferte și semnarea pachetului, cu confirmarea sumei angajate.

**Portalul subcontractantului** — `/portal/subcontractor`, în locul `EmptyState`-ului. Din cele 7 ecrane ale §27.1, pasul ăsta livrează **două**:

| Ecran | Pasul |
|---|---|
| `Pachetele mele` (cu prețuri — negociază pe ele) | **12** |
| `Situații de lucrări` | 13 |
| `Suplimentări` | 14 |
| `Facturile mele` (cu cod SL) | 14 (schelet), faza 5 |
| `Garanții reținute` | 14 |
| `PV-uri` | faza 4 |
| `Utilaje în custodie` | faza 4 |

Cele care nu se livrează acum **apar în meniul portalului cu `EmptyState` care spune din ce pas vin** — regula „un link care duce altundeva decât spune e mai rău decât unul care spune că încă nu e gata".

**Teren** — nimic în pasul ăsta. Șeful de șantier vede pachetul abia la pasul 13, prin `Verificare SL`.

Ecranele se lucrează cu **agentul de design**.

---

## 4. Reguli care nu se negociază

1. **Materialul nu intră în pachet.** Trigger în bază, nu filtru în ecran.
2. **Izolarea A-față-de-B se face cu RLS**, cu `app.current_subcontractor_id()`. Niciun `where subcontractor_id = ?` scris de mână în serviciu ca unic strat.
3. **Subcontractantul vede prețul pachetului lui.** Nu-l ascunde „pentru siguranță" — negociază pe el, iar un portal fără prețuri e un portal inutil.
4. **Parola temporară se arată o singură dată.** Nu se loghează, nu se persistă în clar, nu se retrimite.
5. **Fără MFA pe `app_subcontractor`** (decizia utilizatorului). Schimbarea parolei la prima intrare e obligatorie.
6. **Semnarea scrie în registrul de cost, în aceeași tranzacție, cu `charged_*` completat.** Un pachet semnat fără linie de cost — sau cu una fără componentă, deci în afara rollup-ului — e o depășire de buget invizibilă.
7. **Anularea produce storno, nu `update`.**

## 5. Ce NU faci în pasul ăsta

- **Nu construi situațiile de lucrări** — pasul 13. Pachetul se oprește la „semnat".
- **Nu construi garanțiile.** `retention_pct` e o coloană pe `packages` care se **completează**, dar nimeni nu reține nimic încă — pasul 14.
- **Nu construi facturarea** — faza 5.
- **Nu trimite email către subcontractant.** Nu există flux de invitații (§10.3). Datele de intrare le dă PM-ul, verbal sau cum vrea el.
- **Nu adăuga materiale în pachet „ca opțiune".** Nu e o preferință, e o regulă de business.
- Nu inventa coduri `AppError` noi.

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Grupezi 8 linii din devizul intern într-un pachet „electric" | pachet în `draft`, cu 8 linii și totalul lor |
| 2 | Încerci să adaugi o linie cu `material_cost > 0` | **triggerul refuză**, cu mesaj în română care spune de ce |
| 3 | Idem, prin `insert` direct din `psql`, ca `app_office` | **refuzat la fel** — triggerul, nu serviciul, e apărarea |
| 4 | Inviți 3 subcontractanți la același pachet | 3 rânduri în `package_offers`, toate `invitat` |
| 5 | Subcontractantul A intră în portal | vede **doar** pachetul lui, cu prețuri |
| 6 | A încearcă să deschidă pachetul lui B, cu id-ul în URL | `NOT_FOUND` — RLS nu întoarce rândul. **Nu 403**: existența lui nu trebuie confirmată |
| 7 | `select * from app.packages` din rolul `app_subcontractor` al lui A | doar rândurile lui, zero de la B |
| 8 | A ofertează 4 linii din 8, cu comentariu pe două | `package_offer_lines` are 4 rânduri; restul rămân la prețul propus |
| 9 | PM-ul compară ofertele | vede cele 3, linie cu linie, cu diferența față de prețul lui |
| 10 | PM acceptă oferta lui A și semnează | pachet `semnat`, `subcontractor_id` completat, celelalte 2 oferte trec pe `respins` |
| 11 | Verifici registrul de cost după semnare | **o linie `angajat`**, `servicii_subc`, cu suma pachetului, `document_id` = pachetul și **`charged_*` completat** |
| 12 | Anulezi pachetul semnat | linie de storno în minus; linia inițială rămâne neatinsă |
| 13 | Rollup-ul de plafon după semnare | consumul „angajat" crește cu suma pachetului |
| 14 | PM asignează un subcontractant fără cont | contul se creează, parola temporară apare **o dată**, pe ecran |
| 15 | Reîncarci ecranul de la #14 | parola **nu mai apare** nicăieri |
| 16 | Intri cu contul nou | ești dus obligatoriu pe schimbarea parolei; orice altă rută redirectează |
| 17 | Cauți parola temporară în loguri | **nu există** |
| 18 | `select unit_price from app.package_lines` din `app_field` | **eroare de privilegiu** |
| 19 | Șeful de șantier citește `v_package_lines_field` | cantitățile vin; câmpul de preț nu există nici în tipul TypeScript |
| 20 | Portalul: deschizi `Garanții reținute` | `EmptyState` care spune că vine la pasul 14 |
| 21 | Testul generic de coloane cu preț | trece, cu `package_lines` acoperită |
| 22 | Un subcontractant încearcă orice rută de birou | redirect, nu 500 |

## 7. Definiția de „gata"

- Toate cele 22 de verificări trec. **5, 6, 7, 18 și 21 sunt blocante în CI** — sunt izolarea.
- Există un test care rulează pasul 8 **din rolul `app_subcontractor`**, cu `subcontractorId` din sesiune, pe date reale. Nu din `officeActor()` — regula 2 din `PROGRESS.md` a costat un pas întreg.
- `docs/` capătă o pagină scurtă despre provizionarea de conturi și ce se întâmplă cu parola.
- `PROGRESS.md` are intrarea pasului.

---

## Sub-pași

| Sub-pas | Ce | Verificări |
|---|---|---|
| **12a** | Migrarea `0043`, triggerul de material, RLS-ul, view-ul de teren, serviciile. **Rulat din `app_subcontractor` pe date reale înainte de orice ecran.** | 1–4, 7, 18, 19, 21 |
| **12b** | Portalul: `Pachetele mele`, ofertarea linie cu linie, meniul cu `EmptyState`-urile celorlalte. Migrarea `0044` (provizionarea) și middleware-ul de parolă. | 5, 6, 8, 14–17, 20, 22 |
| **12c** | Ecranul de birou: comparația ofertelor, acceptarea, semnarea, linia de cost `angajat`, stornarea. Migrarea `0045` dacă `document_type` cere valoare nouă. | 9–13 |

**Ordinea nu e negociabilă.** 12b înaintea lui 12c dinadins: dacă izolarea nu ține, afli înainte să existe bani în joc.
