# Pasul 07 — File management: arborele în Postgres, blob-urile în R2

> **Sesiune independentă.** Citește tot fișierul înainte de a scrie cod.
> **Rezultatul pasului:** arbore de fișiere complet funcțional, upload direct din browser cu retry per parte, geotag și thumbnails automate, permisiuni reale, foldere generate automat la fiecare eveniment de business.

---

## 0. Context (de ce e construit exact așa)

Firma lucrează cu **~700 de obiective** și cu mii de poze de teren lunar. Un prototip existent a validat împărțirea, care se portează ca atare:

| Ce | Unde |
|---|---|
| Arborele de foldere, nume, ierarhie, permisiuni, versiuni | **Postgres** |
| Conținutul binar | **R2**, cheie `blobs/{uuid}`, **fără cale semantică** |
| Miniaturi, variante, PDF-uri randate | **R2**, `derived/{uuid}/{variant}` |

Consecința care justifică toată separarea: **mutarea unui folder cu 100.000 de fișiere e un singur `UPDATE parent_id`**, ~1 ms, zero operații pe R2. Redenumirea la fel. **Nu există „reorganizarea storage-ului"** — reorganizezi date în Postgres; R2 e un sac de blob-uri care nu știe ce reprezintă.

**Trei goluri din prototip care se rezolvă acum:**
1. **Geotag și timestamp pe poze** — la 700 de obiective, e singura dovadă că inspecția s-a făcut acolo.
2. **Thumbnails reale** — altfel lista de 312 poze e inutilizabilă.
3. **Stratul de permisiuni** (`node_shares` exista, dar neactivat) — fără el, izolarea subcontractant-A-vs-B **nu există**.

Plus o cerință de teren: **retry per parte, nu pe tot fișierul**. Un upload de 200 MB pe conexiune de șantier cade la 80% și nu se reia de la zero.

## 1. Documente-sursă de citit înainte

| Fișier | Secțiuni |
|---|---|
| `PLAN_TEHNIC_INFRASTRUCTURA.md` | §9 (integral: împărțire, schemă, upload, download, buckets), **Anexa E integral** (organizarea storage-ului, arborele automat, maparea artefact→destinație, ciclul de viață, permisiuni, cele 7 lucruri de neuitat) |
| `Damina_Aplicatie_Structura_Functionala.md` | §16.1 (arborele de fișiere) |
| `DaminaStructuraCapCoada FInal.md` | §19.1 (file management, ce s-a validat în prototip) |

## 2. Precondiții

Din pașii 01–06: `packages/storage` cu client R2 și cele 4 bucket-uri, `withActor`, RLS, worker pg-boss funcțional, shell + `entityRegistry`, contracte, obiective, UL cu etape.

---

## 3. Ce livrezi

### 3.1 Schema (migrarea `0016_files`)

```sql
app.nodes (
  id uuid pk, parent_id uuid, company_id uuid,
  kind app.node_kind,                    -- folder | file
  name text,
  work_unit_id, contract_id, objective_id, stage_id,
  node_role app.node_role,               -- root_company|contract|objective|work_unit|stage|system|user
  is_system boolean default false,       -- folderele de sistem nu se șterg/redenumesc
  current_version_id uuid, deleted_at timestamptz, created_by uuid, created_at timestamptz
);

app.file_versions (
  id uuid pk, node_id uuid, blob_key text, size bigint, mime text,
  checksum_sha256 bytea, state app.file_state,     -- uploading|ready|failed|quarantined
  captured_at timestamptz,
  geo_lat numeric(10,7), geo_lng numeric(10,7), geo_accuracy numeric,
  geo_source app.geo_source,             -- exif | device | manual
  exif jsonb, created_by uuid, created_at timestamptz
);

app.derived_assets (id uuid pk, file_version_id uuid, variant text, blob_key text,
                    width int, height int, status text);
app.node_shares (node_id uuid, subject_type text, subject_id uuid,
                 permission app.share_permission);   -- read | write | manage
```

Constrângeri:

