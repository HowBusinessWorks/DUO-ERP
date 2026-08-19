# Pasul 10 — Aplicația de teren (PWA offline) și raportul lunar către client

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** oamenii din teren lucrează fără semnal, în subsoluri și guri de canal, iar clientul primește la sfârșit de lună raportul pe baza căruia plătește. Cu asta, faza de mentenanță e completă cap-coadă.
> **Ăsta e pasul cu cel mai mare risc din proiect** — nu tehnic, ci de **adopție**.

---

## 0. Context (de ce e riscant și ce contează de fapt)

### Bugetul de tapuri

Regula care decide dacă tot sistemul funcționează sau nu: **dacă șeful de șantier are nevoie de 7 tapuri ca să comande material, dă telefon la magazie** — și toată trasabilitatea rămâne goală. Baza de date e perfectă și complet inutilă.

**Ținta e 3 tapuri.** Și se **măsoară**: fiecare acțiune frecventă are un test Playwright care numără interacțiunile până la salvare și **eșuează la peste 4**. E singurul mod în care o cerință de UX rămâne adevărată după 6 luni de features.

### Offline nu e o opțiune

Inspecțiile se fac în subsoluri, stații de pompare și guri de canal. Nu există semnal. Deci: **ID-uri generate pe client (UUID v7), outbox idempotent, coadă separată pentru poze.**

Am ales **outbox propriu peste IndexedDB (Dexie)**, nu un motor de replicare (PowerSync/ElectricSQL), din patru motive:
1. felia de date a terenului e mică și bine delimitată (UL-urile mele active, checklist-urile lor, gestiunea echipei) — câteva mii de rânduri;
2. **scrierile sunt oricum custom** — regulile de business trebuie să ruleze pe server, iar orice motor te pune să scrii singur uploader-ul de mutații;
3. izolarea prețului ar cere reguli de sincronizare care exclud coloane — protecție în două locuri, care pot diverge;
4. un vendor în plus, pentru ~20 de utilizatori.

**Escape hatch documentat:** dacă felia crește necontrolat, PowerSync se poate adăuga **pentru citiri**, fără să schimbe push-ul.

### Zero lei

Pe **toate** ecranele de teren, la nivel de date, nu de afișare. Aplicația de teren consumă **view-uri per persona** care nu conțin coloane de preț — TypeScript-ul nu cunoaște câmpul.

### Raportul lunar

**Banii se primesc în baza raportului.** Deci e modul de sine stătător, nu un export. Sute de poze × zeci de fișe → generare obligatoriu **asincronă**, raport **versionat și înghețat la emitere**. Modificările ulterioare ale fișelor apar în luna următoare ca ajustare — **nu rescriu raportul trimis**.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §11 (integral: arhitectura offline, mutații, conflicte, media, bugetul de tapuri), Anexa C.13 (raport lunar), C.14 (sincronizare) |
| `Damina_Aplicatie_Structura_Functionala.md` | §26 (aplicația de teren, cele 8 ecrane), §15.2 (raportul lunar), §20 (luna de mentenanță), §30 regula 12 |
| `DaminaStructuraCapCoada FInal.md` | §20.1 (raportul lunar ca modul), §24.1 (consecința celor 7 tapuri) |

## 2. Precondiții

Din pașii 01–09: RLS + **view-uri per persona fără coloane de preț**, file management cu presign multipart, UL cu asignări, inspecții/intervenții/pontaj/bon de consum funcționale online, cereri și backlog, registrul de cost, notificări, worker pg-boss.

---

## 3. Ce livrezi

### 3.1 Arhitectura offline

```
┌─ Service Worker (Workbox) ────────────────────────────────┐
│  precache shell + rute; network-first pe date,            │
│  cache-first pe assets. Fără logică de business           │
└───────────────────────────────────────────────────────────┘
┌─ IndexedDB (Dexie) ───────────────────────────────────────┐
│  snapshot — felia mea de date (read model, DOAR cantități)│
│  outbox   — mutații în așteptare, ordonate, idempotente   │
│  media    — poze/video în așteptare, cu progres per parte │
└───────────────────────────────────────────────────────────┘
┌─ Sync engine ─────────────────────────────────────────────┐
│  pull:  GET  /api/field/sync?since=<cursor>               │
│  push:  POST /api/field/sync  { mutations[] }             │
│  media: canal separat, prioritate mai mică decât datele   │
└───────────────────────────────────────────────────────────┘
```

