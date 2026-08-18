# Regula de rutare a cererilor

Documentul ăsta există dintr-un motiv scris în plan: regula automată **trebuie să
poată fi ajustată fără arheologie în cod**. Dacă jurnalul de decizii arată că
omul schimbă propunerea sistemului des, aici se citește ce propune sistemul azi
și de ce, și de aici pleacă modificarea.

Codul care o implementează: `packages/domain/src/requests/routing.ts`. E o
funcție **pură** — fără bază de date, testată în `routing.test.ts` fără container.

---

## Ce primește

```ts
routeRequest({ value, ceilings, threshold? }): RoutingProposal
```

| Intrare | De unde vine | Ce înseamnă |
|---|---|---|
| `value` | `requests.estimated_value` | valoarea estimată a cererii, calculată din catalogul de operațiuni |
| `ceilings.deltaFreeByPeriod` | `routingContext` din `packages/services/src/requests.ts` | cât e liber pe Deltă, **pe fiecare lună deschisă**, în ordine |
| `ceilings.lucrariCeilingFree` | idem | cât e liber pe componenta Lucrări, în luna curentă. `null` = operațiunea nu e prevăzută în contract |
| `ceilings.isCommercialOpportunity` | `isCommercialOpportunity(request.type)` | vezi mai jos |
| `threshold` | implicit **2.000 lei** | pragul de mentenanță |

### Ce înseamnă „liber"

**Plafonul lunii minus `component_period_rollup.allocated_revenue`** — adică
minus cât s-a promis deja prin alocări de finanțare active.

Nu e consumul din registrul de cost, și diferența contează: o alocare ocupă
plafonul din clipa în care e scrisă, cu mult înainte să existe vreo cheltuială.
Delta are plafon de venit, restul componentelor plafon de cost.

Aceeași definiție e folosită în trei locuri, și trebuie să rămână așa:
`routingContext` (ecranul de Decizie), `deltaFreeForContract` (ecranul de
Backlog) și `freeRoom` (verificarea de plafon din `promoteBacklog`). Dacă ecranul
ar folosi altă definiție decât cea pe care o impune serviciul, ar promite loc pe
care serviciul îl refuză — și atunci omul învață să nu creadă ecranul.

`null` (plafon nesetat pe luna aia) **nu** înseamnă „infinit", ci „nedefinit": o
lună fără plafon nu apare deloc în opțiunile de Deltă.

---

## Ordinea de prioritate a propunerii

Prima care e disponibilă câștigă. **Nu** e și ordinea de afișare — pe ecran
opțiunile stau în ordinea din `ROUTING_CHOICES`, care e cea din §3.5 a planului.

1. **`interventie_mentenanta`** — `value ≤ threshold` (2.000 lei).
2. **`lucrare_delta`** — încape în liberul **primei** luni de Deltă.
3. **`lucrare_componenta_lucrari`** — încape în plafonul liber al componentei Lucrări.
4. **`lucrare_delta_multi_luna`** — încape în liberul cumulat pe 2, apoi pe 3 luni. Se ia **minimul de luni** care ajunge.
5. **`contract_individual_nou`** — cererea e marcată ca oportunitate comercială.
6. **`amanata_backlog`** — mereu disponibilă. E fundul sacului, și e o opțiune legitimă, nu un eșec.

Fiecare opțiune se întoarce cu `available` **și** cu `reason` — inclusiv cele
indisponibile, care spun „✗ peste pragul de 2.000" sau „✗ 12.000,00 lei >
4.100,00 lei disponibil în august, septembrie". Ecranul le arată pe toate.

### Împărțirea pe luni

`splitDeltaAcrossPeriods(value, periods)`: fiecare lună primește **cât are
liber**, în ordine, iar restul cade pe **ultima**.

Nu proporțional (cum face `splitAcrossPeriods` din `funding/`): lunile nu sunt
egale între ele, fiecare are plafonul ei, iar o împărțire proporțională ar depăși
liberul lunii întâi ca să lase loc gol în a treia.

Feliile ajung pe ecran în `RoutingOption.split` și de acolo direct în alocări.
**Ecranul nu recalculează nimic** — două locuri care ar împărți aceeași sumă ar
diverge exact în luna care contează.

---

## Ce e „oportunitate comercială"

```ts
isCommercialOpportunity(requestType) =
  requestType === 'tichet_client' || requestType === 'propunere_interna'
```

Un tichet de client sau o propunere internă pot deveni contract individual nou; o
constatare de inspecție sau o observație de utilaj, nu — alea sunt **obligații**,
nu vânzări.

**Nu există coloană `is_opportunity` pe cerere, și nu s-a inventat una.** Până
când cineva chiar cere să poată bifa manual, tipul cererii e informația care
există deja și care nu poate fi uitată la completare. Când apare cererea, se
adaugă coloana și funcția asta devine `request.isOpportunity ?? regula de mai
sus` — nu se schimbă nimic altceva.

### `contract_individual_nou` NU creează contractul

Alegerea din ecran înseamnă „lucrarea se plătește dintr-un contract individual",
nu „creează-mi acum un contract". Contractul individual se creează **înainte** de
decizie, prin fluxul din pasul 04; decizia doar leagă unitatea de lucru de
componenta lui. Altfel decizia de rutare ar ajunge să scrie contracte, și atunci
ar exista două drumuri de creare de contract.

---

## Cum se ajustează regula

| Vrei să schimbi | Unde |
|---|---|
| pragul de mentenanță | `DEFAULT_THRESHOLD` în `routing.ts`, sau se dă `threshold` la apel (ex. per firmă, din „Praguri și reguli") |
| ordinea de prioritate | lanțul de `if` de la finalul lui `routeRequest` |
| ordinea de afișare | `ROUTING_CHOICES`, tot în `routing.ts` |
| ce e oportunitate | `isCommercialOpportunity` |
| câte luni de Deltă se iau în calcul | parametrul `months` al lui `routingContext` (implicit 3) |
| textele „✗ …" | tot în `routing.ts` — sunt singura explicație pe care o vede omul |

După orice modificare: `pnpm --filter @damina/domain test`. Cazurile din §6 al
planului (verificările #6, #7, #8) sunt acolo, fără bază de date.

---

## Ce măsoară dacă regula e bună

`request_decisions` păstrează **și** `system_proposal`, **și** `choice`. Ecranul
`Cereri › Decizii de rutare` arată procentul în care omul a schimbat propunerea
(`listRoutingDecisions().divergencePercent`).

O divergență mare nu e o problemă de disciplină, ci semnul că regula de aici
trebuie ajustată. Peste ~40% ecranul o marchează. Asta se poate afla **doar**
pentru că se salvează amândouă, nu doar rezultatul — regula 4 a pasului 08.
