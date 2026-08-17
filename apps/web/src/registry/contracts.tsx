import { canSeeFinancials } from '@damina/auth';
import {
  COMPONENT_TYPE_LABELS,
  CONTRACT_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  CONTRACT_TYPES,
} from '@damina/contracts';
import {
  countCeilingsWithoutValue,
  findPeriodId,
  getContract,
  getContractOverview,
  getInspectionCoverage,
  listCeilings,
  listClients,
  listPersonOptions,
  listComponents,
  listContractObjectives,
  listContracts,
  listContractYears,
  listInspectionProfiles,
  listObjectives,
  type ComponentBand,
  type ContractOverview,
  type ContractRow,
} from '@damina/services';

/*
 * Tipurile citirilor de plafon se iau din `ComponentBand`, nu direct din
 * `@damina/domain`: aplicatia de birou nu are voie sa importe domeniul (regula
 * de `boundaries` din pasul 01), iar banda le expune oricum, deja compuse.
 */
type CeilingUsage = NonNullable<ComponentBand['usage']>;
type DeltaFill = NonNullable<ComponentBand['fill']>;
import { Money as MoneyValue } from '@damina/shared';
import {
  Badge,
  Banner,
  CellMeta,
  CellTitle,
  EmptyState,
  Money,
  ProgressBar,
  Stat,
  Table,
} from '@damina/ui';
import { AlertTriangle, ArrowLeft, TrendingDown } from 'lucide-react';
import Link from 'next/link';
import { cache } from 'react';
import { AuditTrail } from '../components/detail/audit-trail';
import { CeilingDialog } from '../components/contract/ceiling-dialog';
import { MonthNav } from '../components/contract/month-nav';
import {
  LinkObjectiveDialog,
  LinkRowActions,
} from '../components/contract/objective-link-dialog';
import { DefinitionList, Empty } from '../components/detail/definition-list';
import { PhasePlaceholder } from '../components/detail/phase-placeholder';
import { defineEntity, type EntityContext } from './types';

/**
 * CONTRACTUL — motorul de bani al firmei, ca ecran.
 *
 * Tot ce urmeaza se sprijina pe regula 1 a pasului 04: **cele trei numere nu se
 * amesteca niciodata.** Venitul alocat, plafonul de cost si consumul au coloane
 * separate in baza, functii separate in domain (`ceilingUsage` / `deltaFill`),
 * si de aici incolo benzi vizual diferite pe ecran.
 *
 * Diferenta care conteaza cel mai mult vizual: **banda Delta se UMPLE.** Nu e o
 * limita de cheltuiala, e venit disponibil, iar ce nu se umple pana la finalul
 * lunii se pierde definitiv. O bara care se goleste in locul ei ar invata omul
 * exact comportamentul gresit.
 */

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const formatDate = (value: string | null): string =>
  value === null ? '—' : dateFormat.format(new Date(`${value}T00:00:00`));

const formatPercent = (fraction: string | null): string =>
  fraction === null ? '—' : `${(Number(fraction) * 100).toFixed(2).replace('.', ',')}%`;

/** Contractul nu se indexeaza deloc. Se degradeaza cel mai repede — se vede. */
const isUnindexed = (row: ContractRow): boolean => Number(row.indexationPct) === 0;

/** Cate luni mai are contractul. Negativ inseamna deja expirat. */
function monthsToExpiry(endsOn: string): number {
  const end = new Date(`${endsOn}T00:00:00`);
  const now = new Date();
  return (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
}

/**
 * Prezentarea lunii, memoizata pe cerere.
 *
 * Antetul si tab-ul au nevoie de aceleasi cifre, si sunt randate in paralel.
 * Fara `cache`, ecranul central al firmei ar face de doua ori acelasi set de
 * interogari — si, mai rau, ar putea afisa doua adevaruri daca intre ele s-ar
 * strecura o scriere.
 */
const overviewFor = cache(
  async (ctx: EntityContext, contractId: string): Promise<ContractOverview> =>
    getContractOverview(ctx.actor, contractId, ctx.app.year, ctx.app.month),
);

// ── Benzile de componenta (§3.3) ─────────────────────────────────────────────

/**
 * O banda de componenta. Clickabila, si duce la lista de UL finantate din ea.
 *
 * „Cu totalul care trebuie sa dea exact cifra de pe banda. Daca nu da, e bug, si
 * trebuie sa se vada.” In pasul 04 lista e goala si cifrele sunt zero — dar
 * legatura exista deja, si nu se schimba cand pasul 05 o umple.
 */
function ComponentBandCard({
  band,
  contractId,
  periodId,
  blockedReason,
  canEditCeilings,
  monthLabel,
}: {
  band: ComponentBand;
  contractId: string;
  periodId: string | null;
  blockedReason: string | undefined;
  canEditCeilings: boolean;
  monthLabel: string;
}) {
  const { component } = band;
  const href = `/contracte/${contractId}/componente/${component.id}`;
  const ceilingBlocked =
    !canEditCeilings
      ? 'Plafoanele conțin valori comerciale. Rolul tău nu le poate modifica.'
      : (blockedReason ??
        (periodId === null ? 'Luna nu e deschisă încă la firma contractului.' : undefined));

  return (
    <article className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <Link href={href} className="text-base font-semibold text-ink hover:text-brand-700">
            {component.name}
          </Link>
          <p className="mt-0.5 text-sm text-ink-muted">
            {COMPONENT_TYPE_LABELS[component.type]} · buget {component.budgetCadence}
            {component.isFillTarget ? ' · țintă de umplere' : ''}
          </p>
        </div>
        {canEditCeilings ? (
          <CeilingDialog
            kind={component.isFillTarget ? 'venit' : 'cost'}
            componentId={component.id}
            componentName={component.name}
            periodId={periodId}
            contractYearId={null}
            scopeLabel={monthLabel}
            currentCeiling={
              band.fill?.revenueCeiling?.toDbString() ?? band.usage?.ceiling?.toDbString() ?? null
            }
            currentAllocatedRevenue={band.allocatedRevenue.toDbString()}
            triggerLabel={component.isFillTarget ? 'Setează plafonul de venit' : 'Setează plafonul'}
            blockedReason={ceilingBlocked}
          />
        ) : null}
      </div>

      <div className="px-4 py-3">
        {band.fill === null ? (
          <CostBand usage={band.usage} allocatedRevenue={band.allocatedRevenue} />
        ) : (
          <FillBand fill={band.fill} />
        )}
      </div>

      <Link
        href={href}
        className="block border-t border-border px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50/40"
      >
        Unitățile de lucru finanțate din componenta asta →
      </Link>
    </article>
  );
}

/** Componenta cu plafon de COST: bara se goleste, depasirea e rosie. */
function CostBand({
  usage,
  allocatedRevenue,
}: {
  usage: CeilingUsage | null;
  allocatedRevenue: MoneyValue;
}) {
  if (usage === null || !usage.hasCeiling) {
    return (
      <div className="space-y-2">
        <NumberRow label="Venit alocat" value={allocatedRevenue} />
        <Banner
          tone="warning"
          title="Plafon nesetat"
          body="Fără plafon nu există procent de consum, iar componenta nu poate declanșa nicio alertă. „Nesetat” nu înseamnă „nelimitat”."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-5">
        <NumberRow label="Venit alocat" value={allocatedRevenue} />
        <NumberRow label="Plafon de cost" value={usage.ceiling ?? MoneyValue.ZERO} />
        <NumberRow label="Angajat" value={usage.committed} />
        <NumberRow label="Consumat" value={usage.consumed} />
        <NumberRow label="Rest" value={usage.remaining} emphasis />
      </div>
      <ProgressBar
        label="Consum din plafon"
        value={Number.isFinite(usage.percent) ? usage.percent : 100}
        detail={`${usage.used.format()} din ${(usage.ceiling ?? MoneyValue.ZERO).format()} · analitica: folosit`}
      />
    </div>
  );
}

/**
 * DELTA. Bara se UMPLE, si cifra care conteaza sunt leii NEUMPLUTI.
 *
 * `expectedPercent` e rigla: pe 10 ale lunii, 33%. Fara ea „38%” nu spune
 * nimic — e excelent pe 12 si dezastruos pe 28.
 */
function FillBand({ fill }: { fill: DeltaFill }) {
  if (fill.state === 'nesetat') {
    return (
      <Banner
        tone="warning"
        title="Plafonul de venit al Deltei nu e setat"
        body="Delta se setează manual, lunar. Fără ea nu se poate ști cât venit rămâne neumplut — iar neumplutul se pierde la finalul lunii, nu se reportează."
      />
    );
  }

  const behind = fill.state === 'in_urma';

  return (
    <div className="space-y-2">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-4">
        <NumberRow label="Plafon de venit" value={fill.revenueCeiling ?? MoneyValue.ZERO} />
        <NumberRow label="Umplut" value={fill.allocatedRevenue} />
        <NumberRow label="Neumplut" value={fill.unfilled} emphasis />
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Zile rămase</p>
          <p data-numeric className="mt-1 text-base font-medium tabular-nums">
            {fill.daysLeft}
          </p>
        </div>
      </div>

      <ProgressBar
        label="Grad de umplere"
        value={fill.fillPercent}
        // Tonul e EXPLICIT, si e inversul celui implicit: la Delta mult inseamna
        // bine. Lasat pe implicit, 90% umplut ar fi desenat portocaliu, ca o
        // depasire de buget — fix pe dos fata de realitate.
        tone={fill.state === 'plin' ? 'success' : behind ? 'danger' : 'brand'}
        detail={`ritmul zilei ar cere ${Math.round(fill.expectedPercent)}% · ${fill.unfilled.format()} se pierd dacă luna se închide așa`}
      />

      {behind ? (
        <p className="flex items-start gap-1.5 text-sm text-danger-700">
          <TrendingDown className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Delta e sub ritm. Venitul neumplut nu se reportează în luna următoare.
        </p>
      ) : null}

      <p className="text-sm text-ink-subtle">
        Propunerile din backlog care ar putea umple Delta vin în pasul 08.
      </p>
    </div>
  );
}

function NumberRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: MoneyValue;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</p>
      <p className="mt-1">
        <Money value={value} emphasis={emphasis} />
      </p>
    </div>
  );
}

