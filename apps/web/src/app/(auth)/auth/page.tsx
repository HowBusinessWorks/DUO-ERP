import { roRO } from '@damina/i18n';

export default function AuthPage() {
  return (
    <main>
      <h1>{roRO.workspace.auth}</h1>
      <p>
        Route group <code>(auth)</code>. Autentificarea Supabase, cele patru personas și
        provizionarea conturilor se implementează în pasul 02.
      </p>
    </main>
  );
}
