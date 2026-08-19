import { EmptyState } from '@damina/ui';
import { Truck } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * `Utilaje și PV` — una dintre cele patru actiuni de sub butonul ＋.
 *
 * Schelet cu `EmptyState`, exact cum cere §3.5 — faza 4. Nu e ecran neterminat: e ecranul lui final pentru faza asta, si e aici ca ＋ sa nu duca in 404.
 *
 * Ruta exista de pe acum fiindca butonul ＋ o arata: o actiune care duce in 404
 * e mai rea decat una care spune cinstit ce urmeaza.
 */
export default function FieldEquipmentPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Utilaje și PV</h1>
      <EmptyState
        icon={<Truck className="size-5" aria-hidden />}
        title="Utilajele vin mai târziu"
        body="Predarea-primirea utilajelor cu proces-verbal și cererea de utilaj fac parte dintr-o fază următoare a aplicației. Deocamdată, cere utilajul prin dispecerat."
      />
    </div>
  );
}
