import type { CapabilitySpec, OfficeRole } from '@damina/auth';
import { OFFICE_ROLE_LABELS, PERSONA_LABELS } from '@damina/contracts';
import { Badge, Card, CardBody, CardHeader, cn, EmptyState } from '@damina/ui';

/**
 * Matricea rol de birou x drepturi (ecranul „Administrare › Utilizatori si
 * roluri”, pasul 02d, §3.10).
 *
 * Randata direct din PERMISSION_MATRIX, nu dintr-o lista scrisa separat in UI:
 * asa ecranul nu poate promite un drept pe care codul nu-l da, sau invers (vezi
 * comentariul din packages/auth/src/permissions.ts).
 *
 * Cerinta §3.10 e sa arate si ce NU vede un rol, nu doar ce vede — de-asta
 * celula pentru "nu" e un punct explicit, nu un gol vizual pe care ochiul il
 * sare fara sa observe ca lipseste ceva.
 */

export interface PermissionMatrixProps {
  readonly matrix: readonly CapabilitySpec[];
  readonly officeRoles: readonly OfficeRole[];
  /** Rolurile persoanei privite, ca sa se evidentieze coloanele ei. Gol = nimeni selectat. */
  readonly highlightRoles?: readonly string[];
}

interface GroupedRows {
  readonly group: string;
  readonly specs: readonly CapabilitySpec[];
}

/** Grupeaza pastrand ordinea de aparitie din matrice, nu ordinea alfabetica. */
function groupByGroup(matrix: readonly CapabilitySpec[]): readonly GroupedRows[] {
  const order: string[] = [];
  const byGroup = new Map<string, CapabilitySpec[]>();

  for (const spec of matrix) {
    const bucket = byGroup.get(spec.group);
    if (bucket === undefined) {
      order.push(spec.group);
      byGroup.set(spec.group, [spec]);
    } else {
      bucket.push(spec);
    }
  }

  return order.map((group) => ({ group, specs: byGroup.get(group) ?? [] }));
}

export function PermissionMatrix({
  matrix,
  officeRoles,
  highlightRoles = [],
}: PermissionMatrixProps) {
  if (matrix.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nu există drepturi de administrat"
          body="Matricea se completează din PERMISSION_MATRIX. Dacă lista e goală, nu s-a definit încă niciun drept."
          size="sm"
        />
      </Card>
    );
  }

  const highlighted = new Set(highlightRoles);
  const groups = groupByGroup(matrix);
  const columnCount = officeRoles.length + 1;

  return (
    <Card>
      <CardHeader
        title="Matricea drepturilor"
        description="Rol de birou pe coloană, drept pe rând. Punctul gri arată explicit ce NU vede rolul."
      />
      <CardBody className="p-0">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <caption className="sr-only">
              Matricea drepturilor pe rol de birou: pentru fiecare drept, ce roluri il au si ce
              persoane pot sa-l primeasca.
            </caption>
            <thead className="sticky top-0 z-10 bg-surface-sunken">
              <tr>
                <th
                  scope="col"
                  className="border-b border-border px-3 py-2 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  Drept
                </th>
                {officeRoles.map((role) => (
                  <th
                    key={role}
                    scope="col"
                    className={cn(
                      'border-b border-border px-3 py-2 text-center text-xs font-semibold tracking-wide text-ink-muted uppercase',
                      highlighted.has(role) ? 'bg-brand-50' : '',
                    )}
                  >
                    {OFFICE_ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((section) => (
                <GroupSection
                  key={section.group}
                  section={section}
                  officeRoles={officeRoles}
                  highlighted={highlighted}
                  columnCount={columnCount}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function GroupSection({
  section,
  officeRoles,
  highlighted,
  columnCount,
}: {
  section: GroupedRows;
  officeRoles: readonly OfficeRole[];
  highlighted: ReadonlySet<string>;
  columnCount: number;
}) {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={columnCount}
          className="border-b border-border bg-surface-sunken px-3 py-1.5 text-left text-xs font-semibold tracking-wide text-ink-muted uppercase"
        >
          {section.group}
        </th>
      </tr>
      {section.specs.map((spec) => (
        <tr key={spec.key} className="border-b border-border/70 last:border-0">
          <th scope="row" className="px-3 py-2 align-top font-normal">
            <div className="text-ink">{spec.label}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs text-ink-subtle">{spec.key}</span>
              {spec.personas.map((persona) => (
                <Badge key={persona} tone="outline">
                  {PERSONA_LABELS[persona]}
                </Badge>
              ))}
            </div>
          </th>
          {officeRoles.map((role) => (
            <RightCell
              key={role}
              granted={spec.officeRoles.includes(role)}
              roleLabel={OFFICE_ROLE_LABELS[role]}
              rightLabel={spec.label}
              highlighted={highlighted.has(role)}
            />
          ))}
        </tr>
      ))}
    </>
  );
}

function RightCell({
  granted,
  roleLabel,
  rightLabel,
  highlighted,
}: {
  granted: boolean;
  roleLabel: string;
  rightLabel: string;
  highlighted: boolean;
}) {
  const dot = (
    <span
      aria-hidden="true"
      className={cn('size-1.5 rounded-full', granted ? 'bg-success-600' : 'bg-ink-subtle/60')}
    />
  );

  return (
    <td
      aria-label={`${roleLabel}: ${granted ? 'are' : 'nu are'} dreptul „${rightLabel}”`}
      className={cn('px-3 py-2 text-center align-middle', highlighted ? 'bg-brand-50/60' : '')}
    >
      <Badge tone={granted ? 'success' : 'neutral'} icon={dot}>
        {granted ? 'Da' : 'Nu'}
      </Badge>
    </td>
  );
}