```sql
-- unicitatea numelui în folder, DOAR pe rândurile nesterse
create unique index on app.nodes (parent_id, name) nulls not distinct where deleted_at is null;
create index on app.nodes (work_unit_id) where deleted_at is null;
create index on app.file_versions (node_id, created_at desc);
create index on app.file_versions (captured_at) where geo_lat is not null;
```

**Numele redevine disponibil la soft-delete** (constrângerea e parțială), nu la golirea coșului — altfel utilizatorul nu poate recrea un folder pe care tocmai l-a șters.

Breadcrumbs și subarbori prin **CTE recursiv**.

### 3.2 Upload — direct din browser către R2

**Serverul nu vede niciodată byte-ii.**

```
1. Client  → POST /api/files/presign  { nodeId, filename, size, mime, checksum }
2. Server  → validează permisiunea pe node, creează file_version cu state='uploading',
             întoarce uploadId + presigned URLs pe părți (5–10 MB per parte)
3. Client  → PUT direct în R2, parte cu parte, RETRY PER PARTE, concurență 3
4. Client  → POST /api/files/complete { versionId, parts[] }
5. Server  → CompleteMultipartUpload, verifică checksum și ContentLength real,
             marchează state='ready', enqueue derive.thumbnails + derive.exif
```

- Presigned URL-urile expiră în **15 minute**.
- **Limite:** 50 MB per poză, 500 MB per video, retenție video configurabilă. Verificate la presign (din `size` declarat) **și la complete (din `ContentLength` real)** — verificate doar la presign, limitele sunt o sugestie.
- **Validare MIME prin magic bytes**, nu prin extensie și nu prin ce declară browserul.
- **Checksum verificat la `complete`** — un upload de 200 MB pe conexiune de șantier se poate corupe fără să dea eroare.

### 3.3 Download — niciodată URL direct către R2

Toate accesele trec prin `/api/files/[versionId]`, care: verifică permisiunea prin RLS → emite presigned GET cu **TTL 60 secunde** → redirect 302.

- `Content-Disposition: attachment` și `Content-Type` **din DB, nu din request** — altfel un HTML încărcat ca „aviz" devine XSS pe domeniul aplicației.
- Pentru miniaturi (multe, mici): token semnat cu TTL mai lung, cache-uit în Cloudflare.

### 3.4 Worker — coada `files.derive`

La fiecare `complete`:
1. **EXIF extras server-side** → `captured_at`, `geo_lat/lng`, `exif jsonb`, `geo_source='exif'`. Motivul pentru care nu ne bazăm pe fișier: orice recompresie sau upload prin unele browsere pierde EXIF-ul.
2. Dacă aplicația a trimis și coordonate din `navigator.geolocation`, se salvează **separat**, cu `geo_source='device'`. La 700 de obiective, dovada trebuie să reziste.
3. **Thumbnails**: 160 · 480 · 1200 px, WebP, în `damina-derived`.
4. Previzualizare pentru PDF/Office (`preview/{version_uuid}/page-{n}.webp`).

Plus coada **`files.cleanup`** (nocturn): uploaduri abandonate, părți multipart orfane, versiuni fără node, blob-uri din coșul golit acum > 30 de zile.

### 3.5 Permisiuni pe fișiere

Moștenire pe arbore, evaluată cu CTE recursiv într-o funcție `stable` (`app.can_access_node(node_id, permission)`), chemată din politicile RLS pe `nodes` și `file_versions`:

- **birou** — prin apartenența contractului la firmele mele;
- **teren** — prin asignarea pe UL;
- **subcontractant** — **doar prin partajare explicită** (`node_shares`). Nimic nu i se moștenește de la contract sau lucrare. Vede exclusiv ce i s-a dat, la crearea pachetului lui. Asta **e** izolarea A-vs-B.

### 3.6 Arborele generat automat

Structura, cu evenimentul care o produce:

