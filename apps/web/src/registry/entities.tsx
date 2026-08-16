import { canEditNomenclature, canSeeFinancials } from '@damina/auth';
import { UNITS_OF_MEASURE } from '@damina/contracts';
import {
  getClient,
  getProduct,
  getQualification,
  getSubcontractor,
  getSupplier,
  listClients,
  listProducts,
  listQualifications,
  listRateCards,
  listSubcontractors,
  listSuppliers,
  type ClientRow,
  type ProductRow,
  type QualificationRow,
  type RateCardRow,
  type SubcontractorRow,
  type SupplierRow,
} from '@damina/services';
import { Money as MoneyValue } from '@damina/shared';
import { Badge, CellMeta, CellTitle, EmptyState, Money } from '@damina/ui';
import { Clock } from 'lucide-react';
import { AuditTrail } from '../components/detail/audit-trail';
import { contracte } from './contracts';
import { obiective } from './objectives';
import { DefinitionList, Empty } from '../components/detail/definition-list';
import { PhasePlaceholder } from '../components/detail/phase-placeholder';
import { defineEntity, type EntityContext, type EntityDefinition } from './types';

/**
 * Cele sase nomenclatoare, fiecare o SINGURA intrare in registry.
 *
 * Nu exista nici macar un fisier de pagina pentru vreuna din ele. Lista,
 * detaliul, tab-urile, legaturile si formularul ies din declaratiile de aici,
 * randate de `[module]/page.tsx` si `[module]/[id]/[[...tab]]/page.tsx`.
 *
 * Asa arata si contractul din pasul 04: se adauga aici, si primeste ecranele
 * gratis. Daca cineva simte nevoia sa scrie o pagina noua, inseamna ca lipseste
 * ceva din `types.ts` — se completeaza acolo, nu se ocoleste registry-ul.
 */

const yesNo = (value: boolean): string => (value ? 'Da' : 'Nu');

const dateFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const formatDate = (value: string | null): string =>
  value === null ? '—' : dateFormat.format(new Date(value));

/** Statusul unui interval de tarif fata de ziua de azi. */
function rateCardPhase(row: RateCardRow): 'current' | 'future' | 'ended' {
  const today = new Date().toISOString().slice(0, 10);
  if (row.validFrom > today) {
    return 'future';
  }
  if (row.validTo !== null && row.validTo <= today) {
    return 'ended';
  }
  return 'current';
}

// ── Produse ──────────────────────────────────────────────────────────────────

