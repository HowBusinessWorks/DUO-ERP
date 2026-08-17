import { canSeeFinancials } from '@damina/auth';
import {
  EXECUTOR_TYPE_LABELS,
  WORK_UNIT_STATUS_LABELS,
  WORK_UNIT_TYPE_LABELS,
} from '@damina/contracts';
import {
  getClosingChecklist,
  getStage,
  getStageOverview,
  getWorkUnit,
  listAllocations,
  listAssignments,
  listComponents,
  listContracts,
  listPeriodOptions,
  listPersonOptions,
  listReallocationDocuments,
  listStages,
  listStagesForCompanies,
  listSubcontractors,
  listObjectives,
  listWorkUnits,
  previewFundingMove,
  promotionCheckFor,
  type AllocationRow,
  type ReallocationDocumentRow,
  type StageWithWorkUnitRow,
  type WorkUnitRow,
} from '@damina/services';
import { Money as MoneyValue } from '@damina/shared';
import { Badge, CellMeta, CellTitle, EmptyState, Money, Stat } from '@damina/ui';
import Link from 'next/link';
import { AuditTrail } from '../components/detail/audit-trail';
import { PhasePlaceholder } from '../components/detail/phase-placeholder';
import { ClosingChecklist } from '../components/work-unit/closing-checklist';
import { FundingPanel, fundingSummary, monthLabel } from '../components/work-unit/funding-panel';
import { StageTimeline } from '../components/work-unit/stage-timeline';
import {
  CloseWorkUnitDialog,
  MoveFundingDialog,
  PromoteDialog,
  StageDialog,
} from '../components/work-unit/work-unit-dialogs';
import { defineEntity, type EntityContext } from './types';

/**
 * Activitatea: inspectii, interventii si lucrari — o SINGURA entitate cu trei
 * seturi de tab-uri, exact ca in model.
 *
 * Cuvantul „Unitate de Lucru" nu apare nicaieri pe ecran, dinadins. Pe ecran apar
 * tipurile concrete; „UL" e limbaj de arhitectura, si un utilizator care l-ar
 * citi ar trebui sa-l invete degeaba.
 *
 * Cele trei seturi de tab-uri se aleg din `visible(session, entity)`, nu prin
 * tab-uri gri: o inspectie **nu are** Deviz, deci Devizul lipseste din DOM. §30.5
 * cere exact asta — lipseste, nu e gri.
 */

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const formatDate = (value: string | null): string =>
  value === null ? '—' : dateFormat.format(new Date(`${value}T00:00:00`));

const TYPE_TONES: Readonly<Record<string, 'brand' | 'neutral' | 'outline'>> = {
  lucrare: 'brand',
  interventie: 'neutral',
  inspectie: 'outline',
};

const STATUS_TONES: Readonly<
  Record<string, 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'outline'>
> = {
  draft: 'outline',
  planificata: 'neutral',
  in_executie: 'brand',
  suspendata: 'warning',
  finalizata: 'success',
  inchisa: 'neutral',
  anulata: 'danger',
};

/** Sub-vederea listei care arata doar tipul asta. */
const TYPE_VIEWS: Readonly<Record<string, string>> = {
  inspectie: 'inspectii',
  interventie: 'interventii',
  lucrare: 'lucrari',
};

const typeLabel = (type: string): string => WORK_UNIT_TYPE_LABELS[type as 'lucrare'] ?? type;
const statusLabel = (status: string): string =>
  WORK_UNIT_STATUS_LABELS[status as 'draft'] ?? status;

/** Luna curenta a shell-ului, ca eticheta scurta. */
const contextMonth = (ctx: EntityContext): string =>
  `${String(ctx.app.month).padStart(2, '0')}/${String(ctx.app.year)}`;

// ── Vederea unificata ────────────────────────────────────────────────────────

