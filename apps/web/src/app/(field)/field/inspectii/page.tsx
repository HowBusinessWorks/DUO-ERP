import { TodayList } from '../../../../components/field/today-list';

export const dynamic = 'force-dynamic';

/**
 * `Inspectii` — a doua intrare din navigatia de jos.
 *
 * Aceeasi lista ca `Azi`, filtrata. Nu un ecran nou cu propria citire din
 * IndexedDB: doua liste care se pot desincroniza ar fi insemnat ca omul vede
 * inspectia intr-un loc si nu in celalalt, fara sa poata spune care minte.
 *
 * Checklist-ul propriu-zis se deschide dintr-o inspectie, si vine la 10c-2.
 */
export default function FieldInspectionsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Inspecții</h1>
      <TodayList only="inspectie" />
    </div>
  );
}
