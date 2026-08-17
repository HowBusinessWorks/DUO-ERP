import { EmptyState } from '@damina/ui';
import { requireWorkspace } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function ClientPortalPage() {
  await requireWorkspace('client');

  return (
    <EmptyState
      title="Portal client"
      body="Tichete, rapoarte lunare și istoricul obiectivelor, pentru clienții de mentenanță. Vine în faza 5; ruta există de acum, cu rolul Postgres app_client."
    />
  );
}
