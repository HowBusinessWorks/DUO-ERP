import { QuickActions } from '../../../components/field/quick-actions';
import { TodayList } from '../../../components/field/today-list';

export const dynamic = 'force-dynamic';

/**
 * `Azi` — prima pagina a terenului.
 *
 * Continutul vine din IndexedDB, nu de pe server: cu reteaua inchisa de tot,
 * ecranul se incarca din felia locala. De asta pagina in sine e goala si toata
 * treaba e in componenta de client — un randat pe server „cu fallback offline"
 * ar fi facut din offline calea rar folosita, adica prima care se strica fara
 * sa observe nimeni.
 */
export default function FieldTodayPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Azi</h1>
      <TodayList />
      <p className="pt-2 text-center text-xs text-ink-subtle">
        Aplicația de teren nu arată prețuri. Niciodată.
      </p>
      <QuickActions />
    </div>
  );
}
