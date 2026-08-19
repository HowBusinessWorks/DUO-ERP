import {
  COST_DOCUMENT_TYPE_LABELS,
  COST_STAGE_LABELS,
  EXPENSE_TYPE_LABELS,
  type CostQuery,
} from '@damina/contracts';
import {
  costBreakdown,
  listCostLines,
  type CostBreakdownRow,
  type CostLineRow,
} from '@damina/services';
import { Money as MoneyValue } from '@damina/shared';
import { Badge, CellMeta, CellTitle, EmptyState, Money, Stat, Table } from '@damina/ui';
import type { EntityContext } from '../../registry/types';

/**
 * Tab-ul Costuri, pe unitate de lucru sau pe etapa (§3.4).
 *
 * Trei straturi, in ordinea in care se pun intrebarile: **cat**, apoi **pe ce**,
 * apoi **din ce document**. Fiecare linie duce mai departe, pana la documentul
 * care a produs-o — principiul I3, „orice cifra se desface".
 *
 * Analitica e declarata pe ecran, nu presupusa: cifrele de aici sunt pe
 * **„folosit"** — costul unitatii, nu al bugetului care il plateste. Diferenta
 * conteaza exact atunci cand cineva a mutat finantarea, adica exact cand se pun
 * intrebari.
 */

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const formatDate = (value: string): string => dateFormat.format(new Date(value));

function stageTone(stage: string): 'neutral' | 'brand' | 'success' | 'warning' {
  if (stage === 'angajat') return 'warning';
  if (stage === 'receptionat') return 'brand';
  if (stage === 'facturat') return 'success';
  return 'neutral';
}

