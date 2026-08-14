# Damina ERP — planul de execuție în 10 pași

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
```

Pașii **nu se pot reordona**. Fiecare pas verifică la început precondițiile din pasul anterior și se oprește dacă nu sunt îndeplinite.

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

## Ce e în afara celor 10 pași

Pașii 01–10 acoperă **faza 0 (fundația) și faza 1 (mentenanța)** din fazarea documentelor — adică un ERP funcțional cap-coadă pentru contractele de mentenanță. Fazele 2–5 (devize și SL cu subcontractanți, achiziții și stoc complet, flotă și PV, e-Factura și consolidare) se planifică ca o a doua serie de pași, după ce faza 1 e în producție.

Motivul: fazele 2–5 înseamnă încă ~110 tabele; comprimate în aceiași 10 pași ar fi produs pași imposibil de executat corect într-o sesiune.

## Convenții valabile în toți pașii

- **Limbă:** cod și DB în engleză; domeniu intraductibil în română fără diacritice (`deviz`, `aviz`, `nir`, `pontaj`, `situatie_lucrari`); UI 100% română cu diacritice, prin dicționar.
- **Bani:** `numeric(14,2)` în DB, `Decimal.js` (tipul `Money`) în aplicație. Niciodată `float`/`number`.
- **ID-uri:** UUID v7 peste tot.
- **Acces la DB:** exclusiv prin `withActor()`. Nu există altă poartă.
- **Migrații:** imutabile după merge. Corecția = migrare nouă.
- **Nimic prin dashboard-ul Supabase.** Tot ce e schemă, politică sau grant e migrare versionată în repo.
