# Cozi, notificări, alerte — trei mecanisme, nu unul

Confuzia dintre ele e cea mai comună greșeală din ERP-uri. Stau în trei tabele
separate, cu API-uri deliberat diferite în `@damina/services`, ca să nu poată fi
apelate din greșeală unul în locul altuia.

|                 | `app.work_queue_items`                | `app.notifications`                 | `app.alerts`                       |
| --------------- | ------------------------------------- | ----------------------------------- | ---------------------------------- |
| **Ce e**        | obiect care așteaptă **acțiunea mea** | eveniment punctual, spus **o dată** | prag depășit, **persistă**         |
| **Unde apare**  | badge în sidebar + card în Panou      | clopoțel                            | banner pe entitate + card în Panou |
| **Cum dispare** | prin **acțiune**                      | prin citire                         | când **condiția** dispare          |
| **Cine scrie**  | use-case-ul, ca `app_service`         | use-case-ul                         | resolver-ul, ca `app_service`      |

## Câte un exemplu concret

**Coadă** — „SL-0012 așteaptă aprobarea ta”.
Rândul se inserează când subcontractantul depune situația și se golește în
aceeași tranzacție cu aprobarea. **Nu există buton „marchează ca rezolvat”**: o
coadă care se bifează manual nu mai măsoară nimic.

```ts
await resolveWorkQueueItem(actor, itemId); // din use-case-ul de aprobare, nu din UI
```

**Notificare** — „A. Ionescu ți-a aprobat devizul D-45”.
S-a întâmplat deja și nu cere nimic. Se citește și rămâne în istoric.

**Alertă** — „Bugetul componentei Lucrări e la 84%”.
Stă pe contract până când cineva mărește plafonul sau consumul scade.

```ts
await raiseAlert('budget.check', {
  companyId,
  scopeType: 'contract',
  scopeId,
  kind: 'buget_80',
  severity: 'warning',
  title: 'Buget la 84%',
  href: `/contracte/${scopeId}/costuri`,
});
```

`raiseAlert` e **idempotent**: indexul unic parțial
`unique (scope_type, scope_id, kind) where resolved_at is null` face ca a doua
rulare a resolver-ului să nu producă un al doilea rând. Fără el, un job care
rulează din 15 în 15 minute umple bannerul în două ore, și atunci nimeni nu-l
mai citește — adică alertele își pierd tot rostul.

## Testul de decizie

> **Se poate goli prin acțiune?**
> Da → coadă de lucru, cu badge în sidebar.
> Nu, dar dispare când condiția dispare → alertă.
> Nu, s-a întâmplat și gata → notificare.
> Niciuna → **e statistică**, și statisticile stau în Panou, nu în meniu.

## Realtime

Prin Supabase Realtime circulă **doar** badge-urile de coadă și clopoțelul
(`apps/web/src/components/shell/live-sync.tsx`). Niciodată date de business: un
ecran care se rearanjează sub degetul omului în timp ce completează un deviz e o
sursă de erori, nu o funcționalitate.

Componenta nu ține niciun număr — ascultă „s-a schimbat ceva la mine” și cere
`router.refresh()`. Numerele rămân într-un singur loc, pe server. Fallback:
reîmprospătare la 60 s, mereu activă, ca badge-urile să rămână corecte și când
Realtime nu e configurat.

## Regula anti-zgomot

Nu se trimit notificări către teren pentru lucruri care sunt vederi de birou.
Inspecțiile nu notifică pe nimeni; acoperirea se măsoară la birou. Fiecare tip
de notificare își declară audiența, iar `field` e o listă scurtă și explicită.
