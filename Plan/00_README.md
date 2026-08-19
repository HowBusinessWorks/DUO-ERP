# Damina ERP — planul de execuție

**Pașii 01–10 sunt fazele 0 și 1** (fundația + mentenanța). **Pașii 11–15 sunt faza 2** (lucrările:
devize, pachete de subcontractant, situații de lucrări). Fazele 3–5 se planifică ca o a treia serie,
după ce faza 2 e în producție.

## Cum se folosește folderul ăsta

**Înainte să începi orice pas, deschide `PROGRESS.md`.** E jurnalul de progres al întregului plan — spune la ce pas suntem, ce s-a executat deja, ce verificări trec și ce observații/decizii au fost notate de sesiunile anterioare. **După ce termini un pas (sau o bucată semnificativă din el), și de fiecare dată când observi ceva relevant în timpul codării sau testării, actualizează `PROGRESS.md`.** Asta e obligatoriu, nu opțional — e singurul fel în care sesiunile viitoare, cu context curat, știu ce s-a întâmplat înainte.

Fiecare fișier `NN_*.md` e **un pas independent**, gândit să fie rulat într-o **sesiune AI separată, cu context curat**. Fiecare pas:

- conține tot contextul de care are nevoie (nu presupune că ai citit ceilalți pași);
- livrează **funcționalitate completă**, nu „jumătate de feature";
- se termină cu un **set de verificări concrete** pe care le poți rula tu ca să vezi că e ok;
- spune explicit **ce NU trebuie făcut** în pasul respectiv (asta previne cel mai mult haosul).

**Regula de aur pentru sesiunea care execută un pas:** dacă ceva nu e specificat în fișierul pasului sau în documentele-sursă indicate acolo, **nu inventa**. Notează întrebarea în `Plan/QUESTIONS.md` și alege varianta cea mai simplă și reversibilă.

## Documentele-sursă (adevărul, în ordinea autorității)

| Document | Ce conține | Cale |
|---|---|---|
| Structura cap-coadă | modelul de business, regulile economice, fazarea | `Initial_Context/DaminaStructuraCapCoada FInal.md` |
| Structura funcțională | ecrane, meniuri, tab-uri, fluxuri de UI | `Initial_Context/Damina_Aplicatie_Structura_Functionala.md` |
| Plan tehnic infrastructură | stack, schema DB, RLS, storage, joburi, CI | `PLAN_TEHNIC_INFRASTRUCTURA.md` |

Dacă apare o contradicție: **business > funcțional > tehnic**.

## Ordinea pașilor și dependențele

```
01 Fundația (repo, DB, storage, joburi, CI)
      ↓
02 Identitate, acces, RLS, audit, perioade, serii
      ↓
03 Shell UI, design system, notificări, nomenclatoare
      ↓
04 Contracte, componente, plafoane · Obiective
      ↓
05 Unitatea de Lucru, finanțare, etape, mutarea finanțării
      ↓
06 Registrul de cost, dubla analitică, rollup-uri, închiderea lunii
      ↓
07 File management (Postgres + Cloudflare R2)
      ↓
08 Cereri, catalog de operațiuni, decizia de rutare, backlog
      ↓
09 Fișe de lucru: inspecții, intervenții, pontaj, consum
      ↓
10 Aplicația de teren (PWA offline) + raportul lunar
      ↓                                  ── aici se termină faza 1 ──
11 Devizul client + intern, maparea N:M, biblioteca de articole normate
      ↓
12 Pachete de subcontractant + portalul lor (prima dată cu date reale)
      ↓
13 Situațiile de lucrări: declarare → verificare pe teren → aprobare → cod SL
      ↓
14 Suplimentări, garanții de bună execuție, SL-ul către client
      ↓
15 Execuția: Gantt, buget pe etapă, necesar pe etape, închiderea lucrării
```

Pașii **nu se pot reordona**. Fiecare pas verifică la început precondițiile din pasul anterior și se oprește dacă nu sunt îndeplinite.

**Faza 2 (11–15) e strict serială în interiorul ei** — devizul e sursa pachetului, pachetul e sursa
situației de lucrări. Se poate executa însă **în paralel cu faza 4** (utilaje, unelte, PV), care nu
depinde de nimic din ea.

## Lista pașilor

