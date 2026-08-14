import { roRO } from '@damina/i18n';

export default function FieldPage() {
  return (
    <main>
      <h1>{roRO.workspace.field}</h1>
      <p>
        Route group <code>(field)</code>, rol Postgres <code>app_field</code> — fără nicio coloană
        de preț, la nivel de date. PWA-ul offline și cele opt ecrane de teren vin în pasul 10.
      </p>
    </main>
  );
}
