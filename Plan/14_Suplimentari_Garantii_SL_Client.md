# Pasul 14 — Suplimentări, garanții de bună execuție, SL-ul către client

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** cele trei lucruri care, dacă nu sunt modelate, se întâmplă oricum — pe lângă sistem. Suplimentările se ascund în cantități umflate, garanțiile se țin în Excel, iar facturile fără SL intră pe ușa din dos fără să le numere nimeni.
> **Pasul cu cea mai mare valoare pe linie de cod din faza 2.** Trei module mici care închid trei găuri mari.

---

## 0. Context de business (esențial)

### Suplimentările — de ce nu se pot amâna

*„Se întâmplă mereu; dacă nu e modelat, oamenii o vor «ascunde» în cantități umflate pe liniile existente"* (§10.2).

Asta e observație de teren, nu ipoteză. La pasul 13 ai blocat declararea peste cantitatea contractată cu `QUANTITY_EXCEEDS_CONTRACT`. Blocajul e corect, dar **fără o ieșire legitimă devine presiune**: omul care chiar a executat mai mult va găsi o linie unde să pună diferența.

Fluxul, cu trei roluri și trei verbe diferite (§12.2):

```
Subcontractant  PROPUNE      →  Sef de santier  VERIFICA (ok|suspect + comentariu)
                                              →  PM  DECIDE (accepta|respinge)
```

**La acceptare, suplimentarea aterizează ÎN ACEEAȘI TRANZACȚIE în două locuri** (§10.3):

1. în **devizul permanent** — categoria „Lucrări suplimentare", creată o singură dată și reutilizată;
2. în **situația curentă**, ca linie nouă legată de noua operațiune.

*„Un pas, nu doi."* Dacă ar fi în doi timpi, ai putea rămâne cu un suplimentar acceptat care nu s-a reflectat nicăieri în bani — adică exact starea pe care modelul o evită.

### Garanțiile — de ce acum și nu la faza 5

*„Lipsește complet din descriere și e standard în construcții"* (§10.2). E pe lista de **critice** din §21, punctul 2. Iar prototipul execuTrack, care are aproape tot restul, **nu are nici el garanțiile** — rămân de construit de la zero (§10.3, ultima frază).

Motivul pentru care nu pot aștepta faza 5: **reținerea se aplică automat la fiecare SL.** Un modul care apare peste trei faze găsește zeci de SL-uri emise fără reținere, și toate trebuie recalculate manual. Reținerea din trecut nu se poate reface din memorie.

Două fețe, aceeași structură, oglindite (§12.3):

| | Reținute **de la** subcontractanți | Reținute **de** client, de la noi |
|---|---|---|
| Procent | per contract de subcontractant | per contract de client |
| Reținere | automată la fiecare SL de subcontractant | automată la fiecare SL client / factură |
| Eliberare | la recepție + la expirarea garanției | idem |
| Unde se vede | sold + scadențar | idem, **plus cash-flow** (faza 5) |

### Intrarea din spate — un contor, nu o interdicție

Facturi de subcontractant **fără SL în sistem**: istorice, sau prestații mici (§10.2). Se introduc direct, cu **contract + componentă + UL + tip de cheltuială obligatorii**, marcate `fără SL`.

*„Un contor vizibil în dashboard-ul financiar arată procentul lor — dacă e mare, fluxul nu e adoptat, și asta e o problemă de management, nu de software"* (§12.2).

Citește ultima propoziție încă o dată. **Nu construi validări care să descurajeze intrarea din spate.** Rostul ei e să existe și să fie numărată. O ușă din dos pe care o închizi cu forța devine o ușă din dos în Excel, unde n-o mai numeri deloc.

### SL-ul către client — pasul 6a

Doar la **contract individual**. La mentenanță lanțul se oprește la aprobare (pasul 6b, deja implementat la 13).

Cantitățile urcă **prin maparea N:M** făcută la pasul 11. Aici se vede de ce a existat maparea: fără ea, n-ai cum să traduci „280 mp declarați pe poziția internă 47" în poziția pe care o vede clientul.

