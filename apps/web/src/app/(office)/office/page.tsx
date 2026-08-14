import { roRO } from '@damina/i18n';

export default function OfficePage() {
  return (
    <main>
      <h1>{roRO.workspace.office}</h1>
      <p>
        Route group <code>(office)</code>, rol Postgres <code>app_office</code>. Sidebar-ul,
        breadcrumb-ul dublu și pagina fractală vin în pasul 03.
      </p>
    </main>
  );
}
