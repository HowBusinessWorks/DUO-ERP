# Review 08a — cereri, rutare, backlog

> **Notă de corectură (18 august 2026).** Raportul a fost verificat după redactare. O constatare —
> **I4** — era **greșită** și a fost retrasă; vezi tabelul „Importante". Restul constatărilor rămân
> în picioare. Numărătoarea reală: **6 blocante, 7 importante** (nu 8).

> **Stare (18 august 2026): TOATE constatările valide sunt REZOLVATE.** Cele 6 blocante și cele
> 7 importante au fost reparate, cu teste de regresie în `packages/domain/src/requests/backlog.test.ts`,
> `routing.test.ts` (domain: 104 teste) și `packages/services/tests/requests.test.ts` (14 teste,
> toate verzi pe Supabase dev). Rezumatul reparațiilor și capcanele de evitat sunt în
> `Plan/PROGRESS.md`, secțiunea „08a′". Minorele și datoria tehnică de la finalul fișierului au
> rămas dinadins neatinse — decizia utilizatorului.

## Verdict

Fundația e solidă structural și reparabilă punctual: schema, migrarea, RLS-ul și tiparul de
tranzacție unică sunt corecte și în linie cu pașii anteriori. Nu trebuie refăcută. Există însă
patru probleme care se propagă dacă se construiesc ecranele peste ele: `knapsackExact` alocă
sute de MB și scoate procesul din memorie la plafoane realiste, `promoteBacklog` nu verifică
nici plafonul (#16) nici apartenența propunerilor la contract și are o cursă de dublă-promovare,
iar `decideRouting` duplică `createWorkUnit` în loc să-l refolosească (pierde regulile lui) și
nu validează starea/firma cererii. Plus o funcție cerută de plan care lipsește complet
(`splitDeltaAcrossPeriods`).

## Blocante (trebuie reparate înainte de 08b)

| # | Fișier:linie | Problema | De ce e blocant | Reparația propusă |
|---|---|---|---|---|
| B1 | `packages/domain/src/requests/backlog.ts:39-53` | `knapsackExact` alocă `Uint8Array(capacityCents+1)` **per propunere** plus două `Array<number>` de aceeași lungime. Plafon 100.000 lei = 10.000.001 cenți → ~10 MB/propunere; 50 propuneri = **~500 MB** de `choice[]` + ~160 MB de `best`/`next`, și ~500M iterații. La `MAX_ITEMS_EXACT=200` → ~2 GB. | Ecranul de backlog îl apelează la fiecare schimbare de selecție; procesul Node moare (OOM) sau blochează event-loop-ul secunde bune. Plafoanele de Deltă de zeci de mii de lei sunt normale, nu marginale. | Nu face DP pe cenți. Fie (a) DP pe valorile distincte comprimate (sumele posibile ≤ 2^n dar practic mici) / meet-in-the-middle pentru n ≤ 40, fie (b) DP pe cenți doar dacă `capacityCents * n <= LIMITĂ` (ex. 5M celule) și greedy+rafinare local altfel, fie (c) scalare la lei întregi (capacitate/100) — reduce de 100× și e suficient pentru „umple plafonul". |
| B2 | `packages/services/src/requests.ts:334-337` | `update ... set status='promoted'` **fără** `and(eq(status,'open'))` în `where`, iar citirea de la 286-294 nu ia lock (`for update`). | Două promovări concurente ale aceleiași propuneri creează 2 UL-uri și 2 alocări pe același plafon — exact banii pe care pasul îi urmărește. | `select ... for update` la citire **sau** `update ... where id = ? and status = 'open'` și verificarea `rowCount === 1`, altfel `CONFLICT`. |
| B3 | `packages/services/src/requests.ts:286-332` | Propunerile nu sunt filtrate pe `values.contractId`: se pot promova propuneri ale contractului A finanțate din componenta/luna contractului B. Nici `componentId` nu e verificat că aparține `contractId`. | Alocare de finanțare pe contract greșit, tăcut. Rollup-urile din 06 vor arăta consum pe un contract care n-a cerut lucrarea. | Adaugă `eq(schema.backlogProposals.contractId, values.contractId)` în `where` și verifică `contract_components.contract_id = values.contractId`. |
| B4 | `packages/services/src/requests.ts:278-332` | Nicio verificare de plafon liber înainte de promovare și niciun avertisment cu suma depășită. | **Verificarea #16 e imposibil de trecut** cu codul actual („avertisment explicit cu suma depășită, decizie conștientă, nu blocaj tăcut") — nici avertisment, nici blocaj: promovează orice. | Calculează liberul din rollup pentru (contract, componentă, lună), compară cu `Σ estimatedValue`, și cere un flag explicit în input (ex. `acceptOverCeiling: boolean` + suma depășită returnată în eroare `CONFLICT` când e `false`). |
| B5 | `packages/services/src/requests.ts:183-226` vs `packages/services/src/work-units.ts:506-560` | `decideRouting` **reimplementează** crearea UL în loc să cheme `createWorkUnit(actor, values.creation, id)`. Pierde: regula „o intervenție cere cel puțin o alocare" (work-units.ts:522-527) și mesajul dedicat pe `UNIQUE_VIOLATION` de serie (work-units.ts:583-590). | Două drumuri de creare a UL cu reguli diferite — exact ce comentariul din `work-units.ts:599` spune că nu trebuie să existe. O intervenție decisă din rutare poate rămâne fără finanțare. | Înlocuiește blocul cu `await createWorkUnitTx(tx, actor, values.creation, newWorkUnitId, { sourceRequestId })` — extrage corpul lui `createWorkUnit` într-o funcție care primește `tx`, ca să rămână în aceeași tranzacție. |
| B6 | `packages/services/src/requests.ts:151-158` | `decideRouting` citește cererea dar **nu verifică nimic** despre ea: nici `status` (o cerere deja `decisa` poate fi decisă din nou → al doilea UL + a doua alocare), nici `request.companyId === values.creation.workUnit.companyId` (UL creat pe altă firmă decât cererea). | Dublarea deciziei e un dublu-cheltuit de plafon; nepotrivirea de firmă rupe scoping-ul de firmă al întregului lanț cerere→UL→alocare. | Respinge cu `CONFLICT` dacă `status` nu e în `('neprocesata','in_evaluare')`; respinge cu `VALIDATION_FAILED` dacă firmele diferă. Ideal, `select ... for update` pe cerere. |

## Importante (de reparat, dar nu blochează)

| # | Fișier:linie | Problema | Reparația propusă |
|---|---|---|---|
| I1 | lipsă (`packages/domain/src/requests/`) | `splitDeltaAcrossPeriods(value, periods)`, cerută explicit de §3.3, **nu există**. Verificarea #12 („3 alocări, sumele corecte") n-are sursă de adevăr: sumele ar fi calculate ad-hoc în UI. | Implement-o în domain (împărțire pe liberul fiecărei luni, cu restul pe ultima, fără pierderi de rotunjire — `Money`), și folosește-o din ecranul de decizie. |
| I2 | `packages/services/src/requests.ts:313-321` | UL-ul promovat nu primește `estimatedValue = proposal.estimatedValue` — valoarea propunerii se pierde din UL, deși alocarea o are. | Setează `estimatedValue: proposal.estimatedValue` la insert. |
| I3 | `packages/services/src/requests.ts:101-125` | `evaluateRequest` nu verifică existența cererii: dacă `requestId` nu există (sau e invizibil prin RLS), `delete`+`update` afectează 0 rânduri și funcția întoarce un total „calculat" fără să fi scris nimic. În plus rescrie `status` în `in_evaluare` chiar dacă cererea e deja `decisa`/`anulata`. | `select ... for update` pe cerere înainte (404 dacă lipsește) + refuz dacă `status` nu mai permite evaluarea. |
| ~~I4~~ | ~~`packages/services/tests/requests.test.ts:256`~~ | **CONSTATARE RETRASĂ — era greșită.** Reviewer-ul a susținut că `sql\`... where id in ${proposalIds}\`` trimite array-ul ca un singur parametru și că testul eșuează. Fals: în `sql` de la drizzle o listă JS se expandează în `(a, b, c)`, deci `in ${ids}` e **forma corectă în repo-ul ăsta** — e documentată explicit în `Plan/PROGRESS.md` („`= any(${ids})` dă `cannot cast type record to uuid[]`; forma corectă e `in ${ids}`"). Testul trece la rulare, confirmat. | **Nu modifica nimic.** O „reparație" aici ar introduce exact bug-ul pe care nota din PROGRESS îl previne. |
| I5 | `packages/domain/src/requests/routing.ts:151-160` | Bucla multi-lună marchează disponibil pe baza **sumei** liberului pe 2–3 luni, dar nu întoarce împărțirea pe luni. Ecranul nu are de unde ști câte lei pe fiecare lună (legat de I1). | După I1, întoarce și `split: { periodId, amount }[]` în `RoutingOption`. |
| I6 | `packages/services/src/requests.ts:82-99` | Nu se filtrează `is_active = true` la operațiunile din catalog: o operațiune dezactivată poate fi folosită la evaluare. | `and(inArray(id, ...), eq(isActive, true))`. |
| I7 | `packages/db/migrations/0025_requests_and_catalog.sql:246-247` | Politica `assigned` pe `app.requests` acoperă doar `select`, ceea ce e corect pentru #20 — dar `app_field` nu are nicio politică pe `request_estimate_lines`/`request_decisions`. Nu e bug (nici grant n-are), doar de confirmat că ecranul de teren nu le va cere; dacă le va cere, se repetă bug-ul „tabelă cu RLS și fără politică → zero rânduri, tăcut". | Nimic acum; de notat în `docs/security.md` că accesul terenului la cereri e strict `select` pe `app.requests`. |
| I8 | `packages/contracts/src/requests.ts:126-130` | `refine` cere `creation` și pentru `contract_individual_nou` — dar la momentul deciziei contractul individual încă nu există, deci alocarea trebuie să pointeze pe ceva. Fie e o restricție nedorită, fie lipsește o ramură dedicată. | Clarifică: fie permite `creation` fără alocări pentru alegerea asta, fie documentează că se creează întâi contractul. |

## Minore / datorie tehnică

- `packages/contracts/src/requests.ts:61-68` — `ROUTING_CHOICES` duplicat față de `packages/domain/src/requests/routing.ts:21-28` (ordine diferită); risc de drift. Importă-l pe unul din celălalt.
- `packages/services/src/requests.ts:115-120` — `estimateFromCatalog(..., quantity: 1)` după ce s-a înmulțit deja manual: corect matematic, dar apelul e decorativ; `Money.sum` direct ar fi mai onest.
- `packages/services/src/requests.ts:252-253` — `targetContractId`/`targetComponentId` iau doar `allocations[0]`; la split pe componente diferite se pierde informația.
- `packages/services/src/requests.ts:229-245` — lookup-ul de perioade nu verifică `company_id`-ul perioadei față de cerere.
- `packages/db/src/schema/requests.ts:49,186` — `sourceInspectionFindingId`/`sourceInspectionId` fără FK (documentat, ok pentru 08, dar de urmărit în 09).
- `packages/contracts/src/requests.ts:80-91` — `createRequestInputSchema` nu expune `sourceInspectionFindingId`/`sourceEquipmentId`, deși coloanele există; câmpurile „opționale" cer `''` explicit în loc de `.optional()`.
- `packages/db/migrations/0025_requests_and_catalog.sql:214-221` — `request_emails` și `request_estimate_lines` nu au audit; e o alegere apărabilă, dar `request_emails` e „dovada".
- Folderul **cererii** (§3.4, atașamentele emailului) nu e creat nicăieri în servicii; folderul UL-ului vine din trigger-ul `work_units_build_tree` (0021_files.sql:654), deci #10/#11 sunt acoperite — dar inbox-ul de email din 08b va avea nevoie de un `ensure_folder` pe cerere.

## Suspiciuni verificate

- **(a) memoria din `knapsackExact` — CONFIRMAT, blocant.** 50 propuneri × plafon 100.000 lei = ~500 MB doar în `choice[]` (10 MB/propunere) plus ~160 MB tranzitoriu în `best`/`next` și ~500M iterații; la `MAX_ITEMS_EXACT=200` depășește 2 GB. Vezi B1.
- **(b) verificarea #16 — CONFIRMAT.** `promoteBacklog` (`requests.ts:278-352`) nu citește niciun plafon și nu întoarce nicio avertizare; nici blocaj, nici avertisment. Vezi B4.
- **(c) ordinea Lucrări înainte de Delta ×2–3 — INFIRMAT ca bug.** Verificarea #8 acceptă explicit „split pe 2–3 luni **sau** componenta Lucrări", iar #6/#7 sunt satisfăcute de primele două ramuri (`routing.ts:177-190`); ordinea e o alegere, nu o abatere — dar merită documentată în `docs/routing.md`, cum cere §7.
- **(d) `quantity: 1` în `evaluateRequest` — INFIRMAT.** Înmulțirea se face la `requests.ts:96-97` cu `Money.mul(quantity)`, iar `estimateFromCatalog` face `mul(1)` peste sumele deja înmulțite; rezultatul (`labor+material`) e corect matematic. Doar redundant.
- **(e) `promoteBacklog` hardcodează `lucrare` și alocă suma întreagă fără plafon — CONFIRMAT parțial.** Tipul `lucrare` e conform §0 („Promovează în lucrări") și nu e bug; lipsa verificării de plafon e reală (B4), la fel lipsa filtrării pe contract (B3) și cursa de status (B2).
- **(f) RLS pe cele 8 tabele — INFIRMAT în esență, cu o nuanță.** `app.rls_enable` (0011_rls_policies.sql:246-261) creează automat politicile `definer` și `service`, deci nicio tabelă nu rămâne fără politică și `app_service` (worker-ul, `expireBacklogProposals`) nu e blocat. `app_field` primește corect doar `select` prin `app.request_assigned_to_me` și un grant pe coloane fără `estimated_value` (0025:304-308), iar `assert_no_money_leak` îl verifică (0025:314-316) — **#20 e acoperită**. Nu am găsit tabelă cu `insert` grantat și fără `with check` corespunzător: toate politicile de birou au `for all` cu `using` + `with check`.
- **(g) atomicitatea lui `decideRouting` — CONFIRMAT ca atomicitate, INFIRMAT ca „corect".** Tot ce se scrie e într-un singur `withActor` (deci și rollback-ul din #11 funcționează, confirmat de testul de la `requests.test.ts:154`), iar statusurile pe ramuri sunt corecte (`in_backlog` la amânare, `decisa` altfel). Problemele sunt de **precondiții**, nu de atomicitate: fără verificare de status/firmă (B6) și cu logica UL duplicată (B5).
- **(h) `target_periods` `date[]` din `period_id` — CONFIRMAT corect ca format, incomplet ca semantică.** `requests.ts:238-244` produce `YYYY-MM-01` din `year`/`month`, exact „prima zi a lunii" cerută de §3.1; lipsește însă verificarea de firmă pe perioadă și se populează și pentru alegeri care nu sunt Delta (unde planul spune „null pentru alegerile care nu sunt Delta", vezi `schema/requests.ts:147`).

## Ce e bine făcut (nu atinge la reparații)

- Schema: o singură entitate `requests` cu tip (regula 1), `request_decisions` cu `choice` **și** `system_proposal` amândouă `not null` (regula 4), `reason not null` + check de non-blank (regula 3). Indexurile sunt exact cele cerute de §3.1, inclusiv `backlog_proposals_contract_status_value_idx`.
- Migrarea 0025: FK-urile întârziate (`work_units.source_request_id`, `request_emails.raw_node_id`) rezolvate curat la final; funcțiile `security definer` de scoping urmează tiparul din 0011/0016; `assert_no_money_leak` rulat din nou.
- Poarta de bani pentru `app_field`: enumerarea explicită de coloane, nu `grant select` global.
- `decideRouting` — tiparul de tranzacție unică și rollback-ul complet; testul #11 e scris bine (verifică inclusiv că statusul cererii n-a migrat).
- `routeRequest` — funcție pură, fără DB, cu `RoutingOption.reason` în forma cerută de ecran („✗ peste pragul de 2.000"), și `Money` peste tot în loc de `number`.
- Folosirea consistentă a lui `Money` și `toDbString()` la granița cu baza.
