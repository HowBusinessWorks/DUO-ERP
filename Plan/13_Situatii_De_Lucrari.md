# Pasul 13 — Situațiile de lucrări, lanțul cap-coadă

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** subcontractantul declară cantități, șeful de șantier le verifică **linie cu linie, fără să vadă prețul**, PM-ul aprobă, sistemul dă codul SL, iar costul intră în registru. Cu asta, ecranul `Verificare SL` din aplicația de teren — schelet gol de la 10c-4 — se umple.
> **E cel mai dens pas al fazei 2.** Trei persone ating aceleași rânduri, cu trei niveluri de vizibilitate.

---

## 0. Context de business (esențial)

### Lanțul, în șase pași

Din §10.1, confirmat de prototipul execuTrack (§10.3):

```
1. Subcontractant    declara cantitati pe liniile pachetului sau
                     ↓
2. Sef de santier    vede CANTITATI, NU PRETURI
                     confirma / corecteaza / comenteaza, LINIE CU LINIE
                     ↓
3. Manager de proiect  vede tot, aproba
                     ↓
4. Sistem            genereaza COD SL
                     ↓
5. Subcontractant    descarca SL, emite factura CU codul SL
                     ↓
6a. Contract individual:  cantitatile urca prin mapare -> SL client   (pasul 14)
6b. Contract mentenanta:  se opreste la 4, costul intra pe componenta
                          Lucrari. Fara SL spre client.
```

**Pasul 5 și matching-ul SPV de la pasul 6 nu se construiesc aici** — factura e faza 5. Ce se construiește acum e **codul SL**, ca să existe pe ce face matching-ul mai târziu.

### Cele cinci cumulate

Fiecare linie de SL arată, **cumulativ pe tot pachetul, nu doar pe luna curentă** (§10.2):

```
contractat / executat cumulat / aprobat cumulat / facturat cumulat / rest
```

**Fără ele controlul e iluzoriu.** Sistemul **blochează** declararea peste cantitatea contractată, fără o suplimentare aprobată. Codul de eroare există deja și e exact ăsta: **`QUANTITY_EXCEEDS_CONTRACT`** — e în lista fixă din `PROGRESS.md`, nu inventa altul.

`facturat cumulat` rămâne **zero pe tot pasul** — nu există facturi încă. Coloana se scrie acum, se alimentează la faza 5. Nu o omite: adăugarea ei târziu ar cere recalculul tuturor SL-urilor existente.

### Verificarea e linie cu linie, nu în bloc

Confirmat în teren (§10.3). Șeful de șantier marchează fiecare linie **`ok`** sau **`suspect`**, cu comentariu opțional. Nu există „aprobă tot" pentru el — el nu aprobă, el **verifică**. Aprobarea e a PM-ului, și aia poate fi pe document.

Diferența contează: dacă șeful de șantier ar aproba în bloc, ar semna pentru cantități pe care nu le-a văzut, iar verificarea ar deveni un click de rutină în trei luni.

### Ce vede fiecare, pe aceleași rânduri

| | PM | Șef de șantier | Subcontractant |
|---|---|---|---|
| Cantități declarate | vede tot, aprobă | **declară / corectează, linie cu linie** | declară inițial |
| Prețuri | vede tot | **nu vede deloc** | vede |
| SL-urile altui subcontractant | vede | doar cele de pe UL-urile lui | **nu vede nimic** |

Șeful de șantier ajunge la SL **prin UL-urile la care e asignat** (`work_unit_assignments`), nu prin subcontractant. Tiparul e cel de la §4.5, rândul „UL și copiii lor".

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `DaminaStructuraCapCoada FInal.md` | §10 integral — §10.1 (fluxul), §10.2 (cumulatele, ce lipsește), §10.3 (modelul validat) |
| `Damina_Aplicatie_Structura_Functionala.md` | §12.2 (fluxul pe ecrane), §26 (aplicația de teren) |
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §4.4 (izolarea prețului, exemplul `v_sl_lines_field` — **e literal ce trebuie făcut aici**), §4.10 (serii și numere de documente) |
| `Plan/12_Pachete_Portal_Subcontractant.md` | tot |
| `Plan/10_Teren_Offline_Raport_Lunar.md` | §3.2–3.3 (mutații și conflicte) — SL-ul de teren intră în aceeași coadă |

## 2. Precondiții

