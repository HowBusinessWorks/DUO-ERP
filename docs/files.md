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
  „folosit". Rutarea unei unități pe alt contract, în schimb, îi *mută* folderul —
  aia chiar e o schimbare de „unde s-a executat".
- **Ștergerea e `deleted_at`.** Numele redevine liber imediat (unicitatea e
  parțială), nu la golirea coșului.

## Cine vede ce

`app.can_access_node(nod, permisiune)` — o singură poartă, trei surse:

| Cine | Prin ce |
|---|---|
| birou | apartenența nodului la una din firmele lui |
| teren | asignarea pe unitatea de lucru (până la `write`) |
| subcontractant | **doar** `app.node_shares`, explicit. Nu moștenește nimic |

Partajarea se moștenește în jos: pusă pe un folder, acoperă tot subarborele.
