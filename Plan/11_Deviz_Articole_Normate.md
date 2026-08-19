# Pasul 11 — Devizul și biblioteca de articole normate

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** o lucrare are deviz — cel al clientului, versionat, și cel intern, al PM-ului — iar cele două sunt legate linie cu linie. Fără pasul ăsta, faza 2 n-are de unde porni: pachetele de subcontractant ies din devizul intern, iar situațiile de lucrări urcă la client prin maparea dintre ele.
> **Primul pas al fazei 2.** Precondiția lui e faza 1 completă.

---

## 0. Context de business (esențial)

### Două devize, și doar unul se versionează

| | Deviz Client (Oferta) | Deviz Intern (al PM-ului) |
|---|---|---|
| Cine îl face | devizist / ofertare | manager de proiect |
| Pentru | ce vede clientul | ce trebuie făcut efectiv |
| Granularitate | 5 poziții sau 500, cum cere cazul | detaliat: material, manoperă, utilaj, transport |
| Material/manoperă | uneori la comun | **întotdeauna separate** |
| Indirecte + profit | da, ca pachet procentual | nu — doar cost direct |
| Versionare | **da, obligatorie** | **nu** |

**Regula care simplifică tot modulul: devizul intern nu ajunge NICIODATĂ la client** (§8.1). E document strict intern. Consecințe practice, toate în favoarea ta: nu are nevoie de versionare oficială, nu are format de export către client, iar PM-ul îl modifică liber în timpul lucrării, fără nicio aprobare externă. **Singurul lucru care se versionează e devizul client.**

Nu inversa asta „ca să fie simetric". Simetria ar costa o tabelă de versiuni întreținută degeaba și un flux de aprobare pe un document pe care nu-l vede nimeni din afară.

### Legătura e N:M, și e motivul pentru care există pasul

O poziție din devizul client se poate sparge în 5 poziții interne; sau 3 poziții client pot corespunde uneia interne. Tabela de mapare (`poziție_client`, `poziție_internă`, `coeficient`) e **ce permite ca declarația de cantitate a subcontractantului să urce automat în situația de lucrări către client** (§8.1, §12.2 pasul 6a).

Fără mapare, lanțul se rupe exact la capăt: ai cantități declarate și aprobate pe intern, și nimic care să le ducă la client.

Când devizul client e deja bine făcut, PM-ul apasă **„preia ca deviz intern"** și maparea iese 1:1.

### Cele patru moduri de a porni un deviz

Toate produc **aceeași structură**. Sunt **patru importatoare, nu patru tipuri de deviz** (§8.2). Nu modela un `kind` per mod de start.

1. **Șablon pe tip de obiectiv** (SH, bazin, rezervor, filtru, stație) — poziții pre-normate, setezi cantitățile.
2. **Copiere din proiect anterior** — alegi o lucrare similară, se clonează devizul, ajustezi.
3. **Bibliotecă de articole normate** — articole proprii, refolosibile, fiecare cu material + manoperă + normă de timp.
4. **Import Excel** — pentru cazuri exotice, cu mapare de coloane. **Testat deja pe fișiere reale**, inclusiv cu celule combinate (§10.3) — deci e viabil, nu teoretic.

**Modul 3 e ținta.** De fiecare dată când cineva face un deviz prin 1, 2 sau 4, sistemul îi propune să salveze pozițiile noi ca articole în bibliotecă. Așa biblioteca crește singură, în loc să depindă de un proiect de „normare" care nu se face niciodată.

### Cine vede prețul din deviz

Tabelul din §10.3, care e model validat în teren, nu ipoteză:

| | PM | Șef de șantier | Subcontractant |
|---|---|---|---|
| Prețuri | vede tot | **nu vede deloc** | vede (negociază pe el) |
| Deviz (categorii, operațiuni) | creează, editează | **nu vede** | vede **doar pachetul lui** |

**Atenție la o contradicție reală între documente.** `PLAN_TEHNIC` §4.4 dă ca exemplu ilustrativ `GRANT SELECT (id, deviz_id, code, name, uom, quantity …) ON app.deviz_lines TO app_field`. §10.3 din business spune că șeful de șantier **nu vede devizul deloc**.

