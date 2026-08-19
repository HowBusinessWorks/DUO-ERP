import { COST_DOCUMENT_TYPE_LABELS, EXPENSE_TYPE_LABELS } from '@damina/contracts';
import {
  contractMargin,
  findPeriodId,
  listContracts,
  listReconciliation,
  type ContractMargin,
  type ReconciliationRow,
} from '@damina/services';
import { Money as MoneyValue } from '@damina/shared';
import { Banner, CellMeta, CellTitle, EmptyState, Money, Stat, Table } from '@damina/ui';
import Link from 'next/link';
import type { EntityContext } from '../../registry/types';

/**
 * Ecranele transversale de bani (§3.4).
 *
 * Regula care le tine pe amandoua: **fiecare ecran cu cifre declara pe ce
 * analitica e construit**, si o declara pe ecran, nu in documentatie. Marja si
 * plafoanele se citesc pe „descarcat" — cine plateste. Istoricul obiectivului se
 * citeste pe „folosit". Doua ecrane care ar arata cifre diferite fara sa spuna
 * care e care sunt mai rele decat un singur ecran.
 */

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

// ── Bani › Marjă și plafoane ─────────────────────────────────────────────────

interface MarginLine {
  readonly contractId: string;
  readonly contractCode: string;
  readonly clientName: string;
  readonly margin: ContractMargin;
}

/**
 * Marja pe contract, pe luna din context.
 *
 * Comutatorul brut/net e **vizibil permanent**, si nu ca un buton de setare
 * ascuns: sunt doua vederi ale meniului, fiecare cu ruta ei. Altfel doi oameni ar
 * citi doua cifre si ar crede amandoi ca se uita la aceeasi.
 */
export async function MarginScreen({ ctx, net }: { ctx: EntityContext; net: boolean }) {
  const contracts = await listContracts(ctx.actor, {
    companyIds: ctx.app.selectedCompanyIds,
  });

  const lines: MarginLine[] = [];
  for (const contract of contracts) {
    const periodId = await findPeriodId(ctx.actor, contract.companyId, ctx.app.year, ctx.app.month);
    if (periodId === null) continue;

    lines.push({
      contractId: contract.id,
      contractCode: contract.code,
      clientName: contract.clientName,
      margin: await contractMargin(ctx.actor, contract.id, periodId, net ? 'net' : 'gross'),
    });
  }

  const total = (pick: (line: MarginLine) => MoneyValue): MoneyValue =>
    MoneyValue.sum(lines.map(pick));

  if (lines.length === 0) {
    return (
      <EmptyState
        title="Nicio lună deschisă pe firmele selectate"
        body="Marja se calculează pe luna din selectorul de sus. Dacă luna nu există la firma asta, nu e nimic de adunat — deschide-o din Închidere de perioadă."
      />
    );
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink-muted">
        Analitica: <strong className="text-ink">descărcat</strong> — cine plătește, nu unde s-a
        lucrat. Baza:{' '}
        <strong className="text-ink">
          {net ? 'marjă netă, cu regie' : 'marjă brută, fără regie'}
        </strong>
        . Comutatorul e sus, lângă vederile listei.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Venit alocat"
          value={<Money value={total((line) => line.margin.revenue)} />}
          context="Cât s-a promis din componente, în luna asta"
        />
        <Stat
          label="Cost direct"
          value={<Money value={total((line) => line.margin.directCost)} />}
          context="Consumat, pe analitica „descărcat”"
        />
        <Stat
          label="Regie"
          value={<Money value={total((line) => line.margin.overhead)} />}
          context={
            net ? 'Din fotografia lunii, nu din procentul de azi' : 'Nu intră în marja brută'
          }
        />
        <Stat
          label={net ? 'Marjă netă' : 'Marjă brută'}
          value={<Money value={total((line) => line.margin.margin)} />}
          context={net ? 'Venit − cost direct − regie' : 'Venit − cost direct, fără regie'}
          tone={total((line) => line.margin.margin).isNegative() ? 'danger' : 'success'}
        />
      </div>

      <Table<MarginLine>
        caption="Marja fiecărui contract pe luna selectată"
        rows={lines}
        rowKey={(line) => line.contractId}
        rowHref={(line) => `/contracte/${line.contractId}`}
        rowFlagged={(line) => line.margin.margin.isNegative()}
        columns={[
          {
            key: 'contract',
            header: 'Contract',
            cell: (line) => (
              <div>
                <CellTitle>{line.contractCode}</CellTitle>
                <CellMeta>{line.clientName}</CellMeta>
              </div>
            ),
          },
          {
            key: 'revenue',
            header: 'Venit alocat',
            align: 'right',
            cell: (line) => <Money value={line.margin.revenue} />,
          },
          {
            key: 'direct',
            header: 'Cost direct',
            align: 'right',
            cell: (line) => <Money value={line.margin.directCost} />,
          },
          {
            key: 'overhead',
            header: 'Regie',
            align: 'right',
            hideBelow: 'md',
            cell: (line) =>
              net ? (
                <div>
                  <Money value={line.margin.overhead} />
                  {line.margin.overheadPct === null ? (
                    <CellMeta>lună nerecalculată</CellMeta>
                  ) : (
                    <CellMeta>
                      {(Number(line.margin.overheadPct) * 100).toFixed(2).replace('.', ',')}%
                    </CellMeta>
                  )}
                </div>
              ) : (
                <CellMeta>—</CellMeta>
              ),
          },
          {
            key: 'margin',
            header: net ? 'Marjă netă' : 'Marjă brută',
            align: 'right',
            cell: (line) => <Money value={line.margin.margin} />,
          },
        ]}
        empty={
          <EmptyState
            title="Niciun contract"
            body="Pe firmele selectate nu există contracte cu lună deschisă."
          />
        }
      />
    </div>
  );
}