**Decizia (19 august 2026): tabela și derivarea intră în faza 2; emiterea facturii rămâne faza 5.** Același tipar ca la raportul lunar, unde blocajul de facturare s-a implementat ca precondiție înainte să existe ecranul de facturare.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §10.2 (tot — suplimentări, garanții, intrarea din spate), §10.3 (atomicitatea), §21 punctul 2 |
| `Damina_Aplicatie_Structura_Functionala.md` | §12.2 (suplimentări, intrarea din spate), §12.3 (garanțiile, ecranul), §15.4 |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | Anexa D.3, §4.6 (registrul de cost) |
| `Plan/13_Situatii_De_Lucrari.md` | tot |
| `Plan/11_Deviz_Articole_Normate.md` | §3.1 (maparea N:M) |

## 2. Precondiții

- **Pașii 11, 12 și 13 complete.** Există SL-uri aprobate, cu cod, și mapări client ↔ intern.
- `app.contracts` cu tipurile `mentenanta` și `individual` (pasul 04).
- Registrul de cost, cu storno (pasul 06).
- Portalul de subcontractant, cu meniul lui (pasul 12).

**Migrări: `0049`–`0052`.**

---

## 3. Ce livrezi

### 3.1 Suplimentările (migrarea `0049_sl_supplements`)

```
sl_supplements → sl_id, package_id, proposed_by (subcontractor person),
                 name, uom, quantity, unit_price, total,   ← PRET
                 justification text not null,
                 status: propusa|verificata|acceptata|respinsa,
                 verified_by, verification_status: ok|suspect,
                 verification_comment, verified_at,
                 decided_by, decided_at, decision_comment,
                 -- completate ATOMIC la acceptare:
                 created_deviz_line_id, created_sl_line_id
```

**`justification` e `not null` cu `check` de text ne-gol.** O suplimentare fără motiv scris e o cantitate umflată cu formular.

Cele două coloane `created_*` sunt **dovada atomicității**: dacă statusul e `acceptata` și una dintre ele e `null`, tranzacția n-a fost atomică. Adaugă un `check` care impune asta — e ieftin și prinde exact defectul pe care §10.3 îl avertizează.

**`acceptSupplement` face, într-o singură tranzacție:**

1. găsește sau creează categoria „Lucrări suplimentare" pe devizul intern (**o singură dată, reutilizată**);
2. scrie linia nouă de deviz;
3. scrie linia nouă în SL-ul curent, legată de ea;
4. scrie linia de cost (`servicii_subc`, `facturat`, ca la 13.5);
5. actualizează cantitatea contractată, ca declararea viitoare să nu mai cadă pe `QUANTITY_EXCEEDS_CONTRACT`;
6. marchează suplimentarea `acceptata`, cu cele două id-uri.

**Șase lucruri, o tranzacție.** Dacă vreunul cade, niciunul nu s-a întâmplat.

**Terenul verifică suplimentarea, dar nu-i vede prețul** — aceeași regulă ca la liniile de SL. View propriu, `v_sl_supplements_field`, fără `unit_price` și `total`. Mutația: `sl.verify-supplement`, în cele trei locuri, testată din `app_field` înainte de ecran.

### 3.2 Garanțiile (migrarea `0050_warranties`)

```
warranties         → company_id, direction: retinuta_de_noi|retinuta_de_client,
                     subcontractor_id?  (pe directia 1)
                     contract_id?       (pe directia 2)
                     source_document_type, source_document_id,  -- SL sau factura
                     work_unit_id, percent numeric(5,2), amount numeric(14,2),
                     retained_at, status: retinuta|eliberata_partial|eliberata,
                     due_at   -- scadenta de eliberare
warranty_releases  → warranty_id, amount, released_at, released_by,
                     reason: receptie|expirare_garantie|alta,
                     justification, document_node_id?
```

**Reținerea e automată, în tranzacția aprobării SL-ului.** `retention_pct` de pe `packages` (coloană pusă la pasul 12, până acum doar completată) devine activă acum.

**Reținerea NU e o linie de cost în minus.** Costul rămâne întreg — datorezi toată suma, doar că plătești o parte mai târziu. Garanția e o **obligație de plată amânată**, nu o reducere de cheltuială. A o scădea din cost ar face marja să arate mai bine cu exact suma pe care o datorezi.

