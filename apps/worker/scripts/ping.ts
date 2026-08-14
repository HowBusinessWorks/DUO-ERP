import { closeConnections, countPings, withServiceActor } from '@damina/db';
import { enqueue, systemPing } from '@damina/jobs';

/**
 * Verificarile #11 si #12 din Pasul 01.
 *
 *   #11 — enqueue('system.ping') => randul apare in jobs.ping_log in < 5s
 *   #12 — enqueue intr-o tranzactie care face rollback => jobul NU se executa
 *
 * Ruleaza worker-ul in alt terminal, apoi:
 *   pnpm --filter @damina/worker ping
 */
const WAIT_MS = 5000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const before = await withServiceActor('script.ping', countPings);
  process.stdout.write(`Randuri in ping_log la start: ${before}\n\n`);

  // ── #12: rollback ─────────────────────────────────────────────────────────
  process.stdout.write('Test #12 — enqueue intr-o tranzactie care face rollback\n');
  await withServiceActor('script.ping', async (tx) => {
    await enqueue(tx, systemPing, { note: 'nu trebuie sa ajunga niciodata' });
    throw new Error('rollback intentionat');
  }).catch(() => undefined);

  await sleep(WAIT_MS);
  const afterRollback = await withServiceActor('script.ping', countPings);
  if (afterRollback !== before) {
    throw new Error(
      `#12 A ESUAT: jobul din tranzactia anulata s-a executat (${before} -> ${afterRollback}).`,
    );
  }
  process.stdout.write('  OK — jobul a disparut odata cu tranzactia.\n\n');

  // ── #11: enqueue reusit ───────────────────────────────────────────────────
  process.stdout.write('Test #11 — enqueue intr-o tranzactie care se comite\n');
  const accepted = await withServiceActor('script.ping', (tx) =>
    enqueue(tx, systemPing, { note: 'ping din scriptul de verificare' }),
  );
  process.stdout.write(`  enqueue acceptat: ${String(accepted)}\n`);

  const deadline = Date.now() + WAIT_MS;
  let after = before;
  while (Date.now() < deadline) {
    await sleep(250);
    after = await withServiceActor('script.ping', countPings);
    if (after > before) break;
  }

  if (after <= before) {
    throw new Error(
      `#11 A ESUAT: jobul nu a fost procesat in ${WAIT_MS}ms. Ruleaza worker-ul: pnpm --filter @damina/worker dev`,
    );
  }
  process.stdout.write(`  OK — randul a aparut in ping_log (${before} -> ${after}).\n\n`);
  process.stdout.write('Ambele verificari trec.\n');
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeConnections();
  });
