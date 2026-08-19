'use client';

import type { FieldWorkUnit } from '@damina/services';
import { EmptyState } from '@damina/ui';
import { FileQuestion } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fieldDb, hasIndexedDb } from '../../lib/field/db';
import { FieldInspectionSheet } from './inspection-sheet';
import { FieldInterventionSheet } from './intervention-sheet';
import { useSync } from './sync-provider';

/**
 * Fisa unei unitati de lucru, pe teren.
 *
 * Alege ecranul dupa tipul unitatii, citind din felia locala. Nu e o pagina de
 * server care „stie" ce sa randeze: cu reteaua inchisa de tot, tot ce se poate
 * sti despre unitate e ce a apucat sa ajunga pe telefon.
 *
 * `?copiaza=<id>` porneste o COPIE a unei mutatii refuzate (§3.3). Ecranul se
 * incarca atunci din ce a scris omul, nu din ce stie serverul — vezi fisele.
 */
export function WorkUnitSheet({ unitId }: { readonly unitId: string }) {
  const { lastPulledAt } = useSync();
  const params = useSearchParams();
  const copyOf = params.get('copiaza') ?? undefined;

  const [unit, setUnit] = useState<FieldWorkUnit | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      if (!hasIndexedDb()) {
        setUnit(null);
        return;
      }
      setUnit((await fieldDb().workUnits.get(unitId)) ?? null);
    })();
  }, [lastPulledAt, unitId]);

  if (unit === undefined) {
    return <p className="text-sm text-ink-muted">Se citește de pe telefon…</p>;
  }

  if (unit === null) {
    return (
      <EmptyState
        icon={<FileQuestion className="size-5" aria-hidden />}
        title="Unitatea nu e pe telefon"
        body="Ori nu ți-a fost repartizată, ori a ieșit din fereastra de 30 de zile a feliei. Deschide aplicația cu semnal ca s-o iei din nou."
      />
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">{unit.name}</h1>
        <p className="text-sm text-ink-muted">
          {unit.objectiveName} · {unit.code}
        </p>
      </header>

      {unit.type === 'inspectie' ? (
        <FieldInspectionSheet unit={unit} copyOf={copyOf} />
      ) : unit.type === 'interventie' ? (
        <FieldInterventionSheet unit={unit} copyOf={copyOf} />
      ) : (
        <EmptyState
          icon={<FileQuestion className="size-5" aria-hidden />}
          title="Lucrările nu se completează de pe teren"
          body="Pentru o lucrare, de pe teren se trimit pontajul, necesarul de material și pozele. Fișa ei se ține la birou."
        />
      )}
    </div>
  );
}
