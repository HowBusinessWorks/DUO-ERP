import { sql } from 'drizzle-orm';
import { type Actor, isPgRole, serviceActor } from './actor';
import { type ConnectionMode, type Db, getDb } from './client';

/**
 * Tranzactia in care ruleaza codul de aplicatie. E acelasi tip ca al lui
 * Drizzle, dar expus doar prin `withActor` — nu exista alta cale de a obtine
 * una, pentru ca `pool` si `getDb` nu se exporta din pachet.
 */
export type ActorTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Singura poarta catre Postgres.
 *
 * Deschide o tranzactie, intra in rolul Postgres al actorului si publica
 * claim-urile JWT si autorul in GUC-urile de sesiune. Tot ce se intampla
 * inauntru vede exact ce are voie sa vada persona respectiva — RLS-ul si
 * grant-urile pe coloane sunt active, nu optionale.
 *
 * Consecinta: e imposibil sa scrii accidental un query fara RLS. Nu depinde
 * de disciplina cuiva, depinde de suprafata de API.
 */
export async function withActor<T>(
  actor: Actor,
  fn: (tx: ActorTx) => Promise<T>,
  options: { mode?: ConnectionMode } = {},
): Promise<T> {
  if (!isPgRole(actor.pgRole)) {
    throw new Error(`Rol Postgres necunoscut: "${String(actor.pgRole)}".`);
  }

  const db = getDb(options.mode ?? 'pooled');

  return db.transaction(async (tx) => {
    // `true` = LOCAL: setarile dispar la commit/rollback, deci nu se scurg
    // catre urmatoarea cerere care refoloseste conexiunea din pool.
    await tx.execute(sql`select set_config('role', ${actor.pgRole}, true)`);
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(actor.claims)}, true)`,
    );
    await tx.execute(sql`select set_config('app.actor_id', ${actor.personId}, true)`);
    if (actor.reason !== undefined && actor.reason !== '') {
      await tx.execute(sql`select set_config('app.action_reason', ${actor.reason}, true)`);
    }

    return fn(tx);
  });
}

/**
 * Varianta pentru worker. Ruleaza ca `app_service`, pe conexiunea de session
 * pooling, si marcheaza in audit ca autorul e un job — cu numele lui.
 */
export async function withServiceActor<T>(
  jobName: string,
  fn: (tx: ActorTx) => Promise<T>,
): Promise<T> {
  return withActor(serviceActor(jobName), fn, { mode: 'session' });
}