```
[Firmă]                              ← creare firmă, node_role='root_company'
└── Contracte
    └── 4700 · Apa Nova              ← creare contract, node_role='contract'
        ├── Contract și acte adiționale
        ├── Obiective
        │   └── Stație pompare Berceni    ← legare obiectiv de contract
        │       ├── Documentație tehnică
        │       └── Poze obiectiv
        └── Activitate
            └── 2026-08              ← prima UL din lună (folder de lună)
                ├── I-9022 Inspecție…     ← creare UL, node_role='work_unit'
                │   ├── Fișă · Poze
                ├── #1841 Intervenție…
                │   ├── Fișă · Poze · Bonuri de consum
                └── L-233 Hidroizolație…
                    ├── Deviz · Oferte · Avize · Facturi · PV
                    ├── Poze/{Înainte, Etapa 1…N, După}   ← Etapa N la crearea etapei
                    ├── Video · Recepții
```

| Eveniment | Noduri create |
|---|---|
| Creare firmă | rădăcina firmei + `Contracte` |
| Creare contract | folder contract + cele 3 subfoldere fixe |
| Legare obiectiv la contract | folder obiectiv + `Documentație tehnică` + `Poze obiectiv` |
| Creare UL | folder de lună dacă lipsește + folder UL + subfolderele specifice tipului |
| Creare etapă | `Poze/Etapa N` |
| **Promovare intervenție → lucrare** | **folderul rămâne același nod**; se adaugă subfolderele de lucrare. Nimic nu se mută, nimic nu se copiază |
| **Mutare de finanțare** | **nimic** |

Ultimul rând e critic și ușor de greșit: **arborele e construit pe analitica „folosit"**, nu pe „descărcat". Dacă folderul s-ar muta când se mută finanțarea, istoricul obiectivului s-ar rupe.

Crearea folderelor se face **în aceeași tranzacție** cu entitatea (se completează `root_node_id` lăsat null în pașii 04–05 — scrie și o migrare de backfill pentru entitățile deja existente).

**Foldere de sistem:** `is_system = true`, `node_role <> 'user'`. Nu se pot șterge, redenumi sau muta din interfață. Utilizatorul poate crea foldere proprii **oriunde**, dar cele generate rămân fixe — altfel structura implicită se erodează în 3 luni și rapoartele care caută „folderul PV al lucrării" nu mai găsesc nimic.

**Căutarea folderului se face pe `node_role`, nu pe nume** — un `where work_unit_id = X and node_role = 'pv_folder'` nu se strică dacă cineva schimbă eticheta afișată.

### 3.7 Ecrane

**Documente › Arbore de fișiere** — explorer clasic: breadcrumb, drag & drop, upload cu progres per fișier și per parte, versionare vizibilă, coș de gunoi, redenumire, mutare, partajare (`node_shares`), previzualizare imagine/PDF, galerie de poze cu **geotag și timestamp afișate**.

**Tab-ul `Documente` pe orice entitate** — arată **exact folderul ei**, nu un filtru peste tot arborele. Se activează prin `entityRegistry`, deci contractul, obiectivul, UL-ul și etapa îl primesc simultan.

**Coșul de gunoi** — ștergerea e `deleted_at = now()`, instant chiar și pentru un folder cu 3.000 de poze. Blob-urile rămân **30 de zile** după golirea coșului, apoi le șterge jobul de curățenie. Pasul e intenționat lent: la 40 de utilizatori care învață aplicația, ștergerea greșită **se va întâmpla**.

### 3.8 Maparea artefact → destinație

Regula: **dacă un om trebuie să-l găsească vreodată răsfoind, e nod în arbore. Dacă doar sistemul îl citește, e blob cu referință în DB.** Poluarea arborelui cu artefacte tehnice e cel mai rapid mod de a-l face inutilizabil. Tabelul complet e în Anexa E.4 — implementează maparea pentru artefactele care există deja (poze de teren, video, documente încărcate manual) și lasă funcția extensibilă.

---

## 4. Reguli care nu se negociază

1. **Cheia R2 nu conține niciodată calea.** `blobs/{uuid}`, atât.
2. **Serverul nu vede byte-ii.** Upload și download prin presigned URL.
3. **Retry per parte**, nu pe fișier.
4. **EXIF-ul se extrage server-side, la ingest.**
5. **Checksum, ContentLength și magic bytes verificate la `complete`.**
6. **Subcontractantul nu moștenește nimic** — doar `node_shares` explicit.
7. **Folderele de sistem nu se șterg, redenumesc sau mută.**
8. **Mutarea finanțării nu atinge arborele.**