// ── Bani › Reconciliere „folosit vs descărcat” ───────────────────────────────

/**
 * Liniile unde cele doua analitici difera (§12, verificarea #15).
 *
 * Interogarea merge pe indexul partial din 0017, care contine EXACT anomaliile.
 * Ecranul nu are filtru implicit care sa scurteze lista: daca ea creste
 * necontrolat, problema e in firma, nu in software — si atunci trebuie sa se vada.
 */
export async function ReconciliationScreen({ ctx }: { ctx: EntityContext }) {
  const periodIds = await Promise.all(
    ctx.app.selectedCompanyIds.map((companyId) =>
      findPeriodId(ctx.actor, companyId, ctx.app.year, ctx.app.month),
    ),
  );

  const rows: ReconciliationRow[] = [];
  for (const periodId of periodIds) {
    if (periodId === null) continue;
    rows.push(
      ...(await listReconciliation(ctx.actor, {
        companyIds: ctx.app.selectedCompanyIds,
        periodId,
      })),
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Banner
          tone="success"
          title="Nicio linie desperecheată în luna asta"
          body="Pe toate liniile de cost, „folosit” și „descărcat” arată spre același contract. Așa arată luna în care nimeni n-a avut nevoie să mute un cost de pe un buget pe altul."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Banner
        tone="warning"
        title={`${String(rows.length)} linii cu analitici diferite`}
        body="Fiecare rând înseamnă un cost care s-a produs într-un loc și se plătește din alt buget. E legitim — dar dacă lista crește în fiecare lună, decizia de rutare se ia prost, și asta se rezolvă în proces, nu în software."
      />

      <Table<ReconciliationRow>
        caption="Liniile de cost unde analitica „folosit” diferă de „descărcat”"
        rows={rows}
        rowKey={(row) => row.id}
        maxBodyHeight="34rem"
        columns={[
          {
            key: 'date',
            header: 'Efect',
            width: '7rem',
            cell: (row) => <CellTitle>{dateFormat.format(new Date(row.effectDate))}</CellTitle>,
          },
          {
            key: 'unit',
            header: 'Unitatea',
            cell: (row) => (
              <div>
                <CellTitle>{row.workUnitCode ?? '—'}</CellTitle>
                <CellMeta>
                  {EXPENSE_TYPE_LABELS[row.expenseType as keyof typeof EXPENSE_TYPE_LABELS] ??
                    row.expenseType}
                </CellMeta>
              </div>
            ),
          },
          {
            key: 'used',
            header: 'Folosit',
            cell: (row) => (
              <div>
                <CellTitle>{row.usedContractCode ?? '—'}</CellTitle>
                <CellMeta>{row.usedComponentName ?? '—'}</CellMeta>
              </div>
            ),
          },
          {
            key: 'charged',
            header: 'Descărcat',
            cell: (row) => (
              <div>
                <CellTitle>{row.chargedContractCode ?? '—'}</CellTitle>
                <CellMeta>{row.chargedComponentName ?? '—'}</CellMeta>
              </div>
            ),
          },
          {
            key: 'document',
            header: 'Document',
            hideBelow: 'lg',
            cell: (row) => (
              <CellMeta>
                {COST_DOCUMENT_TYPE_LABELS[
                  row.documentType as keyof typeof COST_DOCUMENT_TYPE_LABELS
                ] ?? row.documentType}{' '}
                #{row.documentId.slice(-8)}
              </CellMeta>
            ),
          },
          {
            key: 'amount',
            header: 'Valoare',
            align: 'right',
            width: '8rem',
            cell: (row) => <Money value={MoneyValue.fromDb(row.amount)} />,
          },
          {
            key: 'go',
            header: '',
            width: '5rem',
            cell: (row) =>
              row.workUnitId === null ? null : (
                <Link
                  href={`/activitate/${row.workUnitId}/costuri`}
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  Deschide
                </Link>
              ),
          },
        ]}
        empty={<EmptyState title="Nimic" body="Nicio linie desperecheată." />}
        footer={
          <tr>
            <td colSpan={5} className="px-3 py-2 text-sm font-medium text-ink">
              Total mutat
            </td>
            <td className="px-3 py-2 text-right text-sm font-semibold text-ink">
              <Money value={MoneyValue.sum(rows.map((row) => MoneyValue.fromDb(row.amount)))} />
            </td>
            <td />
          </tr>
        }
      />
    </div>
  );
}
