import { canEditNomenclature } from '@damina/auth';
import { OBJECTIVE_KIND_LABELS, OBJECTIVE_KINDS } from '@damina/contracts';
import {
  getObjective,
  listContracts,
  listContractsForObjective,
  listInspectionProfiles,
  listObjectives,
  objectiveCostHistory,
  type ObjectiveCostYear,
  type ObjectiveRow,
} from '@damina/services';
import { Badge, CellMeta, CellTitle, EmptyState, Money, Table } from '@damina/ui';
import { History, MapPin } from 'lucide-react';
import { DefinitionList, Empty } from '../components/detail/definition-list';
import { PhasePlaceholder } from '../components/detail/phase-placeholder';
import { ObjectiveMap, type MapPin as Pin } from '../components/objective/objective-map';
import { defineEntity } from './types';

/**
 * OBIECTIVUL — nomenclator COMUN celor 5 firme.
 *
 * Nu are `company_id` si nicio interogare de aici nu filtreaza pe firma (regula
 * 4 a pasului). Aceeasi statie de pompare e a grupului, nu a unei firme, si
 * poate fi simultan pe doua contracte, la firme diferite, cu profile de
 * inspectie diferite.
 *
 * De aceea tab-ul Istoric e transversal si e etichetat explicit ca fiind
 * construit pe analitica **„folosit”**: el ramane intact indiferent de cate ori
 * se muta finantarea intre contracte. Asta e diferenta pe care utilizatorul
 * trebuie s-o vada, si de aceea eticheta nu e optionala.
 */

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const formatDate = (value: string | null): string =>
  value === null ? '—' : dateFormat.format(new Date(`${value}T00:00:00`));

const kindLabel = (kind: string): string =>
  OBJECTIVE_KIND_LABELS[kind as keyof typeof OBJECTIVE_KIND_LABELS] ?? kind;

const hasCoordinates = (row: ObjectiveRow): boolean =>
  row.geoLat !== null && row.geoLng !== null;

