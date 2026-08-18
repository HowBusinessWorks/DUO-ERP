import { canReadInventory, canSeeFinancials, canWriteInventory } from '@damina/auth';
import { LOCATION_TYPE_LABELS, type LocationType } from '@damina/contracts';
import {
  listConsumptionNotes,
  listDocumentSeries,
  listLocations,
  listStagesForCompanies,
  listStock,
  listTeamOptions,
  listWorkUnits,
  type StockRow,
} from '@damina/services';
import { Badge, CellMeta, CellTitle, EmptyState, Money } from '@damina/ui';
import { PhasePlaceholder } from '../components/detail/phase-placeholder';
import { ConsumptionNotes } from '../components/inventory/consumption-notes';
import { LocationList } from '../components/inventory/location-list';
import { defineEntity, type EntityContext } from './types';

/**
 * Aprovizionare — **minimul fazei 1** (pasul 09, §3.4).
 *
 * Din modulul intreg exista acum trei ecrane: stocul cu cele trei coloane,
 * lista de gestiuni si bonurile de consum. Restul (necesare, comenzi, NIR,
 * transferuri, inventare, rezervari) e faza 3 si spune asta pe fiecare vedere,
 * in loc sa lipseasca din meniu — o legatura care se rupe la sosire e mai rea
 * decat un ecran care se prezinta.
 *
 * **Regula 3 a pasului traieste in enum, nu aici**: nu exista „gestiune de
 * contract", fiindca `location_type` n-are valoarea asta. Contractul apare pe
 * bonul de consum, ca dimensiune analitica. Formularul de gestiune n-are cum
 * s-o ofere, si de asta verificarea #16 trece negativ, prin constructie.
 *
 * Tipul de gestiune e **vedere**, nu filtru de tabel: e intrebarea de nivel
 * inalt din §3.5 („unde ma uit"), si o vedere e navigabila — un filtru tinut in
 * starea componentei n-ar putea fi tinta unui link dintr-o alerta.
 */

const TYPE_VIEWS: Readonly<Record<string, LocationType>> = {
  echipa: 'echipa',
  magazie: 'magazie_centrala',
  santier: 'santier',
};

const stockKey = (row: StockRow): string =>
  `${row.locationId}|${row.productId}|${row.lotId ?? '-'}`;

