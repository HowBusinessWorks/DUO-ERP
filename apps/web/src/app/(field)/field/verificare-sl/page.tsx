import { EmptyState } from '@damina/ui';
import { ListChecks } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * `Verificare SL` — al optulea ecran din §3.5.
 *
 * Schelet cu `EmptyState`, exact cum cere planul: verificarea liniilor de
 * situație de lucrări are nevoie de devize și situații, care vin în faza 2.
 *
 * N-are încă intrare în navigație, dinadins: bara de jos are patru locuri, iar
 * ＋ are cele patru acțiuni frecvente (§3.5). Un al cincilea loc ar fi costat un
 * tap pe fiecare drum, pentru un ecran care încă n-are ce arăta. Ruta există ca
 * legăturile din faza 2 să aibă unde ateriza, nu în 404.
 */
export default function FieldSiteLogVerificationPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Verificare SL</h1>
      <EmptyState
        icon={<ListChecks className="size-5" aria-hidden />}
        title="Verificarea liniilor vine cu devizele"
        body="Confirmarea cantităților din situația de lucrări are nevoie de deviz, care face parte dintr-o fază următoare. Până atunci, cantitățile se consemnează în jurnal."
      />
    </div>
  );
}