export const obiective = defineEntity<ObjectiveRow>({
  slug: 'obiective',
  singular: 'Obiectiv',
  plural: 'Obiective',
  icon: 'mapPin',
  group: 'operational',
  // Obiectivul nu depinde de luna: e un amplasament, nu o cifra. Ecranul lui
  // ascunde selectorul de perioada (§5.2).
  usesPeriod: false,
  canWrite: canEditNomenclature,

  list: {
    load: (ctx, query) => listObjectives(ctx.actor, { query: query.query, limit: 1000 }),
    rowKey: (row) => row.id,
    rowHref: (row) => `/obiective/${row.id}`,
    rowFlagged: (row) => row.activeContractCount > 1,
    searchPlaceholder: 'Caută după cod sau denumire',
    notice:
      'Obiectivele sunt nomenclator comun celor 5 firme — nu aparțin unui contract. Legătura cu contractul e o entitate proprie, cu perioadă și cu profil de inspecție.',
    views: [
      { key: '', label: 'Tabel' },
      { key: 'harta', label: 'Hartă' },
      { key: 'acoperire', label: 'Acoperire inspecții' },
      { key: 'profile', label: 'Profile de inspecție' },
    ],
    renderView: async (rows, view, ctx) => {
      if (view === 'harta') {
        return <ObjectivesMapView rows={rows} />;
      }
      if (view === 'profile') {
        const profiles = await listInspectionProfiles(ctx.actor);
        return <ProfilesView profiles={profiles} />;
      }
      const contracts = await listContracts(ctx.actor, {
        companyIds: ctx.app.selectedCompanyIds,
      });
      return <CoveragePicker contracts={contracts} />;
    },
    empty: {
      title: 'Niciun obiectiv',
      body: 'Obiectivele sunt amplasamentele pe care se lucrează: stații de pompare, bazine, clădiri, guri de canal. Fără ele, nicio lucrare nu are unde să se agațe.',
      actionLabel: 'Adaugă primul obiectiv',
    },
    columns: [
      {
        key: 'code',
        header: 'Cod',
        width: '9rem',
        cell: (row) => <span className="font-mono text-xs text-ink-muted">{row.code}</span>,
      },
      {
        key: 'name',
        header: 'Denumire',
        cell: (row) => (
          <span className="flex items-center gap-2">
            <CellTitle>{row.name}</CellTitle>
            {row.isActive ? null : <Badge tone="neutral">Inactiv</Badge>}
          </span>
        ),
      },
      {
        key: 'kind',
        header: 'Tip',
        width: '11rem',
        cell: (row) => <CellMeta>{kindLabel(row.kind)}</CellMeta>,
      },
      {
        key: 'contracts',
        header: 'Contracte active',
        align: 'right',
        width: '9rem',
        cell: (row) =>
          row.activeContractCount === 0 ? (
            <Badge tone="neutral">niciunul</Badge>
          ) : row.activeContractCount === 1 ? (
            <CellMeta>1</CellMeta>
          ) : (
            // Simultan pe doua contracte, la firme diferite: e cazul real, nu o
            // anomalie. Se marcheaza pentru ca schimba felul in care se citesc
            // costurile obiectivului.
            <Badge tone="brand">{row.activeContractCount}</Badge>
          ),
      },
      {
        key: 'area',
        header: 'Suprafață',
        align: 'right',
        width: '8rem',
        hideBelow: 'lg',
        cell: (row) =>
          row.areaSqm === null ? <Empty /> : <CellMeta>{row.areaSqm} m²</CellMeta>,
      },
      {
        key: 'geo',
        header: 'Coordonate',
        width: '7rem',
        hideBelow: 'md',
        cell: (row) =>
          hasCoordinates(row) ? (
            <span title={`${String(row.geoLat)}, ${String(row.geoLng)}`}>
              <MapPin className="size-4 text-brand-600" aria-label="Are coordonate" />
            </span>
          ) : (
            <Empty />
          ),
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getObjective(ctx.actor, id).catch(() => null),

    header: (row) => ({
      title: row.name,
      breadcrumb: [
        { label: 'Operațional' },
        { label: 'Obiective', href: '/obiective' },
        { label: row.name },
      ],
      badges: [
        { label: row.code, tone: 'brand' },
        { label: kindLabel(row.kind), tone: 'outline' },
        ...(row.activeContractCount > 1
          ? [{ label: `Pe ${String(row.activeContractCount)} contracte`, tone: 'brand' as const }]
          : []),
        ...(row.isActive ? [] : [{ label: 'Inactiv', tone: 'warning' as const }]),
      ],
      meta: [
        { label: 'Contracte active', value: String(row.activeContractCount) },
        { label: 'Suprafață', value: row.areaSqm === null ? '—' : `${row.areaSqm} m²` },
      ],
    }),

    tabs: [
      {
        slug: '',
        label: 'Prezentare',
        render: (row) => (
          <div className="space-y-5">
            <DefinitionList
              items={[
                { label: 'Cod', value: <span className="font-mono">{row.code}</span> },
                { label: 'Denumire', value: row.name },
                { label: 'Tip', value: kindLabel(row.kind) },
                {
                  label: 'Suprafață',
                  value: row.areaSqm === null ? <Empty /> : `${row.areaSqm} m²`,
                },
                {
                  label: 'Latitudine',
                  value: row.geoLat ?? <Empty />,
                },
                {
                  label: 'Longitudine',
                  value: row.geoLng ?? <Empty />,
                  hint: hasCoordinates(row)
                    ? undefined
                    : 'Fără coordonate obiectivul nu apare pe hartă.',
                },
                { label: 'Activ', value: row.isActive ? 'Da' : 'Nu' },
              ]}
            />

            {hasCoordinates(row) ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <ObjectiveMap
                  height="20rem"
                  pins={[
                    {
                      id: row.id,
                      lat: Number(row.geoLat),
                      lng: Number(row.geoLng),
                      label: row.name,
                      meta: `${row.code} · ${kindLabel(row.kind)}`,
                    },
                  ]}
                />
              </div>
            ) : null}
          </div>
        ),
      },

      // ── Istoric: ecranul cerut explicit (§3.5) ────────────────────────────
      {
        slug: 'istoric',
        label: 'Istoric',
        render: async (row, ctx) => {
          const years = await objectiveCostHistory(ctx.actor, row.id);

          return (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-surface-sunken px-4 py-3">
                <p className="text-sm text-ink">
                  Istoricul e <strong>transversal peste contracte și peste ani</strong>: tot ce s-a
                  întâmplat la {row.name}, indiferent din ce contract a fost finanțat și la ce firmă.
                </p>
                <p className="mt-1.5 text-sm text-ink-muted">
                  Construit pe analitica <strong className="text-ink">folosit</strong> — nu pe
                  „descărcat”. Diferența e exact ce face ecranul ăsta să rămână intact când
                  finanțarea se mută de pe un contract pe altul: banii se plimbă, obiectivul rămâne
                  același.
                </p>
              </div>

              {years.length === 0 ? (
                <EmptyState
                  icon={<History className="size-5" aria-hidden="true" />}
                  title="Niciun cost înregistrat la obiectivul ăsta"
                  body="Costurile apar din documentele care le produc, pe unitățile de lucru legate de obiectiv. Structura ecranului e deja cea finală: total anual și medie lunară, pe ani."
                />
              ) : (
                <Table<ObjectiveCostYear>
                  caption="Costul obiectivului pe ani, pe analitica „folosit”"
                  rows={years}
                  rowKey={(year) => String(year.year)}
                  columns={[
                    {
                      key: 'year',
                      header: 'An',
                      width: '6rem',
                      cell: (year) => <CellTitle>{String(year.year)}</CellTitle>,
                    },
                    {
                      key: 'total',
                      header: 'Total',
                      align: 'right',
                      cell: (year) => <Money value={year.total} />,
                    },
                    {
                      key: 'average',
                      header: 'Medie lunară',
                      align: 'right',
                      cell: (year) => (
                        <div>
                          <Money value={year.monthlyAverage} />
                          <CellMeta>
                            pe {String(year.monthsWithActivity)}{' '}
                            {year.monthsWithActivity === 1 ? 'lună' : 'luni'} cu activitate
                          </CellMeta>
                        </div>
                      ),
                    },
                    {
                      key: 'units',
                      header: 'Unități de lucru',
                      align: 'right',
                      hideBelow: 'md',
                      cell: (year) => <span>{String(year.workUnitCount)}</span>,
                    },
                  ]}
                  empty={
                    <EmptyState title="Niciun an" body="Nu există costuri pe obiectivul ăsta." />
                  }
                />
              )}

              <p className="text-xs text-ink-subtle">
                Analitica: <strong>folosit</strong>. Media lunară se împarte la lunile{' '}
                <strong>cu activitate</strong>, nu la 12: o stație atinsă în două luni din an n-a
                costat „media pe douăsprezece”, iar cifra aia n-ar ajuta la nicio comparație.
              </p>
            </div>
          );
        },
      },

      // ── Contracte: pe ce contracte a fost si este, in timp si simultan ────
      {
        slug: 'contracte',
        label: 'Contracte',
        render: async (row, ctx) => {
          const rows = await listContractsForObjective(ctx.actor, row.id);
          const simultaneous = rows.filter((entry) => entry.isCurrent).length;

          return (
            <div className="space-y-3">
              <p className="max-w-prose text-sm text-ink-muted">
                Obiectivul poate fi pe mai multe contracte în același timp, la firme diferite — e
                cazul real, nu o anomalie.{' '}
                {simultaneous > 1
                  ? `Acum e pe ${String(simultaneous)} contracte simultan.`
                  : 'Profilul de inspecție e al fiecărei legături în parte, nu al obiectivului.'}
              </p>

              <Table
                caption="Contractele obiectivului"
                rows={rows}
                rowKey={(entry) => `${entry.contractId}-${entry.validFrom}`}
                rowHref={(entry) => `/contracte/${entry.contractId}/obiective`}
                rowFlagged={(entry) => entry.isCurrent}
                empty={
                  <EmptyState
                    title="Obiectivul nu e pe niciun contract"
                    body="Fără o legătură cu un contract, la obiectiv nu se poate finanța nicio lucrare. Legătura se face din tab-ul Obiective al contractului."
                    size="sm"
                    className="rounded-lg border border-dashed border-border bg-surface"
                  />
                }
                columns={[
                  {
                    key: 'code',
                    header: 'Contract',
                    width: '8rem',
                    cell: (entry) => <span className="font-mono text-xs">{entry.code}</span>,
                  },
                  {
                    key: 'company',
                    header: 'Firmă',
                    cell: (entry) => <CellTitle>{entry.companyName}</CellTitle>,
                  },
                  {
                    key: 'client',
                    header: 'Client',
                    hideBelow: 'md',
                    cell: (entry) => <CellMeta>{entry.clientName}</CellMeta>,
                  },
                  {
                    key: 'period',
                    header: 'Perioadă',
                    width: '15rem',
                    cell: (entry) => (
                      <CellMeta>
                        {formatDate(entry.validFrom)} →{' '}
                        {entry.validTo === null ? 'fără sfârșit' : formatDate(entry.validTo)}
                      </CellMeta>
                    ),
                  },
                  {
                    key: 'state',
                    header: 'Stare',
                    width: '7rem',
                    cell: (entry) =>
                      entry.isCurrent ? (
                        <Badge tone="success">activ</Badge>
                      ) : (
                        <Badge tone="neutral">încheiat</Badge>
                      ),
                  },
                ]}
              />
            </div>
          );
        },
      },

      {
        slug: 'inspectii',
        label: 'Inspecții',
        render: () => (
          <div className="space-y-3">
            <p className="max-w-prose text-sm text-ink-muted">
              Frecvențele sunt date de profilul de inspecție al fiecărei legături cu un contract —
              se editează acolo, nu aici. Acoperirea pe lună se citește din tab-ul{' '}
              <strong>Obiective</strong> al contractului.
            </p>
            <PhasePlaceholder phase={1} what="Fișele de inspecție completate la obiectiv" />
          </div>
        ),
      },
      {
        slug: 'documente',
        label: 'Documente',
        render: () => <PhasePlaceholder phase={1} what="Documentele obiectivului" />,
      },
      {
        slug: 'poze',
        label: 'Poze',
        render: () => <PhasePlaceholder phase={1} what="Pozele de la obiectiv" />,
      },
    ],

    links: async (row, ctx) => {
      const contracts = await listContractsForObjective(ctx.actor, row.id);
      const current = contracts.filter((entry) => entry.isCurrent);

      return [
        {
          kind: 'up',
          title: 'În sus',
          items: [
            { label: 'Toate obiectivele', href: '/obiective' },
            { label: 'Vezi pe hartă', href: '/obiective?view=harta' },
          ],
        },
        {
          kind: 'related',
          title: 'Contracte active',
          count: current.length,
          items: current.slice(0, 6).map((entry) => ({
            label: `${entry.code} · ${entry.companyName}`,
            href: `/contracte/${entry.contractId}/obiective`,
            meta: formatDate(entry.validFrom),
            tone: 'success' as const,
          })),
        },
      ];
    },

    quickActions: (row, ctx) => [
      ...(canEditNomenclature(ctx.session)
        ? [
            {
              label: 'Modifică obiectivul',
              href: `/obiective?edit=${row.id}`,
              tone: 'primary' as const,
            },
          ]
        : []),
      { label: 'Vezi istoricul', href: `/obiective/${row.id}/istoric` },
      { label: 'Deschide o cerere', disabledReason: 'Cererile vin în pasul 08.' },
    ],
  },

  form: {
    schemaKey: 'obiective',
    editable: true,
    createTitle: 'Obiectiv nou',
    editTitle: 'Modifică obiectivul',
    fields: () => [
      {
        name: 'code',
        label: 'Cod',
        control: 'text',
        required: true,
        placeholder: 'SP-014',
        hint: 'Codul de pe teren. Unic, indiferent de scris.',
        readOnlyOnEdit: true,
      },
      { name: 'name', label: 'Denumire', control: 'text', required: true, full: true },
      {
        name: 'kind',
        label: 'Tip',
        control: 'select',
        required: true,
        options: OBJECTIVE_KINDS.map((kind) => ({
          value: kind,
          label: OBJECTIVE_KIND_LABELS[kind],
        })),
      },
      { name: 'areaSqm', label: 'Suprafață', control: 'number', suffix: 'm²' },
      {
        name: 'geoLat',
        pairedWith: 'geoLng',
        label: 'Coordonate',
        control: 'geo',
        hint: 'Grade zecimale, până la 7 zecimale (≈1 cm).',
      },
      { name: 'isActive', label: 'Activ', control: 'checkbox', full: true },
    ],
    blank: {
      code: '',
      name: '',
      kind: 'statie_pompare',
      areaSqm: '',
      geoLat: '',
      geoLng: '',
      isActive: true,
    },
    toFormValues: (row) => ({
      code: row.code,
      name: row.name,
      kind: row.kind,
      areaSqm: row.areaSqm ?? '',
      geoLat: row.geoLat ?? '',
      geoLng: row.geoLng ?? '',
      isActive: row.isActive,
    }),
  },
});

// ── Vederile listei ──────────────────────────────────────────────────────────

/**
 * Vederea harta. ACELEASI randuri ca tabelul, alta reprezentare.
 *
 * Obiectivele fara coordonate nu dispar in tacere: sunt numarate sub harta.
 * Un obiectiv care lipseste de pe harta pentru ca n-are pin arata identic cu
 * unul care nu exista — si atunci nimeni nu-i completeaza coordonatele.
 */
function ObjectivesMapView({ rows }: { rows: readonly ObjectiveRow[] }) {
  const pins: Pin[] = rows.filter(hasCoordinates).map((row) => ({
    id: row.id,
    lat: Number(row.geoLat),
    lng: Number(row.geoLng),
    label: row.name,
    meta: `${row.code} · ${kindLabel(row.kind)}`,
    href: `/obiective/${row.id}`,
  }));

  const missing = rows.length - pins.length;

  if (pins.length === 0) {
    return (
      <EmptyState
        icon={<MapPin className="size-5" aria-hidden="true" />}
        title="Niciun obiectiv cu coordonate"
        body="Harta desenează doar obiectivele care au latitudine și longitudine. Coordonatele se pun din formularul obiectivului, tastate sau cu un click pe hartă."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="min-h-96 flex-1 overflow-hidden rounded-lg border border-border">
        <ObjectiveMap pins={pins} height="100%" />
      </div>
      <p className="text-sm text-ink-subtle">
        {pins.length} obiective pe hartă
        {missing === 0
          ? '.'
          : ` · ${String(missing)} fără coordonate, deci nedesenabile. Completează-le din formular.`}
      </p>
    </div>
  );
}

/** Vederea „Profile de inspecție”: fisele si frecventele fiecarui profil. */
function ProfilesView({
  profiles,
}: {
  profiles: Awaited<ReturnType<typeof listInspectionProfiles>>;
}) {
  if (profiles.length === 0) {
    return (
      <EmptyState
        title="Niciun profil de inspecție"
        body="Profilul spune ce fișe se completează la un obiectiv și cât de des. Se atașează legăturii contract↔obiectiv, nu obiectivului — același obiectiv poate avea frecvențe diferite pe contracte diferite."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-ink-muted">
        Profilul stă pe <strong>legătura cu contractul</strong>, nu pe obiectiv. Fișele sunt
        versionate: o fișă completată păstrează versiunea cu care a fost completată, ca să rămână
        interpretabilă peste doi ani.
      </p>

      {profiles.map((profile) => (
        <article key={profile.id} className="rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">{profile.name}</h2>
            {profile.isActive ? (
              <Badge tone="success">activ</Badge>
            ) : (
              <Badge tone="neutral">inactiv</Badge>
            )}
          </div>
          {profile.description === null ? null : (
            <p className="mt-1 text-sm text-ink-muted">{profile.description}</p>
          )}

          {profile.items.length === 0 ? (
            <p className="mt-2 text-sm text-warning-700">
              Profilul n-are nicio fișă. Un obiectiv cu profilul ăsta nu produce nicio restanță —
              adică nu se măsoară nimic.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {profile.items.map((item) => (
                <li
                  key={item.checklistId}
                  className="flex items-baseline justify-between gap-4 py-1.5 text-sm"
                >
                  <span>{item.checklistName}</span>
                  <span data-numeric className="tabular-nums text-ink-muted">
                    la {item.frequencyMonths} {item.frequencyMonths === 1 ? 'lună' : 'luni'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}

/**
 * Vederea „Acoperire inspectii”: alegerea contractului.
 *
 * Acoperirea se citeste PE CONTRACT, nu global, pentru ca frecventele stau pe
 * legatura contract↔obiectiv. Un tabel global ar fi trebuit sa aleaga una din
 * frecventele aceluiasi obiectiv si sa le ascunda pe celelalte.
 */
function CoveragePicker({
  contracts,
}: {
  contracts: Awaited<ReturnType<typeof listContracts>>;
}) {
  if (contracts.length === 0) {
    return (
      <EmptyState
        title="Niciun contract pe firmele selectate"
        body="Acoperirea inspecțiilor se citește pe contract: frecvențele stau pe legătura contract↔obiectiv, nu pe obiectiv."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-ink-muted">
        Alege contractul. Acoperirea lui se vede în tab-ul <strong>Obiective</strong>, pentru luna
        selectată în bara de sus — <strong>fără nicio notificare către teren</strong>.
      </p>
      <Table
        caption="Contracte cu acoperire de inspecții"
        rows={contracts}
        rowKey={(contract) => contract.id}
        rowHref={(contract) => `/contracte/${contract.id}/obiective`}
        empty={<EmptyState title="Gol" body="Gol." size="sm" />}
        columns={[
          {
            key: 'code',
            header: 'Cod',
            width: '7rem',
            cell: (contract) => <span className="font-mono text-xs">{contract.code}</span>,
          },
          {
            key: 'client',
            header: 'Client',
            cell: (contract) => <CellTitle>{contract.clientName}</CellTitle>,
          },
          {
            key: 'company',
            header: 'Firmă',
            hideBelow: 'md',
            cell: (contract) => <CellMeta>{contract.companyName}</CellMeta>,
          },
          {
            key: 'go',
            header: '',
            align: 'right',
            width: '10rem',
            // Randul intreg e deja o ancora (`rowHref`). O a doua ancora
            // inauntrul ei ar fi HTML invalid si ar rupe navigarea cu tastatura.
            cell: () => <CellMeta>Vezi acoperirea →</CellMeta>,
          },
        ]}
      />
    </div>
  );
}
