import { schema, withActor, type Actor, type ActorTx } from '@damina/db';
import { AppError, uuidv7 } from '@damina/shared';
import { and, eq, sql } from 'drizzle-orm';
import { translateDbError } from './db-errors';

/**
 * Inchiderea de luna: mașina de stari si checklist-ul ei (§3.3).
 *
 * `open → closing → closed`, si inapoi doar prin redeschidere de administrator,
 * cu motiv scris.
 *
 * **Checklist-ul e date, nu cod.** Fiecare rand e un `check_key` in
 * `app.period_close_checks`; interogarea de validare sta in registrul de mai jos.
 * Consecinta practica: un modul care apare la pasul 09 isi aprinde randul singur,
 * fara migrare si fara sa atinga ecranul.
 *
 * **Checklist-ul e blocant, nu informativ.** Daca inchiderea ar fi optionala, nu
 * s-ar face niciodata, iar cifrele lunilor trecute n-ar mai fi reproductibile.
 */

/**
 * Ce poate spune un rand de checklist.
 *
 * `not_applicable` si `pending_module` arata la fel pe ecran si sunt lucruri
 * diferite: primul inseamna „nu se aplica firmei asteia", al doilea „modulul care
 * raspunde inca nu exista". Al doilea se aprinde singur cand modulul apare.
 */
export type CloseCheckStatus = 'pending' | 'ok' | 'blocked' | 'not_applicable' | 'pending_module';

export interface CloseCheckResult {
  readonly status: CloseCheckStatus;
  readonly blockingCount: number;
  /** Obiectele de rezolvat, fiecare cu link. Randul nebifat trebuie sa spuna CE. */
  readonly detail?: { readonly items: readonly { label: string; href?: string }[] };
}

export interface CloseCheckSpec {
  readonly key: string;
  readonly title: string;
  /** Pasul care aduce modulul, cand el inca nu exista. */
  readonly pendingModule?: string;
  readonly evaluate?: (tx: ActorTx, periodId: string) => Promise<CloseCheckResult>;
}

/**
 * Registrul de check-uri. **Extensibil e cerinta de design**, nu un bonus: pasii
 * 07-10 adauga randuri aici, si atat.
 *
 * Cele doua verificari reale de acum ies din registrul de cost — restul asteapta
 * modulele lor si se declara cinstit ca atare. Un rand care s-ar preface ca
 * verifica pontajele inainte sa existe pontaje ar fi mai rau decat lipsa lui:
 * ar da un „✓" pe care nimeni nu l-a castigat.
 */
