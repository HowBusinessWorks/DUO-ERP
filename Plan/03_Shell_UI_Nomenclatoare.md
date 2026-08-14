# Pasul 03 — Shell de navigare, pagina fractală, notificări, nomenclatoare

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** aplicația arată și se navighează ca produsul final, pe date reale de nomenclator. Shell-ul e recursiv, deci fiecare entitate adăugată în pașii următori primește pagina ei gratis.

---

## 0. Context minim

Damina = grup de 5 firme de construcții și mentenanță, 30–40 utilizatori, ERP intern. Există deja: monorepo Next.js 15 + Supabase + Drizzle, autentificare pe 4 personas (birou / teren / portal subcontractant / portal client), RLS, audit, perioade.

Structura de navigare e **fractală**: contract → lucrare → etapă → deviz au **aceeași anatomie de pagină**. Cine a învățat un nivel le-a învățat pe toate. Deci construim **un singur template parametrizat**, nu pagini separate.

Cele opt principii de interfață care determină tot:

- **I1.** O entitate = o pagină = un set de tab-uri. Nu există „ecranul de costuri" separat de obiectul lui.
- **I2.** Navigarea e fractală (un template, un registry de entități).
- **I3.** Orice cifră e clickabilă până la documentul sursă. Dacă un număr nu se poate desface, e bug de design.
- **I4.** Creezi lucruri din contextul lor, nu din meniu.
- **I5.** Aprobarea produce direct obiectul următor.
- **I6.** Banii se ascund la nivel de date, nu de ecran.
- **I7.** Fiecare listă are o stare „de rezolvat" — badge numeric în sidebar, care se golește prin acțiune.
- **I8.** Contextul de firmă și de lună e global, persistent, mereu vizibil.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `Damina_Aplicatie_Structura_Functionala.md` | §1–§6 (integral: principii, spații, meniu, anatomia paginii, bara de sus, panoul Legături), §17 (nomenclatoare), §28 (notificări), §30 (regulile de interfață obligatorii) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §7 (rutare, pagina fractală, caching, server actions, formulare), §13 (realtime și notificări), Anexa C.15 (tabele de notificări) |

## 2. Precondiții

Din pașii 01–02: monorepo funcțional, `withActor`, RLS activ, cele 4 route-group-uri cu verificare de persona, `packages/i18n` inițializat, `app.companies`, `app.persons`, `app.periods`, audit trail.

---

## 3. Ce livrezi

### 3.1 Design system minimal (`packages/ui`)

Nu un design system complet — **componentele pe care se sprijină regulile de interfață**:

`Button` · `Dialog` · `Table` (cu virtualizare pregătită) · `Tabs` · `Badge` · `ProgressBar` · `EmptyState` · `Card` · `Form` (react-hook-form + zodResolver) · `Select` · `DatePicker` · `Money` (afișare, cu semn și formatare ro-RO) · `Toast`.

Reguli implementate **o dată, în componentă**, nu per ecran:

- **`Dialog` nu se închide la click în afară.** `onInteractOutside: preventDefault`, confirmare pe `isDirty`. S-au pierdut date reale din cauza asta.
- **`EmptyState` e obligatoriu.** Nu există listă fără stare goală proiectată: explică ce e lista, cum se umple, cu butonul de acțiune. La 700 de obiective și 40 de utilizatori, multe liste sunt goale la început și **acolo se pierde adopția**.
- **`Money` nu acceptă `number`** — doar tipul `Money` din `packages/shared`.
- **Imaginile nu se decupează** în paginile de detaliu.

### 3.2 i18n (`packages/i18n`)

Dicționar `ro-RO` complet, cu diacritice. **Zero string-uri hardcodate în componente** — lint rule dacă e posibil. Codurile de eroare din `AppError` se mapează 1:1 pe mesaje: `PERIOD_CLOSED` → „Luna august este închisă și nu mai poate fi modificată."

Termenii de domeniu rămân în română și în cod: `deviz`, `aviz`, `nir`, `pontaj`, `situatie_lucrari`, `bon_consum`, `proces_verbal`, `delta`.

