import { canDecideRouting, canEditNomenclature, canTriageRequests } from '@damina/auth';
import {
  REQUEST_SOURCES,
  REQUEST_STATUS_LABELS,
  REQUEST_TYPE_LABELS,
  REQUEST_TYPES,
  ROUTING_CHOICE_LABELS,
} from '@damina/contracts';
import {
  deltaFreeForContract,
  getOperation,
  getRequest,
  getRequestEmail,
  listBacklogProposals,
  listComponents,
  listContracts,
  listDecisionsForRequest,
  listEstimateLines,
  listObjectives,
  listOperationMaterials,
  listOperations,
  listProducts,
  listQualifications,
  listRequests,
  listRoutingDecisions,
  operationActuals,
  proposeRouting,
  type BacklogRow,
  type OperationRow,
  type RequestRow,
  type RoutingDecisionRow,
} from '@damina/services';
import { Money as MoneyValue } from '@damina/shared';
import { Badge, CellMeta, CellTitle, EmptyState, Money, Stat, Table } from '@damina/ui';
import { Scale } from 'lucide-react';
import Link from 'next/link';
import { BacklogFill } from '../components/request/backlog-fill';
import { DecisionScreen } from '../components/request/decision-screen';
import { EvaluationEditor } from '../components/request/evaluation-editor';
import { InboxTriage } from '../components/request/inbox-triage';
import { OperationMaterials } from '../components/request/operation-materials';
import { DefinitionList, Empty } from '../components/detail/definition-list';
import { PhasePlaceholder } from '../components/detail/phase-placeholder';
import { defineEntity, type EntityContext } from './types';

/**
 * CERERILE si CATALOGUL DE OPERATIUNI (pasul 08b).
 *
 * Doua intrari in registry, zero fisiere de pagina — al treilea pas la rand in
 * care testul din `types.ts` trece. Ecranul de Decizie, cel mai complicat din
 * pas, incape in `tabs`, pentru ca tot ce e greu la el se intampla in domain si
 * in servicii: aici doar se citeste contextul si se randeaza propunerea.
 *
 * Cifra „Delta liber" se citeste la fiecare randare, din `routingContext` —
 * §3.5 o cere live, niciodata cache-uita. De aceea nu exista nicio memoizare pe
 * ea si nici n-are voie sa apara una.
 */

const dateTimeFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const formatDateTime = (value: Date | null): string =>
  value === null ? '—' : dateTimeFormat.format(value);

const typeLabel = (type: string): string =>
  REQUEST_TYPE_LABELS[type as keyof typeof REQUEST_TYPE_LABELS] ?? type;

const statusLabel = (status: string): string =>
  REQUEST_STATUS_LABELS[status as keyof typeof REQUEST_STATUS_LABELS] ?? status;

const choiceLabel = (choice: string): string =>
  ROUTING_CHOICE_LABELS[choice as keyof typeof ROUTING_CHOICE_LABELS] ?? choice;

const STATUS_TONES: Readonly<Record<string, 'neutral' | 'brand' | 'success' | 'warning'>> = {
  neprocesata: 'warning',
  in_evaluare: 'brand',
  decisa: 'success',
  in_backlog: 'neutral',
  respinsa: 'neutral',
  anulata: 'neutral',
};

async function objectiveOptions(ctx: EntityContext): Promise<{ value: string; label: string }[]> {
  const objectives = await listObjectives(ctx.actor, { limit: 1000 });
  return objectives.map((objective) => ({
    value: objective.id,
    label: `${objective.code} · ${objective.name}`,
  }));
}

async function contractOptions(
  ctx: EntityContext,
): Promise<{ value: string; label: string; companyId: string }[]> {
  const contracts = await listContracts(ctx.actor, {
    companyIds: ctx.app.selectedCompanyIds,
  });
  return contracts.map((contract) => ({
    value: contract.id,
    label: `${contract.code} · ${contract.clientName}`,
    companyId: contract.companyId,
  }));
}

// ── Cererile ─────────────────────────────────────────────────────────────────

