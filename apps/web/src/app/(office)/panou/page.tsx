import { formatPeriodLong } from '@damina/i18n';
import { countNomenclature, listOpenAlerts, listWorkQueue } from '@damina/services';
import { Badge, Banner, Card, CardBody, CardHeader, EmptyState, Stat } from '@damina/ui';
import { AlertTriangle, Inbox } from 'lucide-react';
import Link from 'next/link';
import { PeriodLockBanner } from '../../../components/shell/period-lock-banner';
import { getAppContext } from '../../../lib/context';

export const dynamic = 'force-dynamic';

const SEVERITY_TONE = { info: 'info', warning: 'warning', critical: 'danger' } as const;

/**
 * Panoul meu — punctul de plecare al zilei.
 *
 * Trei lucruri, in ordinea in care conteaza:
 *   1. COZILE — ce asteapta de la mine. Se golesc prin actiune.
 *   2. ALERTELE — praguri depasite, care persista pana dispare conditia.
 *   3. CIFRELE — statistici. Nu au badge in sidebar, tocmai pentru ca nu se pot
 *      goli prin actiune; locul lor e aici.
 *
 * Cardurile pe rol, cu date reale, vin odata cu modulele lor (pasii 04-10). Ce
 * exista acum e scheletul si mecanica celor trei mecanisme, corect separate.
 */
export default async function PanelPage() {
  const ctx = await getAppContext();

  const [queue, alerts, counts] = await Promise.all([
    listWorkQueue(ctx.actor, ctx.session.personId, ctx.selectedCompanyIds, { limit: 12 }),
    listOpenAlerts(ctx.actor, ctx.selectedCompanyIds, { limit: 8 }),
    countNomenclature(ctx.actor),
  ]);

  return (
    <>
      <PeriodLockBanner period={ctx.period} totalCompanies={ctx.selectedCompanyIds.length} />

      <div className="p-5">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold text-ink">
            Bună, {ctx.session.fullName.split(' ')[0]}
          </h1>
          <p className="mt-1 text-base text-ink-muted">
            Ce așteaptă de la tine în {formatPeriodLong(ctx.year, ctx.month)}, pe{' '}
            {ctx.selectedCompanyIds.length === ctx.companies.length
              ? 'toate firmele'
              : `${String(ctx.selectedCompanyIds.length)} firme`}
            .
          </p>
        </header>

        {alerts.length === 0 ? null : (
          <div className="mb-5 overflow-hidden rounded-lg border border-border">
            {alerts.map((alert) => (
              <Banner
                key={alert.id}
                tone={SEVERITY_TONE[alert.severity]}
                dense
                icon={<AlertTriangle className="size-4" aria-hidden="true" />}
                title={alert.title}
                body={`deschisă din ${alert.raisedAt.toLocaleDateString('ro-RO')}`}
              />
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader
              title="De rezolvat"
              description="Obiecte care așteaptă acțiunea ta. Dispar când le rezolvi — nu se bifează manual."
            />
            {queue.length === 0 ? (
              <EmptyState
                icon={<Inbox className="size-5" aria-hidden="true" />}
                title="Nimic nu așteaptă de la tine"
                body="Cozile se umplu singure când altcineva îți trimite ceva de aprobat sau de procesat. Badge-ul din meniu crește în același moment."
                size="sm"
              />
            ) : (
              <ul className="divide-y divide-border">
                {queue.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base font-medium text-ink">
                          {item.title}
                        </span>
                        <span className="text-sm text-ink-subtle">{item.entityType}</span>
                      </span>
                      <Badge tone="warning">{item.kind.replaceAll('_', ' ')}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Nomenclatoare"
              description="Comune celor 5 firme. Statistici, nu cozi — de aceea stau aici, nu în meniu."
            />
            <CardBody className="grid grid-cols-2 gap-3">
              <Stat
                label="Produse"
                value={counts.produse ?? 0}
                context="active în nomenclator"
                href="/produse"
              />
              <Stat
                label="Furnizori"
                value={counts.furnizori ?? 0}
                context="activi"
                href="/furnizori"
              />
              <Stat label="Clienți" value={counts.clienti ?? 0} context="activi" href="/clienti" />
              <Stat
                label="Subcontractanți"
                value={counts.subcontractanti ?? 0}
                context="activi"
                href="/subcontractanti"
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