### 3.3 Shell-ul de birou — cele cinci benzi

```
┌──────────────────────────────────────────────────────────────────────┐
│ [1] Panou > Contracte > 4700 > Lucrări > L-233        🏢 Damina SRL  │
│                                          🔍  📅 Aug 2026  🔔7  ＋    │
├──────────────────────────────────────────────────────────────────────┤
│ [2] Contracte > Apa Nova 4700 > Lucrări > Hidroizolație bazin        │
│     ▌ L-233 · Hidroizolație bazin B2                                 │
│       [Lucrare] [În execuție] [Delta ×3 luni]                        │
│       Progres 62% ▓▓▓▓▓▓░░░░   Consumat 68% ▓▓▓▓▓▓▓░░░   ⚠ risc     │
├──────────────────────────────────────────────────────────────────────┤
│ [3] Prezentare │ Deviz │ Etape │ Jurnal │ Materiale⁴ │ Costuri │ …   │
├───────────────────────────────────────────────┬──────────────────────┤
│ [4] conținutul tab-ului activ                 │ [5] LEGĂTURI         │
└───────────────────────────────────────────────┴──────────────────────┘
```

- **[1] Bara globală** — breadcrumb de rută, selector de firmă, căutare, selector de perioadă, clopoțel, buton ＋. Nu dispare niciodată.
- **[2] Antetul entității** — breadcrumb **semantic** (nume, nu ID-uri), titlu, badge-uri de tip/status, metadate cheie și **maximum două bare de progres**. Restul indicatorilor stau în tab-uri.
- **[3] Tab-uri** — fațete ale aceleiași entități, cu badge numeric. **Tab-urile financiare lipsesc complet pentru rolurile fără drept, nu apar gri.**
- **[4] Conținut** — o singură treabă per tab.
- **[5] Legături** — colapsabil, deschis implicit pe desktop.

Antetul și breadcrumb-ul rămân **fixe la scroll**.

### 3.4 Sidebar-ul complet

Trei grupe: munca zilnică / biblioteci / configurare. Modulul activ se expandează inline.

```
▣ Panou
OPERAȚIONAL   ▸ Contracte · Obiective · Cereri ⑦ · Activitate · Aprovizionare ③ · Resurse · Bani ②
BIBLIOTECI    ▸ Documente · Nomenclatoare
              ▸ Administrare
```

Structura expandată completă a fiecărui modul e la `Damina_Aplicatie_Structura_Functionala.md` §3 — o transcrii integral. Intrările pentru module care nu există încă randează un `EmptyState` cu „Disponibil din faza X", **nu** 404.

**Badge-urile sunt cozi de lucru personale, nu totaluri.** „Câte lucruri așteaptă de la mine", filtrate pe rol și pe firmele selectate. Dacă un badge nu se poate goli prin acțiune, nu e badge — e statistică, și statisticile stau în Panou.

### 3.5 Selectoarele globale de context

**Firmă:** trei moduri — o firmă / selecție de firme / toate (consolidat). Vederea „toate" e etichetată explicit `consolidat — fără intercompany` sau `brut — cu intercompany`, cu comutator. Selecția **persistă între sesiuni** și se reflectă în absolut toate listele. Când ești pe o entitate a unei singure firme, selectorul afișează firma blocată.

**Perioadă:** luna curentă implicit, săgeți ◀ ▶, acces rapid la an. **Lunile închise apar cu lacăt 🔒** — poți naviga și citi, nu poți modifica. Asta e cea mai importantă indicație vizuală din aplicație. Ecranele care nu depind de lună ascund selectorul.

Contextul se ține în URL + cookie, e citit în RSC (nu doar în client), și e parte din cheia de cache.

### 3.6 Pagina fractală + `entityRegistry`

```tsx
// (office)/[module]/[id]/[[...tab]]/page.tsx
const config = entityRegistry[params.module];
```

`entityRegistry` declară per entitate: **lista de tab-uri** (cu vizibilitate pe rol), componenta de antet, **cele două bare de progres**, sursele pentru panoul de Legături și acțiunile rapide contextuale pe status.