const produse = defineEntity<ProductRow>({
  slug: 'produse',
  singular: 'Produs',
  plural: 'Produse',
  icon: 'package',
  group: 'libraries',
  usesPeriod: false,
  canWrite: canEditNomenclature,

  list: {
    load: (ctx, query) => listProducts(ctx.actor, query),
    rowKey: (row) => row.id,
    rowHref: (row) => `/produse/${row.id}`,
    rowFlagged: (row) => !row.isActive,
    searchPlaceholder: 'Caută după cod sau denumire',
    notice:
      'Nomenclatoarele sunt comune celor 5 firme. Doar seriile de documente și gestiunile sunt per firmă.',
    empty: {
      title: 'Niciun produs în nomenclator',
      body: 'Produsele sunt lista comună din care se cer materiale, se fac NIR-uri și se scriu bonuri de consum. Fără ele, cantitățile din teren nu au de ce să se agațe.',
      actionLabel: 'Adaugă primul produs',
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
        key: 'uom',
        header: 'U.M.',
        width: '5rem',
        cell: (row) => <CellMeta>{row.uom}</CellMeta>,
      },
      {
        key: 'category',
        header: 'Categorie',
        hideBelow: 'md',
        cell: (row) => (row.category === null ? <Empty /> : <CellMeta>{row.category}</CellMeta>),
      },
      {
        key: 'supplier',
        header: 'Furnizor implicit',
        hideBelow: 'lg',
        cell: (row) =>
          row.supplierName === null ? <Empty /> : <CellMeta>{row.supplierName}</CellMeta>,
      },
      {
        key: 'stock',
        header: 'Gestiune',
        width: '7rem',
        cell: (row) =>
          row.isStockItem ? (
            <CellMeta>{row.minStock === null ? 'da' : `min. ${row.minStock}`}</CellMeta>
          ) : (
            <Badge tone="outline">serviciu</Badge>
          ),
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getProduct(ctx.actor, id).catch(() => null),
    header: (row) => ({
      title: row.name,
      breadcrumb: [
        { label: 'Nomenclatoare' },
        { label: 'Produse', href: '/produse' },
        { label: row.name },
      ],
      badges: [
        { label: row.code, tone: 'brand' },
        { label: row.uom, tone: 'outline' },
        ...(row.isStockItem
          ? []
          : [{ label: 'Nu intră în gestiune', tone: 'neutral' as const }]),
        ...(row.isActive ? [] : [{ label: 'Inactiv', tone: 'warning' as const }]),
      ],
      meta: [
        { label: 'Categorie', value: row.category ?? '—' },
        { label: 'Furnizor implicit', value: row.supplierName ?? '—' },
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
              { label: 'Unitate de măsură', value: row.uom },
              { label: 'Categorie', value: row.category ?? <Empty /> },
              { label: 'Furnizor implicit', value: row.supplierName ?? <Empty /> },
              {
                label: 'Intră în gestiune',
                value: yesNo(row.isStockItem),
                hint: row.isStockItem
                  ? undefined
                  : 'Serviciile și manopera facturată nu produc mișcări de stoc.',
              },
              {
                label: 'Stoc minim',
                value: row.minStock ?? <Empty />,
                hint: row.minStock === null ? 'Fără prag de alertă.' : 'Sub prag se ridică alerta.',
              },
              { label: 'Activ', value: yesNo(row.isActive) },
              { label: 'Observații', value: row.notes ?? <Empty />, full: true },
            ]}
          />
        ),
      },
      {
        slug: 'stoc',
        label: 'Stoc',
        render: () => <PhasePlaceholder phase={3} what="Stocul pe gestiuni și loturi" />,
      },
      {
        slug: 'utilizare',
        label: 'Utilizare',
        render: () => (
          <PhasePlaceholder
            phase={3}
            what="Documentele care ating produsul (NIR-uri, bonuri de consum, comenzi)"
          />
        ),
      },
      {
        slug: 'istoric',
        label: 'Istoric',
        render: (row, ctx) => <AuditTrail ctx={ctx} tableName="products" recordId={row.id} />,
      },
    ],
    links: (row) =>
      Promise.resolve([
        {
          kind: 'up',
          title: 'În sus',
          items: [{ label: 'Toate produsele', href: '/produse' }],
        },
        ...(row.defaultSupplierId === null
          ? []
          : [
              {
                kind: 'related' as const,
                title: 'Furnizor implicit',
                items: [
                  {
                    label: row.supplierName ?? 'Furnizor',
                    href: `/furnizori/${row.defaultSupplierId}`,
                  },
                ],
              },
            ]),
      ]),
    quickActions: (row, ctx) => [
      ...(canEditNomenclature(ctx.session)
        ? [{ label: 'Modifică produsul', href: `/produse?edit=${row.id}`, tone: 'primary' as const }]
        : []),
      {
        label: 'Comandă material',
        disabledReason: 'Aprovizionarea vine în faza 3.',
      },
      { label: 'Vezi istoricul', href: `/produse/${row.id}/istoric` },
    ],
  },

  form: {
    schemaKey: 'produse',
    editable: true,
    createTitle: 'Produs nou',
    editTitle: 'Modifică produsul',
    loadLookups: async (ctx: EntityContext) => {
      const suppliers = await listSuppliers(ctx.actor, { limit: 500 });
      return {
        suppliers: suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
      };
    },
    fields: (lookups) => [
      {
        name: 'code',
        label: 'Cod',
        control: 'text',
        required: true,
        placeholder: 'CIM-42',
        hint: 'Codul scris pe bonul de consum. Unic, indiferent de scris.',
        readOnlyOnEdit: true,
      },
      { name: 'name', label: 'Denumire', control: 'text', required: true, full: true },
      {
        name: 'uom',
        label: 'Unitate de măsură',
        control: 'select',
        required: true,
        options: UNITS_OF_MEASURE.map((unit) => ({ value: unit, label: unit })),
      },
      { name: 'category', label: 'Categorie', control: 'text', placeholder: 'Materiale zidărie' },
      {
        name: 'defaultSupplierId',
        label: 'Furnizor implicit',
        control: 'select',
        options: lookups.suppliers ?? [],
        hint: 'Se propune automat la comandă. Se poate schimba oricând.',
      },
      {
        name: 'minStock',
        label: 'Stoc minim',
        control: 'number',
        hint: 'Sub acest prag se ridică alerta de stoc. Lasă gol dacă nu urmărești.',
      },
      {
        name: 'isStockItem',
        label: 'Intră în gestiune',
        control: 'checkbox',
        hint: 'Serviciile și manopera facturată nu intră niciodată în gestiune.',
        full: true,
      },
      { name: 'isActive', label: 'Activ', control: 'checkbox', full: true },
      { name: 'notes', label: 'Observații', control: 'textarea', full: true },
    ],
    blank: {
      code: '',
      name: '',
      uom: 'buc',
      category: '',
      defaultSupplierId: '',
      minStock: '',
      isStockItem: true,
      isActive: true,
      notes: '',
    },
    toFormValues: (row) => ({
      code: row.code,
      name: row.name,
      uom: row.uom,
      category: row.category ?? '',
      defaultSupplierId: row.defaultSupplierId ?? '',
      minStock: row.minStock ?? '',
      isStockItem: row.isStockItem,
      isActive: row.isActive,
      notes: row.notes ?? '',
    }),
  },
});

// ── Furnizori ────────────────────────────────────────────────────────────────

