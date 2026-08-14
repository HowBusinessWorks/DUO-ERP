# Damina ERP — structura funcțională a aplicației

**Ce e documentul ăsta.** `DaminaStructuraCapCoada FInal.md` spune *ce* trebuie să facă sistemul (model de date, reguli de business, fluxuri economice). Documentul de față spune **cum se traduce asta în aplicație**: ce meniuri există, ce ecrane, ce tab-uri, cine ce vede, de unde pornește fiecare acțiune, unde ajunge și cum se leagă modulele între ele.

Nu intru în tehnic (schema DB, framework, componente) și nici în design vizual (culori, spacing, tipografie). Alea se fac separat. Aici e **harta de utilizare**.

Sistemul de navigare e cel din `navigation-system.md`: sidebar fix + breadcrumb dublu + tab-uri la nivel de entitate + panou de Legături. Documentul îl aplică consecvent pe toate entitățile.

**Notă de terminologie.** În prototipul de navigare entitatea de sub contract se numește „Container". În modelul de business e **Unitate de Lucru (UL)** cu trei tipuri: Inspecție, Intervenție, Lucrare. În interfață nu apare niciodată cuvântul „Unitate de Lucru" — apare tipul concret (Lucrare L-233, Intervenție #1841, Inspecție I-9022). „UL" e doar limbaj intern de arhitectură, folosit în acest document.

---

## Cuprins

**Partea A — Cadrul de interfață**
1. Cele opt principii de interfață
2. Spațiile de lucru (cine intră unde)
3. Meniul principal — harta completă
4. Anatomia unei pagini (pattern-ul recursiv)
5. Bara de sus: căutare, context, notificări, creare rapidă
6. Panoul de Legături — coloana vertebrală a interconectării

**Partea B — Modulele, ecran cu ecran**
7. Panou (dashboard-uri pe rol)
8. Contracte
9. Obiective
10. Cereri (tichete, solicitări, constatări, backlog)
11. Activitate — Inspecții, Intervenții, Lucrări
12. Devize și Situații de lucrări
13. Aprovizionare (necesar, PO, recepții, stoc)
14. Resurse (utilaje, unelte, transporturi, oameni)
15. Bani (facturare, plafoane, marjă, ANAF, închidere)
16. Documente și Procese verbale
17. Nomenclatoare
18. Administrare

**Partea C — Fluxurile cap-coadă în aplicație**
19. Flux 1 — de la email la lucrare încasată
20. Flux 2 — luna de mentenanță
21. Flux 3 — lucrarea cu subcontractanți
22. Flux 4 — materialul, de la necesar la cost
23. Flux 5 — utilajul
24. Flux 6 — închiderea de lună
25. Flux 7 — mutarea finanțării

**Partea D — Transversale**
26. Aplicația de teren (mobil)
27. Portalurile externe (subcontractant, client)
28. Notificări, sarcini, cozi de lucru
29. Matricea de interconectare
30. Reguli de interfață obligatorii
31. Ordinea de construcție a interfeței

---

# PARTEA A — CADRUL DE INTERFAȚĂ

## 1. Cele opt principii de interfață

Toate ecranele din document derivă din astea. Sunt echivalentul de UI al celor șase principii de business din §1 al documentului de arhitectură.

**I1. O entitate = o pagină = un set de tab-uri.** Nu există „ecranul de costuri" separat de obiectul căruia îi aparțin costurile. Costurile lucrării sunt un tab al lucrării. Rapoartele globale există, dar sunt vederi agregate, nu locul unde se lucrează.

**I2. Navigarea e fractală.** Contract → Lucrare → Etapă → Deviz au aceeași structură de pagină (breadcrumb + antet + tab-uri + Legături). Cine a învățat un nivel le-a învățat pe toate. Un singur template, parametrizat cu lista de tab-uri.

**I3. Orice cifră e clickabilă până la documentul sursă.** „Consumat 18.100 lei" → listă de linii de cost → linia „bon de consum #4412" → bonul → produsul → NIR-ul → factura. Fără fundătură. Dacă un număr nu se poate desface, e un bug de design.

**I4. Creezi lucruri din contextul lor, nu din meniu.** Butonul „Comandă material" trăiește în lucrare, nu în modulul Aprovizionare. Modulul Aprovizionare e unde *procesezi* ce s-a cerut. Regula: **cine are nevoie deschide cererea din locul unde are nevoia; biroul procesează din coada lui.** (Generalizarea de la §18.1.8.)

**I5. Aprobarea produce direct obiectul următor.** Nu există „acceptat" urmat de cineva care introduce manual rezultatul. Solicitare de utilaj acceptată → planificare + transport, automat. Ofertă acceptată → UL + alocare de finanțare, automat. Cerere de material aprobată → linie de PO, automat.

**I6. Banii se ascund la nivel de date, nu la nivel de ecran.** Șeful de șantier și subcontractantul nu au ecrane „cu prețurile ascunse" — au **rute și ecrane separate**, care nu conțin niciodată coloana de preț. (§10.3, §18.1.1, §21.8.)

**I7. Fiecare listă are o stare „de rezolvat".** Nu construiesc ecrane de raportare pasivă. Fiecare modul are o coadă de lucru cu badge numeric în sidebar: cereri neprocesate, SL de aprobat, facturi nematchate, PV-uri deschise, recepții nefăcute. Munca vine la om, omul nu vânează munca.

**I8. Contextul de firmă și de lună e global, persistent și mereu vizibil.** Selectorul de firmă și selectorul de perioadă stau în bara de sus și filtrează tot ce e sub ele. Nu există ecran care să nu spună explicit pe ce firmă și pe ce lună lucrezi.

---

## 2. Spațiile de lucru (cine intră unde)

Nu toată lumea vede aceeași aplicație. Sunt **patru aplicații distincte** care partajează datele, nu una cu permisiuni multe.

| Spațiu | Cine | Dispozitiv | Ce e |
|---|---|---|---|
| **Birou** | PM, devizist, achiziții, magazioner, financiar, manager flotă, administrator | desktop | aplicația completă, descrisă în Partea B |
| **Teren** | șef de șantier, echipă proprie, inspector | mobil / tabletă, offline-first | 8 ecrane, zero prețuri (§26) |
| **Portal subcontractant** | firme subcontractante | desktop + mobil, login separat | pachetul lui, SL-urile lui, PV-urile lui (§27) |
| **Portal client** ⏳ | clienți la contractele de mentenanță | desktop | tichete, rapoarte lunare, istoric obiectiv (fază târzie) |

Motivul e la §21.8 din documentul de arhitectură: decupajul „flotă" vs „ce am eu pe șantier" nu s-a putut face din permisiuni, a cerut ecrane separate. Aceeași concluzie a ieșit independent din modulul de situații de lucrări.

**Rolurile din birou** nu schimbă aplicația, schimbă doar: dashboard-ul de start, ce badge-uri apar în sidebar, ce butoane de acțiune sunt active și dacă tab-urile financiare sunt vizibile.

| Rol birou | Dashboard de start | Nu vede |
|---|---|---|
| PM / proprietar de contract | contractele lui, plafoanele, gradul de Delta | contractele altor PM (opțional) |
| Devizist / ofertare | cereri de ofertat, devize în lucru | plafoane, marjă |
| Achiziții | necesare de procesat, PO deschise, lead-time | marjă pe contract |
| Magazie | recepții, transferuri, rezervări, sub-minim | marjă, plafoane |
| Manager flotă | flota, solicitări, PV deschise, revizii scadente | contracte, devize |
| Financiar | facturi de emis, SPV, garanții, cash-flow | jurnale de șantier |
| Administrator | tot | — |

---

## 3. Meniul principal — harta completă

Sidebar vertical fix, împărțit în trei grupe. Grupa 1 e munca zilnică, grupa 2 e infrastructura, grupa 3 e configurarea. Modulul activ se expandează inline și arată sub-secțiunile indentate (exact pattern-ul din `navigation-system.md` §2).

```
┌─────────────────────────────┐
│  ▣ Panou                    │
│                             │
│  OPERAȚIONAL                │
│  ▸ Contracte                │
│  ▸ Obiective                │
│  ▸ Cereri            ⑦     │
│  ▸ Activitate               │
│  ▸ Aprovizionare     ③     │
│  ▸ Resurse                  │
│  ▸ Bani              ②     │
│                             │
│  BIBLIOTECI                 │
│  ▸ Documente                │
│  ▸ Nomenclatoare            │
│                             │
│  ▸ Administrare             │
└─────────────────────────────┘
```

Badge-urile numerice (⑦③②) sunt **cozi de lucru personale**, nu totaluri. Arată „câte lucruri așteaptă de la mine", filtrate pe rol și pe firmele selectate. Dacă un badge nu se poate goli prin acțiune, nu e badge, e statistică — și statisticile stau în Panou.

### Structura expandată, completă

**▣ Panou**
- Panoul meu (dashboard pe rol)
- Panou grup (consolidat, 5 firme)
- Rapoarte

**▸ Contracte**
- Toate contractele
- Plafoane și componente
- Portofoliu pe an contractual
- Contracte cadru furnizori
- Contracte subcontractanți

**▸ Obiective**
- Toate obiectivele (listă + hartă)
- Acoperire inspecții
- Profile de inspecție

**▸ Cereri**
- Inbox (email neprocesat) — badge
- Toate cererile
- Backlog de propuneri
- Decizii de rutare (jurnal)

**▸ Activitate**
- Toată activitatea (vedere unificată UL)
- Inspecții
- Intervenții
- Lucrări
- Calendar / Gantt general
- Pontaj

**▸ Aprovizionare**
- Necesare de material — badge
- Comenzi (PO)
- Recepții — badge
- Stoc și gestiuni
- Transferuri și retururi
- Inventare
- Rezervări

**▸ Resurse**
- Utilaje (flotă)
- Unelte
- Transporturi
- Oameni și echipe
- Subcontractanți

**▸ Bani**
- Facturare emisă
- Facturi furnizor / SPV — badge
- Situații de lucrări — badge
- Garanții și avansuri
- Marjă și plafoane
- Cash-flow
- Închidere de perioadă
- Conector Saga

**▸ Documente**
- Arbore de fișiere
- Procese verbale
- Șabloane
- Expirări și autorizații

**▸ Nomenclatoare**
- Produse
- Articole normate (bibliotecă deviz)
- Catalog de operațiuni
- Furnizori · Clienți · Subcontractanți
- Tarife (rate card, tarif utilaj, preț motorină)
- Șabloane de deviz · Checklist-uri

**▸ Administrare**
- Firme și serii de documente
- Utilizatori și roluri
- Praguri și reguli (indexare, prag Delta, alerte)
- Audit trail
- Integrări (SPV, e-Factura, Saga, email)

---

## 4. Anatomia unei pagini (pattern-ul recursiv)

Fiecare pagină de detaliu, indiferent de entitate, are aceeași structură pe cinci benzi. Asta e componenta reutilizabilă din `navigation-system.md` §5.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [1] Panou > Contracte > 4700 > Lucrări > L-233        🏢 Damina SRL  │
│                                          🔍  📅 Aug 2026  🔔7  ＋    │
├──────────────────────────────────────────────────────────────────────┤
│ [2] Contracte > Apa Nova 4700 > Lucrări > Hidroizolație bazin        │
│     ▌ L-233 · Hidroizolație bazin B2                                 │
│       [Lucrare] [În execuție] [Delta ×3 luni]                        │
│       Obiectiv: Stație Berceni · PM: A. Ionescu · 41.800 lei         │
│       Progres 62% ▓▓▓▓▓▓░░░░   Consumat 68% ▓▓▓▓▓▓▓░░░   ⚠ risc     │
├──────────────────────────────────────────────────────────────────────┤
│ [3] Prezentare │ Deviz │ Etape │ Jurnal │ Materiale⁴ │ Manoperă │    │
│     Subcontractanți² │ Situații¹ │ Costuri │ PV-uri │ Documente │    │
│     Închidere                                                        │
├───────────────────────────────────────────────┬──────────────────────┤
│ [4] conținutul tab-ului activ                 │ [5] LEGĂTURI         │
│                                               │  ↑ Contract 4700     │
│                                               │  ↑ Obiectiv Berceni  │
│                                               │  ↑ Cerere #C-882     │
│                                               │  → Deviz client D-45 │
│                                               │  → 3 PO deschise     │
│                                               │  ⋯ Acțiuni rapide    │
└───────────────────────────────────────────────┴──────────────────────┘
```

**[1] Bara globală** — breadcrumb tehnic de rută + selector de firmă + căutare + selector de perioadă + notificări + buton de creare rapidă. Nu dispare niciodată.

**[2] Antetul entității** — breadcrumb semantic (nume, nu ID-uri), titlu, badge-uri de tip/status, metadate cheie, și **maxim două bare de progres**. Barele sunt cele care contează pentru decizie: la lucrare — progres vs consum; la contract — grad de plafon; la Delta — grad de umplere. Restul indicatorilor stau în tab-uri.

**[3] Tab-uri** — fațete ale aceleiași entități. Badge numeric pe tab pentru „câte elemente" sau „câte de rezolvat". Tab-ul activ subliniat. Tab-urile financiare lipsesc complet pentru rolurile fără drept, nu apar gri.

**[4] Conținutul** — o singură treabă per tab. Dacă un tab are nevoie de sub-tab-uri, entitatea probabil trebuia spartă.

**[5] Panoul Legături** — §6. Colapsabil, dar deschis implicit pe desktop.

**Regulă:** antetul și breadcrumb-ul rămân fixe la scroll. Pe ecranele lungi (deviz cu 500 de poziții, listă de costuri) omul trebuie să știe permanent pe ce entitate e.

---

## 5. Bara de sus: căutare, context, notificări, creare rapidă

### 5.1 Selectorul de firmă

Trei moduri: **o firmă** / **selecție de firme** / **toate (consolidat)**. Vederea „toate" e etichetată explicit `consolidat — fără intercompany` sau `brut — cu intercompany`, cu comutator (§3 din arhitectură). Selecția persistă între sesiuni și se reflectă în absolut toate listele, dashboard-urile și rapoartele.

Când ești pe o entitate care aparține unei singure firme (un contract, o factură), selectorul afișează firma respectivă blocat — nu poți fi „pe toate firmele" în timp ce ești pe factura firmei B.

### 5.2 Selectorul de perioadă

Luna curentă implicit, cu săgeți ◀ ▶ și acces rapid la an. Lunile închise apar cu lacăt 🔒 — poți naviga în ele, poți citi tot, nu poți modifica nimic. Asta e cea mai importantă indicație vizuală din aplicație (§21 punctul 1).

Ecranele care nu depind de lună (nomenclatoare, dosarul unui utilaj) ascund selectorul.

### 5.3 Căutarea globală

Un singur câmp, `Ctrl+K`. Caută transversal, cu rezultate grupate pe tip și cu prefixe pentru filtrare rapidă:

```
🔍 berceni

CONTRACTE       4700 · Apa Nova — mentenanță 4 ani
OBIECTIVE       Stație pompare Berceni · 12 UL active
LUCRĂRI         L-233 Hidroizolație bazin B2 · în execuție
INTERVENȚII     #1841 · Înlocuire pompă · finalizată
CERERI          #C-882 · Infiltrații subsol · în evaluare
DOCUMENTE       PV recepție Berceni 2025.pdf
UTILAJE         EXC-01 · alocat pe Berceni până 20 aug
```

Prefixe: `#` cerere · `L-` lucrare · `@` persoană · `/` navigare la modul · `>` comandă (ex. `>închide luna`).

Căutarea în documente merge azi pe nume de fișier; când se adaugă OCR (§21 punctul 21), aceeași casetă returnează și conținut.

### 5.4 Clopoțelul de notificări

Un singur clopoțel pentru tot, inclusiv flotă (§18.1). Grupat pe categorie, cu acțiune directă din notificare unde se poate („Aprobă", „Vezi", „Amână"). Detalii la §28.

### 5.5 Butonul ＋ (creare rapidă)

Meniu scurt, contextual la modulul curent, cu maxim 6 intrări. Pe teren e buton flotant cu 4 intrări. Nu înlocuiește crearea din context (I4) — e scurtătura pentru cazurile care chiar încep de nicăieri: cerere manuală (telefon), obiectiv nou, produs nou.

---

## 6. Panoul de Legături — coloana vertebrală a interconectării

Panoul din dreapta e mecanismul care face aplicația să se simtă conectată, nu ca un set de module. Are trei zone.

**Zona 1 — În sus (părinți).** Contract, obiectiv, cererea din care s-a născut entitatea, contractul-mamă. Alternativă la breadcrumb pentru urcare rapidă.

**Zona 2 — În lateral (obiecte legate).** Nu o listă lungă, ci **grupuri cu contor**, expandabile:

```
LEGĂTURI
↑ Contract 4700 · Apa Nova
↑ Obiectiv · Stație Berceni
↑ Cerere #C-882 (originea)

Deviz client D-45          ✓ acceptat
Deviz intern DI-45         3 pachete
Comenzi                    3 · 1 în întârziere ⚠
Recepții                   5
Situații de lucrări        2 · 1 de aprobat 🔴
Utilaje alocate            EXC-01 (12–20 aug)
Transporturi               4
PV-uri                     2 · 1 deschis ⚠
Documente                  47 fișiere · 312 poze
Costuri                    28.400 lei
```

**Zona 3 — Acțiuni rapide.** Cele 3–5 acțiuni pe care le face 90% din lume pe entitatea asta, în starea ei curentă. Se schimbă cu statusul: o lucrare în execuție arată „Comandă material / Solicită utilaj / Adaugă în jurnal"; aceeași lucrare la final arată „Retur la magazie / Generează PV recepție / Închide lucrarea".

**Regula de aur a panoului:** dacă două entități sunt legate în model, legătura trebuie să fie navigabilă **în ambele sensuri**. Din reparație vezi observația din teren care a generat-o; din observație vezi reparația (§18.1.3). Din factură vezi SL-ul; din SL vezi factura. Fără reciprocitate, jumătate din întrebările reale („de câte ori s-a stricat frâna asta?") nu au răspuns.

---

# PARTEA B — MODULELE, ECRAN CU ECRAN

## 7. Panou

### 7.1 Panoul meu

Compus din carduri, diferite pe rol. Fiecare card e o **coadă** sau un **indicator cu acțiune**, nu decorație.

**PM / proprietar de contract:**

```
┌── CONTRACTELE MELE ─────────────┐  ┌── DELTA — GRAD DE UMPLERE ──────┐
│ 4700 Apa Nova    ▓▓▓▓▓▓▓▓░ 85% │  │ 4700  67%  ⚠ 4.100 lei liberi  │
│ 4812 Apa Nova    ▓▓▓▓▓░░░░ 52% │  │ 4812  91%                       │
│ 3390 Primărie    ▓▓▓▓▓▓▓▓▓ 94%⚠│  │ 3390  38%  🔴 mai sunt 11 zile │
└─────────────────────────────────┘  │ [Vezi backlog: 7 propuneri]     │
                                     └─────────────────────────────────┘
┌── DE APROBAT ───────────────────┐  ┌── LUCRĂRI ÎN RISC ──────────────┐
│ 2 situații de lucrări           │  │ L-233 consum 68% / progres 62%  │
│ 3 suplimentari                  │  │ L-241 etapa 2 întârziere 6 zile │
│ 1 mutare de finanțare           │  └─────────────────────────────────┘
└─────────────────────────────────┘
```

Cardul de Delta e cel mai important din tot dashboard-ul PM și e proiectat ca **gauge care se umple**, nu care se golește (§4.2). Sub el, contorul de zile rămase din lună — pentru că Delta nu se reportează, iar verificarea la închidere e inutilă (§24.1).

**Achiziții:** necesare de procesat pe vechime · PO fără confirmare de furnizor · linii cu lead-time critic · articole la 80% din cantitatea de deviz (§16) · furnizori cu întârzieri repetate.

**Magazie:** recepții de făcut azi · transferuri de expediat · articole sub minim · loturi care expiră în 30 de zile · rezervări expirate de eliberat · filtrul de 24h (Canal C) cu ce mai e de decis.

**Manager flotă:** solicitări noi · PV-uri deschise (lista cea mai importantă din modul, §18.1.4) · revizii scadente pe dată **și** pe ore de contor · observații din teren nerezolvate · utilaje imobilizate.

**Financiar:** facturi de emis luna asta · rapoarte lunare de aprobat înainte de trimitere · SPV nematchat · garanții scadente de eliberat · încasări restante la 70 de zile.

### 7.2 Panou grup

Vederea celor 5 firme. Comutator brut/consolidat vizibil permanent. Cifre: cifră de afaceri, marjă brută, marjă netă (cu regie), consum vs plafon pe fiecare contract, expuneri (cel mai mare client ca procent — §22.8), cash-flow proiectat.

### 7.3 Rapoarte

Listă de rapoarte salvate + constructor simplu peste registrul de cost. Fiecare raport declară în antet **pe care analitică e construit — „folosit" sau „descărcat"** (§12). Fără eticheta asta, două ecrane dau două cifre.

Rapoarte standard livrate: consum pe componentă · istoric obiectiv · estimat vs realizat pe tip de operațiune · estimat vs consumat pe articol pe lucrare · re-alocări ale lunii · acoperire inspecții · reconciliere stoc app vs Saga · marjă pe an contractual.

---

## 8. Contracte

### 8.1 Lista de contracte

Coloane: cod, client, firmă, tip, perioadă, valoare, an contractual curent (2/4), PM, grad de consum, marjă, alertă de expirare. Filtre salvabile. Semn vizual distinct pentru contractele cu **indexare 0** (§22.6) — alea se degradează cel mai repede.

### 8.2 Pagina de contract — tab-uri

`Prezentare · Componente · Obiective · Activitate · Financiar · Facturare · Subcontractanți · Documente · Setări`

**Prezentare.** Ecranul din §4.3 al arhitecturii, exact așa: abonament lunar, apoi câte o bandă per componentă cu venit / plafon / angajat / consumat / rest și bara de progres, apoi marja lunii și marja cumulată pe an contractual. Navigare pe luni cu ◀ ▶. Banda Delta arată explicit lei neumpluți și link către propunerile din backlog care i-ar putea umple.

**Componente.** Fiecare componentă (Mentenanță / Lucrări / Delta / Individual) cu cele trei numere separate: venit alocat, plafon de cost, consum real. Editabile după regula temporală proprie:

| Componentă | Unde se setează | Ecran secundar |
|---|---|---|
| Mentenanță | plafon lunar | cumulat pe an |
| Lucrări | plafon anual, defalcat lunar | plan anual vs angajat vs consumat vs rest |
| Delta | plafon de venit lunar, manual | grad de umplere pe an |

Fiecare componentă e **clickabilă** și duce la lista de UL finanțate din ea în luna selectată — cu totalul care trebuie să dea exact cifra de pe bandă. Dacă nu dă, e bug, și trebuie să se vadă.

**Obiective.** Lista `ContractObiectiv` cu perioada de valabilitate, profilul de inspecție aplicat și frecvența contractuală. Aici se adaugă și se scot obiective din contract în cei 4 ani, cu istoric. Profilul de inspecție se editează **aici**, nu pe obiectiv (§5).

**Activitate.** Toate UL-urile contractului, grupate pe componentă și pe lună, cu filtru pe tip. Coloane: cod, tip, obiectiv, status, valoare, consumat, responsabil.

**Financiar.** Marja pe an contractual (curba pe 4 ani, nu media — §22.6), proiecția până la finalul contractului cu ipoteze editabile de creștere a costurilor, istoricul de indexare pe ani, comutator marjă brută / netă cu regie.

**Facturare.** Facturi emise, raportul lunar atașat fiecăreia, scadențar la 70 de zile, garanții reținute de client, stare e-Factura.

**Subcontractanți.** Firmele care lucrează pe contract, pachetele lor, SL-urile, soldul de garanții reținute, procentul de reținere per contract.

**Setări.** Indexare (%, aniversare, istoric), prag mentenanță→Delta (implicit 2.000 lei), prag de alertă expirare, proprietar de contract (PM), termen de plată, șablon de raport lunar per client.

### 8.3 Contracte cu furnizori și subcontractanți

Sub-secțiuni proprii, aceeași structură de pagină: contracte cadru cu prețuri negociate și lead-time (rolul real al achizițiilor, §16), contracte de subcontractare cu procent de garanție și rate card.

---

## 9. Obiective

### 9.1 Lista

Două vederi comutabile: **tabel** și **hartă** (pin pe hartă e cerință explicită, §18.1.7 — se folosește și la selecția coordonatelor, nu doar la afișare). Filtre: tip, contract, firmă, ultima inspecție, activitate în perioadă.

### 9.2 Pagina de obiectiv — tab-uri

`Prezentare · Istoric · Contracte · Inspecții · Documente · Poze`

**Istoric** e ecranul cerut explicit la §5, transversal peste contracte și peste ani:

```
Stație pompare Berceni                    2026 ▾    [toate contractele ▾]
────────────────────────────────────────────────────────────────────────
Aug 2026  🔍 Inspecție electrică    Subc. ElectroX          412 lei
Aug 2026  🔍 Inspecție vizuală      Echipă proprie          180 lei
Aug 2026  🔧 Intervenție #1841      Echipă proprie        1.240 lei
                                    manoperă 620 · mat. 620
Iul 2026  🔍 Inspecție sanitară     Subc. HidroY            390 lei
Iun 2026  🏗 L-233 Hidroizolație    Delta · 3 luni   total 41.800 lei
                                                     luna asta 13.900
────────────────────────────────────────────────────────────────────────
Total 2026: 87.430 lei   ·   media lunară: 10.929 lei
```

Istoricul e construit pe analitica **„folosit"** (§12) și e etichetat ca atare. Rămâne intact indiferent de câte ori se mută finanțarea (§13.1) — asta e diferența pe care trebuie s-o vadă utilizatorul: pe obiectiv nu se schimbă nimic când se mută banii.

**Contracte** — pe ce contracte a fost sau este obiectivul, în timp și simultan, la firme diferite.

**Inspecții** — profilul aplicabil, checklist-urile, istoricul de completări, punctele NOK deschise și ce s-a întâmplat cu fiecare.

### 9.3 Acoperire inspecții

Vederea de birou cerută la §22.2: din N obiective ale contractului, câte au fost inspectate luna asta, per tip de inspecție, cu restanțele listate. **Fără notificări către teren.** Măsori fără să hărțuiești. Din listă poți asigna o restanță unei persoane, dacă cineva chiar decide asta.

---

## 10. Cereri

Modulul care alimentează tot restul. O entitate, mai multe tipuri (§7).

### 10.1 Inbox

Coadă de emailuri neprocesate din cutia poștală monitorizată. Fiecare mail = o Cerere în stare `neprocesată`, cu textul, expeditorul și atașamentele păstrate. Emailul original rămâne atașat permanent — e dovada solicitării clientului.

Ecran de triere pe două coloane: stânga emailul original, dreapta formularul de completat (obiectiv, contract, tip, descriere, valoare estimată). Ținta e **30 de secunde per email**. Fără parsare automată la început; ce ajută real e precompletarea din expeditor (dacă emailul e cunoscut, clientul și contractul se completează singure).

### 10.2 Pagina de cerere — tab-uri

`Prezentare · Constatare · Evaluare · Decizie · Documente`

**Evaluare** — aici se calculează valoarea estimată **din catalogul de operațiuni** (§8.5). Alegi tipul de operațiune și cantitatea, iar sistemul scoate norma de timp, materialele tipice și costul estimat. Asta transformă pragul de 2.000 lei din „din ochi" în cifră.

**Decizie** — ecranul de rutare, cel mai important din firmă. Sistemul propune, omul confirmă sau schimbă, motivând:

```
Valoare estimată: 3.400 lei          Contract 4700 · Delta liber: 4.100 lei
──────────────────────────────────────────────────────────────────────────
Sistemul propune:  ▶ LUCRARE MICĂ pe DELTA (august)
                     3.400 ≤ 4.100 disponibil · umple Delta la 94%

Alte opțiuni:      ○ Intervenție pe Mentenanță   ✗ peste pragul de 2.000
                   ○ Lucrare pe componenta Lucrări
                   ○ Împărțită pe 2–3 luni de Delta
                   ○ Oportunitate → contract individual nou
                   ○ Amână → backlog de propuneri

Motiv: ______________________________         [Decide și creează UL]
```

Decizia se salvează cu autor, dată și motiv, și apare în jurnalul de decizii de rutare. La apăsarea butonului se creează **atomic**: UL-ul + alocarea de finanțare + folderul de documente + legătura înapoi la cerere (I5).

### 10.3 Backlog de propuneri

Funcționalitatea cu cel mai bun raport efort/venit din tot proiectul (§14). Toate constatările NOK din inspecții și toate cererile amânate sau respinse ajung aici, **cu valoare estimată**, și rămân re-evaluabile.

Ecranul e proiectat pentru un singur scop: **umplerea Deltei**.

```
BACKLOG DE PROPUNERI          Contract 4700 ▾    Delta august: 4.100 lei liberi
────────────────────────────────────────────────────────────────────────────
☐ Înlocuire capac cămin C12      Berceni      1.800 lei   din inspecția 12.07
☐ Reparație tencuială hol        Sediu Vest   2.300 lei   din inspecția 03.08
☐ Revizie tablou electric        Glina        4.000 lei   tichet client 21.07
☐ Vopsitorie scară acces         Berceni        900 lei   din inspecția 12.07
────────────────────────────────────────────────────────────────────────────
Selectate: 2 · 4.100 lei · umple Delta la 100%   [Promovează în lucrări]
```

Selectezi propuneri până umpli exact plafonul, apeși un buton, se creează UL-urile și alocările. Asta e mecanismul care transformă Delta din venit pierdut în venit încasat.

---

## 11. Activitate — Inspecții, Intervenții, Lucrări

### 11.1 Vederea unificată

O singură listă peste toate cele trei tipuri, pentru că sunt aceeași entitate cu structuri diferite. Filtre: tip, status, contract, componentă, obiectiv, responsabil, perioadă, executant (echipă proprie / subcontractant). Coloane comune: cod, tip, denumire, obiectiv, contract+componentă, status, valoare, consumat, responsabil.

De aici pornește și **promovarea** (§6): buton „Promovează în lucrare" pe o intervenție. Ecran de confirmare care arată explicit ce se păstrează (id, poze, ore, consumuri) și ce se adaugă (deviz, etape). Nimic nu se rescrie.

### 11.2 Inspecția — tab-uri

`Fișă · Constatări · Costuri · Poze · Documente`

Se creează de pe teren (§26). Fișa încarcă automat checklist-ul din profilul obiectivului (`ContractObiectiv`, §5). **Fiecare punct NOK trebuie să aibă o ieșire obligatorie** înainte ca fișa să se poată închide:

```
Punct 7 — Etanșare capac cămin C12         ● OK   ○ NOK
   NOK → ieșire obligatorie:
        ○ Rezolvat pe loc  (descrie ce ai făcut)
        ○ Creează intervenție  →  Cerere tip „constatare"
        ● Propunere pentru mai târziu  →  Backlog, estimat 1.800 lei
```

Fără regula asta, backlogul rămâne gol și Delta se umple reactiv.

### 11.3 Intervenția — tab-uri

`Fișă · Materiale · Ore · Costuri · Poze · Documente`

Fișa de intervenție se completează pe teren: descriere, materiale consumate (scanare sau alegere din gestiunea echipei), ore declarate, poze înainte/după. Materialele consumate generează bon de consum, care poartă contractul, componenta și obiectivul (§17 — contractul e o dimensiune, nu un depozit).

La validare, sistemul compară automat **consum așteptat (din catalogul de operațiuni) vs consum real** și marchează abaterile mari. E cel mai bun mecanism anti-furt din sistem (§8.5), și trăiește aici, nu într-un raport pe care nu-l citește nimeni.

### 11.4 Lucrarea — tab-uri

`Prezentare · Deviz · Etape · Jurnal · Materiale · Manoperă · Subcontractanți · Situații · Costuri · PV-uri · Documente · Închidere`

Astea sunt tab-urile din `navigation-system.md` §5, completate cu ce cere modelul de business.

**Prezentare.** Progres fizic (din etape) vs consum financiar, alături. Divergența dintre ele e semnalul de risc. Plus: alocările de finanțare active (poate fi Delta pe 3 luni), responsabili, perioadă, obiectiv.

**Deviz.** Două panouri comutabile: **Deviz client** și **Deviz intern**, cu maparea N:M vizibilă între ele (§8.1). Devizul intern e marcat vizual ca **strict intern** — nu are buton de export către client, deloc. Devizul client are versionare cu istoric; cel intern nu are nevoie (§8.1).

Butonul „Preia ca deviz intern" face mapping 1:1 când devizul client e deja bun.

Pornirea unui deviz — patru importatori, un singur ecran de start (§8.2):

```
CUM PORNIM DEVIZUL?
  ▸ Din șablon pe tip de obiectiv     (SH, bazin, rezervor, filtru, stație)
  ▸ Copiază dintr-o lucrare anterioară (caută în proiecte închise)
  ▸ Din biblioteca de articole normate ← ținta
  ▸ Import Excel                       (mapare de coloane)
```

După fiecare deviz făcut prin modurile 1, 2 sau 4, sistemul propune explicit: *„3 poziții noi nu există în bibliotecă. Le salvezi ca articole normate?"* Așa crește biblioteca singură (§8.2).

**Etape.** Listă + Gantt. Fiecare etapă: denumire, ordine, perioadă planificată, **buget de material**, buget de manoperă, procent din lucrare. Etapa e clickabilă și are propria pagină cu propriile tab-uri (recursivitate) — buget vs consumat, materiale, jurnal, poze.

**Jurnal.** Intrări pe etapă cu text, poze, video. Secțiune fixă **Înainte / După** la nivel de lucrare, obligatorie la deschidere și la închidere.

**Materiale.** Necesarul defalcat pe etape, cu stadiile: necesar → comandat (angajat) → recepționat → consumat. **Câmpul „etapă" e obligatoriu pe fiecare linie**, cu default = etapa curentă din grafic (§22.4). Alertă la 80% din cantitatea de deviz, nu la 100% (§16).

**Manoperă.** Pontaj propriu, cu posibilitatea de a împărți ziua unui om pe mai multe UL (§9) — ecranul de pontaj e proiectat cu procente sau ore pe rând, nu cu o singură lucrare per zi. Separat: pontajul de prezență al subcontractanților, declarat de șeful de șantier, marcat clar ca **instrument de control, nu de plată**.

**Subcontractanți.** Pachetele create din devizul intern (§8.3), cu status: trimis → ofertat → acceptat. Materialele nu pot intra în pachet — sistemul blochează, nu doar avertizează.

**Situații.** SL-urile lunare pe pachet, cu fluxul de la §12.2.

**Costuri.** Toate liniile din registrul de cost cu `ul_id` = lucrarea asta, grupabile pe tip de cheltuială, pe etapă, pe lună, pe stadiu (angajat / recepționat / consumat / facturat). Fiecare linie duce la documentul sursă (I3).

**Închidere.** Checklist obligatoriu (§15):

```
ÎNCHIDEREA LUCRĂRII L-233
  ☑ Inventar gestiune șantier          rest: 3 articole, 840 lei
  ☐ Retur la magazie                   [Generează aviz de retur]
  ☐ Ultimul bon de consum
  ☐ PV de recepție la terminarea lucrărilor   [Generează din șablon]
  ☐ Toate PV-urile închise             ⚠ 1 PV de utilaj încă deschis
  ☐ Poze „După" completate
  ☐ Situații de lucrări finalizate
  ☐ Marja finală calculată             28.4% (țintă 25%)
  ──────────────────────────────────────────────────────────
  [Închide lucrarea]  → blochează costuri noi
                      → arhivează în „proiecte anterioare"
```

Arhivarea o face automat disponibilă ca sursă de copiere pentru devize viitoare.

### 11.5 Calendar / Gantt general

Toate lucrările active pe o axă de timp, cu etapele lor, filtrabile pe contract, PM, șef de șantier. Suprapus, opțional: rezervările de utilaje și transporturile planificate — acolo se văd conflictele reale de resurse.

### 11.6 Pontaj

Ecran de birou pentru validarea pontajelor din teren, pe săptămână, cu totaluri pe om și pe UL. Rate card istoricizat aplicat automat după data pontajului (§9). Costul orei = salariu + taxe + coeficient de neproductivitate, configurat în Nomenclatoare.

---

## 12. Devize și Situații de lucrări

### 12.1 Devizul ca ecran

Editor de deviz cu structură pe categorii → operațiuni → poziții. Coloane: cod articol, denumire, UM, cantitate, material, manoperă, utilaj, transport, total. La devizul client, indirectele și profitul apar ca pachet procentual la final. La cel intern, doar cost direct, cu material și manoperă **întotdeauna separate**.

Panoul de mapare N:M se deschide lateral și arată, pentru poziția selectată din devizul client, ce poziții interne o compun și cu ce coeficient. Asta e ce permite ca declarația subcontractantului să urce automat în SL-ul către client (§8.1).

Bara de trasabilitate, permanentă pe fiecare linie selectată (§8.4):

```
Poziția: Hidroizolație bituminoasă 2 straturi · 340 mp
Ofertat 18.700 · Estimat cost 13.200 · Comandat 11.400 · Consumat 9.800
Declarat subc. 280 mp · Aprobat 265 mp · Facturat client 265 mp
```

### 12.2 Situațiile de lucrări — fluxul pe ecrane

Modulul e portat din prototipul execuTrack (§10.3), cu regulile validate în teren.

| Pas | Cine | Unde | Ce vede |
|---|---|---|---|
| 1 | Subcontractant | portal subc | pachetul lui, declară cantități, **vede prețul** |
| 2 | Șef de șantier | app teren | doar cantități, marchează linie cu linie `ok` / `suspect` + comentariu. **Nu vede prețul deloc** |
| 3 | PM | birou | tot, aprobă, generează cod SL |
| 4 | Subcontractant | portal subc | descarcă SL, emite factură cu codul SL |
| 5 | Sistem | SPV | matching automat pe cod SL |
| 6a | Contract individual | — | cantitățile urcă prin mapare → SL client → factură |
| 6b | Contract mentenanță | — | se oprește la pasul 3, costul intră pe componenta Lucrări |

**Verificarea e linie cu linie, nu în bloc** (§10.3) — confirmat că funcționează la granularitatea de linie.

Fiecare linie de SL arată cumulativ: `contractat / executat cumulat / aprobat cumulat / facturat cumulat / rest`. Sistemul **blochează** declararea peste cantitatea contractată fără o suplimentare aprobată (§10.2).

**Suplimentările** au flux propriu: subcontractantul propune → șeful de șantier verifică (`ok` / `suspect` + comentariu) → PM decide. La acceptare, suplimentarea aterizează **în aceeași tranzacție** și în devizul permanent (categoria „Lucrări suplimentare", creată o dată și reutilizată) și în situația curentă (§10.3). Un pas, nu doi.

**Intrarea din spate** (§10.2): facturi de subcontractant fără SL în sistem. Ecran separat, cu contract + componentă + UL + tip de cheltuială **obligatorii**, marcate `fără SL`. Un contor vizibil în dashboard-ul financiar arată procentul lor — dacă e mare, fluxul nu e adoptat, și asta e o problemă de management, nu de software.

### 12.3 Garanții de bună execuție

Modul nou, nu există nicăieri azi (§10.2, §21 punctul 2). Două fețe:

- **Reținute de la subcontractanți:** procent per contract subc, reținere automată la fiecare SL, sold curent, scadențar de eliberare (la recepție + la expirarea garanției), buton de eliberare cu document.
- **Reținute de client de la noi:** aceeași structură, oglindă, cu urmărire în cash-flow.

Ecran unic „Garanții" în modulul Bani, cu două tab-uri și un scadențar comun.

---

## 13. Aprovizionare

### 13.1 Cele trei canale, ca ecrane distincte

Canalele din §16 nu sunt un câmp pe comandă — sunt **trei cozi diferite, cu proprietari diferiți**.

| | Canal A — Replenishment | Canal B — Urgență mentenanță | Canal C — Aprovizionare lucrare |
|---|---|---|---|
| Coadă | „Sub minim" | „Cereri din teren" | „Necesare de lucrare" |
| Owner | Achiziții | Magazie | Achiziții, aprobare PM |
| Pornește din | min/max automat | app teren, 3 tap-uri | tab-ul Materiale al lucrării |
| Control | stoc de siguranță | prag valoric + furnizori pre-aprobați | **blocaj pe bugetul de etapă** |

### 13.2 Filtrul de 24h (Canal C)

Pasul care păstrează avantajul magaziei fără s-o facă gât de sticlă (§16). Ecran dedicat pentru magazioner:

```
NECESAR L-233 · Etapa 2 · Hidroizolație              ⏱ mai sunt 19h
──────────────────────────────────────────────────────────────────────
Membrană bituminoasă 4mm    340 mp   stoc: 120 mp   retur L-198: 85 mp
   ● Acopăr din stoc (120)  ○ Acopăr din retur (85)  ○ Trimite la achiziții
Amorsă bituminoasă           60 l    stoc: 0
   ○ Acopăr    ● Trimite la achiziții
──────────────────────────────────────────────────────────────────────
[Confirmă]     Nedecise după 19h → curg automat la achiziții
```

Retururile devin vizibile ca stoc disponibil **înainte** să se emită PO pe același articol.

### 13.3 Comenzi (PO)

`Listă → Cerere de ofertă → Comparare oferte → PO → Confirmare → Recepție → Matching`

Ecranul de comparare oferte: matrice furnizori × poziții, cu preț, termen, lead-time istoric real (nu declarat), și buton de split pe furnizori.

**PO-ul are distribuție analitică obligatorie pe fiecare linie**: contract + componentă + UL + etapă. Fără etapă nu se poate salva linia dacă UL-ul e o lucrare (§22.4).

La lansarea PO-ului, liniile intră în registrul de cost cu stadiul **`angajat`** (§P6). Asta e ce face ca plafonul să se coloreze înainte să vină factura, nu după 3 săptămâni.

**Managementul lead-time-ului** are ecran propriu: articole cu lead-time > 7 zile, cu ce lucrări depind de ele și când trebuie comandate ca să nu blocheze șantierul. Kerakoll la 2 săptămâni e problema de aici.

### 13.4 Recepții

Coadă de recepții așteptate (din PO confirmate). Recepția se poate face **din teren** (aviz fotografiat, cantități) sau din magazie. Generează NIR. Diferențele față de PO intră într-o coadă de rezolvat.

Declarațiile de performanță se atașează la NIR (§21 punctul 16) — obligatoriu pentru cartea tehnică.

### 13.5 Stoc și gestiuni

Gestiunile din §17, exact așa: gestiune = loc fizic. Ecran de stoc cu filtru pe gestiune, produs, lot, și trei coloane: **fizic / rezervat / disponibil**.

Tipuri de gestiune ca filtru de nivel înalt: Magazie centrală · Consignație furnizor ⏳ · Șantier · Echipă · Subcontractant · Unelte · Utilaje.

**Nu există interfață pentru a crea „gestiune de contract".** Ecranul de creare gestiune cere obligatoriu un tip din lista de mai sus și o locație fizică.

**Rezervări:** marcate pe gestiunea magaziei, nu mutate. Cu termen de expirare și coadă de rezervări expirate de eliberat.

**Loturi și expirare:** obligatoriu pe adezivi, mortare, chimicale. FEFO la eliberare, alertă cu prag configurabil.

**Consignația ⏳** există ca tip de gestiune (custodie — marfa nu e a ta până la consum), dar nu blochează nimic. Când se semnează primul acord, e deja acolo.

### 13.6 Transferuri, retururi, inventare

Documente cu serie și număr per firmă și per gestiune: NIR · aviz de transfer · bon de consum · aviz de retur · PV de custodie · listă de inventar · decizie de inventariere · notă de diferențe.

**Transferul între gestiuni ale unor firme diferite nu e transfer, e vânzare** (§3). Ecranul detectează asta și avertizează explicit, apoi generează automat perechea de documente (aviz + factură + NIR la destinație) și marchează tranzacția ca intercompany.

---

## 14. Resurse

### 14.1 Utilaje — două perspective, două seturi de ecrane

Nu un ecran cu permisiuni, ci **rute separate** (§18.1.1).

**Manager de flotă (birou):**

- `Flotă` — registrul complet, cu costuri, status (`disponibil` / `service` / `indisponibil` / `casat`)
- `Solicitări` — inbox de cereri din teren, cu alocarea utilajului concret
- `Calendar` — Gantt pe utilaje, două săptămâni vizibile, bare colorate pe categorie
- `PV-uri` — cu **cele deschise evidențiate vizual în capul listei** (cea mai importantă listă din modul, §18.1.4)
- `Motorină` — fișe + registrul de preț pe zi
- `Reparații` — pe patru tipuri (intervenție / revizie periodică / gresare / capitală)
- `Observații din teren` — inbox de rezolvat

**Șef de șantier (teren):** doar `Utilajele mele` — ce am pe șantier, PV-urile în care sunt parte, consumul de motorină pe utilajele mele, butonul de solicitare, butonul de observație. **Zero lei, zero rapoarte de cost.**

**Dosarul unui utilaj — tab-uri:** `Detalii · Accesorii · Motorină · Reparații · Planificări · Procese verbale · Poze`

Fotografia utilajului nu se decupează în pagina de detaliu (§18.1.7).

**Solicitarea de utilaj** (§18.1.2) — formular din teren: tip de activitate, perioadă, lucrare/obiectiv, cu/fără operator, cine manipulează (angajat propriu sau subcontractant + persoane), accesorii, notă. Sistemul filtrează și arată **doar utilajele care se pretează activității și sunt libere în tot intervalul**; dacă nu e nimic, propune alternative sau alt interval. Șeful cere **o categorie, nu un utilaj anume**.

La acceptare: planificare + cerere de transport, automat. Solicitantul devine automat responsabil de utilaj pe perioada respectivă. Statusuri vizibile permanent solicitantului: `nouă` → `acceptată` (cu utilajul afișat) / `respinsă` (cu motivul afișat).

**Calendarul de flotă** (§18.1.5): validare de suprapunere **pe server**, cu mesaj care spune *cu ce* se suprapune. **Decalare în masă** — „mută cu ±N zile tot ce începe după data X", cu afișarea numărului de planificări afectate **înainte** de confirmare. Click pe zonă liberă = rezervare nouă precompletată. Numele complet al utilajului lizibil, pe două-trei rânduri dacă e nevoie.

**PV de predare-primire** (§18.1.4): un document, două etape. Din planificare există link direct cu **datele deja precompletate**. Reguli impuse de sistem, nu de instruire:

1. datele de predare se blochează după creare
2. nu poți deschide un PV nou pe un utilaj cât timp precedentul e deschis
3. data primirii nu poate fi anterioară datei de predare
4. contorul de ore se actualizează la închiderea PV, nu manual
5. PV-urile deschise sunt evidențiate vizual
6. semnătură prin desen pe ecran
7. printabil / vizualizabil A4

**Observația din teren** (§18.1.3): din utilaj, în două atingeri, cu poză. Tipuri: defecțiune / avarie / necesită întreținere / problemă combustibil / altă observație. Ajunge la responsabilul de flotă, care răspunde în aplicație. Tot el decide imobilizarea. **Pe perioada imobilizării nu se calculează costuri de exploatare** — utilajul imobilizat nu încarcă lucrarea unde stă. Din observație se generează fișa de reparație, cu legătura păstrată în ambele sensuri.

**Mentenanță preventivă** (§18.1.7): revizia are **și dată următoare, și oră de contor următoare** (ex. „la 1000 ore"), cu alertă pe oricare dintre ele. O alertă doar pe dată ratează jumătate din cazuri. Reparația poate avea **mai multe facturi** de la furnizori diferiți (piese de la unul, manoperă de la altul).

**Costul utilajului** (§18.1.6):

| Sursă | Calcul | Aterizează pe |
|---|---|---|
| Motorină | litri × prețul zilei | lucrarea din fișă |
| Ore de funcționare | ore × tarif orar intern | lucrarea din planificare |
| Reparații | manoperă + materiale + facturi | utilaj, apoi repartizat |
| Chirie | zile × chirie/zi | lucrarea din planificare |

Prețul motorinei se ține **pe zi**, în registru separat, cu preluare automată și suprascriere manuală.

### 14.2 Unelte

Se comportă ca produsele: necesar → comandă → predare cu PV → retur cu PV și constatare stare. Gestiune proprie cu sub-locații, status (`activ` / `la reparații` / `casat`), **istoric per unealtă și per om**.

### 14.3 Transporturi

O singură entitate, cinci tipuri, **o singură coadă centrală** cu vedere pe zi și pe hartă:

| Tip | Cum intră în coadă |
|---|---|
| Livrare material la șantier | automat, din comandă/livrare |
| Transfer între șantiere | cerere șef de șantier |
| Retur material la magazie | automat, din documentul de retur |
| Evacuare moloz / deșeuri | cerere șef de șantier |
| Transport utilaj | automat, din rezervarea acceptată |

Cele automate sunt diferența dintre o listă de cereri și o planificare reală de transport (§18).

**Evacuarea de moloz** deschide sub-fluxul de **deșeuri reglementate**: evidența deșeurilor, formular de încărcare-descărcare pentru nepericuloase, bon de cântar atașat, raportare SIATD. Nu e opțional (§18, §21 punctul 11).

### 14.4 Oameni și echipe

Nomenclator de persoane cu minimum trei categorii: `angajat` · `șef de șantier` · `subcontractant` (§18.1.1). Echipe (gestiune per echipă, **nu per om**). Calificări legate de rate card.

**SSM** (§21 punctul 12) trăiește aici: instructaje, EIP, permise de lucru (înălțime, foc deschis, spații închise), autorizații cu expirare. **Autorizația expirată blochează asignarea persoanei pe lucrare** — nu avertizează, blochează.

**Provizionarea de conturi** (§10.3): când PM-ul asignează un șef de șantier sau subcontractant care nu are cont, sistemul îl creează automat, cu parolă temporară afișată o singură dată pe ecranul PM-ului. Fără flux de invitații pe email. Același pattern se folosește pentru clienți.

---

## 15. Bani

### 15.1 Facturare emisă

Coadă de facturi de emis, pe tip de contract:

- **Mentenanță:** factură lunară fixă, o linie, **cu raportul lunar atașat obligatoriu**. Butonul de emitere e blocat până raportul e generat și aprobat intern.
- **Individual cu deviz:** din SL client aprobată → factură lunară, o linie, detaliile ca anexă.
- **Individual cu facturare inversă:** proiect → costuri strânse → **generare ofertă din costuri + marjă** → contract/comandă semnat → factură. Ecranul de generare arată costurile pe categorii cu rate card-ul agreat aplicat (regie cu rate card, §20) — tarif/oră pe specialitate, materiale la cost + adaos %.

**e-Factura la emitere** e parte din flux, nu un pas separat: emitere → trimitere → confirmare/eroare, cu stare vizibilă pe factură.

### 15.2 Raportul lunar către client

Modul de sine stătător (§20.1), pentru că *banii se primesc în baza raportului*.

```
RAPORT LUNAR · Contract 4700 · August 2026            Stare: în construcție
──────────────────────────────────────────────────────────────────────────
Fișe incluse       47 inspecții · 12 intervenții · 3 jurnale de lucrare
Poze               312 (comprimate)
Neincluse ⚠        3 fișe nevalidate  [Vezi]
Șablon             Apa Nova — cu branding client
──────────────────────────────────────────────────────────────────────────
[Generează] → asincron → [Aprobă intern] → [Îngheață și trimite]
```

Reguli de interfață: generarea e **asincronă** (sute de poze × 700 obiective), raportul e **versionat și înghețat la emitere**, iar modificările ulterioare ale fișelor apar în luna următoare ca ajustare — nu rescriu raportul trimis. Pentru rapoarte mari, opțiunea de raport interactiv web cu link, în loc de PDF de 400 MB.

### 15.3 Facturi furnizor / SPV

Coadă cu trei stări: **matchate automat** (3-way PO ↔ recepție ↔ factură, sau pe cod SL) · **cu diferențe** · **nerecunoscute**.

Facturile nerecunoscute intră într-un ecran unde li se pune obligatoriu contract + componentă + UL + tip de cheltuială. Nu pot ieși de acolo fără analitica completă — altfel registrul de cost are găuri.

### 15.4 Marjă și plafoane

Vederea transversală peste contracte, pe analitica **„descărcat"** (§12), etichetată ca atare. Comutator **marjă brută (doar directe) / marjă netă (cu regie)** (§22.5) — vizibil permanent, pentru că altfel două ecrane dau două cifre.

Regia: un coeficient % aplicat pe costul direct al fiecărei UL, configurabil per contract, recalculat lunar. Nu chei complicate.

**Raportul de reconciliere „folosit vs descărcat"** (§12): toate liniile unde cele două analitice diferă. Dacă lista crește necontrolat, problema e în firmă.

### 15.5 Închidere de perioadă

Precondiție a regulii de mutare (§13.1, §21 punctul 1, §24.1), deci ecran de fază 0.

```
ÎNCHIDEREA LUNII · August 2026 · Damina SRL
──────────────────────────────────────────────────────────────────
☐ Pontaje validate                    ⚠ 4 zile nevalidate  [Vezi]
☐ Bonuri de consum emise              ⚠ 2 lucrări fără bon  [Vezi]
☐ Recepții înregistrate               ✓
☐ SL-uri aprobate                     ⚠ 1 în așteptare      [Vezi]
☐ Facturi SPV alocate                 ⚠ 3 nerecunoscute     [Vezi]
☐ Rapoarte lunare trimise             ✓
☐ Export Saga confirmat               ✓
──────────────────────────────────────────────────────────────────
[Închide luna]  → blochează data_efect în luna asta
                → costurile mutate ulterior cer document de re-alocare
```

După închidere: lacăt 🔒 în selectorul de perioadă, tot ce e în luna aia e read-only, iar mutările de finanțare comută automat pe mecanica de re-alocare.

### 15.6 Cash-flow

Încasări proiectate la 70 de zile vs plăți către furnizori și subcontractanți, cu garanțiile reținute și avansurile incluse. Fază 5, dar locul lui e aici.

### 15.7 Conector Saga

Ecran de operare, nu de configurare: coadă de export, documente trimise, **documente eșuate cu eroare vizibilă și buton de re-trimitere**, și **raportul lunar de reconciliere** valoare stoc app vs Saga, per gestiune (§20.2).

Undeva vizibil, permanent, o singură propoziție: **adevărul pe stoc e în aplicație; Saga e registrul contabil.** E o regulă organizațională care se rupe în tăcere dacă nu e afirmată în interfață.

---

## 16. Documente și Procese verbale

### 16.1 Arborele de fișiere

Explorer clasic, cu breadcrumb, drag&drop, versionare, coș de gunoi, editare Word/Excel/PowerPoint în browser.

**Folderul se creează automat la deschiderea fiecărei UL**, cu structura implicită:

```
Contract / Obiectiv / Lucrare /
    Deviz · Oferte · Avize · Facturi · PV ·
    Poze/Etapa N · Video · Before-After · Recepții
```

Poți lega manual și un folder existent la o UL.

Din orice entitate, tab-ul `Documente` arată **exact folderul ei**, nu un filtru peste tot arborele. Upload direct din browser, în loturi mici cu retry per parte — relevant pentru poze și video de pe conexiuni proaste de șantier.

De adăugat față de prototip (§19.1): **geotag și timestamp pe poze** (esențial pentru dovada că inspecția s-a făcut acolo, la 700 de obiective), thumbnails reale, OCR și căutare full-text, limită de mărime și retenție pe video, și **stratul de permisiuni** — fără el, izolarea subcontractant-vs-subcontractant nu există.

### 16.2 Procese verbale

Un motor, un șablon per tip. Tipuri livrate: predare-primire utilaj · predare-primire unelte · custodie material la subcontractant · acces în locație · recepție calitativă · **recepție lucrări ascunse** · recepție la terminarea lucrărilor · inventar.

**Fluxul pe ecrane:**

```
Administrare șabloane      încarcă PDF (sau Word convertit), poziționează
                           câmpuri procentual pe pagină, marchează cine
                           completează fiecare câmp și ce e obligatoriu
        ↓
Din entitate (utilaj,      [Generează PV] → precompletat cu ce știe sistemul
lucrare, unealtă)
        ↓
Trimitere                  link unic, tokenizat, FĂRĂ CONT
        ↓
Semnatar                   completează câmpurile lui, semnează pe ecran
        ↓
PDF final                  ardere peste PDF-ul original, la coordonatele
                           salvate → aterizează în folderul UL
```

Stare: `draft → trimis → semnat`, blocat după semnare. Jurnal separat: creat / trimis / **deschis** / semnat — poți arăta „deschis la ora X, semnat la ora Y".

**Înainte de a folosi modulul pentru recepții** e obligatoriu (§19.2, §21 punctul 22): hash SHA-256 al PDF-ului randat stocat lângă semnătură, și **semnare secvențială pe mai multe părți** (șef de șantier → PM → client). Pentru PV de unealtă sau utilaj, semnătura desenată e suficientă.

### 16.3 Expirări și autorizații

O singură coadă pentru tot ce expiră: ITP · RCA · ISCIR · autorizații SSM · certificate de personal · contracte care expiră în N luni · loturi de material. Cu prag configurabil per tip și cu acțiune directă din listă.

---

## 17. Nomenclatoare

Comune între cele 5 firme (§3): produse, furnizori, subcontractanți, clienți, obiective, catalog de operațiuni, șabloane de deviz, șabloane de PV. Separate per firmă: serii și numere de documente.

**Catalogul de operațiuni** (§8.5) merită ecran propriu, pentru că e ce transformă mentenanța din „urmărire analitică" în ceva estimabil:

```
OP-118 · Înlocuire capac cămin carosabil
──────────────────────────────────────────────────────────────
Normă de timp     2,5 h · calificare: instalator
Materiale tipice  capac fontă D400 ×1 · mortar ×5 kg
Cost estimat      412 lei   (manoperă 180 · material 232)
──────────────────────────────────────────────────────────────
Realizat: 34 execuții · cost mediu real 438 lei (+6,3%)
   pe echipe:  Echipa A 401 lei · Echipa B 476 lei ⚠
```

Ultima linie e mecanismul anti-furt și de calitate din §8.5 și e mai valoroasă decât orice structură de gestiuni.

**Biblioteca de articole normate** (§8.2 modul 3) e activul pe termen lung. Ecranul ei arată pentru fiecare articol de câte ori a fost folosit și în ce lucrări — ca să se vadă că merită întreținută.

**Tarife:** rate card pe calificare **istoricizat** (§9), tarif orar intern per utilaj revizuit anual (§18), preț motorină pe zi, coeficient de regie per contract.

---

## 18. Administrare

**Firme** — CUI, serii de documente proprii, credențiale SPV, gestiuni proprii, setări de e-Factura.

**Utilizatori și roluri** — atribuire de rol + spațiu de lucru (birou / teren / portal). Ecranul spune explicit ce **nu** vede rolul, nu doar ce vede. Izolarea prețurilor și izolarea subcontractant-vs-subcontractant apar aici ca **proprietăți fixe ale rolului, needitabile** — sunt constrângeri de arhitectură, nu setări (§21 punctul 8).

**Praguri și reguli** — indexare implicită (5%), prag mentenanță→Delta (2.000 lei), praguri de alertă (80% buget, 6 luni expirare contract, prag Delta la mijlocul lunii), termene de rezervare, retenție video.

**Audit trail** — cine, ce, când, valoare veche → nouă. Obligatoriu și filtrabil pe: mutări de finanțare, aprobări, modificări de buget, decizii de rutare, închideri de lună, modificări de preț.

**Integrări** — SPV, e-Factura, e-Transport, cutia poștală de tichete, conectorul Saga, prețul motorinei.

---

# PARTEA C — FLUXURILE CAP-COADĂ ÎN APLICAȚIE

Fiecare flux e descris ca **secvență de ecrane și clickuri**, cu rolul care acționează.

## 19. Flux 1 — de la email la lucrare încasată

```
[Client]        trimite email „infiltrații la subsol Berceni"
     ↓
[Sistem]        Cereri › Inbox — cerere nouă, stare „neprocesată"      🔔 birou
     ↓
[Birou]         triază 30s: obiectiv Berceni, contract 4700, tip „tichet client"
     ↓
[Constatator]   app teren › deschide cererea › „Constatare la fața locului"
                poze, suprafețe, notițe, operațiuni din catalog
     ↓
[Sistem]        Cerere › Evaluare — valoare estimată 3.400 lei (din catalog)
     ↓
[PM]            Cerere › Decizie — sistemul propune „Lucrare mică pe Delta august"
                PM confirmă + motiv                           [Decide și creează]
     ↓
[Sistem]        atomic: Lucrare L-241 + Alocare(Delta, aug, 3.400)
                        + folder documente + legătură ← cerere
     ↓
[PM]            Lucrare › Deviz — pornește din biblioteca de articole normate
                Lucrare › Etape — 2 etape cu buget de material
                Lucrare › Subcontractanți — pachet „sanitar" → 2 firme
     ↓
[Subc]          portal › ofertează pachetul
[PM]            acceptă → pachetul devine baza SL-urilor
     ↓
[Șef șantier]   app teren › jurnal, necesar material, pontaj, poze înainte/după
     ↓
[Subc]          portal › declară cantități pe SL
[Șef șantier]   app teren › verifică linie cu linie (cantități, nu prețuri)
[PM]            birou › aprobă → cod SL generat
     ↓
[Subc]          descarcă SL, emite factură cu codul SL
[Sistem]        SPV › matching automat pe cod SL
     ↓
[PM]            Lucrare › Închidere — checklist complet, marjă finală
     ↓
[Financiar]     Bani › Facturare — Delta e deja în abonamentul lunar;
                lucrarea a consumat plafonul de venit Delta al lunii august
```

## 20. Flux 2 — luna de mentenanță

```
1–31   [Teren]      inspecții când au drum (fără notificări)
                    fiecare punct NOK → rezolvat / intervenție / propunere
                    intervenții din tichete, cu fișă + materiale + ore
1–31   [Birou]      Obiective › Acoperire — câte din N obiective, cu restanțe
10, 20 [PM]         Panou › gradul de umplere Delta
                    dacă e sub prag → Cereri › Backlog → promovează propuneri
25–31  [PM]         validează fișele, setează data_efect
       [Financiar]  Bani › Raport lunar — generează, aprobă intern, îngheață
       [Financiar]  Bani › Facturare — factură fixă + raport atașat + e-Factura
       [Financiar]  Bani › Închidere de perioadă — checklist → 🔒
```

## 21. Flux 3 — lucrarea cu subcontractanți

Detaliat la §12.2. Cheia de interfață: **trei roluri, trei ecrane, trei niveluri de vizibilitate pe aceleași rânduri.**

| | PM (birou) | Șef de șantier (teren) | Subcontractant (portal) |
|---|---|---|---|
| Prețuri | vede tot | **nu vede deloc** | vede (negociază) |
| Deviz | creează, editează | nu vede | doar pachetul lui |
| Cantități | vede tot, aprobă | declară / corectează, linie cu linie | declară inițial |
| Suplimentări | decide | verifică (ok / suspect) | propune |

## 22. Flux 4 — materialul, de la necesar la cost

```
[Șef șantier]  Lucrare › Materiale › [Necesar] (etapa precompletată)
       ↓            SAU  app teren › 3 tap-uri (Canal B, urgență)
[Magazie]      filtrul de 24h: acopăr din stoc / din retur / trimit mai departe
       ↓            (nedecise → curg automat la achiziții)
[Achiziții]    Cerere de ofertă → Comparare → PO cu analitică pe linie
       ↓            → registrul de cost, stadiu ANGAJAT ← plafonul se colorează acum
[Furnizor]     confirmă termen
[Teren/Magazie] Recepție (aviz fotografiat) → NIR
       ↓            → stadiu RECEPȚIONAT
[Transport]    automat în coada de transport, dacă e livrare la șantier
[Șef șantier]  material intră în gestiunea șantierului
               bon de consum lunar (sau auto-consum, dacă lucrarea e mică)
       ↓            → stadiu CONSUMAT, cu contract + componentă + obiectiv + etapă
[SPV]          factura vine → matching 3-way → stadiu FACTURAT
       ↓            diferențe de preț → notă de ajustare → recalcul CMP înainte
[Închidere]    inventar șantier → retur la magazie → aviz de retur
```

Alertă automată la **80%** din cantitatea de deviz, nu la 100% (§16).

## 23. Flux 5 — utilajul

```
[Șef șantier]  app teren › Solicitare utilaj (categorie, nu utilaj anume)
[Sistem]       arată doar ce se pretează activității ȘI e liber pe interval
[Mgr flotă]    Resurse › Utilaje › Solicitări — alocă utilajul concret
       ↓            acceptă → planificare + cerere de transport, AUTOMAT
       ↓            solicitantul devine automat responsabil
[Mgr flotă]    din planificare › [Generează PV predare] (precompletat)
[Ambii]        semnează pe ecran → datele de predare se blochează
[Teren]        fișe de motorină (litri) + ore de contor · fără lei
       ↓            → cost pe lucrarea din fișă / din planificare
[Teren]        observație „frâna funcționează necorespunzător" + poză
[Mgr flotă]    răspunde în app · decide imobilizarea
       ↓            imobilizat → NU se calculează costuri de exploatare
       ↓            → fișă de reparație, cu legătură în ambele sensuri
[Ambii]        PV de primire (etapa 2) → contorul de ore se actualizează automat
```

## 24. Flux 6 — închiderea de lună

Ecranul de la §15.5. Ce contează ca proiectare: checklist-ul **nu e informativ, e blocant**, iar fiecare rând are link direct la ce trebuie rezolvat. Dacă închiderea e opțională, nu se face niciodată, și toate cifrele devin nereproductibile.

## 25. Flux 7 — mutarea finanțării

Butonul „Mută finanțarea" există pe orice UL. Ecranul se comportă diferit după starea lunii (§13.1):

```
MUTĂ FINANȚAREA · Intervenția #1841
──────────────────────────────────────────────────────────────────────
De la:  Contract 4700 · Mentenanță · august 2026
La:     Contract 4700 · Delta ▾    · august 2026 ▾
Costuri deja înregistrate: 800 lei — se mută cu unitatea de lucru
Motiv (obligatoriu): _______________________________________________
──────────────────────────────────────────────────────────────────────
 LUNA E DESCHISĂ  → se rescrie „descărcat" pe liniile existente
 LUNA E ÎNCHISĂ 🔒 → se emite document de re-alocare în luna curentă:
                     scoate 800 din Mentenanță/aug, pune pe Delta/sept
                     ambele mișcări rămân vizibile
──────────────────────────────────────────────────────────────────────
Nu se schimbă niciodată: data documentului, obiectivul, analitica „folosit"
```

Ecran obligatoriu în modulul Bani: **lista re-alocărilor lunii** — valoare, de la ce componentă, la ce componentă, cine a decis, de ce. Dacă lista e lungă în fiecare lună, decizia inițială de rutare se ia prost, și problema e în proces (§13.1).

---

# PARTEA D — TRANSVERSALE

## 26. Aplicația de teren (mobil)

**Un singur login, un singur clopoțel, o singură coadă de sincronizare offline** (§18.1). Nu module separate — utilajele, jurnalul, materialele și SL-urile stau lângă.

Ecranul de start e o listă de **ce am eu azi**, nu un meniu:

```
┌─────────────────────────────┐
│  AZI · 14 august            │
│                             │
│  🏗 L-233 Berceni           │
│     etapa 2 · 3 oameni      │
│  🔧 Intervenția #1852       │
│     Glina · de făcut        │
│  🚜 EXC-01 la tine          │
│     PV deschis din 12.08    │
│  📋 2 linii de verificat    │
│     pe SL ElectroX          │
│                             │
│  ⚠ 4 de sincronizat         │
└─────────────────────────────┘
                    [ ＋ ]
```

Butonul ＋ deschide cele patru acțiuni frecvente: **Necesar material · Fișă de intervenție · Adaugă în jurnal · Solicită utilaj**. Regula de la §24.1: dacă șeful de șantier are nevoie de 7 tap-uri ca să comande material, dă telefon la magazie și toată trasabilitatea rămâne goală. Ținta e **3 tap-uri**.

Cele 8 ecrane ale aplicației de teren: `Azi` · `Inspecție` · `Intervenție` · `Jurnal` · `Necesar material` · `Bon de consum` · `Pontaj` · `Utilaje și PV` · `Verificare SL`.

**Offline-first**, obligatoriu (§21 punctul 15) — subsoluri, stații, guri de canal. Coada de sincronizare e vizibilă permanent, cu contor și cu ecran de conflicte. Pozele se urcă în fundal, în loturi mici, cu retry per parte.

**Zero lei**, pe toate ecranele, la nivel de date, nu de afișare.

**Geotag + timestamp automat pe fiecare poză** (§19.1) — la 700 de obiective, e singura dovadă că inspecția s-a făcut acolo.

---

## 27. Portalurile externe

### 27.1 Portal subcontractant

Acces prin cont provizionat automat de PM (§10.3). Vede **doar ce e al lui** — izolarea A-față-de-B e constrângere de arhitectură, nu setare.

Ecrane: `Pachetele mele` (cu prețuri — negociază pe ele) · `Situații de lucrări` (declară cantități, vede răspunsul verificării) · `Suplimentări` (propune) · `Facturile mele` (cu cod SL) · `Garanții reținute` (sold și scadențar) · `PV-uri` · `Utilaje în custodie`.

### 27.2 Portal client ⏳

Fază târzie. `Tichetele mele` (creare + urmărire SLA) · `Rapoarte lunare` (arhivă) · `Istoric pe obiectiv` · `Facturi`. Semnarea PV-urilor se face oricum prin **link tokenizat fără cont** (§19.2), deci portalul nu e o precondiție.

---

## 28. Notificări, sarcini, cozi de lucru

Trei mecanisme diferite, ușor de confundat:

| Mecanism | Ce e | Unde apare |
|---|---|---|
| **Coada de lucru** | listă de obiecte care așteaptă acțiunea mea | badge în sidebar + card în Panou |
| **Notificarea** | eveniment punctual, o dată | clopoțel |
| **Alerta** | prag depășit, persistă până se rezolvă | banner pe entitate + card în Panou |

Notificările livrate (§21 punctul 10, §18.1): buget la 80% · SL de aprobat · suplimentare de decis · document/autorizație expirat · stoc sub minim · lot aproape expirat · contract care expiră în 6 luni · **grad Delta sub prag la mijlocul lunii** · solicitare de utilaj în așteptare · observație din teren nerezolvată · PV rămas deschis · revizie scadentă pe dată **sau** pe ore · SLA de tichet aproape depășit · factură SPV nerecunoscută.

**Regula anti-zgomot** (din §22.2): nu se trimit notificări către teren pentru lucruri care sunt vederi de birou. Inspecțiile nu notifică pe nimeni; acoperirea se măsoară la birou.

---

## 29. Matricea de interconectare

Ce se deschide din ce. Astea sunt legăturile care trebuie să existe și în panoul de Legături, și ca butoane de acțiune.

| Din | Ajungi direct la |
|---|---|
| Cerere | UL creată · obiectiv · contract · emailul original · backlog |
| Contract | componente → UL-uri finanțate · obiective · SL-uri · facturi · raport lunar |
| Obiectiv | istoric transversal · toate UL-urile · contracte · profil de inspecție · poze cu geotag |
| Inspecție | punctele NOK → intervenții create · propuneri în backlog · obiectiv |
| Intervenție | cererea sursă · bonuri de consum · pontaj · lucrarea în care a fost promovată |
| Lucrare | deviz client ↔ deviz intern ↔ pachete ↔ SL · etape · PO-uri · utilaje · transporturi · PV-uri · folder |
| Poziție de deviz | poziții interne mapate · linii de pachet · linii de SL · necesar → PO → recepție → consum |
| PO | necesarul sursă · lucrarea și etapa · recepția · NIR · factura SPV · transportul |
| Linie de stoc | NIR-ul de intrare · transferurile · bonurile de consum · lotul · rezervările |
| SL | pachetul · devizul · verificarea șefului de șantier · factura subc · garanția reținută · SL-ul client derivat |
| Utilaj | planificări · PV-uri · fișe motorină · reparații ↔ observațiile care le-au generat · lucrările încărcate |
| Reparație | observația din teren (ambele sensuri) · facturile (mai multe) · utilajul · imobilizarea |
| Linie de cost | documentul sursă (bon, SL, factură, fișă, pontaj) · UL · etapă · contract folosit **și** descărcat |
| Factură emisă | SL-ul client · raportul lunar atașat · contractul · starea e-Factura · încasarea |
| PV | entitatea sursă (utilaj / lucrare / unealtă) · șablonul · PDF-ul în folderul UL · jurnalul de semnare |

---

## 30. Reguli de interfață obligatorii

Ies din testarea reală (§18.1.7) și din regulile de business. Se aplică în toată aplicația, nu doar unde au apărut.

1. **Fereastra modală nu se închide la click în afara ei.** Închidere doar prin buton explicit, cu confirmare dacă există modificări nesalvate. S-au pierdut date reale din cauza asta.
2. **Coerența temporală se impune în model, nu prin instruire.** Fără dată de retur înaintea predării. Fără finalizare înaintea începutului. Fără două documente deschise pe același obiect.
3. **Documentele deschise se evidențiază vizual**, în capul listei, nu ascunse într-un filtru.
4. **Cifrele calculate de sistem nu se editează manual** (contor de ore, cumulate pe SL, CMP). Se corectează prin document, nu prin suprascriere.
5. **Orice acțiune ireversibilă cere motiv scris**, salvat în audit trail: mutare de finanțare, anulare de document, suprascriere de preț, închidere de lună.
6. **Câmpurile analitice obligatorii chiar blochează salvarea** (etapă pe linia de necesar, contract+componentă+UL pe factura nerecunoscută). Dacă sunt opționale, în 3 luni 70% sunt goale și raportul e inutil (§22.4).
7. **Dashboard-urile separă corect pe categorii.** La mai multe categorii de utilaje sau tipuri de obiective, agregările nu se amestecă.
8. **Imaginile nu se decupează** în paginile de detaliu.
9. **Fiecare ecran cu cifre declară analitica** pe care e construit — „folosit" sau „descărcat" — și dacă marja e brută sau netă.
10. **Selectorul de perioadă arată lacătul** pe lunile închise, pe orice ecran.
11. **Nu există ecran fără stare goală proiectată.** Lista goală explică ce e lista și cum se umple, cu butonul de acțiune. La 700 de obiective și 40 de utilizatori, multe liste sunt goale la început și acolo se pierde adopția.
12. **Ținta de tapuri pe teren: 3.** Peste, se dă telefon la magazie și trasabilitatea rămâne goală (§24.1).

---

## 31. Ordinea de construcție a interfeței

Aliniată la fazarea din §23, dar exprimată în ecrane.

| Fază | Ecrane care trebuie să existe | Ce se portează din prototipuri |
|---|---|---|
| **0** | shell-ul de navigare (sidebar + breadcrumb dublu + tab-uri + Legături) · selector firmă/perioadă · căutare globală · contracte + componente + plafoane · obiective · pagina generică de UL · registrul de cost cu drill-down · **închiderea de lună** · arborele de fișiere · utilizatori și roluri | **File management** (Postgres + R2) se portează |
| **1** | app de teren (8 ecrane, offline) · inspecții + checklist-uri · intervenții · Cereri + Inbox email + Decizie + Backlog · gestiuni de echipă · consum pe fișă · **raportul lunar** · Panoul PM cu gauge-ul Delta | — |
| **2** | editor de deviz (4 importatori) · mapare client↔intern · etape + Gantt · jurnal · pachete · **lanțul SL cu cele 3 vizibilități** · buget pe etapă · portal subcontractant | **Situații de lucrări** (execuTrack) se portează: izolarea prețului la nivel de date, verificarea linie cu linie, suplimentările atomice, importul Excel |
| **3** | cele 3 canale de achiziție · filtrul de 24h · comparare oferte · PO cu analitică · recepții · stoc/gestiuni/loturi · transferuri și inventare · SPV + matching 3-way · conector Saga + reconciliere | — |
| **4** | flotă (cele 2 perspective) · solicitare → alocare → planificare → PV → observație → reparație · calendar de flotă cu decalare în masă · unelte · transporturi + hartă + deșeuri · generator de PV | **FleetOps** și **Procese verbale** se portează; de adăugat: mentenanță preventivă pe ore, facturi multiple pe reparație, hash la semnare, semnare secvențială |
| **5** | e-Factura · garanții · avansuri · cash-flow · consolidare intercompany · marjă pe an contractual + proiecție pe 4 ani · forecast · portal client | — |

**Ce trebuie să fie corect din faza 0, altfel se rescrie tot:** shell-ul de navigare recursiv, separarea celor patru spații de lucru, izolarea prețurilor la nivel de date, dubla analitică pe fiecare ecran de cifre, și închiderea de perioadă. Restul se adaugă incremental fără să rupă nimic.

---

## Anexă — verificarea acoperirii în interfață

Fiecare caz din anexa documentului de arhitectură, mapat pe ecranele de aici.

| Caz | Unde se face în aplicație |
|---|---|
| Reabilitare cu proiectare + deviz | Lucrare › Deviz (mod 1/2/3) › Etape › Subcontractanți › Situații › Închidere |
| Apartament, facturare inversă | Lucrare › Costuri → Bani › Facturare › „Generează ofertă din costuri + rate card" |
| Inspecție lunară echipă proprie | app teren › Inspecție (checklist din profilul obiectivului) |
| Inspecție de subcontractant | Contract › Subcontractanți + repartizare proporțională cu inspecțiile făcute (§22.3) |
| Intervenție echipă proprie | app teren › Fișă de intervenție + catalog de operațiuni |
| Intervenție subcontractant | Bani › Facturi furnizor › alocare pe UL |
| Tichet > 2.000 lei → Delta | Cerere › Evaluare › Decizie (sistemul propune Delta) |
| Lucrare spartă pe 3 luni de Delta | Cerere › Decizie › „Împărțită pe 2–3 luni" → 3 alocări · Contract › Componente |
| Tichet > Delta → contract nou | Cerere › Decizie › „Oportunitate" → flux de ofertare |
| Lucrare pe componenta Lucrări | Lucrare · SL se oprește la aprobarea PM, fără SL client |
| Lucrare mutată mentenanță → individual | UL › „Mută finanțarea" (§25) + Bani › Re-alocările lunii |
| Material folosit pe A, descărcat pe B | dubla analitică pe bonul de consum + raport de reconciliere |
| Fișă din iulie raportată în august | `data_efect` la validarea fișei + Bani › Raport lunar |
| Facturi între firmele grupului | transfer între firme → aviz+factură+NIR automat · Panou grup › consolidat |
| Utilaj, motorină, ore, reparație | Resurse › Utilaje (§23) |
| Transport moloz / retur / între șantiere | Resurse › Transporturi + sub-fluxul de deșeuri |
| Necesar unelte cu PV | Resurse › Unelte + Documente › Procese verbale |
| Comandă mentenanță prin magazie | Canal B, app teren › 3 tap-uri |
| Comandă lucrare direct în șantier | Canal C, Lucrare › Materiale + filtrul de 24h |
| Rezervare material pentru lucrare | Aprovizionare › Rezervări (marcate, nu mutate) |
| Factură SPV fără PO cunoscut | Bani › SPV › coada „nerecunoscute", analitică obligatorie |
