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

## Ce ține telefonul

Trei magazii în IndexedDB (`apps/web/src/lib/field/db.ts`), cu roluri care nu se
amestecă:

| Magazie | Ce e | Ce se întâmplă dacă se pierde |
|---|---|---|
| `snapshot` | felia mea de date, **doar cantități** | se ia din nou la primul pull |
| `outbox` | mutațiile care așteaptă | **s-a pierdut o zi de teren** |
| `media` | pozele care așteaptă, cu progresul lor | pozele nu mai ajung niciodată |

Felia se **rescrie întreagă** la fiecare pull, nu se îmbină: e mică (câteva KB
comprimat), iar o îmbinare ar fi cerut tombstones pe șase tabele ca să se vadă ce
a dispărut de la birou. Outbox-ul și media **nu se ating** niciodată la pull —
ele sunt munca omului, felia e doar o copie a ce știe serverul.

**Ordinea unui ciclu: push → pull → media.** Pull-ul vine după push dinadins,
altfel felia proaspătă ar arăta o stare din care lipsește exact ce tocmai a
scris omul. Pozele merg ultimele: o fișă ajunsă fără poze e o fișă pe care cineva
poate lucra, o poză fără fișă nu e nimic.

**Contorul numără separat fișele și pozele.** Dacă omul vede „4 de sincronizat"
și sunt doar poze, intră în panică degeaba — fișa lui e deja la birou.

## Ce face service worker-ul

Scris de mână (`apps/web/public/sw.js`), ~70 de linii, în loc de Workbox printr-un
plugin de build: un plugin care rescrie ieșirea lui Next se strică la fiecare
minor al framework-ului, iar ce ne trebuie încape în două strategii.

- assets cu hash (`/_next/static/`): **cache-first** — sunt imutabile prin nume;
- restul: **network-first**, cu cache-ul ca plasă. În subsol rețeaua nu răspunde
  cu eroare, ci *atârnă* — de aia contează ordinea;
- `/api/**`: **niciodată în cache.** Un răspuns de `/api/field/sync` servit din
  cache ar spune telefonului că a primit felia, fără s-o fi primit.

**Fără logică de business.** Service worker-ul nu știe ce e o fișă; tot ce ține de
mutații trăiește în IndexedDB și în `lib/field/sync.ts`, unde poate fi citit și
testat. `scope` e `/field`: aplicația de birou n-are voie servită din cache — ea
arată bani și stări care se schimbă sub tine.

## Cum pleacă pozele

Poza **nu se urcă la apăsare.** Intră în coada `media` din IndexedDB, cu blob cu
tot, și pleacă la primul ciclu de sincronizare — după fișe, niciodată înaintea
lor. Din perspectiva omului, butonul răspunde la fel în subsol și în birou.

Traducerea **unitate de lucru → folder** se face abia la urcare, prin
`POST /api/field/media/target`. Telefonul nu poate ști id-uri de foldere: poza se
face acolo unde nu există rețea, iar arborele e o noțiune de server. Ce reține
ecranul e unitatea și, la lucrări, faza — „Înainte" sau „După".

Bucla urcă **una câte una**, nu în paralel: pe o conexiune de șantier, trei poze
deodată înseamnă trei transferuri care cad împreună la ieșirea din tunel, în loc
de două reușite și una reluată.

Distincția care ține toată logica în picioare e **rețea versus server**:

| Ce s-a întâmplat | Ce se face | De ce |
|---|---|---|
| `fetch` a picat, sau trei încercări pe aceeași parte | poza rămâne în așteptare, bucla **se oprește** | următoarea ar pica la fel; nu se marchează nimic |
| serverul a răspuns cu o eroare | poza e marcată **căzută**, bucla **merge mai departe** | e problema pozei ăleia, nu a zilei |
| a urcat | rândul se **șterge**, cu blob cu tot | o zi de teren înseamnă sute de MB pe telefon |

O poză căzută **nu oprește coada** — spre deosebire de o mutație blocată, de care
pot depinde cele de după ea. Ea așteaptă omul pe `/field/poze`, cu miniatura,
motivul și două butoane: trimite din nou, sau șterge.

**Numele poartă id-ul pozei** (`teren-<uuid>.jpg`). Fără asta, două poze cu
același nume în același folder ar fi devenit două *versiuni* ale aceluiași
fișier, iar a doua ar fi ascuns-o pe prima — exact ce nu-ți dorești când dovada
e vizuală.

**Coordonatele se cer o dată pe serie**, cu trei secunde de așteptare și fără ele
dacă întârzie. Fixul GPS în subsol nu vine niciodată; o poză fără coordonate e o
dovadă mai slabă, dar o poză neluată nu e nicio dovadă.

## Ce aduce felia pentru fișe, și de ce

Felia poartă **răspunsurile deja completate** și **fișele de intervenție cu
liniile lor**. Nu ca să arate istoric: `saveInspection` și `saveIntervention`
**rescriu** tot setul de linii, nu îl îmbină. Un ecran care ar porni gol și ar
salva ar șterge ce s-a completat înainte — inclusiv de la birou, și tăcut.

Ce **nu** trece niciodată: `estimated_value` de pe ieșirea unei constatări și
`unit_cost` de pe un material. Nu sunt ascunse la afișare — rolul `app_field`
n-are grant de citire pe ele.

Are o consecință vizibilă, și e tratată în ecran: **o fișă care conține deja o
ieșire de tip `propunere` se deschide read-only pe teren.** Propunerea poartă o
valoare estimată, iar la salvare telefonul ar trebui s-o trimită înapoi — n-are
de unde s-o știe. Mai bine spune „se editează de la birou" decât să șteargă.

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
`id` nou.

De asta ecranul de conflicte (`/field/conflicte`) n-are buton „încearcă din nou":
ar fi aceeași respingere cu alt nume. Are **„renunță la ea"**, **„deblochează
coada"** și **„duplică drept fișă nouă"**.

Duplicarea e reîncercarea adevărată. Deschide fișa cu **ce a scris omul**, luat
din payload-ul mutației respinse — nu cu ce știe serverul, care e exact starea ce
a produs refuzul. La trimitere pleacă o mutație cu `id` nou și cea refuzată se
șterge, deci nu rămâne niciodată o pereche care să se calce.

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
