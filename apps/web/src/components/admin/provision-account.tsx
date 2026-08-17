'use client';

import { Banner, Button, Dialog } from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Provizionarea contului de login, cu parola aratata O SINGURA DATA.
 *
 * Verificarea #17 din pas: „parola temporara apare o singura data; refresh-ul
 * paginii nu o mai arata”. Nu e o cerinta de interfata, e o consecinta a
 * arhitecturii — parola se genereaza pe server, se intoarce in raspunsul
 * apelului care a creat contul si nu se scrie nicaieri. Componenta o tine in
 * `useState`, deci ea dispare cu randarea. Nu exista drum inapoi la ea; daca
 * omul o pierde, se foloseste „Am uitat parola” de pe ecranul de login.
 *
 * De aceea dialogul NU se poate inchide din greseala: `isDirty` cat timp parola
 * e pe ecran face ca Escape si butonul de inchidere sa ceara confirmare, exact
 * ca la un formular cu date nesalvate — pentru ca asta si e.
 */

export interface ProvisionAccountProps {
  readonly personId: string;
  readonly personName: string;
  readonly email: string | null;
  /** Motivul pentru care butonul nu se poate apasa: are deja cont, e inactiv... */
  readonly blockedReason?: string;
}

interface Credentials {
  readonly email: string;
  readonly password: string;
}

export function ProvisionAccount({
  personId,
  personName,
  email,
  blockedReason,
}: ProvisionAccountProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  const blocked = blockedReason ?? (email === null ? 'Persoana n-are adresă de email.' : undefined);

  const close = (): void => {
    setCredentials(null);
    setCopied(false);
    // Abia acum: pana la inchidere, un refresh ar fi sters parola de pe ecran.
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <Button
        variant="primary"
        size="sm"
        loading={pending}
        disabled={blocked !== undefined}
        disabledReason={blocked}
        onClick={() => {
          void (async () => {
            setPending(true);
            setError(undefined);
            try {
              const response = await fetch('/api/admin/provision', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ personId }),
              });
              const body: unknown = await response.json().catch(() => null);
              if (!response.ok) {
                const message =
                  typeof body === 'object' && body !== null && 'message' in body
                    ? String((body as { message: unknown }).message)
                    : 'Contul nu a putut fi creat.';
                setError(message);
                return;
              }
              setCredentials(body as Credentials);
            } catch {
              setError('Nu am putut ajunge la server. Încearcă din nou.');
            } finally {
              setPending(false);
            }
          })();
        }}
      >
        Creează contul de login
      </Button>

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      )}

      {credentials === null ? null : (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) {
              close();
            }
          }}
          isDirty
          size="sm"
          title={`Contul lui ${personName} e gata`}
          description="Parola de mai jos se afișează o singură dată. După ce închizi fereastra, nimeni — nici tu — nu o mai poate citi."
          footer={
            <Button variant="primary" onClick={close}>
              Am notat parola, închide
            </Button>
          }
        >
          <div className="space-y-4">
            <dl className="space-y-2">
              <div>
                <dt className="text-sm text-ink-muted">Adresa de login</dt>
                <dd className="font-mono text-base text-ink">{credentials.email}</dd>
              </div>
              <div>
                <dt className="text-sm text-ink-muted">Parolă temporară</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 rounded border border-border bg-surface-sunken px-3 py-2 font-mono text-base break-all text-ink select-all">
                    {credentials.password}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(credentials.password).then(() => {
                        setCopied(true);
                      });
                    }}
                  >
                    {copied ? 'Copiat' : 'Copiază'}
                  </Button>
                </dd>
              </div>
            </dl>

            <Banner
              tone="warning"
              title="La primul login i se cere să o schimbe"
              body="Parola asta a fost văzută de doi oameni, deci nu mai e a nimănui. Persoana intră cu ea o singură dată și ajunge direct pe ecranul de schimbare a parolei — nu poate sări peste."
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}