**Felia de date** trebuie să rămână **sub ~2 MB comprimat**. Se monitorizează; dacă crește, se restrânge fereastra temporală (UL active + ultimele 30 de zile).

### 3.2 Mutații și idempotență (migrarea `0023_field_sync`)

```ts
type Mutation = {
  id: string;              // UUID v7 generat pe client — cheie de idempotență
  type: 'inspection.save' | 'intervention.save' | 'material.request'
      | 'journal.append' | 'timesheet.save' | 'consumption.save'
      | 'sl.verify-line' | 'equipment.request' | 'equipment.observation';
  payload: unknown;        // validat cu ACEEAȘI schemă Zod ca use-case-ul
  baseVersion?: number;
  createdAt: string;
  attempts: number;
};
```

```sql
app.applied_mutations (id uuid pk,           -- = mutation.id de pe client
                       person_id, device_id text, type text,
                       applied_at timestamptz, result jsonb, error_code text,
                       index (person_id, applied_at desc));
app.sync_cursors (person_id, device_id text, last_pulled_at, last_cursor text,
                  primary key (person_id, device_id));
```

- Un `POST` cu un `id` deja aplicat **întoarce rezultatul memorat**, fără să reexecute. Retry-ul e sigur prin construcție — obligatoriu când conexiunea cade la jumătatea request-ului în subsol.
- **Ordinea:** mutațiile se aplică în ordinea creării, **secvențial per dispozitiv**. Dacă una eșuează cu eroare de business (nu de rețea), **coada se oprește** și apare ecranul de conflicte — nu se sare peste ea, pentru că cele ulterioare pot depinde de ea.
- Retenție `applied_mutations`: 90 de zile. Un dispozitiv care revine după 90 de zile face pull complet.
- Rate limiting pe `/api/field/sync`.

### 3.3 Conflicte

| Situație | Politică |
|---|---|
| Fișă în draft, editată doar de mine | last-write-wins, fără conflict |
| Fișă validată la birou între timp | server-authoritative → conflict afișat, cu diff, cu opțiunea „duplică ca fișă nouă" |
| Linie de SL verificată de altcineva | server câștigă, notificare |
| Perioadă închisă între creare și sync | `PERIOD_CLOSED` → fișa rămâne, se propune `data_efect` în luna curentă |
| Cantitate peste contractat | blocaj, cu propunerea de suplimentare |

**Ecranul de conflicte e obligatoriu și proiectat**, nu improvizat. Regula „nu există ecran fără stare goală" se aplică și aici.

### 3.4 Media

Coadă separată, **prioritate mai mică decât datele**. Poza se comprimă pe dispozitiv (max 2000 px, JPEG q80) **după** extragerea geotag-ului, se stochează în IndexedDB, se urcă în fundal, în loturi mici, cu **retry per parte** (folosește presign-ul din pasul 07).

Contorul „⚠ 4 de sincronizat" **numără separat datele și pozele** — dacă omul vede „4 de sincronizat" și sunt doar poze, nu intră în panică.

**Nicio poză nu se pierde dacă aplicația e închisă** — coada e în IndexedDB, nu în memorie.

### 3.5 Cele 8 ecrane de teren

Ecranul de start e **o listă de ce am eu azi**, nu un meniu:

```
┌─────────────────────────────┐
│  AZI · 14 august            │
│  🏗 L-233 Berceni           │
│     etapa 2 · 3 oameni      │
│  🔧 Intervenția #1852       │
│     Glina · de făcut        │
│  🚜 EXC-01 la tine          │
│     PV deschis din 12.08    │
│  📋 2 linii de verificat    │
│  ⚠ 4 de sincronizat         │
└─────────────────────────────┘
                    [ ＋ ]
```

Butonul ＋ deschide **cele 4 acțiuni frecvente**: Necesar material · Fișă de intervenție · Adaugă în jurnal · Solicită utilaj.

