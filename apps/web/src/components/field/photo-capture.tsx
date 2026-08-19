'use client';

import { uuidv7 } from '@damina/shared';
import { Button } from '@damina/ui';
import { Camera } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { enqueueMedia } from '../../lib/field/sync';
import { useSync } from './sync-provider';

/**
 * Butonul de poză, pentru toate ecranele de teren.
 *
 * Poza **nu se urcă acum.** Intră în coadă, în IndexedDB, și pleacă la primul
 * ciclu de sincronizare. Din perspectiva omului, apăsarea e instantanee și în
 * subsol, și în birou — iar asta e tot ce trebuie să știe.
 *
 * `capture="environment"` deschide direct camera din spate pe telefon, fără
 * ecranul de alegere „Galerie / Cameră". Un tap economisit, de fiecare dată.
 * Pe desktop atributul e ignorat și rămâne un selector de fișiere obișnuit —
 * exact ce trebuie pentru testare.
 */

/**
 * Cât se așteaptă după coordonate. Trei secunde, și fără ele dacă întârzie.
 *
 * Fixul GPS în subsol nu vine niciodată. O poză fără coordonate e o dovadă mai
 * slabă; o poză neluată, pentru că omul s-a plictisit de rotița de „se
 * localizează", nu e nicio dovadă.
 */
const GEO_TIMEOUT_MS = 3000;

interface Position {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy: number;
}

async function currentPosition(): Promise<Position | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return null;
  }
  return new Promise<Position | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => {
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

/** Extensia din tipul MIME, ca numele fisierului sa nu minta. */
function extensionOf(file: File): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1];
  if (fromName !== undefined) {
    return fromName.toLowerCase();
  }
  return file.type === 'image/png' ? 'png' : 'jpg';
}

export interface PhotoCaptureProps {
  readonly workUnitId: string;
  /** Faza, doar la lucrări. Alege folderul „Înainte" sau „După". */
  readonly phase?: 'inainte' | 'dupa';
  readonly label?: string;
}

export function PhotoCapture({ workUnitId, phase, label = 'Fă poză' }: PhotoCaptureProps) {
  const { refresh } = useSync();
  const inputRef = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(0);

  const take = useCallback(
    async (files: FileList | null) => {
      if (files === null || files.length === 0) {
        return;
      }
      // O singură citire de poziție pentru toate pozele din serie: sunt făcute
      // în același loc, iar trei cereri de GPS ar însemna trei așteptări.
      const position = await currentPosition();

      for (const file of Array.from(files)) {
        const id = uuidv7();
        await enqueueMedia({
          id,
          workUnitId,
          ...(phase === undefined ? {} : { phase }),
          // Numele poartă id-ul dinadins: două poze cu același nume în același
          // folder ar fi devenit două VERSIUNI ale aceluiași fișier, iar a doua
          // ar fi ascuns-o pe prima.
          filename: `teren-${id}.${extensionOf(file)}`,
          mime: file.type,
          blob: file,
          createdAt: new Date().toISOString(),
          ...(position === null
            ? {}
            : { lat: position.lat, lng: position.lng, accuracy: position.accuracy }),
        });
      }

      setAdded((current) => current + files.length);
      await refresh();
      if (inputRef.current !== null) {
        // Fără asta, a doua poză identică n-ar declanșa `change`.
        inputRef.current.value = '';
      }
    },
    [phase, refresh, workUnitId],
  );

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        aria-label={label}
        data-testid="photo-input"
        onChange={(event) => {
          void take(event.target.files);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        className="min-h-12 w-full"
        onClick={() => inputRef.current?.click()}
      >
        <Camera className="size-5" aria-hidden />
        {label}
      </Button>
      {added > 0 ? (
        <p className="text-center text-xs text-ink-muted">
          {added === 1 ? '1 poză în coadă' : `${String(added)} poze în coadă`} · pleacă singure când
          prinzi semnal
        </p>
      ) : null}
    </div>
  );
}