- **Pasul 12 complet.** Există pachete `semnat`, cu linii și cu `subcontractor_id`.
- `app.document_series` și `app.allocate_document_number` — **există din pasul 02.** Codul SL se alocă prin ea, nu cu un contor propriu.
- Aplicația de teren, cu `pushMutations`, `MUTATION_TYPES` și `EXECUTORS` (pasul 10a).
- Ruta `/field/verificare-sl` cu `EmptyState` — **există din 10c-4**, se înlocuiește conținutul.
- Registrul de cost și perioadele (pasul 06).

**Migrări: `0046`–`0048`.**

---

## 3. Ce livrezi

### 3.1 Schema (migrarea `0046_situatii_lucrari`)

```
situatii_lucrari      → package_id, period_id, company_id, code (COD SL, din
                        serie, null pana la aprobare), status:
                        draft|declarata|verificata|aprobata|anulata,
                        declared_at, declared_by, verified_at, verified_by,
                        approved_at, approved_by,
                        unique (package_id, period_id)
sl_lines              → sl_id, package_line_id, quantity_declared,
                        quantity_approved, unit_price, total  ← PRET
                        (cumulatele NU se stocheaza — vezi mai jos)
sl_line_verifications → sl_line_id, person_id, status: ok|suspect,
                        comment, verified_at
                        unique (sl_line_id)  — o verificare per linie
```

**`unique (package_id, period_id)`** — o situație pe lună per pachet. E chiar definiția: „SL lunară per pachet" (D.3).

**Cele cinci cumulate NU se stochează.** Se calculează la citire, prin `sum` peste toate SL-urile pachetului până la luna curentă inclusiv. Motivul: un cumulat stocat se desincronizează la prima anulare de SL, iar rezultatul e o cifră care arată bine și e greșită — exact tiparul pe care registrul de cost îl evită prin storno în loc de `update`.

**Dacă profilul arată că nu ține la volum**, se adaugă o tabelă de rollup **întreținută prin trigger, în aceeași tranzacție** — tiparul de la §4.7, care există deja în repo pentru plafoane. Nu un cache eventual-consistent. Măsoară înainte: la 9 contracte × 4 ani, e puțin probabil să fie nevoie.

### 3.2 View-ul de teren și grant-urile

Exemplul din `PLAN_TEHNIC` §4.4 e literal ce trebuie scris:

```sql
create view app.v_sl_lines_field with (security_invoker = on) as
  select id, sl_id, package_line_id, name, uom,
         quantity_contracted, quantity_declared, quantity_approved,
         verification_status, comment
  from app.sl_lines ...;
```

`unit_price` și `total`: **neacordate lui `app_field`.** `revoke select on app.sl_lines from app_field`, apoi grant enumerat pe view.

`packages/db` expune view-ul ca schemă Drizzle separată — `schema.slLinesField` există în contextul field, `schema.slLines` **nu compilează** acolo.

| Rol | `situatii_lucrari` | `sl_lines` | `sl_line_verifications` |
|---|---|---|---|
| `app_office` | prin firmă | tot | citire + scriere |
| `app_field` | prin UL asignat, fără preț | **doar prin view** | **insert + update pe ale lui** |
| `app_subcontractor` | doar ale lui | ale lui, **cu preț** | **doar citire** — nu-și verifică singur declarația |

**Grant-ul de `update` pentru teren pe `sl_line_verifications` e obligatoriu** — o verificare se poate răzgândi din `ok` în `suspect`. Vezi ce a costat lipsa lui `delete` la `0031`: șase defecte tăcute din aceeași familie, toate invizibile pentru typecheck.

### 3.3 Codul SL (migrarea `0047_sl_series`)

Se alocă **la aprobare**, prin `app.allocate_document_number`, dintr-o serie nouă pe firmă. Nu la declarare — o SL declarată și apoi anulată ar fi consumat un număr, iar seriile trebuie să rămână fără goluri.

Terenul are nevoie de **`execute` pe funcție**? **Nu** — el nu aprobă. Verifică totuși grant-urile seriei: la 10b lipsa lor a produs migrarea `0030`.

### 3.4 Mutația de teren

`sl.verify-line` intră în **`MUTATION_TYPES`, `MUTATION_PAYLOAD_SCHEMAS` și `EXECUTORS`** — cele trei locuri, nu un al patrulea. Tipul era deja prevăzut în §3.2 al pasului 10; acum capătă executant.

Payload: `{ slLineId, status: 'ok'|'suspect', comment?: string }`.

**Politica de conflict e deja scrisă în plan** (pasul 10, §3.3): *„Linie de SL verificată de altcineva → server câștigă, notificare."* Nu inventa alta. Implementarea: dacă `sl_line_verifications` are deja un rând de la altă persoană, mutația nu eșuează — se aplică politica și se întoarce un rezultat care spune ce s-a întâmplat.