export const aprovizionare = defineEntity<StockRow>({
  slug: 'aprovizionare',
  singular: 'Stoc',
  plural: 'Aprovizionare',
  icon: 'truck',
  group: 'operational',
  // Stocul e un SOLD, nu un flux de lună: el arată ce e acum în gestiune, nu ce
  // s-a mișcat în luna aleasă. Un selector de perioadă deasupra lui ar sugera
  // că soldul se schimbă când comuți luna.
  usesPeriod: false,
  canRead: canReadInventory,
  readDeniedReason:
    'Stocul și gestiunile sunt ale aprovizionării. Dacă îți trebuie un sold, cere-l celui care ține magazia — sau un drept, unui administrator.',
  canWrite: canWriteInventory,
  list: {
    load: (ctx, query) =>
      listStock(ctx.actor, {
        companyIds: ctx.app.selectedCompanyIds,
        withCost: canSeeFinancials(ctx.session),
        ...(TYPE_VIEWS[query.view ?? ''] === undefined
          ? {}
          : { locationType: TYPE_VIEWS[query.view ?? ''] }),
      }),
    rowKey: stockKey,
    // Stocul n-are pagina de detaliu: randul e un sold, nu un document. Legatura
    // duce la produsul din nomenclator, unde chiar exista ceva de deschis.
    rowHref: (row) => `/produse/${row.productId}`,
    // Ce nu mai e disponibil desi exista fizic: rezervat integral.
    rowFlagged: (row) => Number(row.available.toDbString()) <= 0,
    searchPlaceholder: 'Caută după produs sau gestiune',
    notice:
      'Disponibilul se calculează la citire, din fizic minus rezervat. Nu există ca a treia coloană în bază — ar fi fost a treia sursă de adevăr pentru același număr, și prima care rămâne în urmă.',
    views: [
      { key: '', label: 'Tot stocul' },
      { key: 'echipa', label: 'Gestiuni de echipă' },
      { key: 'magazie', label: 'Magazii' },
      { key: 'santier', label: 'Șantiere' },
      { key: 'gestiuni', label: 'Gestiuni' },
      { key: 'bonuri', label: 'Bonuri de consum' },
      { key: 'necesare', label: 'Necesare de material' },
      { key: 'comenzi', label: 'Comenzi (PO)' },
      { key: 'receptii', label: 'Recepții' },
      { key: 'transferuri', label: 'Transferuri și retururi' },
      { key: 'inventare', label: 'Inventare' },
      { key: 'rezervari', label: 'Rezervări' },
    ],
    renderView: async (_rows, view, ctx) => {
      if (view === 'gestiuni') {
        return <LocationsView ctx={ctx} />;
      }
      if (view === 'bonuri') {
        return <NotesView ctx={ctx} />;
      }
      if (view === 'necesare' || view === 'comenzi' || view === 'receptii') {
        return <PhasePlaceholder phase={3} what="Necesarul, comenzile și recepțiile" />;
      }
      if (view === 'transferuri' || view === 'inventare' || view === 'rezervari') {
        return <PhasePlaceholder phase={3} what="Transferurile, inventarele și rezervările" />;
      }
      // Vederile pe tip folosesc ACELASI tabel: `load` a filtrat deja.
      return null;
    },
    empty: {
      title: 'Nimic în gestiuni',
      body: 'Stocul apare pe măsură ce intră marfă. În faza asta intrările se scriu direct în mișcările de stoc; NIR-ul și comenzile vin în faza 3. Ce iese, iese pe bon de consum — din intervenție sau manual, din gestiunea echipei.',
    },
    columns: [
      {
        key: 'product',
        header: 'Produs',
        cell: (row) => (
          <div>
            <CellTitle>{row.productName}</CellTitle>
            <CellMeta>{row.productCode}</CellMeta>
          </div>
        ),
      },
      {
        key: 'location',
        header: 'Gestiune',
        width: '14rem',
        cell: (row) => (
          <div>
            <CellTitle>{row.locationName}</CellTitle>
            <CellMeta>
              {LOCATION_TYPE_LABELS[row.locationType as LocationType] ?? row.locationType}
            </CellMeta>
          </div>
        ),
      },
      {
        key: 'physical',
        header: 'Fizic',
        align: 'right',
        width: '7rem',
        cell: (row) => (
          <span data-numeric className="tabular-nums text-ink">
            {row.physical.format()} {row.uom}
          </span>
        ),
      },
      {
        key: 'reserved',
        header: 'Rezervat',
        align: 'right',
        width: '7rem',
        hideBelow: 'md',
        cell: (row) => (
          <span data-numeric className="tabular-nums text-ink-muted">
            {row.reserved.format()}
          </span>
        ),
      },
      {
        key: 'available',
        header: 'Disponibil',
        align: 'right',
        width: '7.5rem',
        cell: (row) => (
          <span
            data-numeric
            className={`font-medium tabular-nums ${
              Number(row.available.toDbString()) <= 0 ? 'text-danger' : 'text-ink'
            }`}
          >
            {row.available.format()}
          </span>
        ),
      },
      {
        key: 'avgCost',
        header: 'CMP',
        align: 'right',
        width: '8rem',
        hideBelow: 'lg',
        // `null` cand rolul n-are dreptul la bani — coloana nici nu e ceruta.
        cell: (row) => (row.avgCost === null ? <Empty /> : <Money value={row.avgCost} />),
      },
    ],
  },
});

function Empty() {
  return <span className="text-ink-subtle">—</span>;
}