export async function CostTab({
  ctx,
  scope,
  emptyBody,
}: {
  ctx: EntityContext;
  scope: { readonly workUnitId?: string; readonly stageId?: string };
  emptyBody: string;
}) {
  const query: CostQuery = {
    ...(scope.workUnitId === undefined ? {} : { workUnitId: scope.workUnitId }),
    ...(scope.stageId === undefined ? {} : { stageId: scope.stageId }),
    limit: 100,
  };

  const [breakdown, lines] = await Promise.all([
    costBreakdown(ctx.actor, scope),
    listCostLines(ctx.actor, query),
  ]);

  if (lines.rows.length === 0) {
    return <EmptyState title="Niciun cost înregistrat" body={emptyBody} />;
  }

  const total = (pick: (row: CostBreakdownRow) => MoneyValue): MoneyValue =>
    MoneyValue.sum(breakdown.map(pick));

  return (
    <div className="space-y-6">
      {/* [1] Cât. Cele patru stadii, în ordinea în care se întâmplă. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Angajat"
          value={<Money value={total((row) => row.committed)} />}
          context="Comandă lansată, marfa încă n-a venit"
        />
        <Stat
          label="Recepționat"
          value={<Money value={total((row) => row.received)} />}
          context="Intrat în gestiune, încă neconsumat"
        />
        <Stat
          label="Consumat"
          value={<Money value={total((row) => row.consumed)} />}
          context="Cheltuit efectiv pe unitatea asta"
        />
        <Stat
          label="Facturat"
          value={<Money value={total((row) => row.invoiced)} />}
          context="Ajuns pe o factură de furnizor"
        />
      </div>

      {/* [2] Pe ce. */}
      <section>
        <h3 className="text-sm font-semibold text-ink">Pe fel de cheltuială</h3>
        <Table<CostBreakdownRow>
          className="mt-2"
          caption="Costurile unității, grupate pe fel de cheltuială și pe stadiu"
          rows={breakdown}
          rowKey={(row) => row.expenseType}
          columns={[
            {
              key: 'type',
              header: 'Fel',
              cell: (row) => (
                <CellTitle>
                  {EXPENSE_TYPE_LABELS[row.expenseType as keyof typeof EXPENSE_TYPE_LABELS] ??
                    row.expenseType}
                </CellTitle>
              ),
            },
            {
              key: 'committed',
              header: 'Angajat',
              align: 'right',
              hideBelow: 'md',
              cell: (row) => <Money value={row.committed} />,
            },
            {
              key: 'received',
              header: 'Recepționat',
              align: 'right',
              hideBelow: 'lg',
              cell: (row) => <Money value={row.received} />,
            },
            {
              key: 'consumed',
              header: 'Consumat',
              align: 'right',
              cell: (row) => <Money value={row.consumed} />,
            },
            {
              key: 'invoiced',
              header: 'Facturat',
              align: 'right',
              hideBelow: 'md',
              cell: (row) => <Money value={row.invoiced} />,
            },
          ]}
          empty={
            <EmptyState
              title="Nimic de desfăcut"
              body="Nu există linii pe care să le grupăm pe fel de cheltuială."
            />
          }
        />
      </section>

      {/* [3] Din ce document. Capătul lanțului de drill-down. */}
      <section>
        <h3 className="text-sm font-semibold text-ink">
          Liniile de cost{' '}
          <span className="font-normal text-ink-muted">
            · analitica: <strong>folosit</strong> — costul unității, nu al bugetului
          </span>
        </h3>
        <Table<CostLineRow>
          className="mt-2"
          caption="Liniile de cost ale unității, cele mai recente întâi"
          maxBodyHeight="32rem"
          rows={lines.rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'date',
              header: 'Efect',
              width: '7rem',
              cell: (row) => (
                <div>
                  <CellTitle>{formatDate(row.effectDate)}</CellTitle>
                  {row.documentDate === row.effectDate ? null : (
                    <CellMeta>doc. {formatDate(row.documentDate)}</CellMeta>
                  )}
                </div>
              ),
            },
            {
              key: 'document',
              header: 'Document',
              cell: (row) => (
                <div>
                  <CellTitle>
                    {COST_DOCUMENT_TYPE_LABELS[
                      row.documentType as keyof typeof COST_DOCUMENT_TYPE_LABELS
                    ] ?? row.documentType}
                  </CellTitle>
                  <CellMeta>#{row.documentId.slice(-8)}</CellMeta>
                </div>
              ),
            },
            {
              key: 'what',
              header: 'Ce',
              hideBelow: 'md',
              cell: (row) => (
                <div>
                  <CellTitle>
                    {EXPENSE_TYPE_LABELS[row.expenseType as keyof typeof EXPENSE_TYPE_LABELS] ??
                      row.expenseType}
                  </CellTitle>
                  {row.quantity === null ? null : (
                    <CellMeta>
                      {row.quantity} {row.uom ?? ''}
                    </CellMeta>
                  )}
                </div>
              ),
            },
            {
              key: 'stage',
              header: 'Stadiu',
              width: '8rem',
              cell: (row) => (
                <Badge tone={stageTone(row.stage)}>
                  {COST_STAGE_LABELS[row.stage as keyof typeof COST_STAGE_LABELS] ?? row.stage}
                </Badge>
              ),
            },
            {
              key: 'charged',
              header: 'Descărcat pe',
              hideBelow: 'lg',
              cell: (row) =>
                row.usedComponentId === row.chargedComponentId ? (
                  <CellMeta>aceeași componentă</CellMeta>
                ) : (
                  <div>
                    <CellTitle>{row.chargedComponentName ?? '—'}</CellTitle>
                    {/* Semnalul de re-alocare, chiar pe linie: cine se uită la
                        costul unității vede că banul se duce în altă parte. */}
                    <CellMeta>mutat de pe {row.usedComponentName ?? '—'}</CellMeta>
                  </div>
                ),
            },
            {
              key: 'amount',
              header: 'Valoare',
              align: 'right',
              width: '8rem',
              cell: (row) => <Money value={MoneyValue.fromDb(row.amount)} />,
            },
          ]}
          empty={<EmptyState title="Nicio linie" body={emptyBody} />}
        />
        {lines.nextCursor === null ? null : (
          <p className="mt-2 text-sm text-ink-subtle">
            Se arată primele 100 de linii, cele mai recente. Restul se deschid din{' '}
            <strong>Bani › Costuri</strong>, cu filtrele lui.
          </p>
        )}
      </section>
    </div>
  );
}
