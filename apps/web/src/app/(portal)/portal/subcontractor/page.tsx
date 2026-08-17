import { EmptyState } from '@damina/ui';
import { requireWorkspace } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function SubcontractorPortalPage() {
  // Layout-ul lasa sa treaca ambele persone de portal; separarea dintre ele se
  // face aici, unde se stie despre care din cele doua e vorba.
  await requireWorkspace('subcontractor');

  return (
    <EmptyState
      title="Portal subcontractant"
      body="Aici își vede fiecare subcontractant pachetele lui, situațiile de lucrări și procesele verbale. Vine în faza 2; ruta există de acum, cu rolul Postgres app_subcontractor."
    />
  );
}
