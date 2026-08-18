# Sincronizarea aplicației de teren

Totul de aici există pentru un singur fapt: **conexiunea cade la jumătatea
cererii, în subsol.** Nu e un caz limită — e cazul obișnuit, iar restul deciziilor
sunt consecințe.

## Cele trei garanții

1. **Mutația își aduce propriul `id`**, UUID v7 generat pe telefon înainte să
   existe rețea. Un `id` deja aplicat întoarce rezultatul **memorat**, fără să
   reexecute nimic. Fără asta, un retry după un răspuns pierdut ar emite al
   doilea bon de consum pentru același material.
2. **Ordinea e per dispozitiv, secvențială.** Fișa se salvează înainte să fie
   validată; consumul, după ce există fișa. Două telefoane ale aceluiași om au
   cozi și cursoare independente.
3. **Coada se oprește la prima eroare de business**, nu sare peste ea. Cele de
   după pot depinde de cea care a picat. Erorile de *rețea* nu intră aici: ele nu
   ajung să fie înregistrate, deci se reiau de la sine.

## Cum se adaugă un tip nou de mutație

Două locuri. Nu există un al treilea:

1. **`packages/contracts/src/field.ts`** — adaugi numele în `MUTATION_TYPES` și
   perechea în `MUTATION_PAYLOAD_SCHEMAS`, legată de **schema use-case-ului**,
   nu de una scrisă pentru sync. O a doua schemă ar începe identică și ar rămâne
   în urmă la prima regulă nouă, iar diferența s-ar vedea abia pe telefonul
   cuiva, cu rețeaua căzută.
2. **`packages/services/src/field-sync.ts`** — adaugi executantul în `EXECUTORS`.
   El cheamă **exact serviciul pe care îl cheamă și ecranul de birou**, și
   întoarce un obiect **deja serializabil**.

> **Rezultatul se convertește explicit.** `Money` și `Quantity` puse direct în
> `jsonb` ajung acolo ca structurile interne ale bibliotecii de zecimale, deci
> telefonul care primește răspunsul *memorat* ar vedea `{c:[8],e:0,s:1}` acolo
> unde cel care a prins execuția vede `"8.0000"`. Două răspunsuri diferite pentru
> aceeași mutație. Fiecare executant își declară forma de pe sârmă.

Un tip declarat **fără** executant ar accepta mutații pe care nu le poate aplica
nimeni, iar telefonul ar crede că a trimis. De asta `journal.append`,
`sl.verify-line` și `equipment.*` nu sunt încă în listă: ecranele lor sunt
prevăzute, tabelele vin cu fazele 2 și 4.

## Cum depanezi o coadă blocată

O coadă blocată înseamnă o mutație cu `error_code`. E în `app.applied_mutations`,
și se citește de la **birou** — politica de teren e „ale mele și atât":

```sql
select id, type, error_code, error_message, applied_at
  from app.applied_mutations
 where person_id = :persoana and error_code is not null
 order by applied_at desc;
```

Ce se face mai departe **nu e o operație de bază de date**, ci una de aplicație:
omul rezolvă cauza (deschide luna, completează stocul, corectează cantitatea) și
retrimite. Retrimiterea aceleiași mutații va da același răspuns memorat — deci,
dacă datele s-au schimbat, telefonul trebuie să genereze o **mutație nouă**, cu
`id` nou. Asta e și motivul pentru care ecranul de conflicte oferă „duplică ce
fișă nouă", nu „încearcă din nou".

Ștergerea unui rând din jurnal ca să se „deblocheze" coada e ultima soluție și se
face doar cu rolul de serviciu — un rol de aplicație n-are `delete` acolo,
dinadins.

## Cum forțezi un pull complet

Ștergi cursorul dispozitivului. La următoarea cerere, `GET /api/field/sync`
răspunde cu `full: true`:

```sql
delete from app.sync_cursors where person_id = :persoana and device_id = :telefon;
```

Se întâmplă și singur, la 90 de zile: `field.pruneMutations` (duminica, 01:00)
șterge jurnalul mai vechi de atât și cursoarele care n-au mai vorbit de atunci.

**Prețul retenției, spus pe față:** după uitare, o mutație retrimisă se
*reexecută*. Unde nu doare e la `timesheet.save`, idempotent pe cheia lui
naturală (om, zi). Unde ar durea e `consumption.save`, care ar emite al doilea
bon. De asta 90 de zile e o alegere: peste ea, telefonul face pull complet și își
golește coada, în loc s-o retrimită.

## Limita de rată

60 de sincronizări pe minut, pe **(persoană, dispozitiv)** — nu pe IP: un telefon
în roaming își schimbă adresa între două cereri, iar o limită pe IP ar fi oprit
exact omul cu semnal prost. E o frânare, nu un zid: contorul trăiește în memoria
procesului.

## Ce răspunde ruta

`POST /api/field/sync` întoarce **200 chiar și când coada s-a oprit**: lotul a
fost primit și procesat, iar starea fiecărei mutații e în corp
(`applied` · `duplicate` · `failed` · `skipped`). Un 4xx acolo ar fi spus
clientului „n-am înțeles cererea", punându-l să retrimită tot lotul — inclusiv
mutațiile deja aplicate.