**O entitate nouă = o intrare în registry**, nu un set de pagini noi. Ăsta e testul pasului: în pasul 04 se adaugă contractul **fără să atingi shell-ul**.

### 3.7 Panoul de Legături

Trei zone: **în sus** (părinți: contract, obiectiv, cererea de origine) · **lateral** (grupuri cu contor, expandabile) · **acțiuni rapide** (3–5 acțiuni, care se schimbă cu statusul entității).

**Regula de aur:** dacă două entități sunt legate în model, legătura e navigabilă **în ambele sensuri**. Din reparație vezi observația care a generat-o; din observație vezi reparația. Fără reciprocitate, jumătate din întrebările reale nu au răspuns.

Implementare: fiecare entitate din registry declară `links: (id) => LinkGroup[]`, rezolvate în RSC, cu contoare.

### 3.8 Căutarea globală (`Ctrl+K`)

Un singur câmp, rezultate grupate pe tip. Prefixe: `#` cerere · `L-` lucrare · `@` persoană · `/` navigare la modul · `>` comandă (`>închide luna`). În pasul ăsta caută în ce există (firme, persoane, nomenclatoare); fiecare entitate nouă își înregistrează un `searchProvider`.

### 3.9 Notificări, cozi de lucru, alerte (migrarea `0010_notifications`)

Trei mecanisme **distincte** — confuzia dintre ele e cea mai comună greșeală în ERP-uri:

```sql
app.work_queue_items  -- listă de obiecte care așteaptă acțiunea mea → badge + card
                      -- se GOLEȘTE prin acțiune. index (person_id, kind) where resolved_at is null
app.notifications     -- eveniment punctual, o dată → clopoțel
app.alerts            -- prag depășit, PERSISTĂ până se rezolvă → banner + card
                      -- unique (scope_type, scope_id, kind) where resolved_at is null
app.outbox_events     -- efecte secundare care nu blochează tranzacția
```

`unique … where resolved_at is null` previne 40 de alerte identice pentru același buget depășit.

- **Realtime (Supabase) doar pentru:** badge-urile de coadă, clopoțel, starea unui job lung. **Niciodată pentru date de business** — un ecran care se schimbă singur sub degetul omului e sursă de erori, nu feature. Fallback: refetch la 60s.
- Fiecare tip de notificare declară `audience`. **Regula anti-zgomot:** nu se trimit notificări către teren pentru lucruri care sunt vederi de birou.
- Coada `notify.dispatch` în worker.

### 3.10 Randare și caching

| Conținut | Strategie |
|---|---|
| Nomenclatoare | RSC + `unstable_cache` cu tag pe entitate, invalidat la scriere |
| Ecrane de business | RSC **fără cache**, `dynamic = 'force-dynamic'` |
| Liste mari | Server Component + paginare cursor + `Suspense` cu skeleton |
| Editoare | Client Component, salvare optimistă + reconciliere |

**Regula de cache: orice ecran care afișează lei e `force-dynamic`.** Nicăieri nu vrem un plafon vechi de 30 de secunde afișat la o decizie.

Taguri structurate: `contract:{id}`, `work-unit:{id}`, `period:{companyId}:{yyyy-mm}`. Fiecare use-case declară ce invalidează.

### 3.11 Mutații — `createAction`

Toate mutațiile sunt server actions, într-un wrapper unic: validare Zod → auth → use-case → `AppError` tradus în mesaj ro → `revalidateTag`. **Aceeași schemă Zod** în browser (react-hook-form) și pe server — imposibil să divergă.

Route Handlers doar pentru: webhook-uri, presign R2, sync-ul de teren, semnarea PV prin token public.

### 3.12 Nomenclatoarele (primul CRUD real)

Ecrane complete, ca demonstrație a shell-ului: **Produse · Furnizori · Clienți · Subcontractanți · Calificări · Tarife (rate card istoricizat)**.

