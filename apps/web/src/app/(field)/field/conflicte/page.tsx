import { ConflictList } from '../../../../components/field/conflict-list';

export const dynamic = 'force-dynamic';

/**
 * Ecranul de conflicte (§3.3). Obligatoriu si proiectat, nu improvizat —
 * inclusiv starea goala, care e cea vazuta in 99% din zile.
 */
export default function FieldConflictsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">De rezolvat</h1>
      <ConflictList />
    </div>
  );
}