## 5. Ce NU faci în pasul ăsta

- Nu implementezi OCR și căutare full-text în conținut (faza 4) — căutarea merge pe nume de fișier.
- Nu implementezi editarea Word/Excel în browser (se poate adăuga ulterior; notează ca TODO).
- Nu construiești generatorul de procese verbale (faza 4).
- Nu implementezi coada de media offline din aplicația de teren — pasul 10 (dar API-ul de presign trebuie să fie gata pentru ea).

## 6. Verificare

| # | Acțiune | Rezultat așteptat |
|---|---|---|
| 1 | Creezi o firmă nouă | apar automat rădăcina + `Contracte` |
| 2 | Creezi contract, legi obiectiv, creezi UL, creezi 2 etape | tot arborele din §3.6 apare, cu `node_role` corect pe fiecare nod |
| 3 | Promovezi intervenția în lucrare (pasul 05) | **același nod de folder**, cu subfolderele de lucrare adăugate. Nimic mutat, nimic copiat |
| 4 | Muți finanțarea unei UL | **arborele nu se schimbă deloc** |
| 5 | Încerci să ștergi folderul `Poze` (sistem) | blocat, cu explicație |
| 6 | Muți un folder cu 1.000 de fișiere | un singur `UPDATE`, sub ~50 ms, zero apeluri R2 (verifică în log) |
| 7 | Upload 200 MB cu rețeaua întreruptă la 60% | se reia **de la partea căzută**, nu de la zero; fișierul final are checksum corect |
| 8 | Upload cu `size` declarat mic dar fișier mare | respins la `complete`, pe `ContentLength` real |
| 9 | Upload de HTML redenumit `.pdf` | respins de validarea magic bytes |
| 10 | Upload poză cu EXIF GPS | după ~10s: `captured_at`, `geo_lat/lng`, `geo_source='exif'`, 3 thumbnails în `damina-derived` |
| 11 | Upload poză fără EXIF, dar cu coordonate trimise de client | `geo_source='device'`, coordonatele salvate separat |
| 12 | Descarci un fișier | URL cu TTL 60s, `Content-Disposition: attachment`; URL-ul **expiră** și nu mai funcționează după 2 minute |
| 13 | Copiezi URL-ul presemnat și îl deschizi din alt browser în < 60s | funcționează (e limitarea acceptată) — dar nu există niciun URL R2 direct în HTML-ul paginii |
| 14 | Subcontractantul A cere un nod al lui B, direct prin API | zero rânduri |
| 15 | Partajezi explicit un nod cu subcontractantul A | îl vede, **doar pe el și pe copiii lui**, cu permisiunea acordată |
| 16 | Ștergi un folder cu 3.000 de poze | instant (`deleted_at`); **numele redevine imediat liber**; conținutul e în coș |
| 17 | Golești coșul, apoi rulezi jobul de curățenie | blob-urile rămân 30 de zile; abia după aceea dispar din R2 |
| 18 | Upload abandonat (nu se cheamă `complete`) | `files.cleanup` îl șterge; părțile din `damina-tmp` expiră automat |
| 19 | Deschizi tab-ul Documente pe contract, obiectiv, UL și etapă | fiecare arată **exact folderul lui**, cu breadcrumb corect |
| 20 | Galerie cu 300 de poze | se încarcă pe thumbnails (nu originale), scroll fluid, geotag și oră vizibile pe fiecare |
| 21 | Login ca `field`, upload din UL-ul lui | funcționează; upload într-o UL neasignată → respins |

## 7. Definiția de „gata"

- Cele 21 de verificări trec.
- Cele 7 puncte din Anexa E.7 sunt implementate și verificabile fiecare printr-un test.
- Backfill rulat: entitățile create în pașii 04–05 au acum `root_node_id`.
- `docs/files.md` explică în ≤ 15 linii cum se adaugă un tip nou de folder automat (eveniment → `node_role` → subfoldere).
