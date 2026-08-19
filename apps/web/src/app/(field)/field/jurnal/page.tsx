import { EmptyState } from '@damina/ui';
import { BookText } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * `Jurnal de șantier` — una dintre cele patru actiuni de sub butonul ＋.
 *
 * Jurnalul n-are inca tabela, deci nici mutatie: `journal.append` NU e in `MUTATION_TYPES`, dinadins — un tip fara executant ar fi acceptat mutatii pe care nu le poate aplica nimeni, iar telefonul ar fi crezut ca a trimis. Tabela + mutatia + ecranul vin impreuna, la 10c-4.
 *
 * Ruta exista de pe acum fiindca butonul ＋ o arata: o actiune care duce in 404
 * e mai rea decat una care spune cinstit ce urmeaza.
 */
export default function FieldJournalPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Jurnal de șantier</h1>
      <EmptyState
        icon={<BookText className="size-5" aria-hidden />}
        title="Ecranul se pregătește"
        body="Aici se va scrie ce s-a întâmplat pe șantier, cu poze pe etapă. Până atunci, ce e de consemnat intră în observațiile fișei."
      />
    </div>
  );
}
