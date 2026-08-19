import { EmptyState } from '@damina/ui';
import { PackagePlus } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * `Necesar material` — una dintre cele patru actiuni de sub butonul ＋.
 *
 * Ecranul complet vine la 10c-3. Bugetul de tapuri (§0) e blocant: doua tapuri sunt deja consumate de ＋ si de alegerea actiunii, deci ecranul are voie la UNUL. Asta inseamna gestiune si produse precompletate din felie, nu formular gol.
 *
 * Ruta exista de pe acum fiindca butonul ＋ o arata: o actiune care duce in 404
 * e mai rea decat una care spune cinstit ce urmeaza.
 */
export default function FieldMaterialRequestPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Necesar material</h1>
      <EmptyState
        icon={<PackagePlus className="size-5" aria-hidden />}
        title="Ecranul se pregătește"
        body="Cererea de material va pleca de aici în trei atingeri, direct în coada biroului, și va merge și fără semnal. Până atunci, cere materialul prin fișa de intervenție."
      />
    </div>
  );
}
