import { schema, serviceActor, withActor } from '@damina/db';
import { eq } from 'drizzle-orm';
import { verifyStockBalances } from './inventory';
import { raiseAlert } from './notifications';

/**
 * Controlul de integritate al stocului (§3.4, verificarea #18).
 *
 * `app.stock_balances` e un **rollup**, nu sursa: adevarul sta in
 * `app.stock_movements`, iar soldul e intretinut de trigger. Ca orice rollup,
 * poate ramane in urma — dintr-un trigger cu bug, dintr-un `update` manual pe
 * bază, dintr-o migrare care a atins tabela gresita. Si, ca orice rollup, cade
 * **tacut**: nimic nu se rupe, doar cifrele nu se mai potrivesc.
 *
 * De aceea jobul nu raporteaza, ci **alerteaza**, si o face cu diferenta in
 * titlu. Un numar afisat undeva pe care nu-l citeste nimeni valoreaza exact cat
 * a nu-l calcula. E acelasi tipar cu `rollup.verify` din pasul 06 — pana la
 * detaliul ca alerta se inchide singura cand soldul redevine corect, fiindca
 * indexul unic partial din 0008 tine o singura alerta deschisa per (scop, tip).
 */

const STOCK_KIND = 'stoc_divergent';

/** Jobul nocturn `inventory.verifyStock`. Cron: 04:00. */
export async function verifyStockJob(jobName = 'inventory.verifyStock'): Promise<number> {
  const actor = serviceActor(jobName);
  const divergences = await verifyStockBalances(actor);

  for (const row of divergences) {
    const companyId = await companyOfLocation(actor, row.locationId);
    if (companyId === null) {
      continue;
    }

    const difference = row.difference;
    const sign = Number(difference.toDbString()) > 0 ? '+' : '';

    await raiseAlert(jobName, {
      companyId,
      // Scopul e GESTIUNEA, nu produsul: cine primeste alerta se duce la un loc
      // si numara acolo. Un scop pe produs ar fi produs cate o alerta pentru
      // acelasi inventar prost facut, in zece exemplare.
      scopeType: 'location',
      scopeId: row.locationId,
      kind: STOCK_KIND,
      severity: 'critical',
      title: `${row.productName} în ${row.locationName}: soldul spune ${row.stored.format()}, mișcările ${row.computed.format()} (${sign}${difference.format()})`,
      payload: {
        productId: row.productId,
        lotId: row.lotId,
        stored: row.stored.toDbString(),
        computed: row.computed.toDbString(),
        difference: difference.toDbString(),
      },
    });
  }

  return divergences.length;
}

async function companyOfLocation(
  actor: ReturnType<typeof serviceActor>,
  locationId: string,
): Promise<string | null> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ companyId: schema.locations.companyId })
      .from(schema.locations)
      .where(eq(schema.locations.id, locationId))
      .limit(1);
    return row?.companyId ?? null;
  });
}

export const INVENTORY_ALERT_KINDS = { stockDivergent: STOCK_KIND } as const;