export const CLOSE_CHECKS: readonly CloseCheckSpec[] = [
  {
    key: 'costuri_angajate_deschise',
    title: 'Comenzile lansate au ajuns la recepție',
    /*
     * Liniile ramase la stadiul `angajat` la finalul lunii sunt una din doua
     * lucruri: ori a venit marfa si n-a intrat NIR-ul, ori comanda s-a anulat si
     * n-a anulat-o nimeni in sistem. Amandoua fac plafonul lunii sa arate ocupat
     * cu bani care nu s-au cheltuit — si amandoua se rezolva in cinci minute
     * daca cineva le vede, si in trei luni daca nu.
     *
     * NU verificam „liniile fara analitica «descarcat»": `check`-ul din 0017 le
     * face imposibile. Un rand de checklist care nu poate cadea niciodata e un
     * rand pe care oamenii invata sa nu-l mai citeasca.
     */
    evaluate: async (tx, periodId) => {
      /*
       * Se grupeaza pe DOCUMENT si se cere sold zero, nu „nicio linie angajata".
       * Registrul fiind append-only, o comanda anulata nu dispare: se elibereaza
       * cu o linie negativa pe acelasi stadiu. Cele doua se aduna la zero, si
       * atunci comanda chiar e inchisa — pe cand numararea liniilor ar tine
       * randul rosu pentru totdeauna, adica ar face inchiderea imposibila.
       */
      const rows = await tx.execute(sql`
        select cl.document_id,
               sum(cl.amount)::text as open_amount,
               coalesce(min(wu.code), '—') as code,
               min(cl.id::text) as line_id
          from app.cost_lines cl
          left join app.work_units wu on wu.id = cl.work_unit_id
         where cl.period_id = ${periodId} and cl.stage = 'angajat'
         group by cl.document_id
        having sum(cl.amount) <> 0
         order by sum(cl.amount) desc
         limit 20`);

      const items = (rows.rows as { open_amount: string; code: string; line_id: string }[]).map(
        (row) => ({
          label: `${row.code} · ${row.open_amount} lei angajați, fără recepție`,
          href: `/bani/costuri?linie=${row.line_id}`,
        }),
      );

      return {
        status: items.length === 0 ? 'ok' : 'blocked',
        blockingCount: items.length,
        ...(items.length === 0 ? {} : { detail: { items } }),
      };
    },
  },
  {
    key: 'rollup_coerent',
    title: 'Cifrele de pe ecran dau suma din registru',
    evaluate: async (tx, periodId) => {
      const rows = await tx.execute(sql`
        select component_id, column_name, stored, expected
          from app.rollup_verify(${periodId})`);

      const items = (
        rows.rows as {
          component_id: string;
          column_name: string;
          stored: string;
          expected: string;
        }[]
      ).map((row) => ({
        label: `${row.column_name}: ${row.stored} în loc de ${row.expected}`,
        href: `/bani/plafoane?componenta=${row.component_id}`,
      }));

      return {
        status: items.length === 0 ? 'ok' : 'blocked',
        blockingCount: items.length,
        ...(items.length === 0 ? {} : { detail: { items } }),
      };
    },
  },
  { key: 'pontaje_validate', title: 'Pontaje validate', pendingModule: 'pasul 09' },
  { key: 'bonuri_consum', title: 'Bonuri de consum emise', pendingModule: 'pasul 09' },
  { key: 'receptii_inregistrate', title: 'Recepții înregistrate', pendingModule: 'pasul 09' },
  { key: 'sl_aprobate', title: 'Situații de lucrări aprobate', pendingModule: 'faza 3' },
  { key: 'facturi_spv', title: 'Facturi SPV alocate', pendingModule: 'faza 3' },
  { key: 'rapoarte_lunare', title: 'Rapoarte lunare trimise', pendingModule: 'pasul 10' },
  { key: 'export_saga', title: 'Export Saga confirmat', pendingModule: 'faza 3' },
];

export interface CloseCheckRow {
  readonly checkKey: string;
  readonly title: string;
  readonly status: CloseCheckStatus;
  readonly blockingCount: number;
  readonly detail: CloseCheckResult['detail'] | null;
  readonly pendingModule: string | null;
}

export interface PeriodCloseState {
  readonly periodId: string;
  readonly status: 'open' | 'closing' | 'closed';
  readonly checks: readonly CloseCheckRow[];
  /** Butonul „Închide luna" e activ doar cand nimic nu e `blocked`. */
  readonly canClose: boolean;
}

/**
 * Ruleaza checklist-ul si scrie rezultatul in `app.period_close_checks`.
 *
 * Se ruleaza la fiecare deschidere a ecranului, nu o singura data la trecerea in
 * `closing`: un rand bifat acum trei ore nu spune nimic despre ce s-a mai
 * inregistrat intre timp, iar butonul de inchidere se sprijina pe el.
 */
