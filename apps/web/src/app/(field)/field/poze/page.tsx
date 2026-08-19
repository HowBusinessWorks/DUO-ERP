import { MediaQueue } from '../../../../components/field/media-queue';

export const dynamic = 'force-dynamic';

/**
 * `Poze` — coada de imagini, a treia intrare din navigatia de jos.
 *
 * Nu e o galerie: pozele deja urcate nu mai sunt pe telefon, si nici n-au ce
 * cauta acolo — o zi de teren inseamna sute de MB. Ecranul arata exact ce n-a
 * plecat inca, si de ce.
 */
export default function FieldPhotosPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Poze</h1>
      <MediaQueue />
    </div>
  );
}