| # | Fișier | Ce livrează | Acoperă din planuri |
|---|---|---|---|
| 01 | `01_Fundatie_Infrastructura.md` | monorepo, Next.js, Supabase, Drizzle, R2, pg-boss, CI, observabilitate, chei API | Tehnic §3, §4.1–4.2, §5, §9, §10, §14, §16 |
| 02 | `02_Identitate_Acces_Control.md` | Auth, 4 personas, roluri Postgres, RLS, izolarea prețului, audit, perioade, serii | Tehnic §4.3–4.5, §4.8, §4.10, §4.11, §8, §17 |
| 03 | `03_Shell_UI_Nomenclatoare.md` | shell recursiv, pagina fractală, i18n, notificări/cozi, nomenclatoare | Funcțional §1–§6, §17, §28, §30 |
| 04 | `04_Contracte_Obiective.md` | contracte, componente, plafoane, indexare, obiective, profile de inspecție | Business §4, §5 · Funcțional §8, §9 |
| 05 | `05_Unitate_De_Lucru_Finantare.md` | UL cu 3 tipuri, alocări, etape, promovare, mutarea finanțării | Business §6, §13 · Funcțional §11, §25 |
| 06 | `06_Registrul_De_Cost_Inchidere.md` | registrul de cost, dubla analitică, rollup-uri, marjă, închiderea de lună | Business §11, §12 · Tehnic §4.6–4.9 |
| 07 | `07_File_Management_R2.md` | arbore de fișiere, upload multipart, EXIF/geotag, permisiuni, foldere automate | Tehnic §9, Anexa E |
| 08 | `08_Cereri_Rutare_Backlog.md` | cereri, inbox email, catalog de operațiuni, decizia de rutare, backlog Delta | Business §7, §8.5 · Funcțional §10 |
| 09 | `09_Fise_De_Lucru.md` | inspecții + checklist, intervenții, pontaj, gestiune de echipă, bon de consum | Business §9, §17 · Funcțional §11.2–11.6 |
| 10 | `10_Teren_Offline_Raport_Lunar.md` | PWA offline, sync, media, cele 8 ecrane de teren, raportul lunar | Tehnic §11 · Funcțional §26, §15.2 |

### Faza 2 — Lucrările

| # | Fișier | Ce livrează | Acoperă din planuri |
|---|---|---|---|
| 11 | `11_Deviz_Articole_Normate.md` | deviz client (versionat) + intern, maparea N:M, biblioteca de articole normate, cele 4 importatoare | Business §8 · Funcțional §12.1, §17 · Tehnic D.3 |
| 12 | `12_Pachete_Portal_Subcontractant.md` | pachete din devizul intern, ofertare linie cu linie, portalul subcontractantului, provizionarea de conturi, costul `angajat` | Business §8.3, §10.3 · Funcțional §27.1 |
| 13 | `13_Situatii_De_Lucrari.md` | SL lunară per pachet, cele 5 cumulate, verificarea de teren fără preț, aprobarea, codul SL | Business §10 · Funcțional §12.2 |
| 14 | `14_Suplimentari_Garantii_SL_Client.md` | suplimentări atomice, garanții de bună execuție (ambele sensuri), intrarea din spate, SL-ul către client | Business §10.2 · Funcțional §12.2–12.3 |
| 15 | `15_Executia_Lucrarii.md` | Gantt cu buget vs consum pe etapă, necesar de material pe etape, Înainte/După, închiderea lucrării | Business §9, §15 · Funcțional §11 |

**~22 de tabele, 14 sub-pași.** Numerele de migrare rezervate: **`0040`–`0069`**.

## Ce e în afara pașilor 01–15

Pașii 01–10 acoperă **faza 0 (fundația) și faza 1 (mentenanța)**; pașii 11–15 acoperă **faza 2 (lucrările)**. Rămân fazele 3–5 (achiziții și stoc complet, flotă și PV, e-Factura și consolidare), care se planifică ca o a treia serie de pași.

Motivul pentru care nu sunt planificate încă: fazele 3–5 înseamnă încă ~66 de tabele, iar planificarea lor se face mai bine după ce faza 2 a arătat cât de mult din deviz e chiar folosit în practică — necesarul de material și analitica de PO ies direct din el.

**Fazele 3 și 4 se pot executa în paralel** (§23 din documentul de business o spune explicit). Faza 5 are nevoie de date reale din 1–3, deci e ultima.

## Convenții valabile în toți pașii

- **Limbă:** cod și DB în engleză; domeniu intraductibil în română fără diacritice (`deviz`, `aviz`, `nir`, `pontaj`, `situatie_lucrari`); UI 100% română cu diacritice, prin dicționar.
- **Bani:** `numeric(14,2)` în DB, `Decimal.js` (tipul `Money`) în aplicație. Niciodată `float`/`number`.
- **ID-uri:** UUID v7 peste tot.
- **Acces la DB:** exclusiv prin `withActor()`. Nu există altă poartă.
- **Migrații:** imutabile după merge. Corecția = migrare nouă.
- **Nimic prin dashboard-ul Supabase.** Tot ce e schemă, politică sau grant e migrare versionată în repo.
