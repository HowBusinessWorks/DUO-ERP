import { canEmitReports } from '@damina/auth';
import { formatPeriodLong } from '@damina/i18n';
import { listMonthlyReports } from '@damina/services';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@damina/ui';
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { getAppContext } from '../../../../../lib/context';

export const dynamic = 'force-dynamic';

/**
 * Rapoartele lunare ale lunii curente, pe contract (pasul 10, §3.6).
 *
 * Lista e a CONTRACTELOR, nu a rapoartelor: un contract fara raport e exact
 * lucrul pe care trebuie sa-l vada cineva la 1 ale lunii. O lista de rapoarte
 * ar fi ascuns tocmai absenta.
 */

const STATUS_LABEL: Record<
  string,
  { readonly label: string; readonly tone: 'neutral' | 'brand' | 'success' | 'warning' }
> = {
  building: { label: 'se generează', tone: 'brand' },
  review: { label: 'în verificare', tone: 'warning' },
  approved: { label: 'aprobat intern', tone: 'success' },
  frozen: { label: 'înghețat', tone: 'success' },
  sent: { label: 'trimis', tone: 'success' },
};

export default async function MonthlyReportsPage() {
  const ctx = await getAppContext();
  const rows = await listMonthlyReports(ctx.actor, ctx.selectedCompanyIds, ctx.year, ctx.month);
  const allowed = canEmitReports(ctx.session);

  return (
    <div className="p-5">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-ink">Rapoarte lunare</h1>
        <p className="mt-1 text-base text-ink-muted">
          {formatPeriodLong(ctx.year, ctx.month)} · documentul pe baza căruia clientul plătește.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Contracte active"
          description={
            allowed
              ? 'Deschide un contract ca să vezi ce intră în raport și să-l generezi.'
              : 'Rolul tău poate citi rapoartele, dar nu le poate emite.'
          }
        />
        <CardBody>
          {rows.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-5" aria-hidden="true" />}
              title="Nicio lună deschisă pentru contractele vizibile"
              body="Raportul se face pe o lună existentă. Dacă luna asta n-a fost creată încă pentru firmă, apare aici după prima scriere din ea."
              size="sm"
            />
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((row) => {
                const state = row.status === null ? null : STATUS_LABEL[row.status];
                return (
                  <li key={row.contractId} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/panou/rapoarte/lunar/${row.contractId}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        {row.code}
                      </Link>
                      <p className="truncate text-sm text-ink-muted">{row.clientName}</p>
                    </div>
                    {row.latestVersion === null ? null : (
                      <span className="text-xs text-ink-muted">v{row.latestVersion}</span>
                    )}
                    {state === undefined || state === null ? (
                      <Badge tone="neutral">negenerat</Badge>
                    ) : (
                      <Badge tone={state.tone}>{state.label}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
