'use client';

import type { MonthlyReportView, ReportComposition } from '@damina/services';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  ProgressBar,
  useToast,
} from '@damina/ui';
import { AlertTriangle, ExternalLink, FileText, Link2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  approveMonthlyReportAction,
  freezeMonthlyReportAction,
  generateMonthlyReportAction,
  sendMonthlyReportAction,
} from '../../app/(office)/report-actions';

/**
 * Ecranul raportului lunar (§3.6), pe un contract si o luna.
 *
 * Trei lucruri, in ordinea in care le citeste omul:
 *
 *  1. **Ce intra** — fise, jurnale, poze. Si, la fel de vizibil, **ce NU intra**:
 *     fisele nevalidate, numarate, cu link. Verificarea #21 exista tocmai pentru
 *     ca varianta comoda ar fi fost sa dispara tacut.
 *  2. **Unde e generarea** — progres real („312 din 480"), nu un spinner. Cifra
 *     vine de pe raport, scrisa de job.
 *  3. **Ce urmeaza** — un singur buton activ la un moment dat: Generează →
 *     Aprobă intern → Îngheață → Trimite. Ordinea e impusa in `domain`; ecranul
 *     doar n-o contrazice.
 */

/**
 * Starile raportului, scrise si aici.
 *
 * `@damina/domain` nu se importa din aplicatia web (regula de granite din
 * eslint): componenta primeste progresul deja calculat de pagina, iar tipul de
 * mai jos e doar eticheta lui. Ordinea starilor ramane singura, in domain.
 */
type ReportStatus = 'building' | 'review' | 'approved' | 'frozen' | 'sent';

export interface MonthlyReportPanelProps {
  readonly composition: ReportComposition;
  readonly report: MonthlyReportView | null;
  readonly canEmit: boolean;
  /** Calculat pe server cu `reportProgress` din domain. */
  readonly progress: { readonly percent: number; readonly label: string };
}

const STATUS_TONE: Record<ReportStatus, 'neutral' | 'brand' | 'success' | 'warning'> = {
  building: 'brand',
  review: 'warning',
  approved: 'success',
  frozen: 'success',
  sent: 'success',
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  building: 'în construcție',
  review: 'în verificare',
  approved: 'aprobat intern',
  frozen: 'înghețat',
  sent: 'trimis clientului',
};