**Înainte de ecran, rulează mutația din rolul `app_field`, pe date reale, cu payload-ul exact cum îl compune ecranul** — inclusiv `comment` ca șir gol. Regula asta a prins treisprezece defecte tăcute; al paisprezecelea drum, la 10c-4, a mers din prima pentru că a fost aplicată.

### 3.5 Linia de cost la aprobare

**Decizia (19 august 2026): SL aprobată scrie `stage = 'facturat'`.**

Justificarea, ca să n-o redeschidă nimeni: `cost_stage` are `angajat | receptionat | consumat | facturat`. Manopera de subcontractant **nu trece prin `receptionat` sau `consumat`** — nu e marfă, nu intră în gestiune, nu se consumă din stoc. Rămâne `facturat`, care aici înseamnă „datorat și acceptat", nu „există o factură în sistem". Alternativa — o valoare nouă în enum — ar fi însemnat o migrare pe o structură din faza 0 pentru fiecare document nou al fazei 2.

```
expense_type     ← 'servicii_subc'
amount           ← totalul liniilor APROBATE (nu al celor declarate)
stage            ← 'facturat'
document_type    ← 'situatie_lucrari'
document_id      ← sl_id
document_line_id ← sl_line_id, pe fiecare linie
charged_*        ← OBLIGATORIU pe stadiul asta (check-ul din 0017)
```