Scadențarul se calculează, nu se stochează: `due_at` per garanție, iar ecranul grupează pe luni.

**Ecran unic „Garanții" în modulul Bani, cu două tab-uri și un scadențar comun** (§12.3). Intrarea `bani/garantii` există deja în `navigation.ts`.

### 3.3 Intrarea din spate (migrarea `0051_direct_subcontractor_costs`)

Nu e tabelă nouă. E un **use-case care scrie direct în registrul de cost**, cu:

- `contract + componentă + UL + tip de cheltuială` **obligatorii** (validare Zod, nu doar `not null`);
- `document_type = 'factura_furnizor'`, `subcontractor_id` completat;
- un steag `without_sl boolean not null default false` pe `cost_lines` — **singura coloană nouă din migrarea asta**.

**Contorul**: procentul liniilor `servicii_subc` cu `without_sl = true` din total, pe lună și pe contract. Apare în `Panou › Panoul meu`, în blocul financiar făcut la 10e, **doar cu `canSeeFinancials`**.

Fără prag, fără alertă, fără blocaj. Un număr pe ecran. Asta a cerut documentul.

### 3.4 SL-ul către client (migrarea `0052_sl_client`)

```
sl_client       → contract_id, period_id, work_unit_id, code (din serie),
                  status: draft|aprobata|inghetata,
                  unique (contract_id, period_id, work_unit_id)
sl_client_lines → sl_client_id, deviz_line_id (CLIENT), quantity,
                  unit_price, total,
                  source_sl_line_ids uuid[]   -- trasabilitatea inversa
```

**Derivarea** rulează peste `deviz_line_mappings`: pentru fiecare poziție client, adună cantitățile aprobate ale pozițiilor interne mapate, fiecare înmulțită cu coeficientul ei.

**Aici maparea incompletă devine blocantă** — la pasul 11 doar se raporta. O poziție internă cu cantitate aprobată și fără mapare **oprește derivarea**, cu lista pozițiilor neacoperite. Motivul: altfel ai factura clientului mai puțin decât ai executat, tăcut.

`source_sl_line_ids` există ca să se poată răspunde invers: „linia asta de pe factura clientului din ce declarații de subcontractant vine".

**Se generează doar pentru contracte `individual`.** Un `check` sau o verificare în serviciu care refuză explicit pe `mentenanta`, cu mesaj care spune de ce.

---

## 4. Reguli care nu se negociază

1. **Acceptarea unei suplimentări e o singură tranzacție**, cu șase efecte. Cele două coloane `created_*` o dovedesc.
2. **Categoria „Lucrări suplimentare" se creează o dată și se reutilizează.** Nu una per suplimentare.
3. **Justificarea e obligatorie** pe suplimentare.
4. **Terenul verifică suplimentarea fără să-i vadă prețul.**
5. **Garanția reținută nu scade costul.** E obligație amânată, nu reducere.
6. **Reținerea se face în tranzacția aprobării SL-ului**, nu ca job ulterior.
7. **Intrarea din spate nu se descurajează.** Se numără.
8. **SL-ul client se derivă doar la contract individual**, și **se blochează** pe mapare incompletă.
9. **Eliberarea unei garanții cere motiv scris.**

## 5. Ce NU faci în pasul ăsta

