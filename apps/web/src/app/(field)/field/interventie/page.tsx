import { EmptyState } from '@damina/ui';
import { Wrench } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * `Fișă de intervenție` — una dintre cele patru actiuni de sub butonul ＋.
 *
 * Ecranul complet vine la 10c-2, peste `intervention.save` — mutatia exista deja si e testata.
 *
 * Ruta exista de pe acum fiindca butonul ＋ o arata: o actiune care duce in 404
 * e mai rea decat una care spune cinstit ce urmeaza.
 */
export default function FieldInterventionPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Fișă de intervenție</h1>
      <EmptyState
        icon={<Wrench className="size-5" aria-hidden />}
        title="Ecranul se pregătește"
        body="Fișa de intervenție se va deschide de aici, cu materialele din gestiunea echipei tale, orele și pozele înainte/după. Merge și fără semnal."
      />
    </div>
  );
}