**Câștigă business-ul** (ordinea de autoritate din `00_README.md`: business > funcțional > tehnic). Deci: **`app_field` nu primește niciun grant pe tabelele de deviz.** §4.4 rămâne corect ca descriere a *mecanismului*; doar exemplul lui e ales nefericit. Terenul își ia cantitățile din `v_sl_lines_field` și `v_package_lines_field`, care vin la pașii 12 și 13.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §8 integral (devizul), §10.3 (modelul validat, tabelul de vizibilitate), §9 (etape și buget) |
| `Damina_Aplicatie_Structura_Functionala.md` | §12.1 (devizul ca ecran, bara de trasabilitate), §17 (biblioteca de articole normate) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §4.4 (izolarea prețului — mecanismul), Anexa D.3 (inventarul de tabele) |
| `Plan/PROGRESS.md` | secțiunea de predare + „Reguli ale casei care nu se negociază" |

## 2. Precondiții

Verifică-le la început și **oprește-te dacă lipsesc**:

- Faza 1 completă (pașii 01–10), inclusiv 10d — raportul lunar.
- `app.work_units` cu tipul `lucrare` și `app.work_stages` cu `material_budget` / `labor_budget` — **există din pasul 05, nu le recrea.**
- `app.products`, `app.qualifications` (nomenclatoare, pasul 03).
- Cele trei straturi de izolare a prețului, din migrarea `0012_price_isolation.sql`.
- `entityRegistry` și pagina fractală (pasul 03) — vezi `docs/entity-registry.md`.

**Numerele de migrare rezervate fazei 2: `0040`–`0069`.** Pasul ăsta ia `0040`–`0042`.

---

## 3. Ce livrezi

### 3.1 Schema (migrarea `0040_devize`)

```
devize                     → work_unit_id, kind: client|intern, status, company_id
                             unique (work_unit_id, kind) — o lucrare are cel mult
                             un deviz client si cel mult unul intern
deviz_versions             → istoricul devizului CLIENT. version smallint,
                             frozen_at, frozen_by, lines jsonb (copia liniilor la
                             inghetare), unique (deviz_id, version)
deviz_categories           → arbore pe DOUA niveluri: categorie -> operatiune.
                             parent_id self-ref, position, name
deviz_lines                → pozitiile. AICI STAU COLOANELE DE PRET
deviz_line_mappings        → N:M client <-> intern, cu coefficient numeric(10,4)
```

Coloanele de preț pe `deviz_lines`, toate `numeric(14,2)`: `unit_price`, `material_cost`, `labor_cost`, `equipment_cost`, `transport_cost`, `total`. Indirectele și profitul stau la nivel de **deviz**, ca procent (`indirect_pct`, `profit_pct`), și **doar pe cel client** — un `check` care le refuză pe `kind = 'intern'`.

Coloanele fără preț: `id`, `deviz_id`, `category_id`, `position`, `code`, `name`, `uom`, `quantity`, `stage_id`, `normed_article_id`.

**Grant-uri:**

- `app_office`: tot, filtrat de RLS pe firmă + rol de business.
- `app_field`: **nimic.** Vezi §0 mai sus.
- `app_subcontractor`: **nimic.** Vede pachetul, la pasul 12, nu devizul.
- `app_service`: citire, pentru joburi.

RLS pe toate cele cinci, cu tiparul „scoped pe firmă" prin `work_units → company_id`.

### 3.2 Biblioteca de articole normate (migrarea `0041_normed_articles`)

```
normed_articles            → company_id, code (unic pe firma), name, uom,
                             is_active, created_by
normed_article_components  → article_id, kind: material|manopera|utilaj|transport,
                             product_id?, qualification_id?, quantity_per_uom,
                             norm_hours numeric(10,4)
deviz_templates            → name, objective_kind (text, aceeasi conventie ca
                             `checklists.objective_kind`), source_deviz_id
```

**`deviz_templates` nu-și ține propriile linii.** Un șablon arată către un deviz care servește ca tipar (`source_deviz_id`). Alternativa — a doua copie a structurii de linii — ar fi însemnat două locuri de întreținut și două formate care divergeau la prima schimbare de coloană.

