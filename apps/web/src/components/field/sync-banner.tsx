'use client';

import { Badge } from '@damina/ui';
import { AlertTriangle, Check, CloudOff, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useSync } from './sync-provider';

/**
 * Banda de sincronizare (pasul 10, §3.4).
 *
 * **Numără separat datele și pozele.** Dacă omul vede „4 de sincronizat" și sunt
 * doar poze, intră în panică degeaba — fișa lui e deja la birou. Un singur număr
 * ar fi fost mai scurt și ar fi mințit exact în momentul în care contează.
 *
 * Conflictul are locul lui, înaintea celorlalte: e singura stare care **cere
 * omul**. Restul se rezolvă de la sine când revine semnalul.
 */
export function SyncBanner() {
  const { data, media, blocked, online, syncing, syncNow } = useSync();

  if (blocked > 0) {
    return (
      <Link
        href="/field/conflicte"
        className="flex items-center gap-2 bg-warning-700 px-4 py-2 text-left text-warning-50"
      >
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-sm">
          {blocked === 1
            ? 'O fișă așteaptă o decizie'
            : `${String(blocked)} fișe așteaptă o decizie`}
        </span>
        <Badge tone="outline" className="border-warning-200 text-warning-50">
          rezolvă
        </Badge>
      </Link>
    );
  }

  const pending = data + media;

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={syncing}
      className={`flex w-full items-center gap-2 px-4 py-2 text-left ${
        online ? 'bg-brand-900 text-brand-100' : 'bg-ink-900 text-ink-100'
      }`}
    >
      {online ? (
        syncing ? (
          <RefreshCw className="size-4 shrink-0 animate-spin" aria-hidden />
        ) : pending === 0 ? (
          <Check className="size-4 shrink-0" aria-hidden />
        ) : (
          <RefreshCw className="size-4 shrink-0" aria-hidden />
        )
      ) : (
        <CloudOff className="size-4 shrink-0" aria-hidden />
      )}

      <span className="flex-1 text-sm">
        {syncing
          ? 'Se sincronizează…'
          : pending === 0
            ? online
              ? 'Totul e sincronizat'
              : 'Fără semnal — totul e salvat pe telefon'
            : describe(data, media)}
      </span>

      <Badge tone="outline" className="border-current text-current">
        {online ? 'online' : 'offline'}
      </Badge>
    </button>
  );
}

/** „2 fișe și 5 poze", nu „7". Cele două nu se adună. */
function describe(data: number, media: number): string {
  const parts: string[] = [];
  if (data > 0) {
    parts.push(data === 1 ? 'o fișă' : `${String(data)} fișe`);
  }
  if (media > 0) {
    parts.push(media === 1 ? 'o poză' : `${String(media)} poze`);
  }
  return `${parts.join(' și ')} de trimis`;
}
