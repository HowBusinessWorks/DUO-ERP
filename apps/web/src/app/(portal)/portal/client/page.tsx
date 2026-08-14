import { roRO } from '@damina/i18n';

export default function ClientPortalPage() {
  return (
    <main>
      <h1>{roRO.workspace.portalClient}</h1>
      <p>
        Route group <code>(portal)</code>, rol Postgres <code>app_client</code>.
      </p>
    </main>
  );
}
