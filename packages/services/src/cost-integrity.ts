import { serviceActor, withActor, type Actor } from '@damina/db';
import type { Money } from '@damina/shared';
import { sql } from 'drizzle-orm';
import { verifyRollups } from './cost';
import { raiseAlert, resolveAlert } from './notifications';

/**
 * Controlul de integritate al registrului (§3.2 si §3.6).
 *
 * Un ERP nu cade cu 500. Cade tacut, cu cifre care nu se mai potrivesc: un
 * trigger cu un bug, un rollup care ramane in urma, o linie fara analitica. De
 * aceea cele patru masuratori de mai jos ruleaza permanent si **alerteaza**, nu
 * doar se raporteaza — un numar afisat undeva pe care nu-l citeste nimeni are
 * exact aceeasi valoare cu a nu-l calcula.
 */

const ROLLUP_KIND = 'rollup_divergent';

/**
 * Jobul nocturn `rollup.verify`. Cron: 02:00.
 *
 * Recalculeaza rollup-urile din registru, compara, si ridica alerta pe fiecare
 * componenta divergenta — cu diferenta in titlu, nu cu „verifica rollup-urile".
 * Cine primeste alerta trebuie sa stie din prima cat de mare e problema.
 *
 * Alerta se **inchide singura** cand componenta redevine corecta: indexul unic
 * partial din 0008 garanteaza o singura alerta deschisa per (scope, kind), deci
 * jobul se poate rula oricat de des fara sa produca zgomot.
 */
export async function verifyRollupsJob(
  periodId?: string,
  jobName = 'rollup.verify',
): Promise<number> {
  const actor = serviceActor(jobName);
  const divergences = await verifyRollups(actor, periodId);

  // Grupam pe componenta: patru coloane divergente pe aceeasi componenta sunt o
  // singura problema, si o singura alerta.
  const byComponent = new Map<string, typeof divergences>();
  for (const row of divergences) {
    const key = `${row.componentId}:${row.periodId}`;
    byComponent.set(key, [...(byComponent.get(key) ?? []), row]);
  }

  for (const [, rows] of byComponent) {
    const first = rows[0];
    if (first === undefined) continue;

    const companyId = await companyOfComponent(actor, first.componentId);
    if (companyId === null) continue;

    const worst = rows.reduce((a, b) =>
      diff(a).abs().compare(diff(b).abs()) >= 0 ? a : b,
    );

    await raiseAlert(jobName, {
      companyId,
      scopeType: 'component',
      scopeId: first.componentId,
      kind: ROLLUP_KIND,
      severity: 'critical',
      title: `Rollup divergent: ${worst.columnName} e ${worst.stored.format()}, registrul spune ${worst.expected.format()}`,
      payload: {
        periodId: first.periodId,
        columns: rows.map((row) => ({
          column: row.columnName,
          stored: row.stored.toDbString(),
          expected: row.expected.toDbString(),
        })),
      },
    });
  }

  return byComponent.size;
}

const diff = (row: { stored: Money; expected: Money }): Money => row.stored.sub(row.expected);

/** Componenta redevenita corecta: alerta se inchide. */
export async function clearRollupAlert(
  componentId: string,
  jobName = 'rollup.verify',
): Promise<void> {
  await resolveAlert(jobName, 'component', componentId, ROLLUP_KIND);
}

async function companyOfComponent(actor: Actor, componentId: string): Promise<string | null> {
  return withActor(actor, async (tx) => {
    const rows = await tx.execute(sql`
      select c.company_id
        from app.contract_components cc
        join app.contracts c on c.id = cc.contract_id
       where cc.id = ${componentId}`);
    const row = rows.rows[0] as { company_id: string } | undefined;
    return row?.company_id ?? null;
  });
}

export interface IntegrityMetrics {
  /** Linii de cost fara analitica completa. **Trebuie sa fie 0.** */
  readonly linesWithoutAnalytics: number;
  /** Rollup-uri divergente fata de registru. **0.** */
  readonly divergentRollups: number;
  /** Linii cu „folosit" ≠ „descarcat" fara document de re-alocare. */
  readonly unexplainedReallocations: number;
  /** Perioade ramase in `closing` peste 48h. */
  readonly stuckClosings: number;
}

/**
 * Cele patru masuratori din §3.6, intr-o singura interogare pe fiecare.
 *
 * Prima si a treia arata bug-uri de aplicatie, a doua bug-uri de trigger, a
 * patra un om care a inceput inchiderea si a plecat in concediu. Toate patru sunt
 * lucruri care nu se vad din interfata pana cand cineva intreaba de ce nu dau
 * cifrele.
 */
export async function readIntegrityMetrics(actor: Actor): Promise<IntegrityMetrics> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        (select count(*) from app.cost_lines
          where stage <> 'angajat' and charged_contract_id is null)          as lines_without_analytics,
        (select count(*) from app.rollup_verify())                            as divergent_rollups,
        (select count(*) from app.cost_lines cl
          where cl.used_contract_id is distinct from cl.charged_contract_id
            and not exists (
              select 1 from app.reallocation_documents rd
               where rd.work_unit_id = cl.work_unit_id
            ))                                                               as unexplained_reallocations,
        (select count(*) from app.periods
          where status = 'closing' and created_at < now() - interval '48 hours')
                                                                             as stuck_closings`);

    const row = (result.rows[0] ?? {}) as Record<string, string>;
    const num = (value: string | undefined): number => Number(value ?? '0');

    return {
      linesWithoutAnalytics: num(row.lines_without_analytics),
      divergentRollups: num(row.divergent_rollups),
      unexplainedReallocations: num(row.unexplained_reallocations),
      stuckClosings: num(row.stuck_closings),
    };
  });
}

export const COST_ALERT_KINDS = { rollupDivergent: ROLLUP_KIND } as const;