**O linie de cost per linie de SL**, nu una pe document. Fără `document_line_id`, drill-down-ul de la pasul 06 (verificarea #11) se oprește la document și nu ajunge la sursă.

**Stornarea liniei `angajat` a pachetului?** Nu, și e important: `angajat` și `facturat` sunt **stadii diferite ale aceleiași cheltuieli**, urmărite simultan — asta e chiar rostul lui `cost_stage`. Rapoartele filtrează pe stadiu. Nu le scădea una din alta.

### 3.6 Ecrane

**Birou** (PM), ca tab pe pachet și ca listă în `Bani › Situații de lucrări` — intrarea există deja în `navigation.ts`:

- SL-ul lunii, cu cele cinci cumulate pe fiecare linie;
- ce a declarat subcontractantul, ce a verificat șeful de șantier (cu `ok`/`suspect` și comentariile);
- aprobare, cu ajustarea cantității aprobate față de cea declarată;
- generarea codului SL și descărcarea documentului.

**Portal subcontractant** — ecranul `Situații de lucrări`: declară cantitățile lunii, vede răspunsul verificării, descarcă SL-ul aprobat.

**Teren** — `/field/verificare-sl`, în locul scheletului. Lista liniilor de verificat de pe UL-urile mele, fiecare cu `ok` / `suspect` + comentariu. **Offline**, prin coada de mutații, ca tot ce e pe teren.

**Bugetul de tapuri:** `Verificare SL` **nu e sub butonul ＋** (cele patru acțiuni de acolo sunt fixate din 10c-1 și rămân). Se ajunge la el din `Azi`, ca rând de context. Nu are prag măsurat în plan (verificările 12–15 ale pasului 10 nu-l includ), dar **marcarea unei linii trebuie să fie un singur tap** — altfel 40 de linii înseamnă 80 de atingeri, și omul marchează tot `ok` ca să scape.

Ecranele se lucrează cu **agentul de design**.

---

## 4. Reguli care nu se negociază

1. **Șeful de șantier nu vede prețul.** Grant enumerat pe view, `revoke` pe tabelă.
2. **Declararea peste contractat se blochează** cu `QUANTITY_EXCEEDS_CONTRACT`, fără suplimentare aprobată (pasul 14).
3. **Verificarea e linie cu linie.** Fără „marchează tot `ok`" pentru șeful de șantier.
4. **Subcontractantul nu-și verifică propria declarație.** Doar citire pe `sl_line_verifications`.
5. **Codul SL se alocă la aprobare**, din serie, nu la declarare.
6. **O linie de cost per linie de SL**, cu `document_line_id`.
7. **Cumulatele se calculează, nu se stochează** — sau, dacă se stochează, prin trigger în aceeași tranzacție.
8. **`sl.verify-line` se testează din rolul `app_field`** înainte de a exista ecranul.

## 5. Ce NU faci în pasul ăsta

- **Nu construi suplimentările** — pasul 14. Declararea peste contractat se **blochează** aici, atât.
- **Nu construi garanțiile.** Reținerea se aplică la SL, dar mecanismul vine la pasul 14.
- **Nu construi SL-ul către client** (pasul 6a) — pasul 14.
- **Nu construi facturarea și matching-ul SPV** — faza 5. Codul SL există, ca să aibă pe ce se face matching-ul.
- **Nu adăuga acțiuni sub butonul ＋** al aplicației de teren. Cele patru sunt fixate și măsurate.
- **Nu atinge `MUTATION_TYPES` pentru altceva** decât `sl.verify-line`.

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Subcontractantul declară cantități pe 6 din 10 linii | SL în `declarata`, 6 linii cu `quantity_declared` |
| 2 | Declară peste cantitatea contractată | **blocat**, cu `QUANTITY_EXCEEDS_CONTRACT` și cantitatea rămasă în mesaj |
| 3 | A doua SL pe același pachet, aceeași lună | refuzat de `unique (package_id, period_id)` |
| 4 | A doua SL, luna următoare | acceptată; cumulatele includ luna precedentă |
| 5 | Șeful de șantier deschide `Verificare SL` pe teren | vede liniile, **fără nicio coloană de preț** |
| 6 | `select unit_price from app.sl_lines` din `app_field` | **eroare de privilegiu** |
| 7 | Interfața de teren, în DOM | niciun câmp de preț, nicăieri |
| 8 | Marchează 4 linii `ok` și 2 `suspect`, cu comentariu, **offline** | intră în coadă; contorul crește |
| 9 | Repornește rețeaua | verificările urcă; `sl_line_verifications` are 6 rânduri |
| 10 | Se răzgândește pe o linie, din `suspect` în `ok` | se actualizează, nu se dublează |
| 11 | Trimite aceeași verificare de 3 ori | un singur efect; răspunsurile 2 și 3 sunt cele memorate |
| 12 | Altcineva a verificat deja linia, între timp | server câștigă, cu notificare — politica din pasul 10 §3.3 |
| 13 | Subcontractantul încearcă să-și verifice propria linie | refuzat — n-are `insert` |
| 14 | PM aprobă, cu 265 în loc de 280 declarat | `quantity_approved = 265`; cumulatele se mișcă |
| 15 | La aprobare | **cod SL alocat din serie**, fără gol în numerotare |
| 16 | Anulezi o SL declarată, neaprobată | niciun număr consumat |
| 17 | Registrul de cost după aprobare | **o linie per linie de SL**, `servicii_subc`, `facturat`, cu `document_line_id` |
| 18 | Drill-down pe cifra din raport | ajunge până la linia de SL, nu doar la document |
| 19 | Linia `angajat` a pachetului, după aprobarea SL | **neatinsă** — stadii diferite ale aceleiași cheltuieli |
| 20 | Aprobare într-o lună închisă | `PERIOD_CLOSED`, explicat în română, cu propunere de `data_efect` |
| 21 | Subcontractantul A caută SL-ul lui B, cu id în URL | `NOT_FOUND` |
| 22 | Șeful de șantier caută o SL de pe o UL la care nu e asignat | `NOT_FOUND` |
| 23 | Testul generic de coloane cu preț | trece, cu `sl_lines` acoperită |
| 24 | Contract de mentenanță: aprobi SL-ul | costul intră pe componenta Lucrări; **nu se creează nimic către client** (pasul 6b) |

## 7. Definiția de „gata"

- Toate cele 24 de verificări trec. **5, 6, 7, 23 (izolarea) și 11 (idempotența) sunt blocante în CI.**
- `sl.verify-line` are cel puțin un test care o trimite prin `pushMutations(fieldFor(...), …)`, cu payload-ul exact cum îl compune ecranul.
- Test cap-coadă: declarare → verificare offline → sync → aprobare → cod SL → linie de cost, rulat pe date reale.
- `docs/field-sync.md` capătă `sl.verify-line` în lista de tipuri.
- `PROGRESS.md` are intrarea pasului.

---

## Sub-pași

| Sub-pas | Ce | Verificări |
|---|---|---|
| **13a** | Migrările `0046`–`0047`, cumulatele, view-ul de teren, RLS, serviciile, codul SL. **Rulat din toate trei rolurile pe date reale.** | 1–4, 6, 13, 15, 16, 21–23 |
| **13b** | `sl.verify-line` în cele trei locuri + ecranul `/field/verificare-sl`, offline. **Mutația rulată din `app_field` înainte de ecran.** | 5, 7–12, 22 |
| **13c** | Ecranul PM (aprobare, cumulate, cod SL), portalul subcontractantului, liniile de cost | 14, 17–20, 24 |