export const cereri = defineEntity<RequestRow>({
  slug: 'cereri',
  singular: 'Cerere',
  plural: 'Cereri',
  icon: 'inbox',
  group: 'operational',
  // Cererea nu e a unei luni: e a firmei, si traieste pana e decisa. Selectorul
  // de perioada ar sugera altceva.
  usesPeriod: false,
  canWrite: canTriageRequests,

  list: {
    load: (ctx, query) =>
      listRequests(ctx.actor, {
        companyIds: ctx.app.selectedCompanyIds,
        query: query.query,
        // Inbox-ul e o VEDERE a aceleiasi liste, nu o a doua listă: filtrează
        // starea, nu sursa datelor.
        statuses: query.view === 'inbox' ? ['neprocesata'] : undefined,
      }),
    rowKey: (row) => row.id,
    rowHref: (row) => `/cereri/${row.id}`,
    rowFlagged: (row) => row.status === 'neprocesata',
    searchPlaceholder: 'Caută în titlu sau descriere',
    notice:
      'O singură entitate „Cerere”, cu tip — tichet de client, solicitare, constatare de inspecție, propunere. Nu module separate pe sursă.',
    views: [
      { key: '', label: 'Toate cererile' },
      { key: 'inbox', label: 'Inbox' },
      { key: 'backlog', label: 'Backlog' },
      { key: 'rutare', label: 'Decizii de rutare' },
    ],
    renderView: async (rows, view, ctx, search) => {
      if (view === 'inbox') {
        return <InboxView rows={rows} ctx={ctx} />;
      }
      if (view === 'backlog') {
        // `?contract=…` vine din alerta de Delta de pe 10 si 20 (§3.6): omul
        // aterizeaza pe contractul care are Delta neumpluta, nu pe primul din
        // lista.
        const wanted = typeof search.contract === 'string' ? search.contract : undefined;
        return (
          <BacklogView
            ctx={ctx}
            focusContractId={wanted}
            showExpired={search.status === 'expired'}
          />
        );
      }
      return <DecisionJournalView ctx={ctx} />;
    },
    empty: {
      title: 'Nicio cerere',
      body: 'Aici ajunge tot ce intră în firmă ca „ceva de făcut”: tichete de la clienți, solicitări interne, constatări din inspecții, propuneri. Fiecare primește o decizie de rutare, iar decizia creează unitatea de lucru.',
      actionLabel: 'Scrie prima cerere',
    },
    columns: [
      {
        key: 'title',
        header: 'Cerere',
        cell: (row) => (
          <span className="flex flex-col">
            <CellTitle>{row.title}</CellTitle>
            <CellMeta>
              {typeLabel(row.type)}
              {row.objectiveName === null ? '' : ` · ${row.objectiveName}`}
            </CellMeta>
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Stare',
        width: '9rem',
        cell: (row) => (
          <Badge tone={STATUS_TONES[row.status] ?? 'neutral'}>{statusLabel(row.status)}</Badge>
        ),
      },
      {
        key: 'contract',
        header: 'Contract',
        width: '8rem',
        hideBelow: 'md',
        cell: (row) =>
          row.contractCode === null ? <Empty /> : <CellMeta>{row.contractCode}</CellMeta>,
      },
      {
        key: 'value',
        header: 'Estimat',
        align: 'right',
        width: '8rem',
        cell: (row) =>
          row.estimatedValue === null ? (
            <Empty />
          ) : (
            <Money value={MoneyValue.fromDb(row.estimatedValue)} />
          ),
      },
      {
        key: 'created',
        header: 'Intrată',
        width: '11rem',
        hideBelow: 'lg',
        cell: (row) => <CellMeta>{formatDateTime(row.createdAt)}</CellMeta>,
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getRequest(ctx.actor, id).catch(() => null),

    header: (row) => ({
      title: row.title,
      breadcrumb: [
        { label: 'Operațional' },
        { label: 'Cereri', href: '/cereri' },
        { label: row.title },
      ],
      badges: [
        { label: typeLabel(row.type), tone: 'outline' },
        { label: statusLabel(row.status), tone: STATUS_TONES[row.status] ?? 'neutral' },
        ...(row.source === 'email' ? [{ label: 'din email', tone: 'brand' as const }] : []),
      ],
      meta: [
        { label: 'Firma', value: row.companyName },
        { label: 'Obiectiv', value: row.objectiveName ?? '—' },
        { label: 'Contract', value: row.contractCode ?? '—' },
        {
          label: 'Valoare estimată',
          value:
            row.estimatedValue === null ? (
              '—'
            ) : (
              <Money value={MoneyValue.fromDb(row.estimatedValue)} />
            ),
        },
      ],
    }),

    tabs: [
      {
        slug: '',
        label: 'Prezentare',
        render: async (row, ctx) => {
          const email = await getRequestEmail(ctx.actor, row.id);
          return (
            <div className="space-y-5">
              <DefinitionList
                items={[
                  { label: 'Titlu', value: row.title },
                  { label: 'Tip', value: typeLabel(row.type) },
                  { label: 'Sursă', value: row.source },
                  { label: 'Stare', value: statusLabel(row.status) },
                  { label: 'Obiectiv', value: row.objectiveName ?? <Empty /> },
                  { label: 'Contract', value: row.contractCode ?? <Empty /> },
                  {
                    label: 'Valoare estimată',
                    value:
                      row.estimatedValue === null ? (
                        <Empty />
                      ) : (
                        <Money value={MoneyValue.fromDb(row.estimatedValue)} />
                      ),
                  },
                  { label: 'Termen SLA', value: formatDateTime(row.slaDueAt) },
                  { label: 'Intrată', value: formatDateTime(row.createdAt) },
                ]}
              />

              {row.description === null ? null : (
                <section>
                  <h2 className="mb-1 text-sm font-medium text-ink-muted">Descriere</h2>
                  <p className="whitespace-pre-wrap text-sm text-ink">{row.description}</p>
                </section>
              )}

              {email === null ? null : (
                <section className="rounded-lg border border-border bg-surface-sunken p-4">
                  <h2 className="text-sm font-medium text-ink-muted">
                    Emailul original — dovada solicitării
                  </h2>
                  <p className="mt-1 text-sm text-ink">
                    De la <strong>{email.fromAddress}</strong> · {formatDateTime(email.receivedAt)}
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-ink">{email.subject ?? '—'}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
                    {email.bodyText ?? 'Mesaj fără text.'}
                  </p>
                  <p className="mt-2 text-xs text-ink-subtle">
                    `.eml`-ul integral rămâne permanent în R2, chiar dacă cererea e ulterior
                    anulată.
                  </p>
                </section>
              )}
            </div>
          );
        },
      },

      {
        slug: 'constatare',
        label: 'Constatare',
        render: () => (
          <div className="space-y-3">
            <p className="max-w-prose text-sm text-ink-muted">
              Când cererea vine dintr-un punct NOK de inspecție, aici se vede constatarea care a
              generat-o — și invers, din constatare se ajunge înapoi la cerere. Coloana{' '}
              <code className="font-mono text-xs">source_inspection_finding_id</code> există deja în
              schemă; fișele care o completează vin cu inspecțiile.
            </p>
            <PhasePlaceholder phase={1} what="Fișele de inspecție și punctele NOK" />
          </div>
        ),
      },

      {
        slug: 'evaluare',
        label: 'Evaluare',
        render: async (row, ctx) => {
          const [lines, operations] = await Promise.all([
            listEstimateLines(ctx.actor, row.id),
            listOperations(ctx.actor, { limit: 500 }),
          ]);

          const open = row.status === 'neprocesata' || row.status === 'in_evaluare';

          return (
            <EvaluationEditor
              requestId={row.id}
              initialLines={lines.map((line) => ({
                operationId: line.operationId,
                quantity: line.quantity,
              }))}
              /*
               * Ecranul de evaluare e al biroului si CERE cifrele: fara ele
               * n-are cum sa compare cu pragul de 2.000 lei. Lista s-a cerut
               * cu bani (implicit), deci coloanele sunt acolo; `?? '0'` e doar
               * ingustarea tipului, nu o valoare inventata — cine n-are dreptul
               * la bani nu ajunge pe ecranul asta.
               */
              operations={operations.map((operation) => ({
                id: operation.id,
                code: operation.code,
                name: operation.name,
                estimatedLabor: operation.estimatedLabor ?? '0',
                estimatedMaterial: operation.estimatedMaterial ?? '0',
              }))}
              canEdit={open && canTriageRequests(ctx.session)}
              editBlockedReason={
                open
                  ? undefined
                  : 'Cererea nu mai e deschisă. Evaluarea rămâne vizibilă, dar nu se mai schimbă.'
              }
            />
          );
        },
      },

      {
        slug: 'decizie',
        label: 'Decizie',
        render: async (row, ctx) => {
          const decisions = await listDecisionsForRequest(ctx.actor, row.id);

          // Decizia luată nu se re-ia: ecranul devine jurnal. `decideRouting`
          // refuză oricum a doua decizie, dar un ecran care încă o oferă ar
          // învăța omul să încerce.
          if (decisions.length > 0) {
            return <DecisionHistory decisions={decisions} />;
          }

          // Propunerea si cifrele pe care se bazeaza vin dintr-un singur apel:
          // doua citiri separate ar putea sa nu fie de acord exact in luna care
          // conteaza.
          const { context, routing } = await proposeRouting(ctx.actor, row.id);
          const individualTargets = await listIndividualTargets(ctx, row.companyId);

          return (
            <DecisionScreen
              requestId={row.id}
              requestTitle={row.title}
              companyId={row.companyId}
              objectiveId={row.objectiveId}
              contractId={row.contractId}
              contractCode={row.contractCode}
              estimatedValue={row.estimatedValue}
              components={context.components}
              deltaMonths={context.deltaMonths.map((month) => ({
                periodId: month.periodId,
                label: month.label,
                free: month.free.toDbString(),
              }))}
              openPeriods={context.openPeriods.map((period) => ({
                id: period.id,
                label: `${String(period.month)}/${String(period.year)}`,
              }))}
              lucrariCeilingFree={
                context.lucrariCeilingFree === null ? null : context.lucrariCeilingFree.toDbString()
              }
              individualTargets={individualTargets}
              proposal={routing.proposal}
              options={routing.options.map((option) => ({
                choice: option.choice,
                available: option.available,
                reason: option.reason,
                targetPeriods: option.targetPeriods,
                split: option.split?.map((part) => ({
                  periodId: part.periodId,
                  amount: part.amount.toDbString(),
                })),
                fillPercent: option.fillPercent,
              }))}
              canDecide={canDecideRouting(ctx.session)}
            />
          );
        },
      },

      /*
       * Documentele cererii.
       *
       * Dosarul PROPRIU al cererii (`.eml`-ul integral si atasamentele) apare
       * odata cu inboxul de email, in 08c: `app.nodes` n-are inca nici coloana
       * `request_id`, nici rolul `request` in enum, si o migrare de schema numai
       * ca sa existe un folder gol n-ar fi ajutat pe nimeni. Pana atunci tab-ul
       * duce la dosarul unitatii de lucru create din cerere — cel care chiar
       * exista, construit de triggerele din 07a la crearea UL-ului.
       */
      {
        slug: 'documente',
        label: 'Documente',
        render: async (row, ctx) => {
          const decisions = await listDecisionsForRequest(ctx.actor, row.id);
          const created = decisions.find((decision) => decision.createdWorkUnitId !== null);

          if (created?.createdWorkUnitId === undefined || created.createdWorkUnitId === null) {
            return (
              <div className="space-y-3">
                <p className="max-w-prose text-sm text-ink-muted">
                  Cererea n-are încă unitate de lucru, deci n-are unde ține documente. Decide-o
                  întâi — dosarul unității se construiește singur, în aceeași tranzacție.
                </p>
                <PhasePlaceholder
                  phase={1}
                  what="Dosarul propriu al cererii (emailul .eml și atașamentele)"
                />
              </div>
            );
          }

          return (
            <div className="space-y-3">
              <p className="max-w-prose text-sm text-ink-muted">
                Documentele lucrării născute din cererea asta stau în dosarul ei.
              </p>
              <Link
                href={`/activitate/${created.createdWorkUnitId}/documente`}
                className="inline-block rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-hover"
              >
                Deschide dosarul {created.createdWorkUnitCode ?? 'unității de lucru'} →
              </Link>
            </div>
          );
        },
      },
    ],

    links: async (row, ctx) => {
      const decisions = await listDecisionsForRequest(ctx.actor, row.id);
      const units = decisions.filter((decision) => decision.createdWorkUnitId !== null);

      return [
        {
          kind: 'up',
          title: 'În sus',
          items: [
            { label: 'Toate cererile', href: '/cereri' },
            ...(row.contractId === null
              ? []
              : [
                  {
                    label: `Contract ${row.contractCode ?? ''}`,
                    href: `/contracte/${row.contractId}`,
                  },
                ]),
            ...(row.objectiveId === null
              ? []
              : [
                  { label: row.objectiveName ?? 'Obiectiv', href: `/obiective/${row.objectiveId}` },
                ]),
          ],
        },
        {
          kind: 'related',
          title: 'Ce s-a născut din cerere',
          count: units.length,
          items: units.map((decision) => ({
            label: decision.createdWorkUnitCode ?? 'Unitate de lucru',
            href: `/activitate/${decision.createdWorkUnitId ?? ''}`,
            meta: choiceLabel(decision.choice),
            tone: 'success' as const,
          })),
        },
      ];
    },

    quickActions: (row, ctx) => [
      ...(canDecideRouting(ctx.session) &&
      (row.status === 'neprocesata' || row.status === 'in_evaluare')
        ? [{ label: 'Decide rutarea', href: `/cereri/${row.id}/decizie`, tone: 'primary' as const }]
        : []),
      { label: 'Evaluează din catalog', href: `/cereri/${row.id}/evaluare` },
      { label: 'Vezi backlogul', href: '/cereri?view=backlog' },
    ],
  },

  form: {
    schemaKey: 'cereri',
    editable: false,
    createTitle: 'Cerere nouă',
    editTitle: 'Modifică cererea',
    loadLookups: async (ctx) => ({
      companies: ctx.app.companies.map((company) => ({ value: company.id, label: company.name })),
      types: REQUEST_TYPES.map((type) => ({ value: type, label: REQUEST_TYPE_LABELS[type] })),
      sources: REQUEST_SOURCES.map((source) => ({ value: source, label: source })),
      objectives: await objectiveOptions(ctx),
      contracts: (await contractOptions(ctx)).map(({ value, label }) => ({ value, label })),
    }),
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
        name: 'title',
        label: 'Titlu',
        control: 'text',
        required: true,
        full: true,
        placeholder: 'ex. Scurgere la vana din SP-14',
      },
      {
        name: 'objectiveId',
        label: 'Obiectiv',
        control: 'select',
        options: lookups.objectives,
        hint: 'Se poate completa și la triere. Fără el, cererea nu se poate decide.',
      },
      { name: 'contractId', label: 'Contract', control: 'select', options: lookups.contracts },
      {
        name: 'estimatedValue',
        label: 'Valoare estimată',
        control: 'text',
        suffix: 'lei',
        hint: 'Opțional acum: tab-ul Evaluare o calculează din catalogul de operațiuni.',
      },
      { name: 'description', label: 'Descriere', control: 'textarea', full: true },
    ],
    blank: {
      companyId: '',
      type: 'solicitare',
      source: 'manual',
      objectiveId: '',
      contractId: '',
      contractObjectiveId: '',
      title: '',
      description: '',
      estimatedValue: '',
      slaDueAt: '',
    },
    toFormValues: (row) => ({
      companyId: row.companyId,
      type: row.type,
      source: row.source,
      objectiveId: row.objectiveId ?? '',
      contractId: row.contractId ?? '',
      contractObjectiveId: '',
      title: row.title,
      description: row.description ?? '',
      estimatedValue: row.estimatedValue ?? '',
      slaDueAt: '',
    }),
  },
});

// ── Vederile listei de cereri ────────────────────────────────────────────────

async function InboxView({
  rows,
  ctx,
}: {
  readonly rows: readonly RequestRow[];
  readonly ctx: EntityContext;
}) {
  const [objectives, contracts] = await Promise.all([objectiveOptions(ctx), contractOptions(ctx)]);

  const emails = await Promise.all(rows.map((row) => getRequestEmail(ctx.actor, row.id)));

  return (
    <InboxTriage
      canTriage={canTriageRequests(ctx.session)}
      objectives={objectives}
      contracts={contracts}
      requests={rows.map((row, index) => {
        const email = emails[index] ?? null;
        return {
          id: row.id,
          companyId: row.companyId,
          companyName: row.companyName,
          type: row.type,
          source: row.source,
          title: row.title,
          description: row.description,
          estimatedValue: row.estimatedValue,
          objectiveId: row.objectiveId,
          contractId: row.contractId,
          email:
            email === null
              ? null
              : {
                  fromAddress: email.fromAddress,
                  subject: email.subject,
                  receivedAt: formatDateTime(email.receivedAt),
                  bodyText: email.bodyText,
                },
        };
      })}
    />
  );
}

/**
 * Backlogul de propuneri, cu liberul Deltei pe fiecare contract care are
 * propuneri deschise.
 *
 * Se citeste liberul DOAR pentru contractele care chiar au ceva in backlog: un
 * `deltaFreeForContract` pe toate contractele firmei ar fi fost zeci de
 * interogari pentru randuri pe care ecranul nu le arata.
 */
async function BacklogView({
  ctx,
  focusContractId,
  showExpired,
}: {
  readonly ctx: EntityContext;
  readonly focusContractId?: string;
  readonly showExpired: boolean;
}) {
  const proposals = await listBacklogProposals(ctx.actor, {
    companyIds: ctx.app.selectedCompanyIds,
    // O propunere expirata nu se sterge, dar nici nu sta in lista de umplere: ar
    // fi ofertat un lucru pe care firma l-a lasat sa treaca. Se vede pe filtru.
    statuses: showExpired ? ['expired'] : ['open'],
  });

  const contractIds = [...new Set(proposals.map((proposal) => proposal.contractId))];
  const contracts = await Promise.all(
    contractIds.map(async (contractId) => {
      const delta = await deltaFreeForContract(ctx.actor, contractId);
      const code =
        proposals.find((proposal) => proposal.contractId === contractId)?.contractCode ?? '—';
      return {
        contractId,
        contractCode: code,
        componentId: delta.componentId,
        months: delta.months.map((month) => ({
          periodId: month.periodId,
          label: month.label,
          free: month.free.toDbString(),
        })),
      };
    }),
  );

  const filterHref = (expired: boolean) =>
    `/cereri?view=backlog${expired ? '&status=expired' : ''}${
      focusContractId === undefined ? '' : `&contract=${focusContractId}`
    }`;

  return (
    <>
      <nav className="mb-3 flex gap-2 text-sm" aria-label="Filtru de stare">
        {[
          { label: 'Deschise', expired: false },
          { label: 'Expirate', expired: true },
        ].map((option) => (
          <Link
            key={option.label}
            href={filterHref(option.expired)}
            aria-current={option.expired === showExpired ? 'page' : undefined}
            className={
              option.expired === showExpired
                ? 'rounded-md bg-neutral-900 px-3 py-1 font-medium text-white'
                : 'rounded-md px-3 py-1 text-neutral-600 hover:bg-neutral-100'
            }
          >
            {option.label}
          </Link>
        ))}
      </nav>
      <BacklogFill
        canPromote={canDecideRouting(ctx.session)}
        contracts={contracts}
        initialContractId={
          contracts.some((candidate) => candidate.contractId === focusContractId)
            ? focusContractId
            : undefined
        }
        proposals={proposals.map((proposal: BacklogRow) => ({
          id: proposal.id,
          title: proposal.title,
          estimatedValue: proposal.estimatedValue,
          objectiveName: proposal.objectiveName,
          contractId: proposal.contractId,
          contractCode: proposal.contractCode,
          sourceKind: proposal.sourceKind,
          status: proposal.status,
          validUntil: proposal.validUntil,
        }))}
        blockedReason={
          showExpired
            ? 'Propunerile expirate nu se promovează. Redeschide-le sau creează-le din nou.'
            : ctx.app.period.locked
              ? 'Luna selectată este închisă în bara de sus.'
              : undefined
        }
      />
    </>
  );
}

/** Jurnalul de decizii — propunerea sistemului langa alegerea omului (#17). */
async function DecisionJournalView({ ctx }: { readonly ctx: EntityContext }) {
  const journal = await listRoutingDecisions(ctx.actor, {
    companyIds: ctx.app.selectedCompanyIds,
  });

  if (journal.rows.length === 0) {
    return (
      <EmptyState
        icon={<Scale className="size-5" aria-hidden="true" />}
        title="Nicio decizie de rutare încă"
        body="Fiecare decizie se salvează cu propunerea sistemului alături de alegerea omului. Procentul în care omul schimbă propunerea e măsura care spune dacă regula automată e bună — și de aceea se salvează amândouă, nu doar rezultatul."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <Stat
          label="Decizii"
          value={String(journal.total)}
          context="de la începutul evidenței, pe firmele selectate"
        />
        <Stat
          label="Omul a schimbat propunerea"
          value={`${String(journal.divergencePercent)}%`}
          context={`${String(journal.diverged)} din ${String(journal.total)} — peste 40% înseamnă că regula automată trebuie ajustată`}
          tone={journal.divergencePercent > 40 ? 'warning' : 'neutral'}
        />
      </div>

      <p className="max-w-prose text-sm text-ink-muted">
        O divergență mare nu e o problemă de disciplină, ci un semn că regula automată din{' '}
        <code className="font-mono text-xs">routeRequest</code> trebuie ajustată. Se documentează în{' '}
        <code className="font-mono text-xs">docs/routing.md</code>.
      </p>

      <Table<RoutingDecisionRow>
        caption="Deciziile de rutare"
        rows={journal.rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/cereri/${row.requestId}/decizie`}
        rowFlagged={(row) => row.choice !== row.systemProposal}
        empty={<EmptyState title="Gol" body="Gol." size="sm" />}
        columns={[
          {
            key: 'request',
            header: 'Cerere',
            cell: (row) => <CellTitle>{row.requestTitle}</CellTitle>,
          },
          {
            key: 'proposal',
            header: 'Sistemul a propus',
            width: '13rem',
            cell: (row) => <CellMeta>{choiceLabel(row.systemProposal)}</CellMeta>,
          },
          {
            key: 'choice',
            header: 'Omul a ales',
            width: '13rem',
            cell: (row) =>
              row.choice === row.systemProposal ? (
                <CellMeta>la fel</CellMeta>
              ) : (
                <Badge tone="warning">{choiceLabel(row.choice)}</Badge>
              ),
          },
          {
            key: 'value',
            header: 'Estimat',
            align: 'right',
            width: '8rem',
            hideBelow: 'md',
            cell: (row) =>
              row.estimatedValue === null ? (
                <Empty />
              ) : (
                <Money value={MoneyValue.fromDb(row.estimatedValue)} />
              ),
          },
          {
            key: 'who',
            header: 'Cine și când',
            width: '14rem',
            hideBelow: 'lg',
            cell: (row) => (
              <span className="flex flex-col">
                <CellMeta>{row.decidedByName}</CellMeta>
                <CellMeta>{formatDateTime(row.decidedAt)}</CellMeta>
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

/** Deciziile deja luate pe o cerere. Motivul, intreg — el e ce ramane. */
function DecisionHistory({ decisions }: { readonly decisions: readonly RoutingDecisionRow[] }) {
  return (
    <div className="space-y-3">
      {decisions.map((decision) => (
        <article key={decision.id} className="rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">{choiceLabel(decision.choice)}</h2>
            {decision.choice === decision.systemProposal ? (
              <Badge tone="success">a confirmat propunerea sistemului</Badge>
            ) : (
              <Badge tone="warning">
                sistemul propusese {choiceLabel(decision.systemProposal)}
              </Badge>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{decision.reason}</p>
          <p className="mt-2 text-xs text-ink-subtle">
            {decision.decidedByName} · {formatDateTime(decision.decidedAt)}
            {decision.createdWorkUnitCode === null
              ? ''
              : ` · a creat ${decision.createdWorkUnitCode}`}
            {decision.targetPeriods === null || decision.targetPeriods.length === 0
              ? ''
              : ` · luni: ${decision.targetPeriods.join(', ')}`}
          </p>
        </article>
      ))}
    </div>
  );
}

/** Contractele individuale ale firmei, cu componenta din care se plateste. */
async function listIndividualTargets(
  ctx: EntityContext,
  companyId: string,
): Promise<{ contractId: string; contractCode: string; componentId: string }[]> {
  const contracts = await listContracts(ctx.actor, {
    companyIds: [companyId],
    statuses: ['activ'],
  });

  const individual = contracts.filter((contract) => contract.type.startsWith('individual'));
  const targets = await Promise.all(
    individual.map(async (contract) => {
      const components = await listComponents(ctx.actor, contract.id);
      const component = components.find((candidate) => candidate.type === 'individual');
      return component === undefined
        ? null
        : { contractId: contract.id, contractCode: contract.code, componentId: component.id };
    }),
  );

  return targets.filter((target): target is NonNullable<typeof target> => target !== null);
}

// ── Catalogul de operatiuni ──────────────────────────────────────────────────

export const operatiuni = defineEntity<OperationRow>({
  slug: 'operatiuni',
  singular: 'Operațiune',
  plural: 'Catalog de operațiuni',
  icon: 'library',
  group: 'libraries',
  usesPeriod: false,
  canWrite: canEditNomenclature,

  list: {
    load: (ctx, query) =>
      listOperations(ctx.actor, { query: query.query, includeInactive: true, limit: 500 }),
    rowKey: (row) => row.id,
    rowHref: (row) => `/operatiuni/${row.id}`,
    searchPlaceholder: 'Caută după cod, denumire sau categorie',
    notice:
      'Catalogul transformă valoarea estimată dintr-o cifră „din ochi” într-una calculată: normă de timp × tariful curent al calificării + materialele tipice. Manopera nu se tastează — se derivează la fiecare salvare.',
    empty: {
      title: 'Catalogul e gol',
      body: 'Fără catalog, pragul de rutare de 2.000 lei depinde de cine a scris cifra, nu de operațiune. Prima operațiune e cea mai des repetată la voi.',
      actionLabel: 'Adaugă prima operațiune',
    },
    columns: [
      {
        key: 'code',
        header: 'Cod',
        width: '8rem',
        cell: (row) => <span className="font-mono text-xs text-ink-muted">{row.code}</span>,
      },
      {
        key: 'name',
        header: 'Denumire',
        cell: (row) => (
          <span className="flex items-center gap-2">
            <CellTitle>{row.name}</CellTitle>
            {row.isActive ? null : <Badge tone="neutral">Inactivă</Badge>}
          </span>
        ),
      },
      {
        key: 'category',
        header: 'Categorie',
        width: '11rem',
        hideBelow: 'md',
        cell: (row) => (row.category === null ? <Empty /> : <CellMeta>{row.category}</CellMeta>),
      },
      {
        key: 'hours',
        header: 'Normă',
        align: 'right',
        width: '7rem',
        cell: (row) => <CellMeta>{row.standardHours} h</CellMeta>,
      },
      {
        key: 'labor',
        header: 'Manoperă',
        align: 'right',
        width: '8rem',
        cell: (row) => <Money value={MoneyValue.fromDb(row.estimatedLabor)} />,
      },
      {
        key: 'material',
        header: 'Material',
        align: 'right',
        width: '8rem',
        hideBelow: 'md',
        cell: (row) => <Money value={MoneyValue.fromDb(row.estimatedMaterial)} />,
      },
      {
        key: 'total',
        header: 'Total',
        align: 'right',
        width: '8rem',
        cell: (row) => (
          <Money
            value={MoneyValue.fromDb(row.estimatedLabor).add(
              MoneyValue.fromDb(row.estimatedMaterial),
            )}
            emphasis={false}
          />
        ),
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getOperation(ctx.actor, id).catch(() => null),

    header: (row) => ({
      title: row.name,
      breadcrumb: [
        { label: 'Nomenclatoare' },
        { label: 'Catalog de operațiuni', href: '/operatiuni' },
        { label: row.name },
      ],
      badges: [
        { label: row.code, tone: 'brand' },
        ...(row.category === null ? [] : [{ label: row.category, tone: 'outline' as const }]),
        ...(row.isActive ? [] : [{ label: 'Inactivă', tone: 'warning' as const }]),
      ],
      meta: [
        { label: 'Calificare', value: row.qualificationName },
        { label: 'Normă de timp', value: `${row.standardHours} h` },
        {
          label: 'Cost estimat',
          value: (
            <Money
              value={MoneyValue.fromDb(row.estimatedLabor).add(
                MoneyValue.fromDb(row.estimatedMaterial),
              )}
            />
          ),
        },
      ],
    }),

    tabs: [
      {
        slug: '',
        label: 'Prezentare',
        render: (row) => (
          <DefinitionList
            items={[
              { label: 'Cod', value: <span className="font-mono">{row.code}</span> },
              { label: 'Denumire', value: row.name },
              { label: 'Categorie', value: row.category ?? <Empty /> },
              { label: 'Calificare', value: row.qualificationName },
              { label: 'Normă de timp', value: `${row.standardHours} h` },
              {
                label: 'Manoperă estimată',
                value: <Money value={MoneyValue.fromDb(row.estimatedLabor)} />,
                hint: 'Derivată din tariful în vigoare al calificării, la ultima salvare. Nu se recalculează la citire: o cerere evaluată azi nu-și schimbă cifra mâine.',
              },
              {
                label: 'Material estimat',
                value: <Money value={MoneyValue.fromDb(row.estimatedMaterial)} />,
              },
              { label: 'Activă', value: row.isActive ? 'Da' : 'Nu' },
            ]}
          />
        ),
      },

      {
        slug: 'materiale',
        label: 'Materiale tipice',
        count: (row) => (row.materialCount === 0 ? undefined : row.materialCount),
        render: async (row, ctx) => {
          const [lines, products] = await Promise.all([
            listOperationMaterials(ctx.actor, row.id),
            listProducts(ctx.actor, { limit: 1000 }),
          ]);

          return (
            <div className="space-y-3">
              <p className="max-w-prose text-sm text-ink-muted">
                Cantitățile pentru <strong>o singură execuție</strong>. Lista e cantitativă, nu
                valorică: prețurile de referință vin cu aprovizionarea, iar o sumă calculată
                dintr-un preț inventat ar arăta la fel de sigură ca una reală.
              </p>
              <OperationMaterials
                operationId={row.id}
                initialLines={lines.map((line) => ({
                  productId: line.productId,
                  quantity: line.quantity,
                }))}
                products={products.map((product) => ({
                  value: product.id,
                  label: `${product.code} · ${product.name} (${product.uom})`,
                }))}
                canEdit={canEditNomenclature(ctx.session)}
              />
            </div>
          );
        },
      },

      {
        slug: 'realizat',
        label: 'Realizat vs estimat',
        render: async (row, ctx) => {
          const report = await operationActuals(ctx.actor, row.id);

          if (report.executions === 0) {
            return (
              <div className="space-y-3">
                <p className="max-w-prose text-sm text-ink-muted">
                  Ecranul ăsta e mecanismul anti-furt: cost real mediu per operațiune și{' '}
                  <strong>per echipă</strong>. Când aceeași operațiune costă 401 lei la o echipă și
                  476 la alta, diferența se vede aici, nu într-un raport cerut special.
                </p>
                <PhasePlaceholder
                  phase={1}
                  what="Execuțiile reale (se materializează la validarea fișelor de intervenție)"
                />
              </div>
            );
          }

          return (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <Stat
                  label="Execuții"
                  value={String(report.executions)}
                  context="validate din fișe de intervenție"
                />
                <Stat
                  label="Cost real mediu"
                  value={report.avgRealCost?.format() ?? '—'}
                  context={`estimat ${report.avgEstimatedCost?.format() ?? '—'}`}
                />
                <Stat
                  label="Abatere"
                  value={
                    report.deviationPercent === null
                      ? '—'
                      : `${report.deviationPercent > 0 ? '+' : ''}${String(report.deviationPercent)}%`
                  }
                  context="realizat față de estimat, ponderat cu execuțiile"
                  tone={
                    report.deviationPercent !== null && report.deviationPercent > 15
                      ? 'warning'
                      : 'neutral'
                  }
                />
              </div>

              <Table
                caption="Realizat vs estimat, pe echipe"
                rows={report.teams}
                rowKey={(team) => team.teamId}
                rowFlagged={(team) => team.deviationPercent !== null && team.deviationPercent > 15}
                empty={<EmptyState title="Gol" body="Gol." size="sm" />}
                columns={[
                  {
                    key: 'team',
                    header: 'Echipă',
                    cell: (team) => <CellTitle>{team.teamName}</CellTitle>,
                  },
                  {
                    key: 'executions',
                    header: 'Execuții',
                    align: 'right',
                    width: '7rem',
                    cell: (team) => <CellMeta>{String(team.executions)}</CellMeta>,
                  },
                  {
                    key: 'real',
                    header: 'Cost real mediu',
                    align: 'right',
                    width: '10rem',
                    cell: (team) =>
                      team.avgRealCost === null ? <Empty /> : <Money value={team.avgRealCost} />,
                  },
                  {
                    key: 'deviation',
                    header: 'Abatere',
                    align: 'right',
                    width: '8rem',
                    cell: (team) =>
                      team.deviationPercent === null ? (
                        <Empty />
                      ) : team.deviationPercent > 15 ? (
                        <Badge tone="warning">+{String(team.deviationPercent)}% ⚠</Badge>
                      ) : (
                        <CellMeta>
                          {team.deviationPercent > 0 ? '+' : ''}
                          {String(team.deviationPercent)}%
                        </CellMeta>
                      ),
                  },
                ]}
              />
            </div>
          );
        },
      },
    ],

    links: async () => [
      {
        kind: 'up',
        title: 'În sus',
        items: [
          { label: 'Catalogul de operațiuni', href: '/operatiuni' },
          { label: 'Tarife orare', href: '/tarife' },
        ],
      },
    ],

    quickActions: (row, ctx) => [
      ...(canEditNomenclature(ctx.session)
        ? [
            {
              label: 'Modifică operațiunea',
              href: `/operatiuni?edit=${row.id}`,
              tone: 'primary' as const,
            },
          ]
        : []),
      { label: 'Materiale tipice', href: `/operatiuni/${row.id}/materiale` },
      { label: 'Realizat vs estimat', href: `/operatiuni/${row.id}/realizat` },
    ],
  },

  form: {
    schemaKey: 'operatiuni',
    editable: true,
    createTitle: 'Operațiune nouă',
    editTitle: 'Modifică operațiunea',
    loadLookups: async (ctx) => {
      const qualifications = await listQualifications(ctx.actor, {});
      return {
        qualifications: qualifications.map((qualification) => ({
          value: qualification.id,
          label: `${qualification.code} · ${qualification.name}`,
        })),
      };
    },
    fields: (lookups) => [
      {
        name: 'code',
        label: 'Cod',
        control: 'text',
        required: true,
        placeholder: 'OP-118',
        hint: 'Codul pe care îl caută omul din evaluare. Unic.',
        readOnlyOnEdit: true,
      },
      { name: 'name', label: 'Denumire', control: 'text', required: true, full: true },
      { name: 'category', label: 'Categorie', control: 'text' },
      {
        name: 'standardHours',
        label: 'Normă de timp',
        control: 'text',
        required: true,
        suffix: 'ore',
        hint: 'Manopera se calculează din ea × costul orar curent al calificării.',
      },
      {
        name: 'qualificationId',
        label: 'Calificare',
        control: 'select',
        required: true,
        options: lookups.qualifications,
        hint: 'Trebuie să aibă tarif în vigoare azi, altfel operațiunea nu se salvează.',
      },
      {
        name: 'estimatedMaterial',
        label: 'Material estimat',
        control: 'text',
        required: true,
        suffix: 'lei',
      },
      { name: 'isActive', label: 'Activă', control: 'checkbox', full: true },
    ],
    blank: {
      code: '',
      name: '',
      category: '',
      standardHours: '1',
      qualificationId: '',
      estimatedMaterial: '0',
      isActive: true,
    },
    toFormValues: (row) => ({
      code: row.code,
      name: row.name,
      category: row.category ?? '',
      standardHours: row.standardHours,
      qualificationId: row.qualificationId,
      estimatedMaterial: row.estimatedMaterial,
      isActive: row.isActive,
    }),
  },
});
