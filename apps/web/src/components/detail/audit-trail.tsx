import { listAuditEntries } from '@damina/services';
import { Badge, EmptyState } from '@damina/ui';
import { History } from 'lucide-react';
import type { EntityContext } from '../../registry/types';

const OPERATION_LABEL = {
  insert: 'Creat',
  update: 'Modificat',
  delete: 'Șters',
} as const;

const OPERATION_TONE = {
  insert: 'success',
  update: 'brand',
  delete: 'danger',
} as const;

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Tab-ul „Istoric”: cine, ce, cand, valoare veche → noua, si de ce.
 *
 * Acelasi component pentru orice entitate — jurnalul e generic prin constructie
 * (un trigger, o tabela), deci si afisarea lui trebuie sa fie. Cand pasul 04
 * adauga contractele, tab-ul de istoric vine gratis.
 */
export async function AuditTrail({
  ctx,
  tableName,
  recordId,
}: {
  ctx: EntityContext;
  tableName: string;
  recordId: string;
}) {
  const entries = await listAuditEntries(ctx.actor, tableName, recordId);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<History className="size-5" aria-hidden="true" />}
        title="Nicio modificare înregistrată"
        body="Jurnalul se completează singur la fiecare scriere. Dacă e gol, înregistrarea n-a fost atinsă de la creare."
        size="sm"
      />
    );
  }

  return (
    <ol className="space-y-0">
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          className="relative flex gap-4 pb-6 last:pb-0"
        >
          {/* Firul vertical al cronologiei. Se opreste la ultimul element. */}
          {index === entries.length - 1 ? null : (
            <span
              aria-hidden="true"
              className="absolute top-6 bottom-0 left-[3.5px] w-px bg-border"
            />
          )}
          <span
            aria-hidden="true"
            className="mt-1.5 size-2 shrink-0 rounded-full bg-border-strong ring-4 ring-surface"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Badge tone={OPERATION_TONE[entry.operation]}>
                {OPERATION_LABEL[entry.operation]}
              </Badge>
              <span className="text-base font-medium text-ink">
                {entry.actorName ?? 'Sistem'}
              </span>
              <time
                dateTime={entry.occurredAt.toISOString()}
                className="text-sm text-ink-subtle"
              >
                {dateFormat.format(entry.occurredAt)}
              </time>
            </div>

            {entry.reason === null ? null : (
              <p className="mt-1 text-base text-ink-muted italic">„{entry.reason}”</p>
            )}

            {Object.keys(entry.changed).length === 0 ? null : (
              <ul className="mt-2 space-y-1">
                {Object.entries(entry.changed).map(([column, change]) => (
                  <li key={column} className="flex flex-wrap items-baseline gap-1.5 text-sm">
                    <span className="font-mono text-xs text-ink-muted">{column}</span>
                    <span className="text-ink-subtle line-through">{format(change.old)}</span>
                    <span aria-hidden="true" className="text-ink-subtle">
                      →
                    </span>
                    <span className="font-medium text-ink">{format(change.new)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'da' : 'nu';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