| Ecran | Stare în pasul ăsta |
|---|---|
| `Azi` | complet |
| `Inspecție` | complet (checklist offline, NOK cu ieșire obligatorie, poze) |
| `Intervenție` | complet (materiale din gestiunea echipei, ore, poze înainte/după) |
| `Jurnal` | complet (text + poze pe etapă) — livrat la 10c-4, tabela `app.journal_entries`, migrarea `0033`, **3 tapuri** |
| `Necesar material` | complet, **în 3 tapuri** (cererea ajunge în coada de birou; procesarea e faza 3) |
| `Bon de consum` | **SCOS din pasul 10** (decizia utilizatorului, 19 august 2026). Emiterea bonului citește CMP-ul gestiunii și scrie în registrul de cost — terenul ar fi trebuit să poată citi prețuri, adică exact ce interzice regula 2 de mai sus. Consumul pleacă de pe teren **prin fișa de intervenție**, iar biroul îl materializează la validare: drum care există și e testat. Ce se pierde, spus pe față: consumul NElegat de o intervenție nu se poate emite de pe teren. |
| `Pontaj` | complet (ziua împărțită pe mai multe UL) |
| `Utilaje și PV` | schelet cu `EmptyState` — faza 4 |
| `Verificare SL` | schelet cu `EmptyState` — faza 2 |

**Un singur login, un singur clopoțel, o singură coadă de sincronizare.** Nu module separate.

**Geotag + timestamp automat pe fiecare poză.** La 700 de obiective, e singura dovadă că inspecția s-a făcut acolo.

### 3.6 Raportul lunar către client (migrarea `0024_monthly_reports`, numerotată `0034` în lanțul real — **livrat**)

```sql
app.monthly_reports (id uuid pk, contract_id, period_id,
                     status text,        -- building|review|approved|frozen|sent
                     template_id, approved_by, approved_at, frozen_at,
                     unique (contract_id, period_id));

app.monthly_report_versions (id uuid pk, report_id, version smallint,
                             pdf_node_id uuid, web_token text,
                             included_work_unit_ids uuid[],
                             photo_count integer, size_bytes bigint,
                             generated_at, generated_by, unique (report_id, version));
```

Ecran:

```
RAPORT LUNAR · Contract 4700 · August 2026            Stare: în construcție
Fișe incluse       47 inspecții · 12 intervenții · 3 jurnale de lucrare
Poze               312 (comprimate)
Neincluse ⚠        3 fișe nevalidate  [Vezi]
Șablon             Apa Nova — cu branding client
[Generează] → asincron → [Aprobă intern] → [Îngheață și trimite]
```

- Generarea e **coada `reports.monthly`** în worker, cu **progres raportat** (`job_progress`): ecranul arată „312 din 480 poze", nu un spinner.
- Raportul e **versionat și înghețat** la emitere; artefactul intră în `damina-archive` și ca nod în folderul contractului.
- **Alternativa la PDF de 400 MB: raport web interactiv cu link tokenizat.** Obligatoriu pentru contractele cu multe poze.
- Fișele nevalidate se numără explicit ca „neincluse", cu link. Nu dispar tăcut.
- Butonul de emitere a facturii de mentenanță e **blocat până raportul e generat și aprobat intern** (regula există; ecranul de facturare e faza 5, dar blocajul se implementează ca precondiție acum).

### 3.7 Panoul PM cu gauge-ul Delta

Se completează dashboard-ul PM (structura există din pasul 03), acum cu date reale:
- **Delta — grad de umplere**, ca gauge care **se umple**, cu lei liberi și **contorul de zile rămase din lună**;
- contractele mele cu grad de consum;
- de aprobat (fișe, pontaje);
- lucrări în risc (consum % > progres %).

---

## 4. Reguli care nu se negociază

1. **3 tapuri**, măsurat automat. Peste 4 → test roșu.
2. **Zero lei pe teren**, la nivel de date. Aplicația consumă view-uri fără coloane de preț.
3. **ID-urile se generează pe client.** Fără remapare la upload.
4. **Fiecare mutație e idempotentă**, cu rezultat memorat.
5. **Coada se oprește la prima eroare de business**, nu sare peste.
6. **Pozele au prioritate mai mică decât datele**, dar nu se pierd niciodată.
7. **Raportul înghețat nu se rescrie.** Corecțiile apar luna următoare ca ajustare.
8. **Generarea raportului e asincronă**, cu progres real.
9. **Fără notificări către teren pentru vederi de birou.** Inspecțiile nu notifică pe nimeni.

## 5. Ce NU faci în pasul ăsta

- Nu implementezi utilajele și PV-urile (faza 4) — ecranul e schelet.
- Nu implementezi verificarea de SL (faza 2) — ecranul e schelet.
- Nu construiești facturarea și e-Factura (faza 5).
- Nu adaugi PowerSync sau alt motor de replicare. Escape hatch-ul e documentat, nu implementat.
- Nu implementezi push notifications native (faza 2) — notificările în aplicație sunt suficiente.

## 6. Verificare

