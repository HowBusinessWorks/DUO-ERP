import { JournalEntry } from '../../../../components/field/journal-entry';

export const dynamic = 'force-dynamic';

/**
 * `Jurnal de șantier` — una dintre cele patru acțiuni de sub butonul ＋.
 *
 * Tabela (`app.journal_entries`, migrarea `0033`), mutația (`journal.append`) și
 * ecranul au intrat împreună, la 10c-4: un tip de mutație fără executant ar fi
 * acceptat mutații pe care nu le poate aplica nimeni, iar telefonul ar fi crezut
 * că a trimis.
 */
export default function FieldJournalPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Jurnal de șantier</h1>
      <JournalEntry />
    </div>
  );
}
