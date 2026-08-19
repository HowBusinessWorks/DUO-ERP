import { Suspense } from 'react';
import { WorkUnitSheet } from '../../../../components/field/work-unit-sheet';

export const dynamic = 'force-dynamic';

/**
 * Fisa unei unitati de lucru. Ruta pe care o deschide lista `Azi`.
 *
 * Pagina n-are ce citi de pe server: tot ce se stie despre unitate vine din
 * felia locala. `Suspense` e cerut de `useSearchParams` din componenta —
 * `?copiaza=` porneste o copie a unei fise refuzate.
 */
export default async function FieldWorkUnitPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  const { unitId } = await params;

  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Se citește de pe telefon…</p>}>
      <WorkUnitSheet unitId={unitId} />
    </Suspense>
  );
}
