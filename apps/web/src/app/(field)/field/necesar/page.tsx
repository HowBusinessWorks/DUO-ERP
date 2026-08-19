import { MaterialRequest } from '../../../../components/field/material-request';

export const dynamic = 'force-dynamic';

/**
 * `Necesar material` — una dintre cele patru actiuni de sub butonul ＋.
 *
 * Bugetul de tapuri e cel mai strans din aplicatie: doua din trei sunt deja
 * cheltuite pana aici. Vezi comentariul componentei pentru ce inseamna asta la
 * fiecare camp de pe ecran.
 */
export default function FieldMaterialRequestPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Necesar material</h1>
      <MaterialRequest />
    </div>
  );
}
