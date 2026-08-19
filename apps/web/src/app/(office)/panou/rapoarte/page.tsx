import { canSeeFinancials } from '@damina/auth';
import { readIntegrityMetrics } from '@damina/services';
import { Badge, Banner, Card, CardBody, CardHeader, Stat } from '@damina/ui';
import Link from 'next/link';
import { PeriodLockBanner } from '../../../../components/shell/period-lock-banner';
import { getAppContext } from '../../../../lib/context';

export const dynamic = 'force-dynamic';

/**
 * Panou › Rapoarte (§3.4 al pasului 06).
 *
 * Doua lucruri, si amandoua au aceeasi radacina — cifra trebuie sa spuna pe ce e
 * construita:
 *
 * 1. **Rapoartele standard**, fiecare cu analitica DECLARATA IN ANTET. Nu sunt
 *    ecrane noi: sunt trimiteri catre cele care produc cifrele. Un raport care ar
 *    recalcula altfel aceeasi intrebare ar fi a doua sursa de adevar, si atunci
 *    ar exista doua cifre si niciun arbitru.
 * 2. **Metricile de integritate** (§3.6). Un ERP nu cade cu 500 — cade tacut, cu
 *    cifre care nu se mai potrivesc. Aici se vede daca s-a intamplat.
 */

interface ReportCard {
  readonly title: string;
  readonly analytics: 'folosit' | 'descărcat' | 'ambele';
  readonly body: string;
  readonly href: string;
  readonly cta: string;
}

const REPORTS: readonly ReportCard[] = [
  {
    title: 'Consum pe componentă',
    analytics: 'descărcat',
    body: 'Cât s-a angajat și cât s-a consumat din fiecare componentă, față de plafonul lunii. Banda de pe Prezentarea contractului e același număr, desfăcut.',
    href: '/contracte',
    cta: 'Deschide contractele',
  },
  {
    title: 'Istoricul unui obiectiv',
    analytics: 'folosit',
    body: 'Tot ce s-a întâmplat la un amplasament, transversal peste contracte și ani, cu total anual și medie lunară. Rămâne intact când finanțarea se mută.',
    href: '/obiective',
    cta: 'Alege obiectivul',
  },
  {
    title: 'Re-alocările lunii',
    analytics: 'descărcat',
    body: 'Documentele emise când finanțarea s-a mutat dintr-o lună deja închisă. Dacă lista e lungă în fiecare lună, decizia de rutare se ia prost.',
    href: '/bani',
    cta: 'Deschide lista',
  },
  {
    title: 'Marjă pe lună și contract',
    analytics: 'descărcat',
    body: 'Venit alocat minus cost direct, cu comutator brut/net. Regia vine din fotografia lunii, nu din procentul de azi.',
    href: '/bani?view=marja',
    cta: 'Deschide marja',
  },
  {
    title: 'Reconciliere folosit vs descărcat',
    analytics: 'ambele',
    body: 'Liniile unde cele două analitici diferă — exact anomaliile, nimic altceva. Raportul obligatoriu din §12.',
    href: '/bani?view=reconciliere',
    cta: 'Deschide reconcilierea',
  },
];

const ANALYTICS_TONE = {
  folosit: 'brand',
  descărcat: 'success',
  ambele: 'warning',
} as const;

export default async function ReportsPage() {
  const ctx = await getAppContext();
  const allowed = canSeeFinancials(ctx.session);
  const metrics = allowed ? await readIntegrityMetrics(ctx.actor) : null;

  return (
    <>
      <PeriodLockBanner period={ctx.period} totalCompanies={ctx.selectedCompanyIds.length} />

      <div className="p-5">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold text-ink">Rapoarte</h1>
          <p className="mt-1 max-w-prose text-base text-ink-muted">
            Fiecare raport declară în antet pe ce analitică e construit. Nu e formalitate: „folosit”
            spune unde s-a muncit, „descărcat” spune cine plătește, iar aceeași lucrare poate să
            apară diferit în cele două — asta e chiar rostul lor.
          </p>
        </header>

        {/*
         * Raportul lunar sta DEASUPRA celorlalte si separat de ele, pentru ca
         * nu e acelasi fel de lucru: celelalte sunt vederi peste cifrele
         * existente, asta e documentul pe baza caruia clientul plateste. Are
         * stare, versiuni si un moment de inghet — pasul 10, §3.6.
         */}
        <Card className="mb-4">
          <CardHeader
            title="Raportul lunar către client"
            actions={<Badge tone="brand">document, nu vedere</Badge>}
          />
          <CardBody>
            <p className="text-sm text-ink-muted">
              Fișele validate ale lunii, jurnalele și fotografiile, într-un document versionat și
              înghețat la emitere. Factura de mentenanță așteaptă aprobarea lui internă.
            </p>
            <Link
              href="/panou/rapoarte/lunar"
              className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
            >
              Deschide rapoartele lunare →
            </Link>
          </CardBody>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {REPORTS.map((report) => (
            <Card key={report.title}>
              <CardHeader
                title={report.title}
                actions={
                  <Badge tone={ANALYTICS_TONE[report.analytics]}>
                    analitica: {report.analytics}
                  </Badge>
                }
              />
              <CardBody>
                <p className="text-sm text-ink-muted">{report.body}</p>
                <Link
                  href={report.href}
                  className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline"
                >
                  {report.cta} →
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>

        {metrics === null ? null : (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-ink">Integritatea registrului</h2>
            <p className="mt-1 max-w-prose text-sm text-ink-muted">
              Toate patru trebuie să fie zero. Nu sunt statistici: fiecare cifră diferită de zero
              înseamnă că un raport deja trimis poate să nu mai dea aceeași sumă.
            </p>

            {metrics.divergentRollups === 0 && metrics.linesWithoutAnalytics === 0 ? null : (
              <Banner
                className="mt-3"
                tone="danger"
                title="Registrul și cifrele agregate nu se mai potrivesc"
                body="Jobul nocturn rollup.verify a găsit diferențe. Până se lămuresc, cifrele de pe ecranele de bani nu sunt de încredere."
              />
            )}

            <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Linii fără analitică"
                value={String(metrics.linesWithoutAnalytics)}
                context="Trebuie 0. Schema le refuză — o valoare aici e bug de migrare."
                tone={metrics.linesWithoutAnalytics === 0 ? 'success' : 'danger'}
              />
              <Stat
                label="Rollup-uri divergente"
                value={String(metrics.divergentRollups)}
                context="Trebuie 0. Recalculat din registru, nu din aceeași formulă."
                tone={metrics.divergentRollups === 0 ? 'success' : 'danger'}
              />
              <Stat
                label="Mutări neexplicate"
                value={String(metrics.unexplainedReallocations)}
                context="Linii cu „folosit” ≠ „descărcat”, fără document de re-alocare."
                tone={metrics.unexplainedReallocations === 0 ? 'success' : 'warning'}
              />
              <Stat
                label="Luni blocate în verificare"
                value={String(metrics.stuckClosings)}
                context="Peste 48h în „closing”. De obicei un om plecat în concediu."
                tone={metrics.stuckClosings === 0 ? 'success' : 'warning'}
              />
            </div>
          </section>
        )}

        <p className="mt-8 max-w-prose text-sm text-ink-subtle">
          Constructorul de rapoarte peste registru — cel în care îți alegi singur dimensiunile —
          vine odată cu exporturile, în faza 3. Până atunci, rapoartele standard de mai sus acoperă
          întrebările pentru care există date.
        </p>
      </div>
    </>
  );
}