Tabelele `app.products`, `app.clients`, `app.suppliers`, `app.subcontractors`, `app.qualifications`, `app.rate_cards` există din pasul 02 (sau se creează aici pentru `products`). Nomenclatoarele sunt **comune între cele 5 firme**; doar seriile de documente sunt per firmă.

Rate card-ul e **istoricizat**: nu se face `UPDATE`, se adaugă un interval nou. Costul orei = salariu + taxe + coeficient de neproductivitate.

### 3.13 Shell-ul de teren și portalurile

Doar scheletul, ca să existe separarea: `(field)` cu shell mobil + banner de sincronizare (gol), `(portal)/subcontractor` și `(portal)/client` cu navigație proprie. **Zero cifre financiare pe `(field)`.**

---

## 4. Reguli care nu se negociază

1. **Un singur template de pagină de detaliu.** Dacă scrii a doua pagină de detaliu „pentru că e specială", oprește-te.
2. **Zero string-uri de UI hardcodate.**
3. **Fiecare listă are stare goală proiectată.**
4. **Modala nu se închide la click în afară.**
5. **Tab-urile fără drept lipsesc, nu sunt gri.**
6. **Orice ecran cu lei e `force-dynamic`.**
7. **Cifrele calculate de sistem nu se editează manual** — se corectează prin document.

## 5. Ce NU faci în pasul ăsta

- Nu construiești contracte, obiective, UL, costuri — pașii 04–06.
- Nu construiești arborele de fișiere — pasul 07.
- Nu implementezi sincronizarea offline — pasul 10.
- Nu faci OCR / căutare în conținut de documente.
- Nu construiești dashboard-uri pe rol cu date reale (Panoul meu) — scheletul da, cardurile reale vin cu modulele lor.

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Înregistrezi două entități de test în `entityRegistry` cu tab-uri diferite | ambele randează corect **fără cod de pagină nou** |
| 2 | Schimbi firma din selector | toate listele și breadcrumb-ul se actualizează; selecția persistă după refresh și după re-login |
| 3 | Navighezi la o lună închisă | apare lacătul 🔒 pe orice ecran, acțiunile de scriere sunt dezactivate cu explicație |
| 4 | Deschizi o modală cu modificări nesalvate și dai click în afară | **nu se închide**; butonul de închidere cere confirmare |
| 5 | Deschizi orice listă goală | `EmptyState` cu explicație + buton de acțiune, nu tabel gol |
| 6 | `Ctrl+K` → cauți un produs, apoi tastezi `@` și un nume | rezultate grupate pe tip, prefixele filtrează |
| 7 | Login ca rol fără drept financiar | tab-urile financiare **nu apar deloc** în DOM (verifică în inspector, nu vizual) |
| 8 | Inserezi un rând în `work_queue_items` din psql | badge-ul din sidebar crește **fără refresh** (Realtime); rezolvi rândul → badge-ul scade |
| 9 | Inserezi de două ori aceeași alertă pe același scope | un singur rând (constrângerea unique parțială) |
| 10 | Creezi un produs; apoi îl editezi | apare în listă imediat (tag invalidat), audit trail are rândul |
| 11 | Creezi un rate card cu interval suprapus | eroare cu mesaj în română, nu stack trace |
| 12 | Deschizi `(field)` ca șef de șantier | shell mobil, zero cifre în lei, banner de sincronizare vizibil |
| 13 | Test Playwright: pagina de detaliu la 1200 px și la 390 px | antetul rămâne fix la scroll; pe mobil panoul Legături e colapsat |
| 14 | Lighthouse pe o pagină de listă | fără erori de accesibilitate blocante (focus, contrast, labels) |

## 7. Definiția de „gata"

- Cele 14 verificări trec.
- `entityRegistry` e documentat: cum adaugi o entitate nouă, în ≤ 15 linii de exemplu.
- Dicționarul `ro-RO` acoperă 100% din textele existente; un test verifică că nu există chei lipsă.
- Cele trei mecanisme de notificare sunt documentate cu câte un exemplu concret, ca să nu fie confundate în pașii următori.