- **Nu construi facturarea și e-Factura** — faza 5. SL-ul client se oprește la `inghetata`.
- **Nu construi cash-flow-ul** — faza 5. Garanțiile îi dau date, dar ecranul e acolo.
- **Nu construi matching-ul SPV** — faza 5.
- **Nu construi PV-ul de recepție** — faza 4. Eliberarea „la recepție" se face manual până atunci, cu motiv scris.
- **Nu adăuga alerte pe contorul de intrări din spate.**
- **Nu atinge liniile de cost deja scrise la pașii 12 și 13.**

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Subcontractantul propune o suplimentare, fără justificare | respins |
| 2 | Propune cu justificare | `propusa`; apare la șeful de șantier |
| 3 | Șeful de șantier o deschide, pe teren | vede cantitatea și motivul, **nu vede prețul** |
| 4 | `select unit_price from app.sl_supplements` din `app_field` | **eroare de privilegiu** |
| 5 | Marchează `suspect` cu comentariu, offline | intră în coadă; urcă la sync |
| 6 | PM o respinge | `respinsa`; nimic nu se scrie în deviz sau SL |
| 7 | PM acceptă | **într-o tranzacție**: linie în deviz, linie în SL, linie de cost, cantitate contractată mărită, cele două `created_*` completate |
| 8 | A doua suplimentare acceptată pe aceeași lucrare | **aceeași** categorie „Lucrări suplimentare", nu a doua |
| 9 | Forțezi o eroare la pasul 4 din cele șase | **nimic** nu rămâne scris — nici linia de deviz, nici cea de SL |
| 10 | După acceptare, subcontractantul declară până la noua cantitate | **nu mai cade** pe `QUANTITY_EXCEEDS_CONTRACT` |
| 11 | Aprobi o SL pe un pachet cu `retention_pct = 10` | garanție de 10% din suma aprobată, în aceeași tranzacție |
| 12 | Verifici registrul de cost după #11 | costul e **întreg**, nu redus cu garanția |
| 13 | Ecranul Garanții, tab-ul „de la subcontractanți" | soldul curent, pe subcontractant și pe lucrare |
| 14 | Scadențarul | garanțiile grupate pe luni de eliberare |
| 15 | Eliberezi parțial, cu motiv | `eliberata_partial`, soldul scade, `warranty_releases` are rândul |
| 16 | Eliberezi fără motiv | respins |
| 17 | Eliberezi mai mult decât soldul | respins, cu soldul afișat |
| 18 | Garanție reținută de client, pe direcția 2 | aceeași structură, oglindită |
| 19 | Introduci o factură fără SL, fără componentă | respins — cele patru câmpuri sunt obligatorii |
| 20 | Introduci una completă | linie de cost cu `without_sl = true` |
| 21 | Panoul financiar | procentul intrărilor din spate, pe lună; **fără alertă** |
| 22 | Același panou, rol fără `canSeeFinancials` | blocul nu apare deloc |
| 23 | Derivezi SL client pe contract individual, cu mapare completă | cantitățile urcă, cu coeficienții aplicați |
| 24 | Idem, cu o poziție internă nemapată care are cantitate aprobată | **blocat**, cu lista pozițiilor neacoperite |
| 25 | Încerci derivarea pe contract de mentenanță | refuzat, cu mesaj care spune de ce (pasul 6b) |
| 26 | Pe o linie de SL client | `source_sl_line_ids` duce înapoi la declarațiile de subcontractant |
| 27 | Îngheți SL-ul client, apoi modifici o SL de subcontractant din luna aia | SL-ul client **nu se schimbă** |
| 28 | Testul generic de coloane cu preț | trece, cu `sl_supplements` și `sl_client_lines` acoperite |

## 7. Definiția de „gata"

- Toate cele 28 de verificări trec. **3, 4, 28 (izolarea) și 9 (atomicitatea) sunt blocante în CI.**
- Verificarea 9 are test dedicat, care **forțează eșecul la mijlocul tranzacției** și confirmă că nu rămâne nimic.
- `sl.verify-supplement` e testată din `app_field`, cu payload-ul exact cum îl compune ecranul.
- `PROGRESS.md` are intrarea pasului.

---

## Sub-pași

| Sub-pas | Ce | Verificări |
|---|---|---|
| **14a** | Migrarea `0049`, fluxul de suplimentare cu cele trei roluri, `acceptSupplement` atomic, view-ul și mutația de teren | 1–10 |
| **14b** | Migrarea `0050`, garanțiile pe ambele direcții, reținerea automată, scadențarul, ecranul din Bani | 11–18 |
| **14c** | Migrarea `0051` (intrarea din spate + contorul) și `0052` (SL client, derivarea, blocajul pe mapare) | 19–28 |

**14a înaintea lui 14b**: reținerea se aplică pe SL-uri care pot conține deja linii de suplimentare, deci fluxul trebuie să existe întâi.
