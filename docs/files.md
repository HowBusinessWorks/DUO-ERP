# Arborele de fișiere

Ierarhia stă în Postgres (`app.nodes`), conținutul binar în R2 sub cheie opacă
`blobs/{uuid}`. De asta mutarea unui folder cu 100.000 de fișiere e un singur
`update parent_id` și zero operații pe R2.

## Cum adaugi un tip nou de folder automat

Trei pași, toți în migrare — arborele **nu** se construiește din aplicație:

1. **Adaugă valoarea în `app.node_role`** (enumul din `packages/db/src/schema/enums.ts`).
   Rolul e identitatea folderului. Rapoartele îl caută pe rol, niciodată pe nume,
   ca schimbarea etichetei afișate să nu rupă nimic.
2. **Cheamă `app.ensure_folder(firmă, părinte, nume, rol, …)`** din funcția
   `app.build_<entitate>_tree(id)` a entității-părinte. Funcția e idempotentă:
   apelată de două ori, întoarce același nod.
3. **Backfill**: rulează aceeași `build_*` peste rândurile existente, într-un
   `do $$ … $$`. Fiindcă `ensure_folder` e idempotentă, backfill-ul e literalmente
   același cod ca triggerul — nu o a doua implementare care se poate abate.

Evenimentul care declanșează construcția e un trigger `after insert` pe entitate,
în aceeași tranzacție cu ea.

## Ce nu se atinge

- **Folderele de sistem** (`is_system`) nu se șterg, redenumesc sau mută.
  `app.guard_node_system` respinge, indiferent de calea de acces.
- **Mutarea finanțării nu atinge arborele.** Arborele e construit pe analitica
  „folosit". Rutarea unei unități pe alt contract, în schimb, îi _mută_ folderul —
  aia chiar e o schimbare de „unde s-a executat".
- **Ștergerea e `deleted_at`.** Numele redevine liber imediat (unicitatea e
  parțială), nu la golirea coșului.

## Cine vede ce

`app.can_access_node(nod, permisiune)` — o singură poartă, trei surse:

| Cine           | Prin ce                                                   |
| -------------- | --------------------------------------------------------- |
| birou          | apartenența nodului la una din firmele lui                |
| teren          | asignarea pe unitatea de lucru (până la `write`)          |
| subcontractant | **doar** `app.node_shares`, explicit. Nu moștenește nimic |

Partajarea se moștenește în jos: pusă pe un folder, acoperă tot subarborele.

## Upload și descărcare

Serverul nu vede niciodată byte-ii.

```
client → POST /api/files/presign  { parentId, filename, size, checksum? }
       ← uploadId + un URL presemnat PER PARTE
client → PUT direct în R2, parte cu parte, retry PER PARTE
client → POST /api/files/complete { versionId, parts[] }
server → CompleteMultipartUpload, apoi verifică:
           mărimea reală = cea anunțată · magic bytes · sumă de control
       → state='ready', enqueue files.derive
```

**Partea și TTL-ul se calculează din mărimea fișierului** (`uploadPartBytes`,
`uploadTtlSeconds`). Filmările de șantier ajung la ~2 GB, iar limita e 4 GB: la
8 MB pe parte ar fi însemnat 512 de URL-uri într-un răspuns, iar 15 minute de TTL
ar fi expirat la jumătatea unui upload de 27 de minute. Partea crește la 16 și
32 MB peste 1 și 2 GB (deci între 64 și 128 de părți, oricât de mare fișierul),
iar TTL-ul presupune minimum 200 KB/s și se oprește la 12 ore — sub cele 24 h
după care `files.cleanup` consideră uploadul abandonat.

**Suma de control se calculează în browser doar sub 32 MB** (`CHECKSUM_MAX_BYTES`):
`crypto.subtle` nu are hashing pe flux, deci cere fișierul întreg în memorie, iar
serverul l-ar descărca înapoi din R2 ca să-l verifice. Peste prag rămân mărimea
reală și magic bytes.

**Bucket-ul `docs` are nevoie de CORS** ca browserul să poată urca: metoda `PUT`
de pe originea aplicației, și `ExposeHeaders: ETag` — fără el, `xhr.getResponseHeader('ETag')`
întoarce null și uploadul se oprește la prima parte, cu mesaj explicit.

Până la `complete`, fișierul există în R2 dar nu e vizibil nicăieri: nodul n-are
`current_version_id`, iar versiunea e `uploading`. Ce cade la o verificare nu
rămâne pe jumătate — blobul se șterge, versiunea trece în `failed`.

**Descărcarea** trece prin `/api/files/[versionId]`: verifică dreptul, emite un
URL semnat de 60 s, redirect 302. `Content-Type` și `Content-Disposition` vin din
baza de date și sunt acoperite de semnătură — un HTML urcat ca „aviz.pdf" nu se
poate servi ca HTML. Miniaturile au ruta lor, cu `inline` și TTL de 15 minute.

**Un fișier cu același nume** în același folder nu e conflict, e o versiune nouă
a aceluiași nod.

## Ce face worker-ul

`files.derive`, la fiecare `complete`: EXIF (dată, GPS, aparat) și trei
miniaturi WebP — 160, 480, 1200 px. Coordonatele trimise de aparat
(`geo_source='device'`) **nu** se suprascriu cu cele din EXIF: cea culeasă la
fața locului cântărește mai mult decât una scoasă dintr-un fișier editabil.

`files.cleanup`, nocturn: uploaduri abandonate de peste 24 h, părți multipart
orfane (se plătesc lunar), și nodurile din coșul golit acum peste 30 de zile.
