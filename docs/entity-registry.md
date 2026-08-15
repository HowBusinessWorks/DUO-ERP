# `entityRegistry` — cum adaugi o entitate

Nu există pagini per entitate. Există două fișiere de rută, și atât:

```
apps/web/src/app/(office)/[module]/page.tsx                 → lista
apps/web/src/app/(office)/[module]/[id]/[[...tab]]/page.tsx → detaliul
```

Amândouă citesc din `apps/web/src/registry/entities.tsx`. **O entitate nouă = o
intrare acolo.** Dacă simți nevoia să scrii o a treia pagină „pentru că entitatea
ta e specială”, oprește-te: lipsește ceva din `registry/types.ts` și acolo se
completează, unde beneficiază toate entitățile deodată.

## Minimul care randează un ecran complet

```tsx
const contracte = defineEntity<ContractRow>({
  slug: 'contracte', singular: 'Contract', plural: 'Contracte',
  icon: 'fileSignature', group: 'operational', usesPeriod: true,
  list: {
    load: (ctx, q) => listContracts(ctx.actor, q),
    rowKey: (r) => r.id,  rowHref: (r) => `/contracte/${r.id}`,
    searchPlaceholder: 'Caută după număr sau client',
    columns: [{ key: 'name', header: 'Denumire', cell: (r) => <CellTitle>{r.name}</CellTitle> }],
    empty: { title: 'Niciun contract', body: 'Contractele sunt…', actionLabel: 'Adaugă' },
  },
});
```

Adaugi entitatea în obiectul `entityRegistry` de la finalul fișierului și
intrarea corespunzătoare în `registry/navigation.ts` (ca să apară în meniu).
Restul — antet, tab-uri, Legături, formular — se adaugă când ai nevoie de ele.

## Ce mai poți declara

| Cheie | Ce face |
|---|---|
| `detail.load` / `header` / `tabs` | pagina de detaliu, cu banda [2] și [3] |
| `detail.links` | panoul de Legături, rezolvat în RSC, cu contoare |
| `detail.quickActions` | 3–5 acțiuni care se schimbă **cu statusul** entității |
| `form` | formularul de creare/editare, descris ca date |
| `canRead` / `canWrite` | cine deschide modulul, cine îl modifică |
| `usesPeriod` | dacă ecranul depinde de lună (selector + lacăt) |

## Regulile care sunt impuse de tipuri, nu de disciplină

- **`empty` nu e opțional.** Nu poți livra o listă fără stare goală proiectată (§30.11).
- **`Tabs` nu are `disabled`.** Un tab fără drept se filtrează cu `visible` și
  **lipsește din DOM** — nu apare gri (§30.5). Ruta lui răspunde „nu ai acces”.
- **`Stat.context` nu e opțional.** O cifră fără referință nu susține nicio decizie.
- **`Money` nu acceptă `number`.** Doar tipul `Money` din `@damina/shared`.
- **Maximum două bare de progres în antet.** Restul indicatorilor stau în tab-uri.

## Nota de tipuri

Metodele din `registry/types.ts` sunt scrise cu sintaxă de metodă
(`load(...)`), nu de proprietate. Diferența nu e cosmetică: sintaxa de metodă
face parametrii bivarianți în TypeScript, ceea ce permite ca un
`EntityDefinition<ProductRow>` să stea într-un registry de
`EntityDefinition<unknown>`. Fără ea, singura alternativă era `any` peste tot în
registry — adică fără tipuri exact acolo unde contează.
