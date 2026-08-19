import { TimesheetDay } from '../../../../components/field/timesheet-day';

export const dynamic = 'force-dynamic';

/**
 * `Pontaj` — ziua mea, impartita pe unitati de lucru.
 *
 * A patra intrare din bara de jos, si nu una din cele de sub ＋: se face in
 * fiecare zi, la aceeasi ora, iar un lucru zilnic n-are ce cauta sub un meniu.
 */
export default function FieldTimesheetPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Pontaj</h1>
      <TimesheetDay />
    </div>
  );
}
