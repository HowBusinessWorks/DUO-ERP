'use client';

import type { AccountAction } from '@damina/contracts';
import { roRO } from '@damina/i18n';
import { Button, useToast } from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Manetele de urgenta de pe fisa unui cont: inchide-i sesiunile, sterge-i
 * factorii de autentificare.
 *
 * Amandoua merg pe `/api/admin/account`, singurul loc de unde se poate chema
 * Admin API-ul GoTrue. Amandoua cer confirmare, pentru ca amandoua se simt de
 * partea cealalta: una il da afara din aplicatie in mijlocul lucrului, cealalta
 * ii cere sa-si lege telefonul din nou.
 *
 * Ce nu fac: nu se aplica siesi. Ruta refuza oricum, dar un buton care arata
 * activ si raspunde „nu poti” e o promisiune mincinoasa — asa ca spune de la
 * inceput de ce e stins.
 */

export interface AccountActionsProps {
  readonly personId: string;
  readonly personName: string;
  /** Persoana de pe ecran e chiar cea logata? */
  readonly isSelf: boolean;
}

/*
 * Ce NU stie ecranul asta: daca omul are deja un factor configurat.
 *
 * Raspunsul e la GoTrue si se afla doar cu cheia de service, adica dintr-o
 * ruta. Am fi putut cere lista la randarea fisei, dar ar fi insemnat un
 * round-trip la Auth pe un ecran care se deschide des, pentru un buton apasat
 * o data la cateva luni. Asa ca butonul e mereu activ si ADEVARUL vine dupa
 * apasare: raspunsul spune cati factori s-au sters, iar mesajul il repeta.
 */

export function AccountActions({ personId, personName, isSelf }: AccountActionsProps) {
  const [running, setRunning] = useState<AccountAction | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const { toast } = useToast();
  const router = useRouter();

  async function run(action: AccountAction, question: string): Promise<void> {
    if (!window.confirm(question)) {
      return;
    }

    setRunning(action);
    setError(undefined);

    try {
      const response = await fetch('/api/admin/account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId, action }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record =
        typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

      if (!response.ok) {
        const message = record['message'];
        setError(typeof message === 'string' ? message : 'Operațiunea n-a reușit.');
        return;
      }

      const removed = typeof record['factorsRemoved'] === 'number' ? record['factorsRemoved'] : 0;
      toast({
        tone: 'success',
        title: action === 'revoke' ? roRO.mfa.adminRevokeDone : roRO.mfa.adminResetDone,
        ...(action === 'mfa-reset' && removed === 0
          ? { body: 'Nu avea niciun factor configurat — i-am închis doar sesiunile.' }
          : {}),
      });
      router.refresh();
    } catch {
      setError('Nu am putut ajunge la server. Verifică conexiunea.');
    } finally {
      setRunning(null);
    }
  }

  const selfReason = 'Pe tine nu te poți administra de aici.';

  return (
    <div className="space-y-3">
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          loading={running === 'revoke'}
          disabled={isSelf || running !== null}
          disabledReason={isSelf ? selfReason : undefined}
          onClick={() => {
            void run(
              'revoke',
              `Închizi toate sesiunile lui ${personName}? La următoarea cerere va trebui să se logheze din nou.`,
            );
          }}
        >
          {roRO.mfa.adminRevoke}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          loading={running === 'mfa-reset'}
          disabled={isSelf || running !== null}
          disabledReason={isSelf ? selfReason : undefined}
          onClick={() => {
            void run(
              'mfa-reset',
              `Resetezi verificarea în doi pași a lui ${personName}? Va trebui să-și lege din nou telefonul, la următorul login.`,
            );
          }}
        >
          {roRO.mfa.adminReset}
        </Button>
      </div>
    </div>
  );
}
