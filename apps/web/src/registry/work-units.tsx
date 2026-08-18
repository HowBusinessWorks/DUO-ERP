import { canSeeFinancials, canValidateSheets, canWriteSheets } from '@damina/auth';
import {
  EXECUTOR_TYPE_LABELS,
  FINDING_OUTCOME_LABELS,
  WORK_UNIT_STATUS_LABELS,
  WORK_UNIT_TYPE_LABELS,
} from '@damina/contracts';
import {
  describeInspectionBlocker,
  folderForEntity,
  getClosingChecklist,
  getInspectionSheet,
  getInterventionSheet,
  getStage,
  getStageOverview,
  getWorkUnit,
  listAllocations,
  listAssignments,
  listChildren,
  listComponentsForContracts,
  listConsumptionNotes,
  listContracts,
  listDocumentSeries,
  listInterventionHours,
  listInterventionMaterials,
  listPeriodOptions,
  listOperations,
  listPersonOptions,
  listReallocationDocuments,
  listStages,
  listStagesForCompanies,
  listStock,
  listTimesheetWeek,
  listUnvalidatedInspections,
  listUnvalidatedInterventions,
  listSubcontractors,
  listTeamOptions,
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
import { CostTab } from '../components/cost/cost-tab';
import { MarginScreen, ReconciliationScreen } from '../components/cost/money-screens';
import { PeriodCloseScreen } from '../components/cost/period-close-screen';
import { AuditTrail } from '../components/detail/audit-trail';
import { PhasePlaceholder } from '../components/detail/phase-placeholder';
import { EntityDocuments } from '../components/files/entity-documents';
import { ClosingChecklist } from '../components/work-unit/closing-checklist';
import { InspectionSheet } from '../components/work-unit/inspection-sheet';
import { InterventionSheet } from '../components/work-unit/intervention-sheet';
import { TimesheetWeek } from '../components/work-unit/timesheet-week';
import { ValidationQueue } from '../components/work-unit/validation-queue';
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
      { key: 'validare', label: 'De validat' },
    ],
    renderView: async (rows, view, ctx, search) => {
      if (view === 'calendar') {
        return <GeneralGantt ctx={ctx} />;
      }
      if (view === 'pontaj') {
        return <TimesheetTab ctx={ctx} search={search} />;
      }
      if (view === 'validare') {
        return <ValidationTab ctx={ctx} />;
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
        cell: (row) => (
          <Badge tone={TYPE_TONES[row.type] ?? 'neutral'}>{typeLabel(row.type)}</Badge>
        ),
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

      const components = await listComponentsForContracts(
        ctx.actor,
        contracts.map((contract) => contract.id),
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
        components: components.map((component) => ({
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
      {
        name: 'companyId',
        label: 'Firma',
        control: 'select',
        required: true,
        options: lookups.companies,
      },
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
              <Link
                href={`/obiective/${row.objectiveId}`}
                className="text-brand-700 hover:underline"
              >
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
      /*
       * Tab-ul implicit, in doua variante pe acelasi slug.
       *
       * Pagina de detaliu ia PRIMUL tab vizibil cu slugul cerut, iar `visible`
       * le tine despartite pe tip. O inspectie se deschide direct pe fisa ei —
       * nu pe un rezumat de sub care mai trebuie apasat o data, cand fisa E tot
       * ce are inspectia de aratat.
       */
      {
        slug: '',
        label: 'Fișă',
        visible: (_session, row) => row.type === 'inspectie',
        render: async (row, ctx) => <InspectionTab row={row} ctx={ctx} />,
      },
      {
        slug: '',
        label: 'Fișă',
        visible: (_session, row) => row.type === 'interventie',
        render: async (row, ctx) => <InterventionTab row={row} ctx={ctx} section="fisa" />,
      },
      {
        slug: '',
        label: 'Prezentare',
        visible: (_session, row) => row.type === 'lucrare',
        render: async (row, ctx) => <Overview row={row} ctx={ctx} />,
      },

      // ── Doar pe lucrari ────────────────────────────────────────────────────
      {
        slug: 'deviz',
        label: 'Deviz',
        visible: (_session, row) => row.type === 'lucrare',
        render: () => (
          <PhasePlaceholder phase={2} what="Devizul lucrării, cu pachete și articole" />
        ),
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
        render: async (row, ctx) => <FindingsTab row={row} ctx={ctx} />,
      },

      // ── Comune executiei ───────────────────────────────────────────────────
      {
        slug: 'materiale',
        label: 'Materiale',
        visible: (_session, row) => row.type === 'interventie',
        render: async (row, ctx) => <InterventionTab row={row} ctx={ctx} section="materiale" />,
      },
      {
        slug: 'materiale',
        label: 'Materiale',
        visible: (_session, row) => row.type === 'lucrare',
        render: () => <PhasePlaceholder phase={3} what="Consumurile de material" />,
      },
      {
        slug: 'manopera',
        label: 'Ore',
        visible: (_session, row) => row.type === 'interventie',
        render: async (row, ctx) => <InterventionTab row={row} ctx={ctx} section="ore" />,
      },
      {
        slug: 'manopera',
        label: 'Manoperă',
        visible: (_session, row) => row.type === 'lucrare',
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
        render: (row, ctx) => (
          <CostTab
            ctx={ctx}
            scope={{ workUnitId: row.id }}
            emptyBody="Costurile intră aici din documentele care le produc — bon de consum, NIR, pontaj, fișă de utilaj. Până la primul document, unitatea n-a costat nimic."
          />
        ),
      },

      // ── Documente si inchidere ─────────────────────────────────────────────
      /*
       * Pozele deschid GALERIA, nu tabelul: e acelasi explorer, cu vederea deja
       * aleasa. Un folder de poze randat ca tabel de nume de fisiere e cea mai
       * proasta reprezentare posibila a lui.
       *
       * Doar pe inspectii si interventii: lucrarea are `Poze/{Inainte, Etapa
       * 1..N, Dupa}`, deci pozele ei se rasfoiesc din tab-ul Documente, unde se
       * vede si faza — informatia care conteaza acolo.
       */
      {
        slug: 'poze',
        label: 'Poze',
        visible: (_session, row) => row.type !== 'lucrare',
        render: (row, ctx, sub) => (
          <EntityDocuments
            ctx={ctx}
            scope={{ workUnitId: row.id }}
            role="photos"
            basePath={`/activitate/${row.id}/poze`}
            sub={sub.length === 0 ? ['galerie'] : sub}
            notice="Fiecare poză arată ora și locul. Coordonatele culese de aparat la fața locului cântăresc mai mult decât cele scoase din fișier."
          />
        ),
      },
      {
        slug: 'documente',
        label: 'Documente',
        render: (row, ctx, sub) => (
          <EntityDocuments
            ctx={ctx}
            scope={{ workUnitId: row.id }}
            role="work_unit"
            basePath={`/activitate/${row.id}/documente`}
            sub={sub}
            notice="Folderul unității stă sub luna în care s-a executat, în contractul pe care e rutată. Mutarea finanțării nu îl atinge."
          />
        ),
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
          ? [
              {
                label: 'Promovează în lucrare',
                href: `/activitate/${row.id}`,
                tone: 'primary' as const,
              },
            ]
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
    load: (ctx) => listStagesForCompanies(ctx.actor, { companyIds: ctx.app.selectedCompanyIds }),
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
                  stage.pctOfWork === null ? '—' : `${(Number(stage.pctOfWork) * 100).toFixed(0)}%`
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
        render: (stage, ctx) => (
          <CostTab
            ctx={ctx}
            scope={{ stageId: stage.id }}
            emptyBody="Pe etapa asta nu s-a înregistrat încă niciun cost. Liniile apar aici pe măsură ce documentele lor sunt validate."
          />
        ),
      },
      {
        slug: 'documente',
        label: 'Documente',
        render: (stage, ctx, sub) => (
          <EntityDocuments
            ctx={ctx}
            scope={{ stageId: stage.id }}
            role="photo_phase"
            basePath={`/etape/${stage.id}/documente`}
            sub={sub}
            notice="Etapa are un singur folder al ei — „Poze/Etapa N” din lucrare. Redenumirea etapei îl redenumește, dar căutarea lui merge pe rol, nu pe nume."
          />
        ),
      },
      {
        slug: 'istoric',
        label: 'Istoric',
        render: (stage, ctx) => (
          <AuditTrail ctx={ctx} tableName="app.work_stages" recordId={stage.id} />
        ),
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
      {
        label: 'Înapoi la lucrare',
        href: `/activitate/${stage.workUnitId}/etape`,
        tone: 'primary',
      },
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
      { key: 'reconciliere', label: 'Folosit vs descărcat' },
      { key: 'marja', label: 'Marjă brută' },
      { key: 'marja-neta', label: 'Marjă netă' },
      { key: 'inchidere', label: 'Închidere de perioadă' },
      { key: 'facturare', label: 'Facturare emisă' },
      { key: 'situatii', label: 'Situații de lucrări' },
    ],
    /*
     * Cele patru vederi construite la 06c sunt ecrane cu cifre, si fiecare isi
     * declara analitica pe ecran: marja pe „descarcat", reconcilierea pe
     * amandoua (ea despre diferenta lor e). Restul raman placeholder cinstit.
     *
     * Comutatorul brut/net e chiar comutatorul de vederi al listei — vizibil
     * permanent, in acelasi loc ca toate celelalte. Un comutator propriu, desenat
     * in ecran, ar fi fost al doilea mecanism pentru acelasi lucru, si al doilea
     * loc in care omul trebuie sa se uite.
     */
    renderView: (_rows, view, ctx) => {
      if (view === 'marja' || view === 'marja-neta') {
        return <MarginScreen ctx={ctx} net={view === 'marja-neta'} />;
      }
      if (view === 'reconciliere') {
        return <ReconciliationScreen ctx={ctx} />;
      }
      if (view === 'inchidere') {
        return <PeriodCloseScreen ctx={ctx} />;
      }

      const what: Readonly<Record<string, string>> = {
        facturare: 'Facturarea emisă și e-Factura',
        situatii: 'Situațiile de lucrări',
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

  const components = await listComponentsForContracts(
    ctx.actor,
    contracts.map((contract) => contract.id),
  );

  const contractOptions = contracts.map((contract) => ({
    value: contract.id,
    label: `${contract.code} · ${contract.clientName}`,
  }));
  const componentOptions = components.map((component) => ({
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

// ── Fisa de inspectie ────────────────────────────────────────────────────────

/**
 * Tab-ul Fisa. Citirea are `withMoney`, si asta NU e o ascundere de ecran:
 * pe `false`, coloana de bani nu se CERE din SQL. Ceruta, un `select` din
 * contextul `field` ar cadea cu „permission denied for column" si ecranul ar
 * parea stricat — rolul de Postgres nu i-o acorda (verificarea #23).
 */
async function InspectionTab({
  row,
  ctx,
}: {
  readonly row: WorkUnitRow;
  readonly ctx: EntityContext;
}) {
  const withMoney = canSeeFinancials(ctx.session);
  const sheet = await getInspectionSheet(ctx.actor, row.id, { withMoney });

  // Pozele se aleg dintre cele deja urcate in folderul unitatii. Fara folder
  // (fisa deschisa inainte de 07), lista e goala si banda din ecran o spune.
  const photoFolder = await folderForEntity(ctx.actor, { workUnitId: row.id }, 'photos');
  const photos =
    photoFolder === null
      ? []
      : (await listChildren(ctx.actor, photoFolder)).filter((node) => node.kind === 'file');

  return (
    <InspectionSheet
      workUnitId={row.id}
      checklistName={sheet.checklistName}
      checklistVersion={sheet.checklistVersion}
      performedOn={sheet.performedOn}
      effectDate={sheet.effectDate}
      validated={sheet.validatedAt !== null}
      points={sheet.points.map((point) => ({
        ...point,
        estimatedValue: point.estimatedValue === null ? null : point.estimatedValue.toDbString(),
      }))}
      answered={sheet.check.answered}
      total={sheet.check.total}
      canValidate={sheet.check.canValidate}
      blockers={sheet.check.blockers.map((blocker) => ({
        itemId: blocker.itemId,
        message: describeInspectionBlocker(blocker),
      }))}
      photos={photos.map((node) => ({ id: node.id, name: node.name }))}
      photosHref={`/activitate/${row.id}/poze`}
      canWrite={canWriteSheets(ctx.session)}
      canValidateSheet={canValidateSheets(ctx.session)}
      withMoney={withMoney}
      suggestedEffectDate={new Date().toISOString().slice(0, 10)}
    />
  );
}

/**
 * Tab-ul Constatari: doar punctele NOK, cu iesirea si documentele lor.
 *
 * Regula de aur din §6 (legatura navigabila in AMBELE sensuri) se vede aici:
 * din constatare se ajunge la cererea nascuta din ea, iar cererea arata inapoi
 * spre inspectie prin `source_inspection_id`.
 */
async function FindingsTab({
  row,
  ctx,
}: {
  readonly row: WorkUnitRow;
  readonly ctx: EntityContext;
}) {
  const withMoney = canSeeFinancials(ctx.session);
  const sheet = await getInspectionSheet(ctx.actor, row.id, { withMoney });
  const findings = sheet.points.filter((point) => point.answer === 'nok');

  if (findings.length === 0) {
    return (
      <EmptyState
        title="Nicio constatare"
        body="Constatările sunt punctele marcate NOK pe fișă. Fiecare are o ieșire obligatorie — rezolvat pe loc, cerere, sau propunere în backlog — și de aici se ajunge la documentul pe care l-a născut."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {findings.map((point) => (
        <li key={point.itemId} className="rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm font-medium text-ink">
              <span className="mr-2 text-ink-subtle">{point.position}.</span>
              {point.text}
            </p>
            <Badge tone={point.outcome === null ? 'danger' : 'neutral'}>
              {point.outcome === null
                ? 'Fără ieșire'
                : FINDING_OUTCOME_LABELS[point.outcome]}
            </Badge>
          </div>

          {point.resolutionNote === null ? null : (
            <p className="mt-2 text-sm text-ink-muted">{point.resolutionNote}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            {point.estimatedValue === null ? null : (
              <span className="text-ink-muted">
                Valoare estimată <Money value={point.estimatedValue} />
              </span>
            )}
            {point.createdRequestId === null ? null : (
              <Link href={`/cereri/${point.createdRequestId}`} className="text-brand underline">
                Cererea născută din constatare
              </Link>
            )}
            {point.backlogProposalId === null ? null : (
              <Link href="/cereri?view=backlog" className="text-brand underline">
                Propunerea din backlog
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Fisa de interventie, in trei sectiuni pe trei tab-uri (§3.2).
 *
 * Toate trei incarca ACELEASI date si randeaza aceeasi componenta, cu alta
 * sectiune. Nu e risipa: salvarea inlocuieste fisa intreaga, deci si tab-ul
 * Materiale trebuie sa stie orele — altfel prima salvare de acolo le-ar sterge.
 *
 * Terenul primeste totul fara bani. Nu doar ascuns: coloanele nici nu se cer,
 * fiindca `unit_cost`, `avg_cost` si costul estimat din catalog nu-i sunt
 * acordate — o interogare care le-ar cere n-ar intoarce zero randuri, ci ar
 * cadea cu „permission denied".
 */
async function InterventionTab({
  row,
  ctx,
  section,
}: {
  readonly row: WorkUnitRow;
  readonly ctx: EntityContext;
  readonly section: 'fisa' | 'materiale' | 'ore';
}) {
  const withMoney = canSeeFinancials(ctx.session);

  const [sheet, materials, hours, teams, operations, persons, series, notes] = await Promise.all([
    getInterventionSheet(ctx.actor, row.id, { withMoney }),
    listInterventionMaterials(ctx.actor, row.id, { withMoney }),
    listInterventionHours(ctx.actor, row.id),
    listTeamOptions(ctx.actor, [row.companyId]),
    listOperations(ctx.actor, { withMoney }),
    listPersonOptions(ctx.actor, ['office', 'field']),
    canValidateSheets(ctx.session)
      ? listDocumentSeries(ctx.actor, row.companyId, 'bon_consum')
      : Promise.resolve([]),
    listConsumptionNotes(ctx.actor, { companyIds: [row.companyId], workUnitId: row.id }),
  ]);

  const team = teams.find((candidate) => candidate.id === sheet.teamId);
  const locationId = team?.locationId ?? '';

  // Stocul se cere doar cand exista gestiune: fara ea selectorul n-are ce lista,
  // iar o interogare pe toata firma ar aduce si ce nu poate fi consumat de aici.
  const stock =
    locationId === ''
      ? []
      : await listStock(ctx.actor, {
          companyIds: [row.companyId],
          locationId,
          withCost: withMoney,
        });

  return (
    <InterventionSheet
      section={section}
      workUnitId={row.id}
      performedOn={sheet.performedOn}
      effectDate={sheet.effectDate}
      validated={sheet.validatedAt !== null}
      description={sheet.description}
      declaredHours={sheet.declaredHours === null ? null : sheet.declaredHours.toDbString()}
      operationId={sheet.operationId}
      teamId={sheet.teamId}
      consumptionNoteNumber={notes[0]?.number ?? null}
      materials={materials.map((line) => ({
        id: line.id,
        productId: line.productId,
        productLabel: `${line.productCode} · ${line.productName}`,
        quantity: line.quantity.toDbString(),
        uom: line.uom,
        locationId: line.locationId,
        unitCost: line.unitCost === null ? null : line.unitCost.toDbString(),
      }))}
      hours={hours.map((line) => ({
        id: line.id,
        personId: line.personId,
        personName: line.personName,
        hours: line.hours.toDbString(),
        workDate: line.workDate,
      }))}
      variance={
        sheet.variance === null
          ? null
          : {
              expectedCost: sheet.variance.expectedCost?.toDbString() ?? null,
              realCost: sheet.variance.realCost.toDbString(),
              variancePct: sheet.variance.variancePct,
              flagged: sheet.variance.flagged,
            }
      }
      locationId={locationId}
      locationName={team?.locationName ?? null}
      stock={stock.map((entry) => ({
        productId: entry.productId,
        label: `${entry.productCode} · ${entry.productName}`,
        uom: entry.uom,
        available: entry.available.toDbString(),
      }))}
      operations={operations.map((operation) => ({
        id: operation.id,
        label: `${operation.code} · ${operation.name}`,
      }))}
      teams={teams.map((entry) => ({ id: entry.id, name: entry.name }))}
      persons={persons.map((person) => ({ id: person.id, name: person.fullName }))}
      consumptionSeries={series.map((entry) => entry.series)}
      canWrite={canWriteSheets(ctx.session)}
      canValidateSheet={canValidateSheets(ctx.session)}
      withMoney={withMoney}
      suggestedEffectDate={new Date().toISOString().slice(0, 10)}
    />
  );
}

/**
 * Activitate › Pontaj — saptamana de birou (§3.3).
 *
 * Saptamana vine din `?week=`, nu din selectorul de luna al shell-ului, si
 * dinadins: o saptamana taie luna in doua de patru ori pe an, iar un pontaj de
 * pe 31 nu poate sa dispara de pe ecran doar pentru ca a inceput alta luna.
 * Implicit e saptamana zilei de azi, daca ea cade in luna aleasa, altfel prima
 * saptamana a lunii — asa comutatorul de luna ramane util fara sa fie stapan.
 */
async function TimesheetTab({
  ctx,
  search,
}: {
  readonly ctx: EntityContext;
  readonly search: Readonly<Record<string, string | string[] | undefined>>;
}) {
  const requested = typeof search.week === 'string' ? search.week : undefined;
  const start = mondayOf(requested ?? defaultWeekStart(ctx.app.year, ctx.app.month));
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const from = days[0] as string;
  const to = days[6] as string;

  const [week, persons, units, stages] = await Promise.all([
    listTimesheetWeek(ctx.actor, { companyIds: ctx.app.selectedCompanyIds, from, to }),
    listPersonOptions(ctx.actor, ['office', 'field']),
    listWorkUnits(ctx.actor, {
      companyIds: ctx.app.selectedCompanyIds,
      statuses: ['planificata', 'in_executie', 'suspendata'],
      limit: 500,
    }),
    listStagesForCompanies(ctx.actor, { companyIds: ctx.app.selectedCompanyIds, limit: 1000 }),
  ]);

  const stagesByUnit = new Map<string, { id: string; name: string }[]>();
  for (const stage of stages) {
    const list = stagesByUnit.get(stage.workUnitId) ?? [];
    list.push({ id: stage.id, name: stage.name });
    stagesByUnit.set(stage.workUnitId, list);
  }

  const unitLabels = new Map(units.map((unit) => [unit.id, `${unit.code} · ${unit.name}`]));

  return (
    <TimesheetWeek
      companyId={ctx.app.selectedCompanyIds[0] ?? ''}
      days={days}
      sheets={week.sheets.map((sheet) => ({
        id: sheet.id,
        personId: sheet.personId,
        personName: sheet.personName,
        workDate: sheet.workDate,
        status: sheet.status,
        totalHours: sheet.totalHours.toDbString(),
        lines: sheet.lines.map((line) => ({
          id: line.id,
          workUnitId: line.workUnitId,
          stageId: line.stageId,
          hours: line.hours.toDbString(),
        })),
      }))}
      persons={persons.map((person) => ({ id: person.id, name: person.fullName }))}
      workUnits={units.map((unit) => ({
        id: unit.id,
        label: `${unit.code} · ${unit.name}`,
        type: unit.type,
        stages: stagesByUnit.get(unit.id) ?? [],
      }))}
      byPerson={Object.fromEntries(
        [...week.byPerson.entries()].map(([id, hours]) => [id, hours.toDbString()]),
      )}
      byWorkUnit={[...week.byWorkUnit.entries()].map(([id, hours]) => ({
        label: unitLabels.get(id) ?? id,
        hours: hours.toDbString(),
      }))}
      weekHref={(value) => `/activitate?view=pontaj&week=${value}`}
      previousWeek={addDays(start, -7)}
      nextWeek={addDays(start, 7)}
      canWrite={canWriteSheets(ctx.session)}
      canValidate={canValidateSheets(ctx.session)}
    />
  );
}

/** Luni din saptamana zilei date. Saptamana incepe luni, ca in tara. */
function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Ziua de azi daca e in luna aleasa; altfel intai ale ei. */
function defaultWeekStart(year: number, month: number): string {
  const today = new Date();
  if (today.getFullYear() === year && today.getMonth() + 1 === month) {
    return today.toISOString().slice(0, 10);
  }
  return `${String(year)}-${String(month).padStart(2, '0')}-01`;
}

/**
 * Activitate › De validat — ecranul de sfarsit de luna al PM-ului (§3.6).
 *
 * Inspectiile si interventiile nevalidate, la un loc: pentru cel care inchide
 * luna sunt acelasi lucru — fise care inca nu produc cost si nu intra in
 * raport. Doua liste separate l-ar fi pus sa tina minte pe care a terminat-o.
 */
async function ValidationTab({ ctx }: { readonly ctx: EntityContext }) {
  const companyId = ctx.app.selectedCompanyIds[0] ?? '';

  const [inspections, interventions, series] = await Promise.all([
    listUnvalidatedInspections(ctx.actor, ctx.app.selectedCompanyIds),
    listUnvalidatedInterventions(ctx.actor, ctx.app.selectedCompanyIds),
    companyId === ''
      ? Promise.resolve([])
      : listDocumentSeries(ctx.actor, companyId, 'bon_consum'),
  ]);

  const sheets = [
    ...inspections.map((row) => ({ ...row, kind: 'inspectie' as const })),
    ...interventions.map((row) => ({ ...row, kind: 'interventie' as const })),
  ].sort((a, b) => a.performedOn.localeCompare(b.performedOn));

  return (
    <ValidationQueue
      sheets={sheets}
      consumptionSeries={series.map((entry) => entry.series)}
      // Luna aleasa in shell, nu ziua de azi: ecranul asta se deschide ca sa
      // inchida o luna anume, iar aia e cea din selector.
      suggestedEffectDate={`${String(ctx.app.year)}-${String(ctx.app.month).padStart(2, '0')}-01`}
      canValidate={canValidateSheets(ctx.session)}
    />
  );
}