const furnizori = defineEntity<SupplierRow>({
  slug: 'furnizori',
  singular: 'Furnizor',
  plural: 'Furnizori',
  icon: 'truck',
  group: 'libraries',
  usesPeriod: false,
  canWrite: canEditNomenclature,

  list: {
    load: (ctx, query) => listSuppliers(ctx.actor, query),
    rowKey: (row) => row.id,
    rowHref: (row) => `/furnizori/${row.id}`,
    searchPlaceholder: 'Caută după denumire',
    empty: {
      title: 'Niciun furnizor',
      body: 'Furnizorii sunt cei de la care se cumpără. Comenzile, NIR-urile și facturile intrate se leagă de ei.',
      actionLabel: 'Adaugă primul furnizor',
    },
    columns: [
      { key: 'name', header: 'Denumire', cell: (row) => <CellTitle>{row.name}</CellTitle> },
      {
        key: 'cui',
        header: 'CUI',
        width: '10rem',
        cell: (row) =>
          row.cui === null ? <Empty /> : <span className="font-mono text-xs">{row.cui}</span>,
      },
      {
        key: 'leadTime',
        header: 'Termen livrare',
        align: 'right',
        width: '9rem',
        hideBelow: 'md',
        cell: (row) =>
          row.defaultLeadTimeDays === null ? (
            <Empty />
          ) : (
            <CellMeta>{row.defaultLeadTimeDays} zile</CellMeta>
          ),
      },
      {
        key: 'status',
        header: 'Stare',
        width: '6rem',
        cell: (row) =>
          row.isActive ? <Badge tone="success">Activ</Badge> : <Badge tone="neutral">Inactiv</Badge>,
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getSupplier(ctx.actor, id).catch(() => null),
    header: (row) => ({
      title: row.name,
      breadcrumb: [
        { label: 'Nomenclatoare' },
        { label: 'Furnizori', href: '/furnizori' },
        { label: row.name },
      ],
      badges: [
        ...(row.cui === null ? [] : [{ label: row.cui, tone: 'outline' as const }]),
        row.isActive
          ? { label: 'Activ', tone: 'success' as const }
          : { label: 'Inactiv', tone: 'warning' as const },
      ],
      meta: [
        {
          label: 'Termen de livrare',
          value: row.defaultLeadTimeDays === null ? '—' : `${String(row.defaultLeadTimeDays)} zile`,
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
              { label: 'Denumire', value: row.name },
              { label: 'CUI', value: row.cui ?? <Empty /> },
              {
                label: 'Termen de livrare',
                value:
                  row.defaultLeadTimeDays === null ? (
                    <Empty />
                  ) : (
                    `${String(row.defaultLeadTimeDays)} zile`
                  ),
                hint: 'Se folosește la planificarea aprovizionării.',
              },
              { label: 'Activ', value: yesNo(row.isActive) },
            ]}
          />
        ),
      },
      {
        slug: 'produse',
        label: 'Produse',
        render: async (row, ctx) => {
          const products = await listProducts(ctx.actor, { limit: 500 });
          const mine = products.filter((product) => product.defaultSupplierId === row.id);

          if (mine.length === 0) {
            return (
              <EmptyState
                title="Niciun produs cu acest furnizor implicit"
                body="Alege furnizorul ca implicit pe un produs, și el apare aici. Legătura e navigabilă în ambele sensuri."
                size="sm"
              />
            );
          }

          return (
            <ul className="divide-y divide-border">
              {mine.map((product) => (
                <li key={product.id}>
                  <a
                    href={`/produse/${product.id}`}
                    className="flex items-baseline justify-between gap-4 py-2.5 hover:text-brand-700"
                  >
                    <span className="font-medium">{product.name}</span>
                    <span className="font-mono text-xs text-ink-muted">{product.code}</span>
                  </a>
                </li>
              ))}
            </ul>
          );
        },
      },
      {
        // TAB FINANCIAR. Pentru rolurile fara drept LIPSESTE din DOM, nu apare
        // gri: `visible` decide inainte de randare, iar ruta `/furnizori/{id}/
        // solduri` raspunde „nu ai acces” pentru acelasi om. §30, regula 5.
        slug: 'solduri',
        label: 'Solduri',
        visible: canSeeFinancials,
        render: () => <PhasePlaceholder phase={3} what="Soldurile și facturile furnizorului" />,
      },
      {
        slug: 'istoric',
        label: 'Istoric',
        render: (row, ctx) => <AuditTrail ctx={ctx} tableName="suppliers" recordId={row.id} />,
      },
    ],
    links: async (row, ctx) => {
      const products = await listProducts(ctx.actor, { limit: 500 });
      const mine = products.filter((product) => product.defaultSupplierId === row.id);

      return [
        { kind: 'up', title: 'În sus', items: [{ label: 'Toți furnizorii', href: '/furnizori' }] },
        {
          kind: 'related',
          title: 'Produse cu acest furnizor implicit',
          count: mine.length,
          items: mine.slice(0, 5).map((product) => ({
            label: product.name,
            href: `/produse/${product.id}`,
            meta: product.code,
          })),
        },
      ];
    },
    quickActions: (row, ctx) => [
      ...(canEditNomenclature(ctx.session)
        ? [
            {
              label: 'Modifică furnizorul',
              href: `/furnizori?edit=${row.id}`,
              tone: 'primary' as const,
            },
          ]
        : []),
      { label: 'Deschide o comandă', disabledReason: 'Aprovizionarea vine în faza 3.' },
    ],
  },

  form: {
    schemaKey: 'furnizori',
    editable: true,
    createTitle: 'Furnizor nou',
    editTitle: 'Modifică furnizorul',
    fields: () => [
      { name: 'name', label: 'Denumire', control: 'text', required: true, full: true },
      { name: 'cui', label: 'CUI', control: 'text', placeholder: 'RO12345678' },
      {
        name: 'defaultLeadTimeDays',
        label: 'Termen de livrare',
        control: 'number',
        suffix: 'zile',
        hint: 'Câte zile trec, în medie, de la comandă la livrare.',
      },
      { name: 'isActive', label: 'Activ', control: 'checkbox', full: true },
    ],
    blank: { name: '', cui: '', defaultLeadTimeDays: '', isActive: true },
    toFormValues: (row) => ({
      name: row.name,
      cui: row.cui ?? '',
      defaultLeadTimeDays: row.defaultLeadTimeDays === null ? '' : String(row.defaultLeadTimeDays),
      isActive: row.isActive,
    }),
  },
});

// ── Clienți ──────────────────────────────────────────────────────────────────

const clienti = defineEntity<ClientRow>({
  slug: 'clienti',
  singular: 'Client',
  plural: 'Clienți',
  icon: 'building',
  group: 'libraries',
  usesPeriod: false,
  canWrite: canEditNomenclature,

  list: {
    load: (ctx, query) => listClients(ctx.actor, query),
    rowKey: (row) => row.id,
    rowHref: (row) => `/clienti/${row.id}`,
    searchPlaceholder: 'Caută după denumire',
    empty: {
      title: 'Niciun client',
      body: 'Clienții sunt cei către care se facturează. Contractele și situațiile de lucrări se leagă de ei.',
      actionLabel: 'Adaugă primul client',
    },
    columns: [
      {
        key: 'name',
        header: 'Denumire',
        cell: (row) => (
          <span className="flex items-center gap-2">
            <CellTitle>{row.name}</CellTitle>
            {row.isIntercompany ? <Badge tone="brand">firmă din grup</Badge> : null}
          </span>
        ),
      },
      {
        key: 'cui',
        header: 'CUI',
        width: '10rem',
        cell: (row) =>
          row.cui === null ? <Empty /> : <span className="font-mono text-xs">{row.cui}</span>,
      },
      {
        key: 'term',
        header: 'Termen plată',
        align: 'right',
        width: '9rem',
        hideBelow: 'md',
        cell: (row) => <CellMeta>{row.paymentTermDays} zile</CellMeta>,
      },
      {
        key: 'status',
        header: 'Stare',
        width: '6rem',
        cell: (row) =>
          row.isActive ? <Badge tone="success">Activ</Badge> : <Badge tone="neutral">Inactiv</Badge>,
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getClient(ctx.actor, id).catch(() => null),
    header: (row) => ({
      title: row.name,
      breadcrumb: [
        { label: 'Nomenclatoare' },
        { label: 'Clienți', href: '/clienti' },
        { label: row.name },
      ],
      badges: [
        ...(row.cui === null ? [] : [{ label: row.cui, tone: 'outline' as const }]),
        ...(row.isIntercompany ? [{ label: 'Firmă din grup', tone: 'brand' as const }] : []),
        row.isActive
          ? { label: 'Activ', tone: 'success' as const }
          : { label: 'Inactiv', tone: 'warning' as const },
      ],
      meta: [{ label: 'Termen de plată', value: `${String(row.paymentTermDays)} zile` }],
    }),
    tabs: [
      {
        slug: '',
        label: 'Prezentare',
        render: (row) => (
          <DefinitionList
            items={[
              { label: 'Denumire', value: row.name },
              { label: 'CUI', value: row.cui ?? <Empty /> },
              { label: 'Termen de plată', value: `${String(row.paymentTermDays)} zile` },
              {
                label: 'Firmă din grup',
                value: yesNo(row.isIntercompany),
                hint: row.isIntercompany
                  ? 'Facturile către acest client se elimină la consolidare.'
                  : undefined,
              },
              { label: 'Activ', value: yesNo(row.isActive) },
            ]}
          />
        ),
      },
      {
        slug: 'contracte',
        label: 'Contracte',
        render: () => <PhasePlaceholder phase={1} what="Contractele clientului" />,
      },
      {
        slug: 'istoric',
        label: 'Istoric',
        render: (row, ctx) => <AuditTrail ctx={ctx} tableName="clients" recordId={row.id} />,
      },
    ],
    links: () =>
      Promise.resolve([
        { kind: 'up', title: 'În sus', items: [{ label: 'Toți clienții', href: '/clienti' }] },
      ]),
    quickActions: (row, ctx) => [
      ...(canEditNomenclature(ctx.session)
        ? [{ label: 'Modifică clientul', href: `/clienti?edit=${row.id}`, tone: 'primary' as const }]
        : []),
      { label: 'Contract nou', disabledReason: 'Contractele vin în faza 1.' },
    ],
  },

  form: {
    schemaKey: 'clienti',
    editable: true,
    createTitle: 'Client nou',
    editTitle: 'Modifică clientul',
    loadLookups: async (ctx: EntityContext) =>
      Promise.resolve({
        companies: ctx.app.companies.map((company) => ({
          value: company.id,
          label: company.name,
        })),
      }),
    fields: (lookups) => [
      { name: 'name', label: 'Denumire', control: 'text', required: true, full: true },
      { name: 'cui', label: 'CUI', control: 'text', placeholder: 'RO12345678' },
      {
        name: 'paymentTermDays',
        label: 'Termen de plată',
        control: 'number',
        required: true,
        suffix: 'zile',
      },
      {
        name: 'isIntercompany',
        label: 'E una din cele 5 firme ale grupului',
        control: 'checkbox',
        hint: 'Facturile către el se elimină în vederea consolidată.',
        full: true,
      },
      {
        name: 'intercompanyCompanyId',
        label: 'Care firmă din grup',
        control: 'select',
        options: lookups.companies ?? [],
        full: true,
      },
    ],
    blank: {
      name: '',
      cui: '',
      paymentTermDays: '70',
      isIntercompany: false,
      intercompanyCompanyId: '',
    },
    toFormValues: (row) => ({
      name: row.name,
      cui: row.cui ?? '',
      paymentTermDays: String(row.paymentTermDays),
      isIntercompany: row.isIntercompany,
      intercompanyCompanyId: row.intercompanyCompanyId ?? '',
    }),
  },
});

// ── Subcontractanți ──────────────────────────────────────────────────────────

const subcontractanti = defineEntity<SubcontractorRow>({
  slug: 'subcontractanti',
  singular: 'Subcontractant',
  plural: 'Subcontractanți',
  icon: 'handshake',
  group: 'libraries',
  usesPeriod: false,
  canWrite: canEditNomenclature,

  list: {
    load: (ctx, query) => listSubcontractors(ctx.actor, query),
    rowKey: (row) => row.id,
    rowHref: (row) => `/subcontractanti/${row.id}`,
    searchPlaceholder: 'Caută după denumire',
    empty: {
      title: 'Niciun subcontractant',
      body: 'Subcontractanții execută pachete de lucrări și își raportează situațiile prin portalul lor.',
      actionLabel: 'Adaugă primul subcontractant',
    },
    columns: [
      { key: 'name', header: 'Denumire', cell: (row) => <CellTitle>{row.name}</CellTitle> },
      {
        key: 'specialties',
        header: 'Specialități',
        hideBelow: 'md',
        cell: (row) =>
          row.specialties === null || row.specialties.length === 0 ? (
            <Empty />
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.specialties.slice(0, 3).map((specialty) => (
                <Badge key={specialty} tone="outline">
                  {specialty}
                </Badge>
              ))}
            </span>
          ),
      },
      {
        key: 'warranty',
        header: 'Garanție',
        align: 'right',
        width: '7rem',
        cell: (row) =>
          row.warrantyRetentionPct === null ? (
            <Empty />
          ) : (
            <CellMeta>{(Number(row.warrantyRetentionPct) * 100).toFixed(2)}%</CellMeta>
          ),
      },
      {
        key: 'status',
        header: 'Stare',
        width: '6rem',
        cell: (row) =>
          row.isActive ? <Badge tone="success">Activ</Badge> : <Badge tone="neutral">Inactiv</Badge>,
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getSubcontractor(ctx.actor, id).catch(() => null),
    header: (row) => ({
      title: row.name,
      breadcrumb: [
        { label: 'Nomenclatoare' },
        { label: 'Subcontractanți', href: '/subcontractanti' },
        { label: row.name },
      ],
      badges: [
        ...(row.cui === null ? [] : [{ label: row.cui, tone: 'outline' as const }]),
        row.isActive
          ? { label: 'Activ', tone: 'success' as const }
          : { label: 'Inactiv', tone: 'warning' as const },
      ],
      meta: [
        {
          label: 'Garanție reținută',
          value:
            row.warrantyRetentionPct === null
              ? '—'
              : `${(Number(row.warrantyRetentionPct) * 100).toFixed(2)}%`,
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
              { label: 'Denumire', value: row.name },
              { label: 'CUI', value: row.cui ?? <Empty /> },
              {
                label: 'Specialități',
                value:
                  row.specialties === null || row.specialties.length === 0 ? (
                    <Empty />
                  ) : (
                    row.specialties.join(', ')
                  ),
                full: true,
              },
              {
                label: 'Garanție de bună execuție',
                value:
                  row.warrantyRetentionPct === null ? (
                    <Empty />
                  ) : (
                    `${(Number(row.warrantyRetentionPct) * 100).toFixed(2)}%`
                  ),
                hint: 'Se reține din fiecare situație de lucrări.',
              },
              { label: 'Activ', value: yesNo(row.isActive) },
            ]}
          />
        ),
      },
      {
        slug: 'pachete',
        label: 'Pachete',
        render: () => <PhasePlaceholder phase={2} what="Pachetele de lucrări și situațiile lui" />,
      },
      {
        slug: 'istoric',
        label: 'Istoric',
        render: (row, ctx) => <AuditTrail ctx={ctx} tableName="subcontractors" recordId={row.id} />,
      },
    ],
    links: () =>
      Promise.resolve([
        {
          kind: 'up',
          title: 'În sus',
          items: [{ label: 'Toți subcontractanții', href: '/subcontractanti' }],
        },
      ]),
    quickActions: (row, ctx) => [
      ...(canEditNomenclature(ctx.session)
        ? [
            {
              label: 'Modifică subcontractantul',
              href: `/subcontractanti?edit=${row.id}`,
              tone: 'primary' as const,
            },
          ]
        : []),
      { label: 'Atribuie un pachet', disabledReason: 'Pachetele vin în faza 2.' },
    ],
  },

  form: {
    schemaKey: 'subcontractanti',
    editable: true,
    createTitle: 'Subcontractant nou',
    editTitle: 'Modifică subcontractantul',
    fields: () => [
      { name: 'name', label: 'Denumire', control: 'text', required: true, full: true },
      { name: 'cui', label: 'CUI', control: 'text', placeholder: 'RO12345678' },
      {
        name: 'warrantyRetentionPct',
        label: 'Garanție reținută',
        control: 'number',
        suffix: '%',
        hint: 'Procentul reținut din fiecare situație de lucrări.',
      },
      {
        name: 'specialties',
        label: 'Specialități',
        control: 'text',
        placeholder: 'hidroizolații, instalații sanitare',
        hint: 'Separate prin virgulă.',
        full: true,
      },
      { name: 'isActive', label: 'Activ', control: 'checkbox', full: true },
    ],
    blank: { name: '', cui: '', warrantyRetentionPct: '', specialties: '', isActive: true },
    toFormValues: (row) => ({
      name: row.name,
      cui: row.cui ?? '',
      warrantyRetentionPct:
        row.warrantyRetentionPct === null
          ? ''
          : (Number(row.warrantyRetentionPct) * 100).toFixed(2),
      specialties: row.specialties === null ? '' : row.specialties.join(', '),
      isActive: row.isActive,
    }),
  },
});

// ── Calificări ───────────────────────────────────────────────────────────────

const calificari = defineEntity<QualificationRow>({
  slug: 'calificari',
  singular: 'Calificare',
  plural: 'Calificări',
  icon: 'award',
  group: 'libraries',
  usesPeriod: false,
  canWrite: canEditNomenclature,

  list: {
    load: (ctx, query) => listQualifications(ctx.actor, query),
    rowKey: (row) => row.id,
    rowHref: (row) => `/calificari/${row.id}`,
    searchPlaceholder: 'Caută după cod sau denumire',
    empty: {
      title: 'Nicio calificare',
      body: 'Calificările sunt meseriile pe care le pontezi: instalator, electrician, zidar. Fiecare are un tarif orar istoricizat.',
      actionLabel: 'Adaugă prima calificare',
    },
    columns: [
      {
        key: 'code',
        header: 'Cod',
        width: '8rem',
        cell: (row) => <span className="font-mono text-xs text-ink-muted">{row.code}</span>,
      },
      { key: 'name', header: 'Denumire', cell: (row) => <CellTitle>{row.name}</CellTitle> },
      {
        key: 'status',
        header: 'Stare',
        width: '6rem',
        cell: (row) =>
          row.isActive ? <Badge tone="success">Activ</Badge> : <Badge tone="neutral">Inactiv</Badge>,
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getQualification(ctx.actor, id).catch(() => null),
    header: (row) => ({
      title: row.name,
      breadcrumb: [
        { label: 'Nomenclatoare' },
        { label: 'Calificări', href: '/calificari' },
        { label: row.name },
      ],
      badges: [
        { label: row.code, tone: 'brand' },
        row.isActive
          ? { label: 'Activ', tone: 'success' as const }
          : { label: 'Inactiv', tone: 'warning' as const },
      ],
      meta: [],
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
              { label: 'Activ', value: yesNo(row.isActive) },
            ]}
          />
        ),
      },
      {
        // Tab financiar: tarifele poarta salariu si cost orar.
        slug: 'tarife',
        label: 'Tarife',
        visible: canSeeFinancials,
        render: async (row, ctx) => {
          const rateCards = await listRateCards(ctx.actor, { qualificationId: row.id });
          if (rateCards.length === 0) {
            return (
              <EmptyState
                icon={<Clock className="size-5" aria-hidden="true" />}
                title="Niciun tarif pentru calificarea asta"
                body="Fără tarif orar, pontajul nu produce cost, iar marja pe lucrare rămâne necunoscută."
                size="sm"
              />
            );
          }
          return <RateCardTimeline rows={rateCards} />;
        },
        count: () => undefined,
      },
      {
        slug: 'istoric',
        label: 'Istoric',
        render: (row, ctx) => <AuditTrail ctx={ctx} tableName="qualifications" recordId={row.id} />,
      },
    ],
    links: async (row, ctx) => {
      if (!canSeeFinancials(ctx.session)) {
        return [
          {
            kind: 'up',
            title: 'În sus',
            items: [{ label: 'Toate calificările', href: '/calificari' }],
          },
        ];
      }
      const rateCards = await listRateCards(ctx.actor, { qualificationId: row.id });
      return [
        {
          kind: 'up',
          title: 'În sus',
          items: [{ label: 'Toate calificările', href: '/calificari' }],
        },
        {
          kind: 'related',
          title: 'Tarife orare',
          count: rateCards.length,
          items: rateCards.slice(0, 5).map((card) => ({
            label: `${formatDate(card.validFrom)} → ${card.validTo === null ? 'azi' : formatDate(card.validTo)}`,
            href: `/tarife`,
            meta: MoneyValue.fromDb(card.hourlyCost).format(),
            tone: rateCardPhase(card) === 'current' ? ('success' as const) : undefined,
          })),
        },
      ];
    },
    quickActions: (row, ctx) => [
      ...(canSeeFinancials(ctx.session)
        ? [{ label: 'Adaugă un tarif', href: `/tarife?new=${row.id}`, tone: 'primary' as const }]
        : []),
      { label: 'Vezi istoricul', href: `/calificari/${row.id}/istoric` },
    ],
  },

  form: {
    schemaKey: 'calificari',
    editable: false,
    createTitle: 'Calificare nouă',
    editTitle: 'Modifică calificarea',
    fields: () => [
      {
        name: 'code',
        label: 'Cod',
        control: 'text',
        required: true,
        placeholder: 'INST',
        readOnlyOnEdit: true,
      },
      { name: 'name', label: 'Denumire', control: 'text', required: true, full: true },
      { name: 'isActive', label: 'Activ', control: 'checkbox', full: true },
    ],
    blank: { code: '', name: '', isActive: true },
    toFormValues: (row) => ({ code: row.code, name: row.name, isActive: row.isActive }),
  },
});

// ── Tarife (rate card istoricizat) ───────────────────────────────────────────

const tarife = defineEntity<RateCardRow>({
  slug: 'tarife',
  singular: 'Tarif',
  plural: 'Tarife',
  icon: 'receipt',
  group: 'libraries',
  usesPeriod: false,
  // Modulul intreg poarta salarii. Cine nu are drept financiar nu-l vede in
  // meniu si nu ajunge la el pe URL.
  canRead: canSeeFinancials,
  canWrite: canSeeFinancials,

  list: {
    load: (ctx) => listRateCards(ctx.actor),
    rowKey: (row) => row.id,
    // Tarifele nu au pagina proprie: intervalul e citit in context, langa
    // celelalte intervale ale aceleiasi calificari. Randul duce la calificare.
    rowHref: (row) => `/calificari/${row.qualificationId}/tarife`,
    rowFlagged: (row) => rateCardPhase(row) === 'current',
    searchPlaceholder: 'Caută după calificare',
    notice:
      'Tarifele nu se modifică — se adaugă un interval nou. Un pontaj din martie rămâne evaluat la tariful din martie.',
    empty: {
      title: 'Niciun tarif definit',
      body: 'Tariful orar spune cât costă efectiv o oră de manoperă: salariu, plus taxe, plus orele plătite dar nelucrate. Fără el, pontajul nu produce cost.',
      actionLabel: 'Adaugă primul tarif',
    },
    columns: [
      {
        key: 'qualification',
        header: 'Calificare',
        cell: (row) => (
          <span className="flex items-center gap-2">
            <CellTitle>{row.qualificationName}</CellTitle>
            <span className="font-mono text-xs text-ink-subtle">{row.qualificationCode}</span>
          </span>
        ),
      },
      {
        key: 'interval',
        header: 'Interval',
        width: '14rem',
        cell: (row) => (
          <CellMeta>
            {formatDate(row.validFrom)} → {row.validTo === null ? 'fără sfârșit' : formatDate(row.validTo)}
          </CellMeta>
        ),
      },
      {
        key: 'salary',
        header: 'Salariu orar',
        align: 'right',
        width: '9rem',
        hideBelow: 'md',
        cell: (row) => <Money value={MoneyValue.fromDb(row.hourlySalary)} />,
      },
      {
        key: 'coefficients',
        header: 'Taxe · neprod.',
        align: 'right',
        width: '10rem',
        hideBelow: 'lg',
        cell: (row) => (
          <CellMeta>
            {(Number(row.taxCoefficient) * 100).toFixed(0)}% ·{' '}
            {(Number(row.unproductivityCoefficient) * 100).toFixed(0)}%
          </CellMeta>
        ),
      },
      {
        key: 'cost',
        header: 'Cost orar',
        align: 'right',
        width: '9rem',
        cell: (row) => <Money value={MoneyValue.fromDb(row.hourlyCost)} />,
      },
      {
        key: 'phase',
        header: 'Stare',
        width: '8rem',
        cell: (row) => {
          const phase = rateCardPhase(row);
          return phase === 'current' ? (
            <Badge tone="success">în vigoare</Badge>
          ) : phase === 'future' ? (
            <Badge tone="brand">viitor</Badge>
          ) : (
            <Badge tone="neutral">încheiat</Badge>
          );
        },
      },
    ],
  },

  form: {
    schemaKey: 'tarife',
    // NU se editeaza. Un `UPDATE` ar rescrie retroactiv costul tuturor orelor
    // deja pontate, inclusiv al celor din luni inchise.
    editable: false,
    createTitle: 'Tarif nou',
    editTitle: 'Tarifele nu se modifică',
    loadLookups: async (ctx: EntityContext) => {
      const qualifications = await listQualifications(ctx.actor, { limit: 500 });
      return {
        qualifications: qualifications.map((q) => ({ value: q.id, label: `${q.name} (${q.code})` })),
      };
    },
    fields: (lookups) => [
      {
        name: 'qualificationId',
        label: 'Calificare',
        control: 'select',
        required: true,
        options: lookups.qualifications ?? [],
        full: true,
      },
      { name: 'validFrom', label: 'Valabil de la', control: 'date', required: true },
      {
        name: 'validTo',
        label: 'Valabil până la',
        control: 'date',
        hint: 'Lasă gol pentru tariful curent, fără dată de sfârșit.',
      },
      {
        name: 'hourlySalary',
        label: 'Salariu orar',
        control: 'number',
        required: true,
        suffix: 'lei',
      },
      {
        name: 'taxCoefficient',
        label: 'Taxe',
        control: 'number',
        required: true,
        suffix: '%',
        hint: 'Procent peste salariu: scrie 45, nu 0,45.',
      },
      {
        name: 'unproductivityCoefficient',
        label: 'Neproductivitate',
        control: 'number',
        required: true,
        suffix: '%',
        hint: 'Ore plătite dar nelucrate: deplasări, așteptări, concedii.',
      },
    ],
    blank: {
      qualificationId: '',
      validFrom: new Date().toISOString().slice(0, 10),
      validTo: '',
      hourlySalary: '',
      taxCoefficient: '45',
      unproductivityCoefficient: '15',
    },
    toFormValues: (row) => ({
      qualificationId: row.qualificationId,
      validFrom: row.validFrom,
      validTo: row.validTo ?? '',
      hourlySalary: row.hourlySalary,
      taxCoefficient: (Number(row.taxCoefficient) * 100).toFixed(0),
      unproductivityCoefficient: (Number(row.unproductivityCoefficient) * 100).toFixed(0),
    }),
  },
});

/** Intervalele de tarif ale unei calificari, cel mai nou sus. */
function RateCardTimeline({ rows }: { rows: readonly RateCardRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const phase = rateCardPhase(row);
        return (
          <div
            key={row.id}
            className={`rounded-lg border px-4 py-3 ${
              phase === 'current' ? 'border-success-200 bg-success-50/50' : 'border-border bg-surface'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-base font-medium">
                {formatDate(row.validFrom)} →{' '}
                {row.validTo === null ? 'fără dată de sfârșit' : formatDate(row.validTo)}
              </span>
              {phase === 'current' ? (
                <Badge tone="success">în vigoare</Badge>
              ) : phase === 'future' ? (
                <Badge tone="brand">viitor</Badge>
              ) : (
                <Badge tone="neutral">încheiat</Badge>
              )}
            </div>
            <p className="mt-2 text-sm text-ink-muted">
              <Money value={MoneyValue.fromDb(row.hourlySalary)} /> salariu ×{' '}
              {(1 + Number(row.taxCoefficient)).toFixed(2)} taxe ×{' '}
              {(1 + Number(row.unproductivityCoefficient)).toFixed(2)} neproductivitate
            </p>
            <p className="mt-1">
              <Money value={MoneyValue.fromDb(row.hourlyCost)} emphasis /> cost real al orei
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const entityRegistry: Readonly<Record<string, EntityDefinition>> = {
  // Contractul si obiectivul s-au adaugat in pasul 04 FARA sa se atinga shell-ul
  // sau pagina fractala: doua intrari aici, doua fisiere de declaratii, zero
  // fisiere de pagina. Asta era testul pe care si-l pusese pasul 03.
  contracte,
  obiective,
  produse,
  furnizori,
  clienti,
  subcontractanti,
  calificari,
  tarife,
};

export function findEntity(module: string): EntityDefinition | undefined {
  return entityRegistry[module];
}