export function MonthlyReportPanel({
  composition,
  report,
  canEmit,
  progress,
}: MonthlyReportPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  const status = report?.status ?? null;
  const latest = report?.versions[0] ?? null;

  function act(what: 'generate' | 'approve' | 'freeze' | 'send'): void {
    void (async () => {
      setRunning(true);
      const result =
        what === 'generate'
          ? await generateMonthlyReportAction({
              contractId: composition.contractId,
              periodId: composition.periodId,
              templateId: 'standard',
            })
          : await (
              what === 'approve'
                ? approveMonthlyReportAction
                : what === 'freeze'
                  ? freezeMonthlyReportAction
                  : sendMonthlyReportAction
            )({ reportId: report?.id ?? '' });
      setRunning(false);

      if (!result.ok) {
        toast({ tone: 'error', title: result.message });
        return;
      }

      toast({
        tone: 'success',
        title:
          what === 'generate'
            ? 'Generarea a pornit. Progresul apare mai jos.'
            : what === 'approve'
              ? 'Raport aprobat intern.'
              : what === 'freeze'
                ? 'Raport înghețat. Versiunea trimisă nu se mai schimbă.'
                : 'Raport marcat ca trimis.',
      });
      router.refresh();
    })();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Ce intră în raport"
          description="Tot ce s-a validat în lună, pe contractul care plătește."
          actions={
            status === null ? (
              <Badge tone="neutral">negenerat</Badge>
            ) : (
              <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
            )
          }
        />
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Inspecții" value={composition.inspections} />
            <Figure label="Intervenții" value={composition.interventions} />
            <Figure label="Jurnale" value={composition.journals} />
            <Figure label="Fotografii" value={composition.photos} />
          </dl>

          {composition.unvalidated.length > 0 ? (
            <div className="mt-4">
              <Banner
                tone="warning"
                icon={<AlertTriangle className="size-4" aria-hidden="true" />}
                title={`${String(composition.unvalidated.length)} fișe nevalidate — neincluse`}
                body="Nu intră în raport și nu dispar tăcut. Validează-le înainte de generare dacă trebuie să apară."
                action={
                  <Link
                    href="/activitate?view=validare"
                    className="text-sm font-medium text-brand-700 hover:underline"
                  >
                    Deschide validarea →
                  </Link>
                }
              />
              <ul className="mt-2 space-y-1 text-sm">
                {composition.unvalidated.slice(0, 8).map((sheet) => (
                  <li key={sheet.workUnitId}>
                    <Link
                      href={`/activitate/${sheet.workUnitId}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {sheet.code}
                    </Link>{' '}
                    <span className="text-ink-muted">
                      {sheet.name} · {sheet.performedOn}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Generare și emitere"
          description="Generarea rulează în fundal. Poți închide ecranul."
        />
        <CardBody className="space-y-4">
          {status === 'building' ? (
            <ProgressBar
              value={progress.percent}
              tone="brand"
              label="Se generează"
              detail={progress.label}
            />
          ) : null}

          {report?.lastError === null || report?.lastError === undefined ? null : (
            <Banner tone="danger" title="Ultima generare a eșuat" body={report.lastError} />
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!canEmit || running || status === 'building'}
              onClick={() => {
                act('generate');
              }}
              icon={<RefreshCw className="size-4" aria-hidden="true" />}
            >
              {latest === null ? 'Generează' : `Regenerează (v${String(latest.version + 1)})`}
            </Button>
            <Button
              variant="secondary"
              disabled={!canEmit || running || status !== 'review'}
              onClick={() => {
                act('approve');
              }}
            >
              Aprobă intern
            </Button>
            <Button
              variant="secondary"
              disabled={!canEmit || running || status !== 'approved'}
              onClick={() => {
                act('freeze');
              }}
            >
              Îngheață
            </Button>
            <Button
              variant="secondary"
              disabled={!canEmit || running || status !== 'frozen'}
              onClick={() => {
                act('send');
              }}
            >
              Trimite
            </Button>
          </div>

          {canEmit ? null : (
            <p className="text-sm text-ink-muted">
              Rolul tău poate citi raportul, dar nu îl poate emite.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Versiuni"
          description="Versiunea înghețată nu se rescrie. O regenerare produce următoarea."
        />
        <CardBody>
          {report === null || report.versions.length === 0 ? (
            <p className="text-sm text-ink-muted">Nicio versiune generată încă.</p>
          ) : (
            <ul className="divide-y divide-line">
              {report.versions.map((version) => (
                <li key={version.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="font-medium text-ink">v{version.version}</span>
                  <span className="text-ink-muted">
                    {version.generatedAt.toLocaleDateString('ro-RO')} · {version.photoCount} poze ·{' '}
                    {Math.max(1, Math.round(version.sizeBytes / 1024))} KB
                  </span>
                  <a
                    href={`/raport/${version.webToken}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    Raport web
                  </a>
                  {version.artifactNodeId === null ? (
                    <span className="inline-flex items-center gap-1 text-ink-muted">
                      <FileText className="size-3.5" aria-hidden="true" />
                      doar în arhivă
                    </span>
                  ) : (
                    <Link
                      href={`/documente/arbore?node=${version.artifactNodeId}`}
                      className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"
                    >
                      <Link2 className="size-3.5" aria-hidden="true" />
                      În dosarul contractului
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-xl font-semibold text-ink">{value}</dd>
    </div>
  );
}