/** Gestiunile: liste + creare. Tipul e obligatoriu, si e fizic — §3.4. */
async function LocationsView({ ctx }: { readonly ctx: EntityContext }) {
  const [locations, teams] = await Promise.all([
    listLocations(ctx.actor, { companyIds: ctx.app.selectedCompanyIds, includeInactive: true }),
    listTeamOptions(ctx.actor, ctx.app.selectedCompanyIds),
  ]);

  return (
    <LocationList
      companyId={ctx.app.selectedCompanyIds[0] ?? ''}
      locations={locations.map((location) => ({
        id: location.id,
        name: location.name,
        code: location.code,
        type: location.type,
        isActive: location.isActive,
        isCustody: location.isCustody,
        teamName: teams.find((team) => team.locationId === location.id)?.name ?? null,
      }))}
      teams={teams
        .filter((team) => team.locationId === '')
        .map((team) => ({ id: team.id, name: team.name }))}
      canWrite={canWriteInventory(ctx.session)}
    />
  );
}

/** Bonurile de consum, cu emiterea manuala din gestiunea echipei. */
async function NotesView({ ctx }: { readonly ctx: EntityContext }) {
  const canWrite = canWriteInventory(ctx.session);
  const companyId = ctx.app.selectedCompanyIds[0] ?? '';

  const [notes, locations, units, stages, stock, series] = await Promise.all([
    listConsumptionNotes(ctx.actor, { companyIds: ctx.app.selectedCompanyIds }),
    canWrite
      ? listLocations(ctx.actor, { companyIds: ctx.app.selectedCompanyIds })
      : Promise.resolve([]),
    canWrite
      ? listWorkUnits(ctx.actor, {
          companyIds: ctx.app.selectedCompanyIds,
          statuses: ['planificata', 'in_executie', 'suspendata'],
          limit: 500,
        })
      : Promise.resolve([]),
    canWrite
      ? listStagesForCompanies(ctx.actor, {
          companyIds: ctx.app.selectedCompanyIds,
          limit: 1000,
        })
      : Promise.resolve([]),
    canWrite
      ? listStock(ctx.actor, {
          companyIds: ctx.app.selectedCompanyIds,
          withCost: canSeeFinancials(ctx.session),
        })
      : Promise.resolve([]),
    canWrite && companyId !== ''
      ? listDocumentSeries(ctx.actor, companyId, 'bon_consum')
      : Promise.resolve([]),
  ]);

  if (notes.length === 0 && !canWrite) {
    return (
      <EmptyState
        title="Niciun bon de consum"
        body="Bonul e documentul care transformă un material în cheltuială. Se emite automat la validarea unei intervenții, sau manual din gestiunea echipei."
      />
    );
  }

  const stagesByUnit = new Map<string, { id: string; name: string }[]>();
  for (const stage of stages) {
    const list = stagesByUnit.get(stage.workUnitId) ?? [];
    list.push({ id: stage.id, name: stage.name });
    stagesByUnit.set(stage.workUnitId, list);
  }

  return (
    <ConsumptionNotes
      notes={notes.map((note) => ({
        id: note.id,
        number: `${note.series}-${note.number}`,
        locationName: note.locationName,
        documentDate: note.documentDate,
        effectDate: note.effectDate,
        status: note.status,
        workUnitId: note.workUnitId,
      }))}
      canWrite={canWrite}
      locations={locations.map((location) => ({ id: location.id, name: location.name }))}
      workUnits={units.map((unit) => ({
        id: unit.id,
        label: `${unit.code} · ${unit.name}`,
        type: unit.type,
        stages: stagesByUnit.get(unit.id) ?? [],
      }))}
      stock={stock.map((entry) => ({
        locationId: entry.locationId,
        productId: entry.productId,
        label: `${entry.productCode} · ${entry.productName}`,
        uom: entry.uom,
        available: entry.available.toDbString(),
      }))}
      series={series.map((entry) => entry.series)}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}

/** Eticheta de stare a unui bon. Exportata pentru ecranul de unitate. */
export function NoteStatusBadge({ status }: { readonly status: string }) {
  return status === 'consumat' ? (
    <Badge tone="success">Consumat</Badge>
  ) : status === 'anulat' ? (
    <Badge tone="danger">Anulat</Badge>
  ) : (
    <Badge tone="neutral">Ciornă</Badge>
  );
}
