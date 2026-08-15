import { EmptyState } from '@damina/ui';
import { ClipboardCheck } from 'lucide-react';

export default function FieldTodayPage() {
  return (
    <>
      <EmptyState
        icon={<ClipboardCheck className="size-5" aria-hidden="true" />}
        title="Nimic pe ziua de azi"
        body="Când primești o inspecție sau o intervenție, apare aici. Merge și fără semnal — se trimite singură când prinzi rețea."
      />
      <p className="mt-6 text-center text-sm text-ink-subtle">
        Aplicația de teren nu arată prețuri. Niciodată.
      </p>
    </>
  );
}
