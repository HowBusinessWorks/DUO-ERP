import { can } from '@damina/auth';
import { listRecentAuditEntries } from '@damina/services';
import { Badge, EmptyState } from '@damina/ui';
import { History, Lock } from 'lucide-react';
import type { EntityContext } from '../../registry/types';

/**
 * Jurnalul de audit al intregii aplicatii, cel mai recent primul.
 *
 * Diferenta fata de `AuditTrail` nu e doar sfera: acolo intrebarea e „ce s-a
 * intamplat cu randul asta”, aici e „ce s-a intamplat azi”. Prima se citeste
 * langa rand; a doua e un ecran de administrare.
 *
 * Dreptul se verifica IN DOUA LOCURI, si nu din exces de zel: politica de pe
 * `audit.entries` (migrarea `0011`) intoarce unui `financiar` **zero randuri**,
 * nu o eroare — adica un ecran gol care arata exact ca un jurnal in care nu s-a
 * intamplat nimic. Verificarea de aici exista ca sa scrie de ce e gol.
 */

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

/** `app.contracts` → „contracte”. Numele de tabelă nu e limba nimănui. */
const TABLE_LABELS: Readonly<Record<string, string>> = {
  'app.contracts': 'Contract',
  'app.contract_components': 'Componentă de contract',
  'app.component_ceilings': 'Plafon',
  'app.objectives': 'Obiectiv',
  'app.contract_objectives': 'Legătură obiectiv–contract',
  'app.products': 'Produs',
  'app.suppliers': 'Furnizor',
  'app.clients': 'Client',
  'app.subcontractors': 'Subcontractant',
  'app.qualifications': 'Calificare',
  'app.rate_cards': 'Tarif',
  'app.persons': 'Persoană',
  'app.person_office_roles': 'Roluri de birou',
  'app.person_company_access': 'Acces pe firme',
  'app.companies': 'Firmă',
  'app.periods': 'Perioadă',
};

function label(tableName: string): string {
  return TABLE_LABELS[tableName] ?? tableName.replace(/^app\./, '');
}

export async function AuditFeed({ ctx }: { ctx: EntityContext }) {
  if (!can(ctx.session, 'audit.read')) {
    return (
      <EmptyState
        icon={<Lock className="size-5" aria-hidden="true" />}
        title="Jurnalul de audit e rezervat administratorilor"
        body="Rolul tău nu îl deschide. Nu e o setare de ecran: politica de pe „audit.entries” nu-ți întoarce niciun rând, oricum ai ajunge la ele."
        className="rounded-lg border border-dashed border-border bg-surface"
      />
    );
  }

  const entries = await listRecentAuditEntries(ctx.actor, 100);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<History className="size-5" aria-hidden="true" />}
        title="Jurnalul e gol"
        body="Nimic nu s-a modificat încă. Fiecare creare, modificare și ștergere ajunge aici automat, printr-un trigger — nu depinde de ce ține minte codul aplicației să scrie."
        className="rounded-lg border border-dashed border-border bg-surface"
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-subtle">
        Ultimele {entries.length} modificări din toată aplicația. Jurnalul e append-only: nimeni nu
        poate șterge din el, nici administratorul.
      </p>

      <ol className="space-y-2">
        {entries.map((entry) => {
          const fields = Object.entries(entry.changed);
          return (
            <li
              key={entry.id}
              className="rounded-lg border border-border bg-surface px-4 py-3 text-base"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Badge tone={OPERATION_TONE[entry.operation]}>
                  {OPERATION_LABEL[entry.operation]}
                </Badge>
                <span className="font-medium text-ink">{label(entry.tableName)}</span>
                <span className="text-sm text-ink-muted">
                  {entry.actorName ?? 'autor necunoscut'}
                </span>
                <span className="ml-auto text-sm text-ink-subtle tabular-nums">
                  {dateFormat.format(entry.occurredAt)}
                </span>
              </div>

              {entry.reason === null ? null : (
                <p className="mt-1.5 text-sm text-ink-muted">„{entry.reason}”</p>
              )}

              {fields.length === 0 ? null : (
                <ul className="mt-2 space-y-0.5 text-sm">
                  {fields.slice(0, 6).map(([field, change]) => (
                    <li key={field} className="flex flex-wrap gap-x-2 text-ink-muted">
                      <span className="font-mono text-xs text-ink-subtle">{field}</span>
                      <span className="line-through">{format(change.old)}</span>
                      <span aria-hidden="true">→</span>
                      <span className="text-ink">{format(change.new)}</span>
                    </li>
                  ))}
                  {fields.length > 6 ? (
                    <li className="text-ink-subtle">
                      și încă {fields.length - 6} câmpuri modificate
                    </li>
                  ) : null}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
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