// ── Entitatea ────────────────────────────────────────────────────────────────

export const contracte = defineEntity<ContractRow>({
  slug: 'contracte',
  singular: 'Contract',
  plural: 'Contracte',
  icon: 'fileSignature',
  group: 'operational',
  usesPeriod: true,
  canWrite: canSeeFinancials,

  list: {
    // Contractele au `company_id`, spre deosebire de nomenclatoare: lista se
    // filtreaza pe firmele bifate in shell. O selectie goala inseamna „nicio
    // firma”, nu „toate” — o cifra pusa in P&L-ul altcuiva nu e o inconveniență
    // de interfata.
    load: (ctx, query) =>
      listContracts(ctx.actor, {
        companyIds: ctx.app.selectedCompanyIds,
        query: query.query,
      }),
    rowKey: (row) => row.id,
    rowHref: (row) => `/contracte/${row.id}`,
    rowFlagged: (row) => monthsToExpiry(row.endsOn) < row.expiryAlertMonths,
    searchPlaceholder: 'Caută după cod, referință sau client',
    notice:
      'Consumul și marja se umplu din registrul de cost (pasul 06). Până atunci coloanele lor arată „—”, nu zero — un zero inventat s-ar citi ca o cifră reală.',
    views: [
      { key: '', label: 'Toate' },
      { key: 'plafoane', label: 'Plafoane' },
      { key: 'portofoliu', label: 'Portofoliu' },
      { key: 'cadru-furnizori', label: 'Cadru furnizori' },
      { key: 'subcontractanti', label: 'Subcontractanți' },
    ],
    renderView: (rows, view) => {
      if (view === 'plafoane') {
        return <CeilingsOverview rows={rows} />;
      }
      if (view === 'portofoliu') {
        return <PortfolioByYear rows={rows} />;
      }
      if (view === 'cadru-furnizori') {
        return <PhasePlaceholder phase={3} what="Contractele cadru cu furnizorii" />;
      }
      return <PhasePlaceholder phase={2} what="Contractele cu subcontractanții" />;
    },
    empty: {
      title: 'Niciun contract pe firmele selectate',
      body: 'Contractul e locul în care se decid banii: abonamentul lunar, componentele și plafoanele lor. Fără el, nicio unitate de lucru nu are din ce să fie finanțată.',
      actionLabel: 'Adaugă primul contract',
    },
    columns: [
      {
        key: 'code',
        header: 'Cod',
        width: '7rem',
        cell: (row) => <span className="font-mono text-xs text-ink-muted">{row.code}</span>,
      },
      {
        key: 'client',
        header: 'Client',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            <CellTitle>{row.clientName}</CellTitle>
            {/* SEMNUL VIZUAL DISTINCT cerut de §3.4: contractele fara indexare
                se degradeaza cel mai repede, si nimic altceva din rand nu o
                spune. */}
            {isUnindexed(row) ? <Badge tone="danger">indexare 0</Badge> : null}
          </span>
        ),
      },
      {
        key: 'company',
        header: 'Firmă',
        hideBelow: 'lg',
        cell: (row) => <CellMeta>{row.companyName}</CellMeta>,
      },
      {
        key: 'type',
        header: 'Tip',
        width: '11rem',
        hideBelow: 'md',
        cell: (row) => <CellMeta>{CONTRACT_TYPE_LABELS[row.type]}</CellMeta>,
      },
      {
        key: 'period',
        header: 'Perioadă',
        width: '13rem',
        hideBelow: 'md',
        cell: (row) => (
          <CellMeta>
            {formatDate(row.startsOn)} → {formatDate(row.endsOn)}
          </CellMeta>
        ),
      },
      {
        key: 'value',
        header: 'Abonament lunar',
        align: 'right',
        width: '10rem',
        cell: (row) =>
          row.monthlyValue === null ? <Empty /> : <Money value={MoneyValue.fromDb(row.monthlyValue)} />,
      },
      {
        key: 'year',
        header: 'An contractual',
        align: 'right',
        width: '8rem',
        cell: (row) =>
          row.currentYearIndex === null ? (
            <Empty />
          ) : (
            <CellMeta>
              {row.currentYearIndex}/{row.yearCount}
            </CellMeta>
          ),
      },
      {
        key: 'owner',
        header: 'PM',
        hideBelow: 'lg',
        cell: (row) => (row.ownerName === null ? <Empty /> : <CellMeta>{row.ownerName}</CellMeta>),
      },
      {
        key: 'usage',
        header: 'Consum',
        align: 'right',
        width: '6rem',
        hideBelow: 'lg',
        cell: () => (
          <span title="Se calculează din registrul de cost, în pasul 06.">
            <Empty />
          </span>
        ),
      },
      {
        key: 'margin',
        header: 'Marjă',
        align: 'right',
        width: '6rem',
        hideBelow: 'lg',
        cell: () => (
          <span title="Se calculează din registrul de cost, în pasul 06.">
            <Empty />
          </span>
        ),
      },
      {
        key: 'expiry',
        header: 'Expirare',
        width: '9rem',
        cell: (row) => {
          const months = monthsToExpiry(row.endsOn);
          if (months < 0) {
            return <Badge tone="neutral">expirat</Badge>;
          }
          if (months < row.expiryAlertMonths) {
            return <Badge tone="warning">în {months} luni</Badge>;
          }
          return <CellMeta>{formatDate(row.endsOn)}</CellMeta>;
        },
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getContract(ctx.actor, id).catch(() => null),

    header: async (row, ctx) => {
      const overview = await overviewFor(ctx, row.id);
      const cost = overview.bands.find((band) => band.usage?.hasCeiling === true);
      const delta = overview.bands.find((band) => band.fill !== null);

      return {
        title: `${row.code} · ${row.clientName}`,
        breadcrumb: [
          { label: 'Operațional' },
          { label: 'Contracte', href: '/contracte' },
          { label: row.code },
        ],
        badges: [
          { label: CONTRACT_TYPE_LABELS[row.type], tone: 'brand' as const },
          { label: CONTRACT_STATUS_LABELS[row.status] ?? row.status, tone: 'outline' as const },
          ...(isUnindexed(row) ? [{ label: 'Indexare 0', tone: 'danger' as const }] : []),
          ...(monthsToExpiry(row.endsOn) < row.expiryAlertMonths
            ? [{ label: `Expiră în ${monthsToExpiry(row.endsOn)} luni`, tone: 'warning' as const }]
            : []),
        ],
        meta: [
          { label: 'Firmă', value: row.companyName },
          {
            label: 'An contractual',
            value:
              row.currentYearIndex === null
                ? '—'
                : `${String(row.currentYearIndex)}/${String(row.yearCount)}`,
          },
          { label: 'PM', value: row.ownerName ?? '—' },
          {
            label: 'Abonamentul lunii',
            value:
              overview.monthlyValue === null ? '—' : <Money value={overview.monthlyValue} />,
          },
        ],
        // MAXIM DOUA bare, si sunt cele pe care se ia decizia: cat s-a consumat
        // din plafonul de cost, si cat s-a umplut din Delta. Sensurile lor sunt
        // opuse, si de aceea tonul Deltei e dat explicit.
        progress: [
          ...(cost?.usage === undefined || cost.usage === null
            ? []
            : [
                {
                  label: `Consum · ${cost.component.name}`,
                  value: Number.isFinite(cost.usage.percent) ? cost.usage.percent : 100,
                  detail: `${cost.usage.used.format()} din ${(cost.usage.ceiling ?? MoneyValue.ZERO).format()}`,
                },
              ]),
          ...(delta?.fill == null || delta.fill.state === 'nesetat'
            ? []
            : [
                {
                  label: 'Umplere Delta',
                  value: delta.fill.fillPercent,
                  tone:
                    delta.fill.state === 'plin'
                      ? ('success' as const)
                      : delta.fill.state === 'in_urma'
                        ? ('danger' as const)
                        : ('brand' as const),
                  detail: `${delta.fill.unfilled.format()} neumpluți`,
                },
              ]),
        ],
      };
    },

    tabs: [
      // ── Prezentare ────────────────────────────────────────────────────────
      {
        slug: '',
        label: 'Prezentare',
        render: async (row, ctx) => {
          const overview = await overviewFor(ctx, row.id);
          const periodId = await findPeriodId(
            ctx.actor,
            row.companyId,
            ctx.app.year,
            ctx.app.month,
          );
          const monthLabel = `${String(ctx.app.month).padStart(2, '0')}/${String(ctx.app.year)}`;
          const blocked = ctx.app.period.locked
            ? 'Luna selectată este închisă. Plafoanele ei nu se mai pot modifica.'
            : undefined;

          return (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <MonthNav
                  year={ctx.app.year}
                  month={ctx.app.month}
                  locked={ctx.app.period.locked}
                />
                <p className="text-sm text-ink-subtle">
                  Cifrele sunt pe analitica <strong className="text-ink-muted">folosit</strong>,
                  marja e <strong className="text-ink-muted">brută</strong>.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Stat
                  label="Abonament lunar"
                  value={
                    overview.monthlyValue === null ? (
                      '—'
                    ) : (
                      <Money value={overview.monthlyValue} />
                    )
                  }
                  context={
                    overview.contractYear === null
                      ? 'Luna e în afara perioadei contractului.'
                      : `Anul contractual ${String(overview.contractYear.yearIndex)}, indexat cu ${formatPercent(overview.contractYear.indexationAppliedPct)}`
                  }
                />
                <Stat
                  label="Marja lunii"
                  value="—"
                  context="Venit − cost real. Se calculează din registrul de cost, pasul 06."
                />
                <Stat
                  label="Marja anului contractual"
                  value="—"
                  context="Cumulat de la aniversare. Tot din pasul 06."
                />
              </div>

              {overview.bands.length === 0 ? (
                <EmptyState
                  title="Contractul n-are componente"
                  body="Fără componente nu există plafoane, deci nici o limită de cheltuială și nicio țintă de venit. Un contract de mentenanță are trei: Mentenanță, Lucrări și Delta."
                  size="sm"
                />
              ) : (
                <div className="space-y-3">
                  {overview.bands.map((band) => (
                    <ComponentBandCard
                      key={band.component.id}
                      band={band}
                      contractId={row.id}
                      periodId={periodId}
                      blockedReason={blocked}
                      canEditCeilings={canSeeFinancials(ctx.session)}
                      monthLabel={monthLabel}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        },
      },

      // ── Componente ────────────────────────────────────────────────────────
      {
        slug: 'componente',
        label: 'Componente',
        count: () => undefined,
        render: async (row, ctx, sub) => {
          const componentId = sub[0];
          const components = await listComponents(ctx.actor, row.id);

          if (componentId !== undefined) {
            const component = components.find((candidate) => candidate.id === componentId);
            if (component === undefined) {
              return (
                <EmptyState
                  title="Componenta nu există pe contractul ăsta"
                  body="Poate a fost ștearsă, sau linkul e vechi. Lista componentelor e mai sus."
                  size="sm"
                />
              );
            }
            return <FundedWorkUnits contractId={row.id} componentName={component.name} ctx={ctx} />;
          }

          const [years, monthlyCeilings, periodId] = await Promise.all([
            listContractYears(ctx.actor, row.id),
            listCeilings(ctx.actor, { componentIds: components.map((c) => c.id) }),
            findPeriodId(ctx.actor, row.companyId, ctx.app.year, ctx.app.month),
          ]);

          const currentYear = years.find(
            (year) =>
              `${String(ctx.app.year)}-${String(ctx.app.month).padStart(2, '0')}-01` >=
                year.startsOn &&
              `${String(ctx.app.year)}-${String(ctx.app.month).padStart(2, '0')}-01` <= year.endsOn,
          );

          const canEdit = canSeeFinancials(ctx.session);
          const blocked = ctx.app.period.locked
            ? 'Luna selectată este închisă.'
            : periodId === null
              ? 'Luna nu e deschisă încă la firma contractului.'
              : undefined;
          const monthLabel = `${String(ctx.app.month).padStart(2, '0')}/${String(ctx.app.year)}`;

          if (components.length === 0) {
            return (
              <EmptyState
                title="Niciun component"
                body="Componentele se creează odată cu contractul: Mentenanță (plafon lunar de cost), Lucrări (plafon anual, defalcat lunar) și Delta (plafon de venit, lunar, manual)."
                size="sm"
              />
            );
          }

          return (
            <div className="space-y-4">
              <p className="max-w-prose text-sm text-ink-muted">
                Fiecare componentă are regula ei temporală: Mentenanța se setează lunar, Lucrările
                anual cu defalcare pe luni, Delta lunar și manual. Cele trei numere — venit alocat,
                plafon de cost, plafon de venit — stau în coloane separate și nu se convertesc unul
                în altul.
              </p>

              <div className="space-y-3">
                {components.map((component) => {
                  const monthly = monthlyCeilings.find(
                    (ceiling) =>
                      ceiling.componentId === component.id && ceiling.periodId === periodId,
                  );
                  const annual = monthlyCeilings.find(
                    (ceiling) =>
                      ceiling.componentId === component.id &&
                      ceiling.contractYearId !== null &&
                      ceiling.contractYearId === currentYear?.id,
                  );

                  return (
                    <div key={component.id} className="rounded-lg border border-border bg-surface">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                        <div>
                          <Link
                            href={`/contracte/${row.id}/componente/${component.id}`}
                            className="font-semibold text-ink hover:text-brand-700"
                          >
                            {component.name}
                          </Link>
                          <span className="ml-2 text-sm text-ink-muted">
                            {COMPONENT_TYPE_LABELS[component.type]}
                          </span>
                        </div>
                        {component.isFillTarget ? (
                          <Badge tone="brand">se umple</Badge>
                        ) : (
                          <Badge tone="outline">se consumă</Badge>
                        )}
                      </div>

                      <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                            Luna {monthLabel}
                          </p>
                          <dl className="mt-1.5 space-y-1 text-sm">
                            <Pair
                              label="Venit alocat"
                              value={monthly?.allocatedRevenue ?? null}
                            />
                            <Pair
                              label={component.isFillTarget ? 'Plafon de venit' : 'Plafon de cost'}
                              value={
                                component.isFillTarget
                                  ? (monthly?.revenueCeiling ?? null)
                                  : (monthly?.costCeiling ?? null)
                              }
                            />
                          </dl>
                          {canEdit ? (
                            <div className="mt-2">
                              <CeilingDialog
                                kind={component.isFillTarget ? 'venit' : 'cost'}
                                componentId={component.id}
                                componentName={component.name}
                                periodId={periodId}
                                contractYearId={null}
                                scopeLabel={`Luna ${monthLabel}`}
                                currentCeiling={
                                  component.isFillTarget
                                    ? (monthly?.revenueCeiling ?? null)
                                    : (monthly?.costCeiling ?? null)
                                }
                                currentAllocatedRevenue={monthly?.allocatedRevenue ?? null}
                                triggerLabel="Setează plafonul lunii"
                                blockedReason={blocked}
                              />
                            </div>
                          ) : null}
                        </div>

                        {/* PLANUL ANUAL, doar pentru componenta cu cadenta anuala.
                            Nu e blocat de luna inchisa, intentionat: planul anual
                            nu e o cifra a lunii august. */}
                        {component.budgetCadence === 'anual' ? (
                          <div>
                            <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                              Plan anual{' '}
                              {currentYear === undefined
                                ? ''
                                : `· anul ${String(currentYear.yearIndex)}`}
                            </p>
                            <dl className="mt-1.5 space-y-1 text-sm">
                              <Pair label="Venit alocat" value={annual?.allocatedRevenue ?? null} />
                              <Pair label="Plafon anual de cost" value={annual?.costCeiling ?? null} />
                            </dl>
                            {canEdit && currentYear !== undefined ? (
                              <div className="mt-2">
                                <CeilingDialog
                                  kind="cost"
                                  componentId={component.id}
                                  componentName={component.name}
                                  periodId={null}
                                  contractYearId={currentYear.id}
                                  scopeLabel={`Anul contractual ${String(currentYear.yearIndex)}`}
                                  currentCeiling={annual?.costCeiling ?? null}
                                  currentAllocatedRevenue={annual?.allocatedRevenue ?? null}
                                  triggerLabel="Setează planul anual"
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        },
      },

      // ── Obiective ─────────────────────────────────────────────────────────
      {
        slug: 'obiective',
        label: 'Obiective',
        render: async (row, ctx) => {
          const [links, profiles, allObjectives, coverage] = await Promise.all([
            listContractObjectives(ctx.actor, row.id),
            listInspectionProfiles(ctx.actor),
            listObjectives(ctx.actor, { limit: 1000 }),
            getInspectionCoverage(ctx.actor, row.id, ctx.app.year, ctx.app.month),
          ]);

          const profileOptions = profiles.map((profile) => ({
            value: profile.id,
            label: profile.name,
          }));
          const linkedNow = new Set(
            links.filter((link) => link.isCurrent).map((link) => link.objectiveId),
          );
          const objectiveOptions = allObjectives
            .filter((objective) => !linkedNow.has(objective.id))
            .map((objective) => ({
              value: objective.id,
              label: `${objective.code} · ${objective.name}`,
            }));

          const blocked = canSeeFinancials(ctx.session)
            ? undefined
            : 'Rolul tău nu poate schimba componența contractului.';

          return (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="max-w-prose text-sm text-ink-muted">
                  Legătura contract↔obiectiv e o entitate proprie, cu valabilitate în timp:
                  obiectivele intră și ies din contract în cei 4 ani, iar istoricul rămâne.{' '}
                  <strong className="text-ink">Profilul de inspecție se editează aici</strong>, nu
                  pe obiectiv — același obiectiv poate avea frecvențe diferite pe contracte
                  diferite.
                </p>
                <LinkObjectiveDialog
                  contractId={row.id}
                  objectives={objectiveOptions}
                  profiles={profileOptions}
                  blockedReason={blocked}
                />
              </div>

              <Table
                caption="Obiectivele contractului"
                rows={links}
                rowKey={(link) => link.id}
                rowFlagged={(link) => link.isCurrent}
                empty={
                  <EmptyState
                    title="Niciun obiectiv pe contract"
                    body="Fără obiective, contractul n-are unde să producă lucrări: fiecare unitate de lucru se agață de un amplasament."
                    size="sm"
                    className="rounded-lg border border-dashed border-border bg-surface"
                  />
                }
                columns={[
                  {
                    key: 'objective',
                    header: 'Obiectiv',
                    cell: (link) => (
                      <Link
                        href={`/obiective/${link.objectiveId}`}
                        className="font-medium hover:text-brand-700"
                      >
                        {link.objectiveName}
                      </Link>
                    ),
                  },
                  {
                    key: 'code',
                    header: 'Cod',
                    width: '8rem',
                    cell: (link) => (
                      <span className="font-mono text-xs text-ink-muted">{link.objectiveCode}</span>
                    ),
                  },
                  {
                    key: 'validity',
                    header: 'Valabilitate',
                    width: '14rem',
                    cell: (link) => (
                      <CellMeta>
                        {formatDate(link.validFrom)} →{' '}
                        {link.validTo === null ? 'fără sfârșit' : formatDate(link.validTo)}
                      </CellMeta>
                    ),
                  },
                  {
                    key: 'profile',
                    header: 'Profil de inspecție',
                    hideBelow: 'md',
                    cell: (link) =>
                      link.profileName === null ? (
                        <Badge tone="neutral">fără profil</Badge>
                      ) : (
                        <CellMeta>{link.profileName}</CellMeta>
                      ),
                  },
                  {
                    key: 'state',
                    header: 'Stare',
                    width: '7rem',
                    cell: (link) =>
                      link.isCurrent ? (
                        <Badge tone="success">în contract</Badge>
                      ) : (
                        <Badge tone="neutral">încheiat</Badge>
                      ),
                  },
                  {
                    key: 'actions',
                    header: '',
                    align: 'right',
                    width: '10rem',
                    cell: (link) =>
                      link.isCurrent ? (
                        <LinkRowActions
                          linkId={link.id}
                          objectiveName={link.objectiveName}
                          currentProfileId={link.inspectionProfileId}
                          profiles={profileOptions}
                          blockedReason={blocked}
                        />
                      ) : null,
                  },
                ]}
              />

              <CoverageSection
                coverage={coverage}
                month={`${String(ctx.app.month).padStart(2, '0')}/${String(ctx.app.year)}`}
              />
            </div>
          );
        },
      },

      {
        slug: 'activitate',
        label: 'Activitate',
        render: () => (
          <PhasePlaceholder phase={1} what="Unitățile de lucru și fișele contractului" />
        ),
      },

      // ── Financiar ─────────────────────────────────────────────────────────
      {
        slug: 'financiar',
        label: 'Financiar',
        visible: canSeeFinancials,
        render: async (row, ctx, sub) => {
          const years = await listContractYears(ctx.actor, row.id);
          const net = sub[0] === 'neta';

          return (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Indexarea pe ani contractuali</h2>
                  <p className="mt-0.5 max-w-prose text-sm text-ink-muted">
                    Istoricizată, nu recalculată: un an în care s-a aplicat 0% rămâne 0% și peste
                    trei ani, chiar dacă între timp procentul contractului s-a schimbat.
                  </p>
                </div>

                {/* Comutatorul e o RUTA, nu stare de client: marja brută și cea
                    netă sunt două cifre diferite, iar linkul trimis pe chat
                    trebuie să deschidă exact pe care a văzut-o expeditorul. */}
                <nav className="flex gap-1 rounded-lg border border-border bg-surface-sunken p-0.5">
                  <Link
                    href={`/contracte/${row.id}/financiar`}
                    aria-current={net ? undefined : 'page'}
                    className={`rounded px-2.5 py-1 text-sm font-medium ${net ? 'text-ink-muted' : 'bg-surface text-ink shadow-sm'}`}
                  >
                    Marjă brută
                  </Link>
                  <Link
                    href={`/contracte/${row.id}/financiar/neta`}
                    aria-current={net ? 'page' : undefined}
                    className={`rounded px-2.5 py-1 text-sm font-medium ${net ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
                  >
                    Marjă netă
                  </Link>
                </nav>
              </div>

              <Table
                caption="Anii contractuali"
                rows={years}
                rowKey={(year) => year.id}
                rowFlagged={(year) => year.yearIndex === row.currentYearIndex}
                empty={
                  <EmptyState
                    title="Contractul n-are ani contractuali"
                    body="Anii se generează la crearea contractului, din abonamentul lunar și procentul de indexare. Un contract fără abonament lunar nu are cum să-i aibă."
                    size="sm"
                    className="rounded-lg border border-dashed border-border bg-surface"
                  />
                }
                columns={[
                  {
                    key: 'index',
                    header: 'An',
                    width: '5rem',
                    cell: (year) => <CellTitle>{year.yearIndex}</CellTitle>,
                  },
                  {
                    key: 'period',
                    header: 'Perioadă',
                    width: '15rem',
                    cell: (year) => (
                      <CellMeta>
                        {formatDate(year.startsOn)} → {formatDate(year.endsOn)}
                      </CellMeta>
                    ),
                  },
                  {
                    key: 'indexation',
                    header: 'Indexare aplicată',
                    align: 'right',
                    width: '10rem',
                    cell: (year) =>
                      Number(year.indexationAppliedPct) === 0 ? (
                        <Badge tone="danger">0%</Badge>
                      ) : (
                        <CellMeta>{formatPercent(year.indexationAppliedPct)}</CellMeta>
                      ),
                  },
                  {
                    key: 'monthly',
                    header: 'Abonament lunar',
                    align: 'right',
                    width: '11rem',
                    cell: (year) => <Money value={MoneyValue.fromDb(year.monthlyValue)} />,
                  },
                  {
                    key: 'annual',
                    header: 'Valoare anuală',
                    align: 'right',
                    width: '11rem',
                    cell: (year) => (
                      <Money value={MoneyValue.fromDb(year.monthlyValue).mul(12)} />
                    ),
                  },
                ]}
              />

              <div className="rounded-lg border border-border bg-surface p-4">
                <h3 className="text-base font-semibold">
                  Marja pe an contractual — {net ? 'netă' : 'brută'}
                </h3>
                <p className="mt-1 max-w-prose text-sm text-ink-muted">
                  {net
                    ? `Venit − cost direct − regie (${formatPercent(row.overheadPct)}). Regia se aplică peste costul direct.`
                    : 'Venit − cost direct. Fără regie.'}{' '}
                  Cifrele se umplu din registrul de cost, în pasul 06. Structura e deja cea finală,
                  ca ecranul să nu se schimbe când capătă conținut.
                </p>
                <dl className="mt-3 grid gap-4 sm:grid-cols-4">
                  <Pair label="Venit cumulat" value={null} />
                  <Pair label="Cost direct" value={null} />
                  {net ? <Pair label="Regie" value={null} /> : null}
                  <Pair label={net ? 'Marjă netă' : 'Marjă brută'} value={null} />
                </dl>
                <p className="mt-3 text-xs text-ink-subtle">
                  Analitica: <strong>folosit</strong>. Marja: <strong>{net ? 'netă' : 'brută'}</strong>.
                </p>
              </div>
            </div>
          );
        },
      },

      {
        slug: 'facturare',
        label: 'Facturare',
        visible: canSeeFinancials,
        render: () => <PhasePlaceholder phase={2} what="Facturarea contractului" />,
      },
      {
        slug: 'subcontractanti',
        label: 'Subcontractanți',
        render: () => <PhasePlaceholder phase={2} what="Pachetele de subcontractare" />,
      },
      {
        slug: 'documente',
        label: 'Documente',
        render: () => <PhasePlaceholder phase={1} what="Dosarul de documente al contractului" />,
      },

      // ── Setări ────────────────────────────────────────────────────────────
      {
        slug: 'setari',
        label: 'Setări',
        visible: canSeeFinancials,
        render: (row, ctx) => (
          <div className="space-y-6">
            <DefinitionList
              items={[
                { label: 'Cod', value: <span className="font-mono">{row.code}</span> },
                { label: 'Referință act', value: row.reference ?? <Empty /> },
                { label: 'Tip', value: CONTRACT_TYPE_LABELS[row.type] },
                { label: 'Status', value: CONTRACT_STATUS_LABELS[row.status] ?? row.status },
                { label: 'Începe la', value: formatDate(row.startsOn) },
                { label: 'Se termină la', value: formatDate(row.endsOn) },
                {
                  label: 'Valoare totală',
                  value:
                    row.totalValue === null ? (
                      <Empty />
                    ) : (
                      <Money value={MoneyValue.fromDb(row.totalValue)} />
                    ),
                },
                {
                  label: 'Abonament lunar (anul 1)',
                  value:
                    row.monthlyValue === null ? (
                      <Empty />
                    ) : (
                      <Money value={MoneyValue.fromDb(row.monthlyValue)} />
                    ),
                  hint: 'Anii următori se indexează și se istoricizează separat.',
                },
                {
                  label: 'Indexare anuală',
                  value: isUnindexed(row) ? (
                    <Badge tone="danger">0% — contractul se degradează</Badge>
                  ) : (
                    formatPercent(row.indexationPct)
                  ),
                  hint: 'Propunerea la generarea anilor. Ce s-a aplicat efectiv stă pe fiecare an.',
                },
                {
                  label: 'Prag mentenanță → Delta',
                  value: <Money value={MoneyValue.fromDb(row.deltaThreshold)} />,
                  hint: 'Peste prag, o intervenție de mentenanță trece pe Delta.',
                },
                {
                  label: 'Alertă de expirare',
                  value: `cu ${String(row.expiryAlertMonths)} luni înainte`,
                  hint: 'Cron zilnic la 06:00. O singură alertă per contract, nu una pe zi.',
                },
                { label: 'Termen de plată', value: `${String(row.paymentTermDays)} zile` },
                { label: 'PM proprietar de P&L', value: row.ownerName ?? <Empty /> },
                {
                  label: 'Regie (pentru marja netă)',
                  value: row.overheadPct === null ? <Empty /> : formatPercent(row.overheadPct),
                  hint: row.overheadPct === null ? 'Fără regie, marja netă nu se calculează.' : undefined,
                },
                {
                  label: 'Șablon de raport lunar',
                  value: <Empty />,
                  hint: 'Șabloanele de raport vin în pasul 10.',
                  full: true,
                },
              ]}
            />

            <div>
              <h2 className="mb-2 text-base font-semibold">Cine a modificat contractul</h2>
              <AuditTrail ctx={ctx} tableName="contracts" recordId={row.id} />
            </div>
          </div>
        ),
      },
    ],

    links: async (row, ctx) => {
      const [objectives, missingCeilings] = await Promise.all([
        listContractObjectives(ctx.actor, row.id, { onlyCurrent: true }),
        countCeilingsWithoutValue(ctx.actor, row.id),
      ]);

      return [
        {
          kind: 'up',
          title: 'În sus',
          items: [
            { label: 'Toate contractele', href: '/contracte' },
            { label: row.clientName, href: `/clienti/${row.clientId}` },
          ],
        },
        {
          kind: 'related',
          title: 'Obiective în contract',
          count: objectives.length,
          items: objectives.slice(0, 6).map((link) => ({
            label: link.objectiveName,
            href: `/obiective/${link.objectiveId}`,
            meta: link.profileName ?? 'fără profil',
          })),
        },
        ...(missingCeilings === 0
          ? []
          : [
              {
                kind: 'related' as const,
                title: 'De rezolvat',
                count: missingCeilings,
                items: [
                  {
                    label: `${String(missingCeilings)} componente fără niciun plafon`,
                    href: `/contracte/${row.id}/componente`,
                    tone: 'warning' as const,
                  },
                ],
              },
            ]),
      ];
    },

    quickActions: (row, ctx) => [
      ...(canSeeFinancials(ctx.session)
        ? [
            {
              label: 'Modifică contractul',
              href: `/contracte?edit=${row.id}`,
              tone: 'primary' as const,
            },
          ]
        : []),
      { label: 'Componente și plafoane', href: `/contracte/${row.id}/componente` },
      { label: 'Obiective', href: `/contracte/${row.id}/obiective` },
      { label: 'Propune din backlog', disabledReason: 'Backlogul de propuneri vine în pasul 08.' },
    ],
  },

  form: {
    schemaKey: 'contracte',
    editable: true,
    createTitle: 'Contract nou',
    editTitle: 'Modifică contractul',
    loadLookups: async (ctx: EntityContext) => {
      const [clients, persons] = await Promise.all([
        listClients(ctx.actor, { limit: 500 }),
        // Doar oamenii de birou activi: un sef de santier nu poate fi PM. Vezi
        // `listPersonOptions` pentru de ce lista nu-i cuprinde pe cei plecati.
        listPersonOptions(ctx.actor),
      ]);
      return {
        clients: clients.map((client) => ({ value: client.id, label: client.name })),
        companies: ctx.app.companies.map((company) => ({
          value: company.id,
          label: company.name,
        })),
        persons: persons.map((person) => ({ value: person.id, label: person.fullName })),
      };
    },
    fields: (lookups) => [
      {
        name: 'code',
        label: 'Cod',
        control: 'text',
        required: true,
        placeholder: '4700',
        hint: 'Codul din vorbirea curentă. Unic pe firmă, nu global.',
        readOnlyOnEdit: true,
      },
      { name: 'reference', label: 'Referință act', control: 'text', placeholder: 'nr. 128/2024' },
      {
        name: 'companyId',
        label: 'Firmă',
        control: 'select',
        required: true,
        options: lookups.companies ?? [],
        readOnlyOnEdit: true,
        hint: 'Contractul aparține unei firme din grup. Nu se mută după creare.',
      },
      {
        name: 'clientId',
        label: 'Client',
        control: 'select',
        required: true,
        options: lookups.clients ?? [],
      },
      {
        name: 'type',
        label: 'Tip',
        control: 'select',
        required: true,
        options: CONTRACT_TYPES.map((type) => ({
          value: type,
          label: CONTRACT_TYPE_LABELS[type],
        })),
        full: true,
      },
      { name: 'startsOn', label: 'Începe la', control: 'date', required: true },
      { name: 'endsOn', label: 'Se termină la', control: 'date', required: true },
      {
        name: 'monthlyValue',
        label: 'Abonament lunar (anul 1)',
        control: 'number',
        suffix: 'lei',
        hint: 'Din el se generează cei 4 ani contractuali, cu indexarea aplicată la fiecare aniversare.',
      },
      { name: 'totalValue', label: 'Valoare totală', control: 'number', suffix: 'lei' },
      {
        name: 'indexationPct',
        label: 'Indexare anuală',
        control: 'number',
        required: true,
        suffix: '%',
        hint: 'Scrie 5, nu 0,05. Zero e o decizie comercială explicită și se marchează în listă.',
      },
      {
        name: 'deltaThreshold',
        label: 'Prag mentenanță → Delta',
        control: 'number',
        required: true,
        suffix: 'lei',
      },
      {
        name: 'paymentTermDays',
        label: 'Termen de plată',
        control: 'number',
        required: true,
        suffix: 'zile',
      },
      {
        name: 'expiryAlertMonths',
        label: 'Alertă de expirare',
        control: 'number',
        required: true,
        suffix: 'luni',
      },
      {
        name: 'overheadPct',
        label: 'Regie',
        control: 'number',
        suffix: '%',
        hint: 'Pentru marja netă. Gol înseamnă că marja netă nu se calculează.',
      },
      {
        name: 'status',
        label: 'Status',
        control: 'select',
        required: true,
        options: Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
      },
      {
        name: 'ownerPersonId',
        label: 'PM proprietar de P&L',
        control: 'select',
        options: [{ value: '', label: '— fără —' }, ...(lookups.persons ?? [])],
        hint: 'Cine răspunde de marja contractului. Doar oameni de birou, activi.',
      },
    ],
    blank: {
      code: '',
      reference: '',
      companyId: '',
      clientId: '',
      type: 'mentenanta_multianual',
      startsOn: new Date().toISOString().slice(0, 10),
      endsOn: '',
      monthlyValue: '',
      totalValue: '',
      indexationPct: '5',
      deltaThreshold: '2000',
      paymentTermDays: '70',
      expiryAlertMonths: '6',
      overheadPct: '',
      status: 'draft',
      ownerPersonId: '',
    },
    toFormValues: (row) => ({
      code: row.code,
      reference: row.reference ?? '',
      companyId: row.companyId,
      clientId: row.clientId,
      type: row.type,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      monthlyValue: row.monthlyValue ?? '',
      totalValue: row.totalValue ?? '',
      indexationPct: (Number(row.indexationPct) * 100).toFixed(2),
      deltaThreshold: row.deltaThreshold,
      paymentTermDays: String(row.paymentTermDays),
      expiryAlertMonths: String(row.expiryAlertMonths),
      overheadPct: row.overheadPct === null ? '' : (Number(row.overheadPct) * 100).toFixed(2),
      status: row.status,
      ownerPersonId: row.ownerPersonId ?? '',
    }),
  },
});

// ── Bucati de ecran ──────────────────────────────────────────────────────────

/** O pereche eticheta/suma, cu „—” cand cifra chiar lipseste. */
function Pair({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd>{value === null ? <Empty /> : <Money value={MoneyValue.fromDb(value)} />}</dd>
    </div>
  );
}

/**
 * Lista de unitati de lucru finantate dintr-o componenta, in luna selectata.
 *
 * §3.3: „cu totalul care trebuie sa dea exact cifra de pe banda. Daca nu da, e
 * bug, si trebuie sa se vada.” In pasul 04 nu exista unitati de lucru, deci
 * lista e goala si totalul e zero — dar drumul de la cifra la desfacerea ei
 * exista deja, si nu se schimba cand pasul 05 il umple.
 */
function FundedWorkUnits({
  contractId,
  componentName,
  ctx,
}: {
  contractId: string;
  componentName: string;
  ctx: EntityContext;
}) {
  return (
    <div className="space-y-4">
      <Link
        href={`/contracte/${contractId}/componente`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Înapoi la componente
      </Link>

      <EmptyState
        title={`Nicio unitate de lucru finanțată din ${componentName}`}
        body={`În luna ${String(ctx.app.month).padStart(2, '0')}/${String(ctx.app.year)} nu există unități de lucru: ele se construiesc în pasul 05. Când vor exista, totalul de aici trebuie să dea exact cifra de pe bandă — dacă nu dă, e bug.`}
      />

      <p className="text-sm text-ink-subtle">
        Total: <Money value={MoneyValue.ZERO} /> · analitica: <strong>folosit</strong>
      </p>
    </div>
  );
}

/** Acoperirea inspectiilor, sub lista de obiective a contractului (§3.6). */
function CoverageSection({
  coverage,
  month,
}: {
  coverage: Awaited<ReturnType<typeof getInspectionCoverage>>;
  month: string;
}) {
  const overdue = coverage.rows.filter((row) => row.due > row.done);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Acoperire inspecții · {month}</h2>
        <p className="text-sm text-ink-subtle">
          {coverage.objectiveCount} obiective · {coverage.doneTotal} din {coverage.dueTotal}{' '}
          inspecții datorate · analitica: <strong>{coverage.basis}</strong>
        </p>
      </div>

      <p className="mb-2 max-w-prose text-sm text-ink-muted">
        Vedere de birou. <strong>Nu trimite nicio notificare către teren</strong> — se măsoară fără
        să se hărțuiască. Din listă se poate asigna o restanță, dacă cineva decide asta.
      </p>

      <Table
        caption="Acoperirea inspecțiilor"
        rows={coverage.rows}
        rowKey={(row) => `${row.objectiveId}-${row.checklistId ?? 'none'}`}
        rowFlagged={(row) => row.due > row.done}
        maxBodyHeight="24rem"
        empty={
          <EmptyState
            title="Niciun obiectiv de inspectat luna asta"
            body="Fie contractul n-are obiective în luna selectată, fie niciunul n-are profil de inspecție. Profilul se pune pe legătură, în tabelul de mai sus."
            size="sm"
            className="rounded-lg border border-dashed border-border bg-surface"
          />
        }
        footer={
          overdue.length === 0 ? null : (
            <tr>
              <td colSpan={5} className="border-t border-border px-3 py-2 text-sm text-warning-700">
                <AlertTriangle className="mr-1.5 inline size-4" aria-hidden="true" />
                {overdue.length} restanțe în luna asta.
              </td>
            </tr>
          )
        }
        columns={[
          {
            key: 'objective',
            header: 'Obiectiv',
            cell: (row) => (
              <Link href={`/obiective/${row.objectiveId}`} className="hover:text-brand-700">
                {row.objectiveName}
              </Link>
            ),
          },
          {
            key: 'profile',
            header: 'Profil',
            hideBelow: 'md',
            cell: (row) =>
              row.profileName === null ? <Badge tone="neutral">fără profil</Badge> : <CellMeta>{row.profileName}</CellMeta>,
          },
          {
            key: 'checklist',
            header: 'Fișă',
            hideBelow: 'md',
            cell: (row) =>
              row.checklistName === null ? <Empty /> : <CellMeta>{row.checklistName}</CellMeta>,
          },
          {
            key: 'frequency',
            header: 'Frecvență',
            align: 'right',
            width: '8rem',
            cell: (row) =>
              row.frequencyMonths === null ? (
                <Empty />
              ) : (
                <CellMeta>{row.frequencyMonths} luni</CellMeta>
              ),
          },
          {
            key: 'state',
            header: 'Luna asta',
            width: '10rem',
            cell: (row) =>
              row.due === 0 ? (
                <CellMeta>nu e datorată</CellMeta>
              ) : row.done >= row.due ? (
                <Badge tone="success">făcută</Badge>
              ) : (
                <Badge tone="warning">restanță</Badge>
              ),
          },
        ]}
      />
    </section>
  );
}

/** Vederea „Plafoane”: unde lipsesc plafoanele, pe toate contractele. */
function CeilingsOverview({ rows }: { rows: readonly ContractRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Niciun contract pe firmele selectate"
        body="Plafoanele se setează pe componentele unui contract. Fără contracte, n-au pe ce sta."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-ink-muted">
        Plafoanele se setează pe componentele fiecărui contract, cu regula temporală proprie.
        Deschide contractul și mergi la <strong>Componente</strong>.
      </p>
      <Table
        caption="Contracte și plafoane"
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/contracte/${row.id}/componente`}
        empty={<EmptyState title="Nimic" body="Nimic de arătat." size="sm" />}
        columns={[
          { key: 'code', header: 'Cod', width: '7rem', cell: (row) => <span className="font-mono text-xs">{row.code}</span> },
          { key: 'client', header: 'Client', cell: (row) => <CellTitle>{row.clientName}</CellTitle> },
          { key: 'company', header: 'Firmă', hideBelow: 'md', cell: (row) => <CellMeta>{row.companyName}</CellMeta> },
          {
            key: 'monthly',
            header: 'Abonament lunar',
            align: 'right',
            width: '11rem',
            cell: (row) =>
              row.monthlyValue === null ? <Empty /> : <Money value={MoneyValue.fromDb(row.monthlyValue)} />,
          },
        ]}
      />
    </div>
  );
}

/** Vederea „Portofoliu”: contractele grupate pe anul contractual curent. */
function PortfolioByYear({ rows }: { rows: readonly ContractRow[] }) {
  const groups = new Map<string, ContractRow[]>();
  for (const row of rows) {
    const key =
      row.currentYearIndex === null
        ? 'în afara perioadei'
        : `anul ${String(row.currentYearIndex)} din ${String(row.yearCount)}`;
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [row]);
    } else {
      bucket.push(row);
    }
  }

  if (groups.size === 0) {
    return (
      <EmptyState
        title="Niciun contract pe firmele selectate"
        body="Portofoliul se citește pe anul contractual, nu pe cel calendaristic: un contract semnat în martie își face aniversarea în martie."
      />
    );
  }

  return (
    <div className="space-y-5">
      <p className="max-w-prose text-sm text-ink-muted">
        Gruparea e pe <strong>anul contractual</strong>, nu pe cel calendaristic. Un contract semnat
        în martie 2024 e în anul 3 abia din martie 2026 — iar indexarea îl urmează, nu invers.
      </p>
      {[...groups.entries()].map(([label, bucket]) => (
        <section key={label}>
          <h2 className="mb-2 text-base font-semibold capitalize">
            {label} <span className="text-ink-subtle">· {bucket.length}</span>
          </h2>
          <Table
            caption={`Contracte în ${label}`}
            rows={bucket}
            rowKey={(row) => row.id}
            rowHref={(row) => `/contracte/${row.id}`}
            rowFlagged={(row) => isUnindexed(row)}
            empty={<EmptyState title="Gol" body="Gol." size="sm" />}
            columns={[
              { key: 'code', header: 'Cod', width: '7rem', cell: (row) => <span className="font-mono text-xs">{row.code}</span> },
              { key: 'client', header: 'Client', cell: (row) => <CellTitle>{row.clientName}</CellTitle> },
              {
                key: 'indexation',
                header: 'Indexare',
                align: 'right',
                width: '8rem',
                cell: (row) =>
                  isUnindexed(row) ? (
                    <Badge tone="danger">0%</Badge>
                  ) : (
                    <CellMeta>{formatPercent(row.indexationPct)}</CellMeta>
                  ),
              },
              {
                key: 'monthly',
                header: 'Abonament lunar',
                align: 'right',
                width: '11rem',
                cell: (row) =>
                  row.monthlyValue === null ? (
                    <Empty />
                  ) : (
                    <Money value={MoneyValue.fromDb(row.monthlyValue)} />
                  ),
              },
              {
                key: 'ends',
                header: 'Se termină',
                width: '9rem',
                cell: (row) => <CellMeta>{formatDate(row.endsOn)}</CellMeta>,
              },
            ]}
          />
        </section>
      ))}
    </div>
  );
}
