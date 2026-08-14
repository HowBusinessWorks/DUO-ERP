# Sistem de navigare — Damina Ops

Descriere generală a modului în care e structurată navigarea în aplicație, pe baza interfeței "Contracte > Container". Documentul e scris ca referință rapidă pentru un AI care trebuie să înțeleagă/replice acest pattern.

## 1. Breadcrumb global (bara de sus, header)

- Poziționat în header-ul aplicației, deasupra tuturor paginilor.
- Format: `Panou > Contracte > {id contract} > Containers > {id container}`.
- Folosește ID-uri tehnice (UUID) în loc de nume, deci e mai degrabă un "path tehnic" / breadcrumb de rută (route path), nu unul orientat spre utilizator.
- Rol: arată poziția absolută în ierarhia aplicației (din rădăcină), similar unui path de filesystem sau URL.

## 2. Sidebar principal (navigare verticală, fix pe stânga)

- Listă de module de nivel top: Panou, Contracte, Cerere, Teren, Aprovizionare, Bani.
- Modulul activ (ex. "Contracte") se expandează inline și arată sub-secțiuni proprii (Toate contractele, Obiective) indentate sub el.
- E navigare de tip "primary/global nav" — determină în ce modul/domeniu al aplicației te afli. Rămâne vizibil constant, nu dispare la navigare internă.

## 3. Breadcrumb local + titlu de pagină (in-page)

- Sub header, fiecare pagină de detaliu are propriul breadcrumb "prietenos" (nume, nu ID-uri): `Contracte > Reabilitare Call Center`.
- Urmat de titlul entității, badge-uri de status/tip (ex. "Individual", "Activ") și metadate cheie (client, valoare, perioadă) afișate direct sub titlu.
- Acesta e breadcrumb-ul "semantic", orientat spre utilizator — corespunde 1:1 cu breadcrumb-ul tehnic din header, dar cu label-uri umane în loc de UUID.

## 4. Tab-uri orizontale (navigare secundară, la nivel de entitate)

- Sub titlul entității apare o bară de tab-uri orizontale: Prezentare, Obiective, Containere, Financiar, Facturare, Documente.
- Fiecare tab reprezintă o "fațetă"/secțiune de date a aceleiași entități (contractul), nu o entitate diferită — navigarea rămâne în context, doar schimbă view-ul.
- Un tab poate avea badge numeric (ex. "Obiective 1") care indică număr de elemente în acea secțiune.
- Tab-ul activ e evidențiat cu underline/highlight.

## 5. Drill-down (navigare ierarhică prin click pe element din listă)

- Din tab-ul "Containere" al contractului, click pe un container specific duce la o pagină nouă de detaliu, dedicată acelui container (ex. "Reabilitare Etaj 1").
- Această pagină nouă repetă exact același pattern (1–4): breadcrumb tehnic global actualizat, breadcrumb local actualizat (`Contracte > Reabilitare Call Center > Containere > Reabilitare Etaj 1`), titlu + badge-uri + metadate, și propriul set de tab-uri (Prezentare, Buget, Deviz, Activități, Comenzi, Costuri, Situații, PV-uri, Documente, Închidere).
- Deci navigarea e recursivă/fractală: fiecare nivel de entitate (Contract → Container → ...) are aceeași structură (breadcrumb + header + tab-uri), doar setul de tab-uri diferă în funcție de tipul entității.
- Panelul lateral "Legături" (dreapta) arată relațiile entității curente cu părinții ei (Contract, Obiectiv) ca linkuri rapide de navigare — o alternativă la breadcrumb pentru a urca în ierarhie.

## Sumar pentru AI

Navigarea are 3 straturi combinate:
1. **Global/primary nav** — sidebar vertical fix, pe module.
2. **Ierarhic/breadcrumb** — path dublu (tehnic cu ID-uri în header + semantic cu nume in-page), reflectă adâncimea curentă în arborele de entități (Contract > Container > ...).
3. **Local/secundar (tabs)** — la fiecare nivel din ierarhie, tab-uri orizontale comută între fațete/secțiuni de date ale aceleiași entități, fără să schimbe nivelul ierarhic.

Pattern-ul e recursiv: orice entitate "container-like" (Contract, Container, posibil altele) urmează același template de pagină — header cu breadcrumb, titlu+metadate, tab-uri, panel lateral de legături — ceea ce sugerează o componentă de layout reutilizabilă (ex. `EntityDetailPage`) parametrizată cu lista de tab-uri și câmpurile de metadate specifice tipului de entitate.
