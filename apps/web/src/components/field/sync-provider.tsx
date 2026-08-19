'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { summary, syncOnce, type SyncSummary } from '../../lib/field/sync';

/**
 * Starea sincronizării, pentru tot shell-ul de teren (pasul 10, §3.1).
 *
 * Se sincronizează singură la trei momente, și fiecare are un motiv:
 *
 *  - **la pornire**, ca ecranul `Azi` să nu fie vechi de o zi;
 *  - **când revine rețeaua** (`online`), fiindcă ăsta e momentul în care omul
 *    iese din subsol și încă ține telefonul în mână;
 *  - **la fiecare 60 de secunde**, cât timp e ceva de trimis. Când coada e
 *    goală nu se mai bate la ușă degeaba — bateria e o resursă de teren.
 */

interface SyncContextValue extends SyncSummary {
  readonly syncing: boolean;
  /**
   * Cine e conectat. Vine din sesiunea de pe server, prin layout.
   *
   * Ecranele au nevoie de el ca sa poata compune mutatii — pontajul isi scrie
   * propriul `personId`. Nu se citeste din felie: felia e o copie a datelor, nu
   * a identitatii, iar un ecran care ar ghici omul din primul rand de `people`
   * ar ponta pe altcineva in ziua in care echipa se schimba.
   */
  readonly personId: string;
  readonly refresh: () => Promise<void>;
  readonly syncNow: () => Promise<void>;
}

const EMPTY: SyncSummary = {
  data: 0,
  media: 0,
  blocked: 0,
  lastPulledAt: null,
  lastPushedAt: null,
  online: true,
};

const SyncContext = createContext<SyncContextValue>({
  ...EMPTY,
  syncing: false,
  personId: '',
  refresh: async () => undefined,
  syncNow: async () => undefined,
});

export const useSync = (): SyncContextValue => useContext(SyncContext);

const TICK_MS = 60_000;

export function SyncProvider({
  children,
  personId,
}: {
  readonly children: ReactNode;
  readonly personId: string;
}) {
  const [state, setState] = useState<SyncSummary>(EMPTY);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setState(await summary());
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      setState(await syncOnce());
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void syncNow();

    const onOnline = (): void => {
      void syncNow();
    };
    window.addEventListener('online', onOnline);

    // Doar când e ceva de trimis. Un interval care rulează pe o coadă goală e
    // baterie consumată ca să afle că n-are ce face.
    const timer = window.setInterval(() => {
      void (async () => {
        const now = await summary();
        setState(now);
        if (now.online && (now.data > 0 || now.media > 0)) {
          await syncNow();
        }
      })();
    }, TICK_MS);

    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [syncNow]);

  // Starea de rețea se citește și pasiv: `offline` nu declanșează sincronizare,
  // dar trebuie să se vadă imediat în bandă.
  useEffect(() => {
    const onOffline = (): void => {
      setState((current) => ({ ...current, online: false }));
    };
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return (
    <SyncContext.Provider value={{ ...state, syncing, personId, refresh, syncNow }}>
      {children}
    </SyncContext.Provider>
  );
}