export const activitate = defineEntity<WorkUnitRow>({
  slug: 'activitate',
  singular: 'Lucrare',
  plural: 'Activitate',
  icon: 'hammer',
  group: 'operational',
  usesPeriod: true,
  /*
   * Cine deschide o unitate de lucru atinge finantarea de la primul ecran: fara
   * ea, o interventie nici nu se poate crea. Deci dreptul e cel financiar, nu cel
   * de nomenclator.
   *
   * Un PM fara drept financiar vede lista si fisa — izolarea coloanelor de bani e
   * in baza, pe coloana — dar nu deschide unitati noi.
   */
  canWrite: canSeeFinancials,

  list: {
    load: (ctx, query) =>
      listWorkUnits(ctx.actor, {
        companyIds: ctx.app.selectedCompanyIds,
        query: query.query,
        ...(query.view === 'inspectii' ? { types: ['inspectie'] as const } : {}),
        ...(query.view === 'interventii' ? { types: ['interventie'] as const } : {}),
        ...(query.view === 'lucrari' ? { types: ['lucrare'] as const } : {}),
      }),
    rowKey: (row) => row.id,
    rowHref: (row) => `/activitate/${row.id}`,
    // Randul se evidentiaza cand e in executie: aia e coloana de lucruri care se
    // intampla ACUM, si ea e motivul pentru care cineva deschide ecranul.
    rowFlagged: (row) => row.status === 'in_executie',
    searchPlaceholder: 'Caută după cod sau denumire',
    notice:
      'Consumul se umple din registrul de cost (pasul 06). Până atunci coloana arată „—”, nu zero — un zero inventat s-ar citi ca o cifră reală.',
    views: [
      { key: '', label: 'Toată activitatea' },
      { key: 'inspectii', label: 'Inspecții' },
      { key: 'interventii', label: 'Intervenții' },
      { key: 'lucrari', label: 'Lucrări' },
      { key: 'calendar', label: 'Calendar / Gantt' },
      { key: 'pontaj', label: 'Pontaj' },
    ],
    renderView: async (rows, view, ctx) => {
      if (view === 'calendar') {
        return <GeneralGantt ctx={ctx} />;
      }
      if (view === 'pontaj') {
        return <PhasePlaceholder phase={1} what="Pontajul pe unitate de lucru" />;
      }
      // Cele trei vederi de tip folosesc ACELASI tabel: `load` a filtrat deja, iar
      // o a doua randare ar putea arata alt numar de randuri decat prima.
      return null;
    },
    empty: {
      title: 'Nicio activitate pe firmele selectate',
      body: 'Aici intră inspecțiile, intervențiile și lucrările. Toate trei se leagă la un obiectiv și se plătesc din câte o componentă de contract — finanțarea nu e un câmp pe ele, e un rând pe fiecare lună din care se plătesc.',
      actionLabel: 'Deschide prima',
    },
    columns: [
      {
        key: 'code',
        header: 'Cod',
        width: '7.5rem',
        cell: (row) => (
          <span data-numeric className="font-medium tabular-nums text-ink">
            {row.code}
          </span>
        ),
      },
      {
        key: 'type',
        header: 'Tip',
        width: '7rem',
        cell: (row) => <Badge tone={TYPE_TONES[row.type] ?? 'neutral'}>{typeLabel(row.type)}</Badge>,
      },
      {
        key: 'name',
        header: 'Denumire',
        cell: (row) => (
          <>
            <CellTitle>{row.name}</CellTitle>
            <CellMeta>
              {row.objectiveCode} · {row.objectiveName}
            </CellMeta>
          </>
        ),
      },
      {
        key: 'funding',
        header: 'Finanțare',
        hideBelow: 'md',
        cell: (row) =>
          row.fundingLabel === null ? (
            <span className="text-sm text-ink-subtle">nefinanțată</span>
          ) : (
            <span className="text-sm text-ink">
              {row.allocationCount > 1
                ? `${row.fundingLabel} ×${String(row.allocationCount)} luni`
                : row.fundingLabel}
            </span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        width: '8rem',
        cell: (row) => (
          <Badge tone={STATUS_TONES[row.status] ?? 'neutral'}>{statusLabel(row.status)}</Badge>
        ),
      },
      {
        key: 'value',
        header: 'Valoare',
        align: 'right',
        width: '8rem',
        hideBelow: 'md',
        cell: (row) =>
          row.estimatedValue === null ? (
            <span className="text-ink-subtle">—</span>
          ) : (
            <Money value={MoneyValue.fromDb(row.estimatedValue)} />
          ),
      },
      {
        key: 'consumed',
        header: 'Consumat',
        align: 'right',
        width: '7rem',
        hideBelow: 'lg',
        // Nu zero: „—”. Consumul nu se poate calcula pana la pasul 06, iar un zero
        // afisat ar fi o afirmatie despre bani pe care n-o putem susține.
        cell: () => <span className="text-ink-subtle">—</span>,
      },
      {
        key: 'responsible',
        header: 'Responsabil',
        hideBelow: 'lg',
        cell: (row) => (
          <span className="text-sm text-ink-muted">
            {row.responsibleName ?? 'neatribuit'}
            {row.executorType === 'subcontractant' && row.subcontractorName !== null
              ? ` · ${row.subcontractorName}`
              : ''}
          </span>
        ),
      },
    ],
  },

  form: {
    schemaKey: 'activitate',
    loadLookups: async (ctx) => {
      const [contracts, persons, subcontractors, periods] = await Promise.all([
        listContracts(ctx.actor, { companyIds: ctx.app.selectedCompanyIds }),
        listPersonOptions(ctx.actor),
        listSubcontractors(ctx.actor, {}),
        listPeriodOptions(ctx.actor, { companyIds: ctx.app.selectedCompanyIds }),
      ]);

      const componentGroups = await Promise.all(
        contracts.map((contract) => listComponents(ctx.actor, contract.id)),
      );

      return {
        companies: ctx.app.companies.map((company) => ({
          value: company.id,
          label: company.name,
        })),
        types: Object.entries(WORK_UNIT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
        executors: Object.entries(EXECUTOR_TYPE_LABELS).map(([value, label]) => ({ value, label })),
        objectives: await objectiveOptions(ctx),
        persons: persons.map((person) => ({ value: person.id, label: person.fullName })),
        subcontractors: subcontractors.map((row) => ({ value: row.id, label: row.name })),
        contracts: contracts.map((contract) => ({
          value: contract.id,
          label: `${contract.code} · ${contract.clientName}`,
        })),
        components: componentGroups.flat().map((component) => ({
          value: component.id,
          label: component.name,
        })),
        // Doar lunile DESCHISE. Numele firmei intra in eticheta doar cand sunt mai
        // multe selectate, altfel repeta acelasi cuvant pe fiecare rand.
        periods: periods.map((period) => ({
          value: period.id,
          label:
            ctx.app.selectedCompanyIds.length > 1
              ? `${monthLabel(period.year, period.month)} · ${
                  ctx.app.companies.find((company) => company.id === period.companyId)?.name ?? ''
                }`
              : monthLabel(period.year, period.month),
        })),
      };
    },
    fields: (lookups) => [
      { name: 'companyId', label: 'Firma', control: 'select', required: true, options: lookups.companies },
      { name: 'type', label: 'Tip', control: 'select', required: true, options: lookups.types },
      {
        name: 'name',
        label: 'Denumire',
        control: 'text',
        required: true,
        full: true,
        placeholder: 'ex. Înlocuire pompă SP-14',
      },
      {
        name: 'objectiveId',
        label: 'Obiectiv',
        control: 'select',
        required: true,
        options: lookups.objectives,
        hint: 'Unde se întâmplă fizic munca. Nu se mai schimbă la mutarea finanțării.',
      },
      {
        name: 'series',
        label: 'Serie de numerotare',
        control: 'text',
        required: true,
        placeholder: 'L',
        hint: 'Codul se alocă fără goluri, din seria firmei. Fiecare tip are seria lui.',
      },
      {
        name: 'responsiblePersonId',
        label: 'Responsabil',
        control: 'select',
        options: lookups.persons,
      },
      {
        name: 'executorType',
        label: 'Executant',
        control: 'select',
        required: true,
        options: lookups.executors,
      },
      {
        name: 'executorSubcontractorId',
        label: 'Subcontractant',
        control: 'select',
        options: lookups.subcontractors,
        hint: 'Se completează doar când execută un subcontractant.',
      },
      { name: 'startsOn', label: 'Început', control: 'date' },
      { name: 'endsOn', label: 'Sfârșit', control: 'date' },
      { name: 'estimatedValue', label: 'Valoare estimată', control: 'text', suffix: 'lei' },
      { name: 'costBudget', label: 'Buget de cost', control: 'text', suffix: 'lei' },
      {
        name: 'fundingContractId',
        label: 'Se plătește din contractul',
        control: 'select',
        options: lookups.contracts,
        hint: 'Cele patru câmpuri de finanțare merg împreună: ori toate, ori niciunul.',
      },
      {
        name: 'fundingComponentId',
        label: 'Componenta',
        control: 'select',
        options: lookups.components,
      },
      {
        name: 'fundingPeriodId',
        label: 'Luna',
        control: 'select',
        options: lookups.periods,
        hint: 'Doar luni deschise. Restul lunilor se adaugă din tab-ul Finanțare.',
      },
      { name: 'fundingAmount', label: 'Sumă alocată', control: 'text', suffix: 'lei' },
    ],
    toFormValues: (row) => ({
      companyId: row.companyId,
      type: row.type,
      name: row.name,
      objectiveId: row.objectiveId,
      responsiblePersonId: row.responsiblePersonId ?? '',
      executorType: row.executorType,
      executorSubcontractorId: row.executorSubcontractorId ?? '',
      startsOn: row.startsOn ?? '',
      endsOn: row.endsOn ?? '',
      estimatedValue: row.estimatedValue ?? '',
      costBudget: row.costBudget ?? '',
      series: '',
      fundingContractId: '',
      fundingComponentId: '',
      fundingPeriodId: '',
      fundingAmount: '',
    }),
    blank: {
      companyId: '',
      type: 'lucrare',
      name: '',
      objectiveId: '',
      responsiblePersonId: '',
      executorType: 'echipa_proprie',
      executorSubcontractorId: '',
      startsOn: '',
      endsOn: '',
      estimatedValue: '',
      costBudget: '',
      series: '',
      fundingContractId: '',
      fundingComponentId: '',
      fundingPeriodId: '',
      fundingAmount: '',
    },
    createTitle: 'Deschide inspecție, intervenție sau lucrare',
    editTitle: 'Modifică',
    // Codul si finantarea nu se editeaza de aici: codul e alocat o data din serie,
    // iar finantarea se MUTA, cu motiv scris, din ecranul ei.
    editable: false,
  },

  detail: {
    load: async (ctx, id) => {
      try {
        return await getWorkUnit(ctx.actor, id);
      } catch {
        return null;
      }
    },

    header: async (row, ctx) => {
      const overview = row.type === 'lucrare' ? await getStageOverview(ctx.actor, row.id) : null;

      return {
        title: `${row.code} · ${row.name}`,
        breadcrumb: [
          { label: 'Activitate', href: '/activitate' },
          { label: typeLabel(row.type), href: `/activitate?view=${TYPE_VIEWS[row.type] ?? ''}` },
          { label: row.code },
        ],
        badges: [
          { label: typeLabel(row.type), tone: TYPE_TONES[row.type] ?? 'neutral' },
          { label: statusLabel(row.status), tone: STATUS_TONES[row.status] ?? 'neutral' },
          ...(row.executorType === 'subcontractant'
            ? [{ label: row.subcontractorName ?? 'Subcontractant', tone: 'outline' as const }]
            : []),
        ],
        meta: [
          {
            label: 'Obiectiv',
            value: (
              <Link href={`/obiective/${row.objectiveId}`} className="text-brand-700 hover:underline">
                {row.objectiveCode} · {row.objectiveName}
              </Link>
            ),
          },
          { label: 'Finanțare', value: row.fundingLabel ?? 'nefinanțată' },
          { label: 'Perioadă', value: `${formatDate(row.startsOn)} → ${formatDate(row.endsOn)}` },
          { label: 'Responsabil', value: row.responsibleName ?? 'neatribuit' },
        ],
        /*
         * CELE DOUA BARE, una langa alta (§3.4). Divergenta dintre ele e semnalul
         * de risc: 30% executat cu 80% consumat inseamna ca lucrarea o sa depaseasca.
         *
         * A doua bara e zero pana la pasul 06 si SPUNE de ce. Un zero fara
         * explicatie s-ar citi ca „n-am cheltuit nimic", care e altceva decat „nu
         * se poate calcula inca”.
         */
        progress:
          overview === null
            ? undefined
            : [
                {
                  label: 'Progres fizic',
                  value: overview.progress.percent,
                  tone: 'brand',
                  detail: overview.progress.weighted
                    ? `${String(overview.progress.completedStages)} din ${String(overview.progress.totalStages)} etape, ponderat`
                    : `${String(overview.progress.completedStages)} din ${String(overview.progress.totalStages)} etape`,
                },
                {
                  label: 'Consum financiar',
                  value: 0,
                  detail: 'registrul de cost intră în pasul 06',
                },
              ],
      };
    },

    tabs: [
      // ── Tab-ul implicit: Fisa (inspectie/interventie) sau Prezentare (lucrare) ──
      {
        slug: '',
        label: 'Prezentare',
        render: async (row, ctx) => <Overview row={row} ctx={ctx} />,
      },

      // ── Doar pe lucrari ────────────────────────────────────────────────────
      {
        slug: 'deviz',
        label: 'Deviz',
        visible: (_session, row) => row.type === 'lucrare',
        render: () => <PhasePlaceholder phase={2} what="Devizul lucrării, cu pachete și articole" />,
      },
      {
        slug: 'etape',
        label: 'Etape',
        visible: (_session, row) => row.type === 'lucrare',
        render: async (row, ctx, sub) => <StagesTab row={row} ctx={ctx} sub={sub} />,
      },
      {
        slug: 'jurnal',
        label: 'Jurnal',
        visible: (_session, row) => row.type === 'lucrare',
        render: () => <PhasePlaceholder phase={1} what="Jurnalul de șantier" />,
      },

      // ── Doar pe inspectii ──────────────────────────────────────────────────
      {
        slug: 'constatari',
        label: 'Constatări',
        visible: (_session, row) => row.type === 'inspectie',
        render: () => (
          <PhasePlaceholder phase={1} what="Constatările inspecției, pe punctele fișei" />
        ),
      },

      // ── Comune executiei ───────────────────────────────────────────────────
      {
        slug: 'materiale',
        label: 'Materiale',
        visible: (_session, row) => row.type !== 'inspectie',
        render: () => <PhasePlaceholder phase={3} what="Consumurile de material" />,
      },
      {
        slug: 'manopera',
        label: 'Manoperă',
        visible: (_session, row) => row.type !== 'inspectie',
        render: () => <PhasePlaceholder phase={1} what="Orele pontate pe unitate" />,
      },
      {
        slug: 'subcontractanti',
        label: 'Subcontractanți',
        visible: (_session, row) => row.type === 'lucrare',
        render: () => <PhasePlaceholder phase={2} what="Pachetele date în subcontractare" />,
      },
      {
        slug: 'situatii',
        label: 'Situații',
        visible: (_session, row) => row.type === 'lucrare',
        render: () => <PhasePlaceholder phase={2} what="Situațiile de lucrări" />,
      },

      // ── Finantarea: doar cine vede bani ────────────────────────────────────
      {
        slug: 'finantare',
        label: 'Finanțare',
        visible: (session) => canSeeFinancials(session),
        count: (row) => (row.allocationCount === 0 ? undefined : row.allocationCount),
        render: async (row, ctx) => <FundingTab row={row} ctx={ctx} />,
      },
      {
        slug: 'costuri',
        label: 'Costuri',
        visible: (session) => canSeeFinancials(session),
        render: () => (
          <PhasePlaceholder phase={1} what="Registrul de cost al unității (pasul 06)" />
        ),
      },

      // ── Documente si inchidere ─────────────────────────────────────────────
      {
        slug: 'poze',
        label: 'Poze',
        visible: (_session, row) => row.type !== 'lucrare',
        render: () => <PhasePlaceholder phase={1} what="Pozele de pe teren, cu geo și dată" />,
      },
      {
        slug: 'documente',
        label: 'Documente',
        render: () => <PhasePlaceholder phase={1} what="Folderul unității din arborele de fișiere" />,
      },
      {
        slug: 'pv',
        label: 'PV-uri',
        visible: (_session, row) => row.type === 'lucrare',
        render: () => <PhasePlaceholder phase={2} what="Procesele-verbale de recepție" />,
      },
      {
        slug: 'inchidere',
        label: 'Închidere',
        render: async (row, ctx) => <ClosingTab row={row} ctx={ctx} />,
      },
      {
        slug: 'istoric',
        label: 'Istoric',
        render: (row, ctx) => <AuditTrail ctx={ctx} tableName="app.work_units" recordId={row.id} />,
      },
    ],

    links: async (row, ctx) => {
      const [allocations, assignments, stages] = await Promise.all([
        canSeeFinancials(ctx.session)
          ? listAllocations(ctx.actor, row.id)
          : Promise.resolve([] as AllocationRow[]),
        listAssignments(ctx.actor, row.id),
        row.type === 'lucrare' ? listStages(ctx.actor, row.id) : Promise.resolve([]),
      ]);

      const contracts = new Map(
        allocations
          .filter((allocation) => allocation.status === 'active')
          .map((allocation) => [allocation.contractId, allocation.contractCode]),
      );

      return [
        {
          kind: 'up',
          title: 'Unde se întâmplă',
          items: [
            {
              label: `${row.objectiveCode} · ${row.objectiveName}`,
              href: `/obiective/${row.objectiveId}`,
              meta: 'obiectiv',
            },
          ],
        },
        {
          kind: 'up',
          title: 'Cine plătește',
          count: contracts.size,
          items:
            contracts.size === 0
              ? [
                  {
                    label: 'Nefinanțată',
                    href: `/activitate/${row.id}/finantare`,
                    meta: 'alocă finanțare',
                    tone: 'warning',
                  },
                ]
              : [...contracts].map(([contractId, code]) => ({
                  label: `Contract ${code}`,
                  href: `/contracte/${contractId}`,
                  meta: 'contract',
                })),
        },
        /*
         * Grupul de etape apare DOAR pe lucrari.
         *
         * Prima versiune il randa pe toate tipurile, gol pe inspectii — si un grup
         * „Etape (0)" pe o inspectie nu e o absenta, e o afirmatie falsa: sugereaza
         * ca inspectiile au etape, doar ca asta n-are. Prins la verificarea pe
         * ecrane, nu la typecheck.
         */
        ...(row.type === 'lucrare'
          ? [
              {
                kind: 'related' as const,
                title: 'Etape',
                count: stages.length,
                items: stages.slice(0, 6).map((stage) => ({
                  label: `${String(stage.position)}. ${stage.name}`,
                  href: `/etape/${stage.id}`,
                  meta: stage.actualEnd === null ? 'în lucru' : 'încheiată',
                  tone: (stage.actualEnd === null ? 'neutral' : 'success') as 'neutral' | 'success',
                })),
              },
            ]
          : []),
        {
          kind: 'related',
          title: 'Echipa',
          count: assignments.length,
          items: assignments.map((assignment) => ({
            label: assignment.personName,
            href: `/administrare/${assignment.personId}`,
            meta: assignment.role.replace('_', ' '),
          })),
        },
      ];
    },

    quickActions: (row, ctx) => {
      const promotion = promotionCheckFor({ type: row.type, status: row.status });
      const closed = row.status === 'inchisa' || row.status === 'anulata';

      return [
        ...(promotion.allowed
          ? [{ label: 'Promovează în lucrare', href: `/activitate/${row.id}`, tone: 'primary' as const }]
          : []),
        ...(canSeeFinancials(ctx.session)
          ? [{ label: 'Mută finanțarea', href: `/activitate/${row.id}/finantare` }]
          : []),
        ...(row.type === 'lucrare'
          ? [{ label: 'Etape', href: `/activitate/${row.id}/etape` }]
          : []),
        {
          label: closed ? 'Închisă' : 'Închide unitatea',
          href: `/activitate/${row.id}/inchidere`,
          ...(closed ? { disabledReason: 'Unitatea e deja închisă sau anulată.' } : {}),
        },
      ];
    },
  },
});

// ── Etapa: aceeasi pagina fractala, un nivel mai jos (verificarea #11) ───────

export const etape = defineEntity<StageWithWorkUnitRow>({
  slug: 'etape',
  singular: 'Etapă',
  plural: 'Etape',
  icon: 'hammer',
  group: 'operational',
  usesPeriod: false,

  list: {
    load: (ctx) =>
      listStagesForCompanies(ctx.actor, { companyIds: ctx.app.selectedCompanyIds }),
    rowKey: (row) => row.id,
    rowHref: (row) => `/etape/${row.id}`,
    rowFlagged: (row) => row.actualStart !== null && row.actualEnd === null,
    searchPlaceholder: 'Caută în etape',
    notice:
      'Etapele tuturor lucrărilor active, în ordinea lor. Fiecare are pagina ei — aceeași pagină ca lucrarea, un nivel mai jos.',
    empty: {
      title: 'Nicio etapă',
      body: 'Etapele apar pe lucrări, din tab-ul Etape. Ele taie lucrarea în bucăți cu grafic și buget propriu.',
    },
    columns: [
      {
        key: 'workUnit',
        header: 'Lucrare',
        width: '10rem',
        cell: (row) => (
          <span data-numeric className="font-medium tabular-nums text-ink">
            {row.workUnitCode}
          </span>
        ),
      },
      {
        key: 'name',
        header: 'Etapă',
        cell: (row) => (
          <>
            <CellTitle>
              {row.position}. {row.name}
            </CellTitle>
            <CellMeta>{row.workUnitName}</CellMeta>
          </>
        ),
      },
      {
        key: 'planned',
        header: 'Planificat',
        hideBelow: 'md',
        cell: (row) => (
          <span data-numeric className="text-sm tabular-nums text-ink-muted">
            {formatDate(row.plannedStart)} → {formatDate(row.plannedEnd)}
          </span>
        ),
      },
      {
        key: 'state',
        header: 'Stare',
        width: '9rem',
        cell: (row) =>
          row.actualEnd !== null ? (
            <Badge tone="success">Încheiată</Badge>
          ) : row.actualStart !== null ? (
            <Badge tone="brand">În lucru</Badge>
          ) : (
            <Badge tone="outline">Neîncepută</Badge>
          ),
      },
    ],
  },

  detail: {
    load: (ctx, id) => getStage(ctx.actor, id),

    header: (stage) => ({
      title: `${String(stage.position)}. ${stage.name}`,
      breadcrumb: [
        { label: 'Activitate', href: '/activitate' },
        { label: stage.workUnitCode, href: `/activitate/${stage.workUnitId}` },
        { label: 'Etape', href: `/activitate/${stage.workUnitId}/etape` },
        { label: `Etapa ${String(stage.position)}` },
      ],
      badges: [
        stage.actualEnd !== null
          ? { label: 'Încheiată', tone: 'success' as const }
          : stage.actualStart !== null
            ? { label: 'În lucru', tone: 'brand' as const }
            : { label: 'Neîncepută', tone: 'outline' as const },
      ],
      meta: [
        {
          label: 'Lucrarea',
          value: (
            <Link
              href={`/activitate/${stage.workUnitId}`}
              className="text-brand-700 hover:underline"
            >
              {stage.workUnitCode} · {stage.workUnitName}
            </Link>
          ),
        },
        { label: 'Obiectiv', value: stage.objectiveName },
        {
          label: 'Planificat',
          value: `${formatDate(stage.plannedStart)} → ${formatDate(stage.plannedEnd)}`,
        },
        {
          label: 'Realizat',
          value: `${formatDate(stage.actualStart)} → ${formatDate(stage.actualEnd)}`,
        },
      ],
    }),

    tabs: [
      {
        slug: '',
        label: 'Prezentare',
        render: (stage, ctx) => (
          <div className="space-y-4">
            <p className="max-w-prose text-sm text-ink-muted">
              Etapa are pagina ei, cu aceleași tab-uri ca lucrarea — aceeași pagină fractală, un
              nivel mai jos. Cine a învățat lucrarea a învățat și etapa.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat
                label="Cât cântărește"
                value={
                  stage.pctOfWork === null
                    ? '—'
                    : `${(Number(stage.pctOfWork) * 100).toFixed(0)}%`
                }
                context={
                  stage.pctOfWork === null
                    ? 'fără pondere: progresul se numără pe etape'
                    : 'din lucrare, la progresul fizic'
                }
              />
              {canSeeFinancials(ctx.session) ? (
                <>
                  <Stat
                    label="Buget material"
                    value={
                      stage.materialBudget === null ? (
                        '—'
                      ) : (
                        <Money value={MoneyValue.fromDb(stage.materialBudget)} />
                      )
                    }
                    context="plan, nu consum"
                  />
                  <Stat
                    label="Buget manoperă"
                    value={
                      stage.laborBudget === null ? (
                        '—'
                      ) : (
                        <Money value={MoneyValue.fromDb(stage.laborBudget)} />
                      )
                    }
                    context="plan, nu consum"
                  />
                </>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        slug: 'materiale',
        label: 'Materiale',
        render: () => <PhasePlaceholder phase={3} what="Consumurile de material ale etapei" />,
      },
      {
        slug: 'manopera',
        label: 'Manoperă',
        render: () => <PhasePlaceholder phase={1} what="Orele pontate pe etapă" />,
      },
      {
        slug: 'costuri',
        label: 'Costuri',
        visible: (session) => canSeeFinancials(session),
        render: () => <PhasePlaceholder phase={1} what="Costurile etapei (pasul 06)" />,
      },
      {
        slug: 'istoric',
        label: 'Istoric',
        render: (stage, ctx) => <AuditTrail ctx={ctx} tableName="app.work_stages" recordId={stage.id} />,
      },
    ],

    links: (stage) =>
      Promise.resolve([
        {
          kind: 'up' as const,
          title: 'Lucrarea',
          items: [
            {
              label: `${stage.workUnitCode} · ${stage.workUnitName}`,
              href: `/activitate/${stage.workUnitId}`,
              meta: 'lucrare',
            },
          ],
        },
        {
          kind: 'related' as const,
          title: 'Graficul lucrării',
          items: [
            {
              label: 'Toate etapele',
              href: `/activitate/${stage.workUnitId}/etape`,
              meta: 'Gantt',
            },
          ],
        },
      ]),

    quickActions: (stage) => [
      { label: 'Înapoi la lucrare', href: `/activitate/${stage.workUnitId}/etape`, tone: 'primary' },
    ],
  },
});

// ── Bani › Re-alocarile lunii (verificarea #15) ──────────────────────────────

export const bani = defineEntity<ReallocationDocumentRow>({
  slug: 'bani',
  singular: 'Re-alocare',
  plural: 'Bani',
  icon: 'banknote',
  group: 'operational',
  usesPeriod: true,
  canRead: canSeeFinancials,
  readDeniedReason:
    'Ecranele de bani arată valori comerciale — venituri, plafoane, re-alocări. Rolul tău nu le deschide.',

  list: {
    load: (ctx, query) =>
      query.view === '' || query.view === undefined
        ? listReallocationDocuments(ctx.actor, { companyIds: ctx.app.selectedCompanyIds })
        : Promise.resolve([]),
    rowKey: (row) => row.id,
    rowHref: (row) => `/activitate/${row.workUnitId}/finantare`,
    searchPlaceholder: 'Caută în re-alocări',
    notice:
      'Dacă lista e lungă în fiecare lună, decizia inițială de rutare se ia prost — și asta e o problemă de proces, nu de software. De aceea ecranul nu o scurtează.',
    views: [
      { key: '', label: 'Re-alocările lunii' },
      { key: 'facturare', label: 'Facturare emisă' },
      { key: 'situatii', label: 'Situații de lucrări' },
      { key: 'marja', label: 'Marjă și plafoane' },
      { key: 'inchidere', label: 'Închidere de perioadă' },
    ],
    renderView: (_rows, view) => {
      const what: Readonly<Record<string, string>> = {
        facturare: 'Facturarea emisă și e-Factura',
        situatii: 'Situațiile de lucrări',
        marja: 'Marja și gradul de plafon',
        inchidere: 'Închiderea de perioadă',
      };
      return <PhasePlaceholder phase={2} what={what[view] ?? 'Ecranul'} />;
    },
    empty: {
      title: 'Nicio re-alocare',
      body: 'Documentele de re-alocare apar când finanțarea se mută dintr-o lună deja închisă: luna raportată nu se rescrie, așa că mișcarea se înregistrează în luna curentă, cu ambele capete vizibile.',
    },
    columns: [
      {
        key: 'number',
        header: 'Număr',
        width: '9rem',
        cell: (row) => (
          <span data-numeric className="font-medium tabular-nums text-ink">
            {row.number}
          </span>
        ),
      },
      {
        key: 'workUnit',
        header: 'Unitatea',
        cell: (row) => (
          <>
            <CellTitle>{row.workUnitName}</CellTitle>
            <CellMeta>{row.workUnitCode}</CellMeta>
          </>
        ),
      },
      {
        key: 'from',
        header: 'De la',
        cell: (row) => <span className="text-sm text-ink">{row.fromComponentName}</span>,
      },
      {
        key: 'to',
        header: 'La',
        cell: (row) => <span className="text-sm text-ink">{row.toComponentName}</span>,
      },
      {
        key: 'amount',
        header: 'Valoare',
        align: 'right',
        width: '8rem',
        cell: (row) => <Money value={MoneyValue.fromDb(row.amount)} />,
      },
      {
        key: 'who',
        header: 'Cine a decis',
        hideBelow: 'md',
        cell: (row) => (
          <span className="text-sm text-ink-muted">{row.createdByName ?? 'necunoscut'}</span>
        ),
      },
      {
        key: 'why',
        header: 'De ce',
        hideBelow: 'lg',
        cell: (row) => (
          <span className="block max-w-[18rem] truncate text-sm text-ink-muted" title={row.reason}>
            {row.reason}
          </span>
        ),
      },
    ],
  },
});

// ── Bucatile de ecran ────────────────────────────────────────────────────────

async function objectiveOptions(
  ctx: EntityContext,
): Promise<readonly { value: string; label: string }[]> {
  const rows = await listObjectives(ctx.actor, {});
  return rows.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }));
}

/** Prezentarea: cele doua bare sunt in antet, aici stau cifrele si finantarea. */
async function Overview({ row, ctx }: { readonly row: WorkUnitRow; readonly ctx: EntityContext }) {
  const [allocations, assignments, overview] = await Promise.all([
    canSeeFinancials(ctx.session)
      ? listAllocations(ctx.actor, row.id)
      : Promise.resolve([] as AllocationRow[]),
    listAssignments(ctx.actor, row.id),
    row.type === 'lucrare' ? getStageOverview(ctx.actor, row.id) : Promise.resolve(null),
  ]);

  const promotion = promotionCheckFor({ type: row.type, status: row.status });

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {canSeeFinancials(ctx.session) ? (
          <Stat
            label="Valoare estimată"
            value={
              row.estimatedValue === null ? (
                '—'
              ) : (
                <Money value={MoneyValue.fromDb(row.estimatedValue)} />
              )
            }
            context={
              row.allocationCount === 0
                ? 'nefinanțată încă'
                : `finanțare: ${fundingSummary(allocations) ?? '—'}`
            }
            href={`/activitate/${row.id}/finantare`}
          />
        ) : null}

        <Stat
          label="Consumat"
          value="—"
          context="registrul de cost intră în pasul 06"
          tone="neutral"
        />

        {overview === null ? null : (
          <Stat
            label="Etape încheiate"
            value={`${String(overview.progress.completedStages)}/${String(overview.progress.totalStages)}`}
            context={
              overview.progress.weighted
                ? 'progresul e ponderat cu cât cântărește fiecare'
                : 'fără ponderi: progresul se numără pe etape'
            }
            href={`/activitate/${row.id}/etape`}
          />
        )}

        <Stat
          label="Echipa"
          value={String(assignments.length)}
          context={
            assignments.length === 0
              ? 'nimeni asignat: SSM se verifică la asignare'
              : 'persoane asignate, cu SSM valabil'
          }
        />
      </div>

      {overview !== null && !overview.schedule.coherent ? (
        <section className="rounded-md border border-warning-200 bg-warning-50 p-3">
          <h3 className="text-sm font-semibold text-warning-800">Graficul etapelor nu se leagă</h3>
          <ul className="mt-1.5 space-y-1 text-sm text-warning-900">
            {overview.schedule.problems.map((problem) => (
              <li key={`${problem.code}-${String(problem.position ?? 0)}`}>{problem.detail}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {promotion.allowed && canSeeFinancials(ctx.session) ? (
        <section className="rounded-md border border-line bg-surface-muted p-4">
          <h3 className="text-sm font-semibold text-ink">S-a dovedit mai mare decât părea?</h3>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            Promovarea în lucrare păstrează identitatea: același cod, aceleași poze, aceleași ore,
            aceeași finanțare. Se adaugă doar structura de lucrare.
          </p>
          <div className="mt-3">
            <PromoteDialog
              workUnitId={row.id}
              code={row.code}
              preserves={promotion.preserves}
              adds={promotion.adds}
            />
          </div>
        </section>
      ) : null}

      {canSeeFinancials(ctx.session) ? (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">Din ce se plătește</h3>
          <FundingPanel allocations={allocations} />
        </section>
      ) : null}
    </div>
  );
}

/** Tab-ul Etape: lista + Gantt, si pagina unei etape prin `sub` — sau prin `/etape`. */
async function StagesTab({
  row,
  ctx,
  sub,
}: {
  readonly row: WorkUnitRow;
  readonly ctx: EntityContext;
  readonly sub: readonly string[];
}) {
  const stages = await listStages(ctx.actor, row.id);

  // `/activitate/{id}/etape/{stageId}` duce la pagina proprie a etapei, ca sa nu
  // existe doua adrese pentru acelasi ecran.
  const stageId = sub[0];
  if (stageId !== undefined) {
    return (
      <EmptyState
        title="Etapa are pagina ei"
        body="Deschide-o din listă: are propriile tab-uri, prin aceeași pagină fractală."
        size="sm"
      />
    );
  }

  const closed = row.status === 'inchisa' || row.status === 'anulata';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-muted">
          Etapele taie lucrarea în bucăți cu grafic și buget propriu. Au voie să se suprapună în
          timp — pe șantier chiar se suprapun.
        </p>
        <StageDialog
          workUnitId={row.id}
          nextPosition={stages.length + 1}
          {...(closed ? { blockedReason: 'Unitatea e închisă sau anulată.' } : {})}
        />
      </div>

      <StageTimeline
        stages={stages.map((stage) => ({
          id: stage.id,
          position: stage.position,
          name: stage.name,
          plannedStart: stage.plannedStart,
          plannedEnd: stage.plannedEnd,
          actualStart: stage.actualStart,
          actualEnd: stage.actualEnd,
          href: `/etape/${stage.id}`,
        }))}
      />
    </div>
  );
}

/** Tab-ul Finantare: alocarile, cu butonul de mutare pe fiecare. */
async function FundingTab({
  row,
  ctx,
}: {
  readonly row: WorkUnitRow;
  readonly ctx: EntityContext;
}) {
  const allocations = await listAllocations(ctx.actor, row.id);
  const active = allocations.filter((allocation) => allocation.status === 'active');

  const [contracts, previews] = await Promise.all([
    listContracts(ctx.actor, { companyIds: [row.companyId] }),
    Promise.all(active.map((allocation) => previewFundingMove(ctx.actor, allocation.id))),
  ]);

  const componentGroups = await Promise.all(
    contracts.map((contract) => listComponents(ctx.actor, contract.id)),
  );

  const contractOptions = contracts.map((contract) => ({
    value: contract.id,
    label: `${contract.code} · ${contract.clientName}`,
  }));
  const componentOptions = componentGroups.flat().map((component) => ({
    value: component.id,
    label: component.name,
  }));

  // Doar luni DESCHISE: o luna inchisa nu poate primi finantare mutata, iar un
  // `select` care ar oferi-o ar promite ceva ce baza refuza.
  const periodOptions = active
    .map((allocation) => allocation)
    .reduce<{ value: string; label: string }[]>((acc, allocation) => {
      if (allocation.periodStatus === 'open' && !acc.some((o) => o.value === allocation.periodId)) {
        acc.push({
          value: allocation.periodId,
          label: monthLabel(allocation.periodYear, allocation.periodMonth),
        });
      }
      return acc;
    }, []);

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-ink-muted">
        Finanțarea nu e un câmp pe unitate: e un rând pe fiecare componentă și lună din care se
        plătește. De aceea o lucrare mare poate fi tăiată pe trei luni de Delta, iar mutarea lasă
        urmă în loc să rescrie.
      </p>

      <FundingPanel
        allocations={allocations}
        actions={(allocation) => {
          const preview = previews[active.findIndex((row2) => row2.id === allocation.id)];
          if (preview === undefined) {
            return null;
          }
          return (
            <MoveFundingDialog
              workUnitId={row.id}
              allocationId={allocation.id}
              code={row.code}
              fromLabel={`${allocation.componentName} · ${monthLabel(allocation.periodYear, allocation.periodMonth)}`}
              amountLabel={
                allocation.allocatedAmount === null
                  ? `${(Number(allocation.allocatedPct) * 100).toFixed(2)}%`
                  : `${allocation.allocatedAmount} lei`
              }
              periodIsClosed={preview.periodIsClosed}
              currentPeriodLabel={preview.currentPeriodLabel}
              contractOptions={contractOptions}
              componentOptions={componentOptions}
              periodOptions={
                periodOptions.length > 0
                  ? periodOptions
                  : [{ value: allocation.periodId, label: 'luna curentă' }]
              }
              defaultContractId={allocation.contractId}
            />
          );
        }}
      />

      <p className="text-xs text-ink-subtle">
        Luna din shell: {contextMonth(ctx)}. Documentul de re-alocare se emite mereu în luna
        curentă, nu în cea din care se mută.
      </p>
    </div>
  );
}

/** Tab-ul Inchidere: checklist blocant. */
async function ClosingTab({
  row,
  ctx,
}: {
  readonly row: WorkUnitRow;
  readonly ctx: EntityContext;
}) {
  const checklist = await getClosingChecklist(ctx.actor, row.id);

  return (
    <ClosingChecklist
      checklist={checklist}
      action={
        <CloseWorkUnitDialog
          workUnitId={row.id}
          code={row.code}
          {...(checklist.canClose
            ? {}
            : { blockedReason: 'Rezolvă mai întâi rândurile care blochează.' })}
        />
      }
    />
  );
}

/** Calendarul general: toate lucrarile active, cu etapele lor (§3.4). */
async function GeneralGantt({ ctx }: { readonly ctx: EntityContext }) {
  const stages = await listStagesForCompanies(ctx.actor, {
    companyIds: ctx.app.selectedCompanyIds,
  });

  if (stages.length === 0) {
    return (
      <EmptyState
        title="Nicio etapă pe firmele selectate"
        body="Calendarul arată lucrările active cu etapele lor. Apare pe măsură ce lucrările capătă etape cu date planificate."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-ink-muted">
        Toate lucrările active, pe o axă de timp comună. Datele se citesc ca text, nu doar din
        poziția barei — raportul de lună are nevoie de ziua exactă.
      </p>
      <StageTimeline
        stages={stages.map((stage) => ({
          id: stage.id,
          position: stage.position,
          name: stage.name,
          plannedStart: stage.plannedStart,
          plannedEnd: stage.plannedEnd,
          actualStart: stage.actualStart,
          actualEnd: stage.actualEnd,
          href: `/etape/${stage.id}`,
          groupLabel: `${stage.workUnitCode} · ${stage.workUnitName}`,
        }))}
      />
    </div>
  );
}
