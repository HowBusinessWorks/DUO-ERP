import { EmptyState } from '@damina/ui';
import { Construction } from 'lucide-react';

/**
 * Locul unui ecran care exista in plan dar nu e construit inca.
 *
 * NU e 404 si nu e un tab lipsa, dinadins: navigarea catre el functioneaza de
 * la inceput, deci nicio legatura nu se rupe cand modulul soseste, iar omul
 * vede din prima harta intreaga a aplicatiei. Un meniu care creste pe masura ce
 * se construieste produsul il invata de cinci ori.
 */
export function PhasePlaceholder({ phase, what }: { phase: number; what: string }) {
  return (
    <EmptyState
      icon={<Construction className="size-5" aria-hidden="true" />}
      title={`${what} — din faza ${String(phase)}`}
      body="Ecranul e prevăzut în plan și ruta către el funcționează deja. Se umple când modulul lui e construit, fără să se schimbe nimic din navigare."
    />
  );
}