`normed_articles` are nevoie de **numărul de folosiri și lucrările în care apare** (§17 funcțional: „ecranul arată pentru fiecare articol de câte ori a fost folosit și în ce lucrări — ca să se vadă că merită întreținută"). Se calculează din `deviz_lines.normed_article_id`, **nu se ține ca și contor denormalizat** — un contor s-ar desincroniza tăcut, și e exact cifra care justifică întreținerea bibliotecii.

### 3.3 Domain (`packages/domain/src/deviz/`)

Funcții pure, cu teste unitare, fără Postgres:

- `rollupDeviz(lines, indirectPct, profitPct)` → totaluri pe categorie, pe operațiune, pe deviz. Cu `Money`, niciodată `number`.
- `explodeNormedArticle(article, components, quantity)` → liniile care rezultă din punerea unui articol normat în deviz.
- `validateMapping(clientLines, internLines, mappings)` → ce poziții client n-au acoperire și ce coeficienți nu însumează 1. **Nu blochează** — raportează. O mapare incompletă e o stare de lucru normală în timpul redactării.
- `deriveOneToOne(clientLines)` → maparea 1:1 pentru „preia ca deviz intern".

### 3.4 Servicii (`packages/services/src/deviz.ts`)

`createDeviz` · `updateDevizLine` · `moveLine` · `freezeClientDeviz` (produce `deviz_versions`) · `adoptAsInternal` · `mapLines` · `unmapLines` · `saveAsNormedArticle` · `listNormedArticles` (cu numărul de folosiri).

**`freezeClientDeviz` e singura operație ireversibilă din pas** — cere motiv scris, ca plafoanele la 04.

### 3.5 Ecrane

**Nu scrie fișiere de pagină.** Un modul nou = o intrare în `entityRegistry` (regula casei). Devizul e un tab pe UL-ul de tip `lucrare`, plus `articole-normate` ca modul de nomenclator de sine stătător — intrarea lui există deja în `navigation.ts` cu `phase: 2`, i se schimbă doar faza pe `0`.

**Editorul de deviz** (§12.1): coloane cod articol · denumire · UM · cantitate · material · manoperă · utilaj · transport · total. La cel client, indirectele și profitul apar ca pachet procentual la final.

**Panoul de mapare N:M**, lateral: pentru poziția selectată din devizul client, ce poziții interne o compun și cu ce coeficient.

**Bara de trasabilitate**, permanentă pe linia selectată (§8.4, §12.1):

```
Poziția: Hidroizolație bituminoasă 2 straturi · 340 mp
Ofertat 18.700 · Estimat cost 13.200 · Comandat — · Consumat 9.800
Declarat subc. — · Aprobat — · Facturat client —
```

Câmpurile care încă n-au sursă (comandat = faza 3; declarat/aprobat/facturat = pașii 12–14) **se afișează cu liniuță, nu se ascund**. Un rând care apare abia peste două faze învață omul de două ori.

Ecranele se lucrează cu **agentul de design** — cerință explicită a utilizatorului, scrisă în regulile casei.

### 3.6 Cele patru importatoare

Un singur serviciu, `startDeviz(source)`, cu patru surse. Nu patru fluxuri.

| Mod | Ce face |
|---|---|
| Șablon | clonează `source_deviz_id` al șablonului, cu cantitățile golite |
| Copiere | clonează devizul altei lucrări, cu cantitățile păstrate |
| Bibliotecă | linie goală + căutare în `normed_articles`, cu explozia componentelor |
| Excel | `deviz_import_batches` + mapare de coloane — **sub-pasul 11c** |

**Importul Excel e sub-pas separat, la final, dinadins**: cere o dependență nouă (parser de `.xlsx`) și e singura bucată care se poate tăia fără să rămână altceva neterminat.

---

## 4. Reguli care nu se negociază

1. **Devizul intern nu se versionează și nu se exportă către client.** Nicio rută, niciun PDF, niciun link tokenizat.
2. **Bani în `numeric(14,2)` și `Money`.** Niciodată `float` sau `number`.
3. **`app_field` și `app_subcontractor` nu primesc niciun grant pe tabelele de deviz.**
4. **Coloanele de preț se acordă enumerat, nu prin `grant select` pe tabelă.** Testul generic din CI care enumeră `information_schema.columns` trebuie să treacă fără excepții adăugate.
5. **Un deviz client înghețat nu se mai modifică.** Modificarea produce versiunea următoare.
6. **Maparea N:M nu se impune la salvare.** Se raportează ce lipsește; blocajul apare abia la pasul 14, când se derivă SL-ul către client.
7. **Migrările se generează cu `pnpm db:generate`**, apoi se completează dedesubt de mână cu RLS, grant-uri și triggere. Nu se scriu de mână când schimbă tabele.

## 5. Ce NU faci în pasul ăsta

- **Nu creezi pachete de subcontractant** — pasul 12.
- **Nu creezi situații de lucrări** — pasul 13.
- **Nu atingi `work_stages`** — există din pasul 05, completă.
- **Nu scrii linii în registrul de cost.** Un deviz e o estimare, nu o cheltuială. Prima linie de cost din faza 2 apare la pasul 12, când se semnează un pachet (`stage = 'angajat'`).
- **Nu construi Gantt-ul** — pasul 15.
- **Nu adăuga `necesar de material` din deviz** — pasul 15, cu `stage_id`.
- Nu inventa coduri `AppError` noi. Lista e fixă și e în `PROGRESS.md`.

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Creezi deviz client cu 3 categorii × 2 operațiuni × 4 poziții | totalurile pe categorie și pe deviz dau, la ban, cu suma liniilor |
| 2 | Setezi indirecte 8% și profit 12% pe devizul client | totalul crește compus, în ordinea indirecte → profit, și se vede desfășurat |
| 3 | Încerci să setezi indirecte pe devizul **intern** | `check`-ul din bază refuză; serviciul dă `VALIDATION_FAILED` cu mesaj în română |
| 4 | „Preia ca deviz intern" pe un deviz client cu 12 poziții | 12 poziții interne, 12 mapări cu coeficient 1, într-o singură tranzacție |
| 5 | Spargi o poziție client în 3 interne, cu coeficienți 0,5 / 0,3 / 0,2 | maparea acceptă; panoul lateral arată cele trei cu coeficienții lor |
| 6 | Lași o poziție client nemapată | `validateMapping` o raportează, salvarea **merge** (regula 6) |
| 7 | Îngheți devizul client, apoi îl modifici | apare versiunea 2; versiunea 1 rămâne citibilă, cu liniile ei |
| 8 | Îngheți fără motiv scris | respins |
| 9 | `select *` din `app.deviz_lines` din rolul `app_field` | **eroare de privilegiu**, nu rând gol |
| 10 | Idem din `app_subcontractor` | **eroare de privilegiu** |
| 11 | Testul generic de coloane cu preț, din CI | trece fără excepții noi în listă |
| 12 | Pui un articol normat cu 3 componente într-un deviz, cantitate 20 | 3 linii, cu cantitățile înmulțite corect; `normed_article_id` completat pe fiecare |
| 13 | Deschizi ecranul bibliotecii | fiecare articol arată de câte ori a fost folosit și în ce lucrări |
| 14 | Pornești deviz din șablon „stație de pompare" | structura vine, cantitățile sunt goale |
| 15 | Copiezi devizul altei lucrări | structura **și** cantitățile vin |
| 16 | Salvezi o poziție nouă ca articol normat | apare în bibliotecă, cu componentele deduse din linie |
| 17 | Import Excel cu celule combinate și coloane în altă ordine | maparea de coloane se face pe ecran; liniile intră corect (**11c**) |
| 18 | Import Excel cu o coloană nemapată obligatorie | respins înainte de a scrie ceva, cu lista coloanelor lipsă (**11c**) |
| 19 | Bara de trasabilitate pe o linie oarecare | „Ofertat" și „Estimat cost" au cifre; restul, liniuțe |
| 20 | Deschizi devizul unei lucrări din altă firmă | RLS nu întoarce nimic |

## 7. Definiția de „gata"

- Toate cele 20 de verificări trec. **9, 10 și 11 sunt blocante în CI** — sunt izolarea prețului.
- Testele de domeniu acoperă `rollupDeviz`, `explodeNormedArticle` și `validateMapping` fără Postgres.
- Cel puțin un test de integrare rulează **din rolul `app_office`, pe date reale**, nu doar din harness.
- `PROGRESS.md` are intrarea pasului, cu deciziile luate și capcanele găsite.

---

## Sub-pași

Tăiate ca o sesiune să nu se termine la jumătate — convenția care a mers la 08, 09 și 10.

| Sub-pas | Ce | Verificări |
|---|---|---|
| **11a** | Migrările `0040`–`0041`, domain-ul, serviciile, RLS-ul și grant-urile. **Rulat din rolul restrâns înainte de orice ecran.** | 1–13, 20 |
| **11b** | Editorul de deviz, panoul de mapare, bara de trasabilitate, modulul `articole-normate` | 14–16, 19 |
| **11c** | Importul Excel: `0042_deviz_import`, dependența de parser, ecranul de mapare a coloanelor | 17–18 |

**Regula care a plătit de treisprezece ori:** rulează fiecare use-case pe date reale, **din rolul restrâns**, înainte să scrii ecranul. La pasul ăsta rolul restrâns e `app_office` cu un rol de business fără drept financiar — verifică ce vede un PM față de un devizist.