export async function evaluatePeriodClose(
  actor: Actor,
  periodId: string,
): Promise<PeriodCloseState> {
  try {
    return await withActor(actor, async (tx) => {
      const periods = await tx
        .select({ status: schema.periods.status })
        .from(schema.periods)
        .where(eq(schema.periods.id, periodId))
        .limit(1);

      const period = periods[0];
      if (period === undefined) {
        throw new AppError('NOT_FOUND', 'Luna nu există sau nu e vizibilă.');
      }

      const checks: CloseCheckRow[] = [];

      for (const spec of CLOSE_CHECKS) {
        const result: CloseCheckResult =
          spec.evaluate === undefined
            ? { status: 'pending_module', blockingCount: 0 }
            : await spec.evaluate(tx, periodId);

        /*
         * Scrierea intr-o luna INCHISA e blocata de `guard_closed_period`, iar
         * `period_close_checks` poarta si el trigger-ul. Pe o luna inchisa doar
         * citim ce s-a scris la inchidere — istoria checklist-ului e parte din
         * dovada ca luna a fost inchisa in reguli.
         */
        if (period.status !== 'closed') {
          await tx
            .insert(schema.periodCloseChecks)
            .values({
              id: uuidv7(),
              periodId,
              checkKey: spec.key,
              status: result.status,
              blockingCount: result.blockingCount,
              detail: result.detail ?? null,
              evaluatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [schema.periodCloseChecks.periodId, schema.periodCloseChecks.checkKey],
              set: {
                status: result.status,
                blockingCount: result.blockingCount,
                detail: result.detail ?? null,
                evaluatedAt: new Date(),
              },
            });
        }

        checks.push({
          checkKey: spec.key,
          title: spec.title,
          status: result.status,
          blockingCount: result.blockingCount,
          detail: result.detail ?? null,
          pendingModule: spec.pendingModule ?? null,
        });
      }

      return {
        periodId,
        status: period.status,
        checks,
        canClose: period.status !== 'closed' && !checks.some((check) => check.status === 'blocked'),
      };
    });
  } catch (error) {
    return translateDbError(error);
  }
}

/** `open → closing`. Din clipa asta checklist-ul e vizibil si se reevalueaza. */
export async function startClosing(actor: Actor, periodId: string): Promise<PeriodCloseState> {
  await withActor({ ...actor, reason: 'Începe închiderea lunii' }, async (tx) => {
    await tx
      .update(schema.periods)
      .set({ status: 'closing' })
      .where(and(eq(schema.periods.id, periodId), eq(schema.periods.status, 'open')));
  });

  return evaluatePeriodClose(actor, periodId);
}

/**
 * `closing → closed`. Tranzactie unica: statusul, autorul si motivul.
 *
 * Refuza daca vreun rand e `blocked` — si o face **din nou aici**, nu doar in
 * ecran. Butonul inactiv e comoditate; regula e asta.
 */
export async function closePeriod(
  actor: Actor,
  periodId: string,
  reason: string,
): Promise<PeriodCloseState> {
  if (reason.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 'Închiderea lunii cere un motiv scris.');
  }

  const state = await evaluatePeriodClose(actor, periodId);

  if (state.status === 'closed') {
    throw new AppError('CONFLICT', 'Luna e deja închisă.');
  }

  const blocked = state.checks.filter((check) => check.status === 'blocked');
  if (blocked.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Luna nu se poate închide: ${blocked.map((check) => check.title).join(', ')}.`,
      { blocked: blocked.map((check) => check.checkKey) },
    );
  }

  try {
    await withActor({ ...actor, reason }, async (tx) => {
      await tx
        .update(schema.periods)
        .set({ status: 'closed', closedAt: new Date(), closedBy: actor.personId })
        .where(eq(schema.periods.id, periodId));
    });
  } catch (error) {
    return translateDbError(error);
  }

  return evaluatePeriodClose(actor, periodId);
}

/**
 * Redeschiderea lunii. Actiune de administrator, cu motiv obligatoriu.
 *
 * Scrierea in luna inchisa trece prin usa de avarie din 0005: ea cere motivul si
 * il pune in `app.action_reason`, de unde il ia trigger-ul de audit. Fara usa,
 * `guard_closed_period` ar refuza chiar `update`-ul care o redeschide.
 */
export async function reopenPeriod(
  actor: Actor,
  periodId: string,
  reason: string,
): Promise<PeriodCloseState> {
  if (reason.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 'Redeschiderea lunii cere un motiv scris.');
  }

  try {
    await withActor({ ...actor, reason }, async (tx) => {
      await tx.execute(sql`select app.allow_closed_period_writes(${reason})`);
      await tx
        .update(schema.periods)
        .set({ status: 'open', closedAt: null, closedBy: null })
        .where(eq(schema.periods.id, periodId));
    });
  } catch (error) {
    return translateDbError(error);
  }

  return evaluatePeriodClose(actor, periodId);
}
