import { canEmitReports } from '@damina/auth';
import { formatPeriodLong } from '@damina/i18n';
import { listMonthlyReports, readMonthlyReport, readReportComposition } from '@damina/services';
import { Banner } from '@damina/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MonthlyReportPanel } from '../../../../../../components/reports/monthly-report-panel';
import { getAppContext } from '../../../../../../lib/context';

export const dynamic = 'force-dynamic';

/**
 * Raportul lunar al unui contract, pe luna din contextul de shell.
 *
 * Luna vine din contextul global, nu din URL: la fel ca peste tot in birou,
 * comutatorul de luna e unul singur si sta in bara de sus. Un al doilea selector
 * pe ecranul asta ar fi insemnat doua adevaruri despre „ce luna privesc".
 */
export default async function MonthlyReportPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;
  const ctx = await getAppContext();

  const contracts = await listMonthlyReports(
    ctx.actor,
    ctx.selectedCompanyIds,
    ctx.year,
    ctx.month,
  );
  const row = contracts.find((entry) => entry.contractId === contractId);
  if (row === undefined) {
    notFound();
  }

  const [composition, report] = await Promise.all([
    readReportComposition(ctx.actor, contractId, row.periodId),
    readMonthlyReport(ctx.actor, contractId, row.periodId),
  ]);

  return (
    <div className="p-5">
      <header className="mb-5">
        <Link href="/panou/rapoarte/lunar" className="text-sm text-brand-700 hover:underline">
          ← Rapoarte lunare
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink">
          Raport lunar · {row.code} · {formatPeriodLong(ctx.year, ctx.month)}
        </h1>
        <p className="mt-1 text-base text-ink-muted">Client: {row.clientName}</p>
      </header>

      {composition.periodClosed ? null : (
        <Banner
          tone="info"
          className="mb-4"
          title="Luna e încă deschisă"
          body="Se poate genera și acum, dar fișele validate după generare nu intră în versiunea asta. Raportul care pleacă la client se face, de regulă, după închiderea lunii."
        />
      )}

      <MonthlyReportPanel
        composition={composition}
        report={report}
        canEmit={canEmitReports(ctx.session)}
        progress={report?.progress ?? { percent: 0, label: 'se pregătește…' }}
      />
    </div>
  );
}