### Offline (testat cu rețeaua oprită de tot, nu doar throttled)

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Închizi rețeaua, deschizi aplicația | ecranul `Azi` se încarcă din snapshot, cu toate UL-urile mele |
| 2 | Completezi o inspecție cu 12 puncte și 5 poze, offline | se salvează local; contorul arată „1 fișă + 5 poze de sincronizat", **separat** |
| 3 | Închizi complet browserul, redeschizi | fișa și pozele sunt intacte |
| 4 | Repornești rețeaua | datele urcă primele, apoi pozele; contorul scade la 0 |
| 5 | Întrerupi rețeaua în timpul push-ului, apoi o repornești | mutațiile se reiau; **niciun duplicat** în DB (verifică `applied_mutations`) |
| 6 | Trimiți manual aceeași mutație de 3 ori | un singur efect; răspunsurile 2 și 3 sunt cele memorate |
| 7 | Creezi 3 fișe offline, a doua eșuează cu eroare de business | coada **se oprește la a doua**; a treia nu se aplică; apare ecranul de conflicte |
| 8 | Fișă editată offline, validată la birou între timp | conflict afișat **cu diff**, cu opțiunea „duplică ca fișă nouă" |
| 9 | Luna se închide între creare și sync | `PERIOD_CLOSED` explicat în română, cu propunerea de `data_efect` în luna curentă; fișa **nu se pierde** |
| 10 | Măsori felia de date sincronizată | **< 2 MB comprimat** |
| 11 | Dispozitiv care revine după 91 de zile | face pull complet, fără eroare |

### Bugetul de tapuri (Playwright, blocant în CI)

| # | Acțiune | Prag |
|---|---|---|
| 12 | Necesar material, de la `Azi` până la salvare | **≤ 3 tapuri** |
| 13 | Fișă de intervenție, până la salvare | ≤ 4 |
| 14 | Adaugă în jurnal cu poză | ≤ 4 |
| 15 | Pontaj pentru o zi | ≤ 4 |

### Teren — corectitudine

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 16 | Inspectezi orice ecran de teren, în DOM | **niciun câmp de preț**, nicăieri; query-ul pe view-ul de bază nici nu compilează |
| 17 | Faci o poză din aplicație | geotag + timestamp atașate; după sync, `geo_source` corect pe `file_versions` |
| 18 | NOK pe checklist, offline | ieșirea obligatorie e impusă **și local**, nu doar pe server |
| 19 | Consumi din gestiunea echipei mai mult decât ai | blocat la sync, cu sold afișat; fișa rămâne editabilă |

### Raportul lunar

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 20 | Generezi raport cu 47 inspecții, 12 intervenții, 312 poze | asincron; ecranul arată progres real („X din 480"), nu spinner |
| 21 | 3 fișe nevalidate în lună | apar ca „neincluse ⚠" cu link, nu dispar tăcut |
| 22 | Aprobi și îngheți raportul | versiune 1 înghețată, artefact în `damina-archive` și nod în folderul contractului |
| 23 | Modifici o fișă din luna raportată, după îngheț | **raportul nu se schimbă**; modificarea apare în luna următoare ca ajustare |
| 24 | Regenerezi după îngheț | apare **versiunea 2**, versiunea 1 rămâne intactă și accesibilă |
| 25 | Deschizi raportul web prin link tokenizat | funcționează fără cont; linkul expiră conform politicii |
| 26 | Rulezi jobul de două ori pe același raport | `singletonKey` previne al doilea PDF |

### Panou PM

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 27 | Delta la 67% pe 14 august | gauge care **se umple**, „4.100 lei liberi", „mai sunt 17 zile", link în backlog |
| 28 | Lucrare cu consum 68% și progres 62% | apare în „Lucrări în risc" |

## 7. Definiția de „gata"

- Toate cele 28 de verificări trec; **12–15 (tapurile) și 5–6 (idempotența) sunt blocante în CI**.
- Test E2E complet al lunii de mentenanță: „inspecții offline → sync → validare la birou → costuri în registru → raport lunar generat și înghețat → luna se închide".
- Felia de date e monitorizată în producție (metrică, nu presupunere).
- `docs/field-sync.md` documentează: cum se adaugă un tip nou de mutație, cum se depanează o coadă blocată, cum se forțează un pull complet.
- **Cu asta, faza 1 e completă.** Următoarea serie de pași acoperă fazele 2–5: devize și situații de lucrări, achiziții și stoc, flotă și procese verbale, facturare și consolidare.
