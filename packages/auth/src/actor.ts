import type { Actor } from '@damina/db';
import { PG_ROLE_BY_PERSONA } from '@damina/db';
import type { Session } from './session';

/**
 * Puntea dintre sesiune si baza de date.
 *
 * Sta separat de `session.ts` pentru ca e SINGURA bucata din `packages/auth`
 * care are nevoie de `@damina/db`, iar `@damina/db` aduce cu el driverul de
 * Postgres, deci `node:fs`.
 *
 * Middleware-ul Next ruleaza pe Edge, unde `node:fs` nu exista. Cat timp
 * `actorFor` statea langa tipul `Session`, orice import din `@damina/auth`
 * tragea dupa el toata baza de date — si build-ul cadea cu
 * „Reading from node:fs is not handled by plugins” in clipa in care
 * middleware-ul a avut nevoie de o singura functie de aici. Impartirea nu e
 * cosmetica: e granita dintre ce poate rula pe Edge si ce nu.
 *
 * Vezi `edge.ts` pentru jumatatea curata.
 */

/** Actorul de baza de date al sesiunii. `reason` se adauga per operatie. */
export function actorFor(session: Session, reason?: string): Actor {
  return {
    personId: session.personId,
    persona: session.persona,
    pgRole: PG_ROLE_BY_PERSONA[session.persona],
    claims: {
      persona: session.persona,
      person_id: session.personId,
      office_roles: session.officeRoles,
      company_ids: session.companyIds,
      /*
       * Cheile optionale LIPSESC cand n-au valoare, nu sunt `null`. Doua motive,
       * si al doilea l-am aflat pe pielea noastra:
       *
       *  - setul de claim-uri vazut de RLS prin `withActor` trebuie sa fie
       *    identic cu cel din JWT, iar hook-ul le omite (migrarea 0014);
       *  - GoTrue refuza sa semneze un token cu `client_id: null` — e un nume
       *    rezervat in specificatie. Trei din patru persone nu se puteau loga.
       *
       * Semantica e aceeasi: `app.current_client_id()` trateaza cheia lipsa si
       * `null` la fel, cazand pe `app.persons`.
       */
      ...(session.subcontractorId === null ? {} : { subcontractor_id: session.subcontractorId }),
      ...(session.clientId === null ? {} : { client_id: session.clientId }),
    },
    ...(reason === undefined ? {} : { reason }),
  };
}
