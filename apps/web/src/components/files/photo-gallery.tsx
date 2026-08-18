'use client';

import { thumbnailVariant } from '@damina/contracts';
import { EmptyState, cn } from '@damina/ui';
import { Clock, ImageOff, MapPin, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * Galeria de poze — verificarea #20.
 *
 * Trei lucruri o fac să țină la 300 de poze, și toate trei sunt despre ce NU se
 * încarcă:
 *
 * 1. **Miniaturi, niciodată originalele.** `thumb160` în grilă, `thumb1200` în
 *    previzualizare. O poză de telefon are 4 MB; grila ar fi cerut 1,2 GB.
 * 2. **`loading="lazy"`**, deci browserul cere doar ce se vede. Nativ, nu cu un
 *    observator scris de mână — face același lucru, și îl face mai bine.
 * 3. **URL-urile miniaturilor sunt rute ale aplicației, nu semnături.** Ruta
 *    semnează la cerere, cu TTL de 15 minute; altfel randarea paginii ar fi
 *    însemnat 300 de semnături R2 înainte ca omul să vadă ceva.
 *
 * Geotagul și ora se afișează pe fiecare poză, cerință explicită a pasului: o
 * poză de recepție fără „unde" și „când" nu dovedește nimic.
 */

export interface Photo {
  readonly id: string;
  readonly name: string;
  readonly versionId: string | null;
  readonly capturedAt: string | null;
  readonly geoLat: string | null;
  readonly geoLng: string | null;
  readonly geoSource: string | null;
}

const dateTimeFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Sursa coordonatelor spune cât cântăresc: culese la fața locului, sau din fișier. */
const GEO_SOURCE_LABELS: Readonly<Record<string, string>> = {
  device: 'de pe aparat, la fața locului',
  exif: 'din fișier (EXIF)',
  manual: 'pus de om',
};

function GeoBadge({ photo }: { readonly photo: Photo }) {
  if (photo.geoLat === null || photo.geoLng === null) {
    return <span className="text-ink-subtle">fără locație</span>;
  }
  const source = photo.geoSource === null ? '' : (GEO_SOURCE_LABELS[photo.geoSource] ?? '');
  return (
    <span className="flex items-center gap-1" title={source}>
      <MapPin className="size-3 shrink-0" aria-hidden="true" />
      {Number(photo.geoLat).toFixed(4)}, {Number(photo.geoLng).toFixed(4)}
    </span>
  );
}

export function PhotoGallery({ photos }: { readonly photos: readonly Photo[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const move = useCallback(
    (delta: number) => {
      setOpenIndex((current) => {
        if (current === null) {
          return null;
        }
        const next = current + delta;
        return next < 0 || next >= photos.length ? current : next;
      });
    },
    [photos.length],
  );

  // Săgețile și Escape, pentru că o galerie se răsfoiește de la tastatură. Fără
  // ele, 300 de poze înseamnă 300 de clicuri pe o săgeată de 24 de pixeli.
  useEffect(() => {
    if (openIndex === null) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenIndex(null);
      } else if (event.key === 'ArrowRight') {
        move(1);
      } else if (event.key === 'ArrowLeft') {
        move(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [openIndex, move]);

  if (photos.length === 0) {
    return (
      <EmptyState
        icon={<ImageOff className="size-5" aria-hidden="true" />}
        title="Nicio poză aici"
        body="Pozele urcate în folderul ăsta apar în galerie, cu ora și locul în care au fost făcute."
      />
    );
  }

  const open = openIndex === null ? undefined : photos[openIndex];

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {photos.map((photo, index) => (
          <li key={photo.id} className="overflow-hidden rounded-lg border border-border bg-surface">
            <button
              type="button"
              onClick={() => {
                setOpenIndex(index);
              }}
              className="block w-full focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={`Deschide ${photo.name}`}
            >
              <Thumb photo={photo} />
            </button>
            <div className="space-y-0.5 px-2 py-1.5 text-xs text-ink-muted">
              <p className="truncate text-ink" title={photo.name}>
                {photo.name}
              </p>
              <p className="flex items-center gap-1">
                <Clock className="size-3 shrink-0" aria-hidden="true" />
                {photo.capturedAt === null
                  ? 'fără oră'
                  : dateTimeFormat.format(new Date(photo.capturedAt))}
              </p>
              <GeoBadge photo={photo} />
            </div>
          </li>
        ))}
      </ul>

      {open === undefined ? null : (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={open.name}
        >
          <div className="flex items-start justify-between gap-4 text-white">
            <div className="min-w-0">
              <p className="truncate font-medium">{open.name}</p>
              <p className="text-xs text-white/70">
                {open.capturedAt === null
                  ? 'fără oră'
                  : dateTimeFormat.format(new Date(open.capturedAt))}
                {open.geoLat === null || open.geoLng === null
                  ? ' · fără locație'
                  : ` · ${Number(open.geoLat).toFixed(5)}, ${Number(open.geoLng).toFixed(5)}${
                      open.geoSource === null
                        ? ''
                        : ` (${GEO_SOURCE_LABELS[open.geoSource] ?? open.geoSource})`
                    }`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpenIndex(null);
              }}
              aria-label="Închide"
              className="rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center gap-3">
            <Arrow direction={-1} onClick={move} disabled={openIndex === 0} />
            {open.versionId === null ? null : (
              /*
               * `thumb1200`, nu originalul: destul pentru un ecran, și de zeci de
               * ori mai puțin de descărcat. Originalul se ia cu „Descarcă".
               *
               * `<img>`, nu `next/image`, peste tot în galerie: optimizatorul lui
               * Next ar descărca fișierul PE SERVER ca să-l reprelucreze — adică
               * exact ce nu face pasul ăsta, byte-ii nu trec prin server. În plus,
               * miniaturile sunt deja WebP redimensionat, făcut o dată de worker;
               * a doua optimizare ar fi muncă și cost pentru zero câștig.
               */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/files/${open.versionId}/thumb/${thumbnailVariant(1200)}`}
                alt={open.name}
                className="max-h-full max-w-full object-contain"
              />
            )}
            <Arrow
              direction={1}
              onClick={move}
              disabled={openIndex !== null && openIndex >= photos.length - 1}
            />
          </div>

          {open.versionId === null ? null : (
            <div className="flex justify-center gap-4 pt-3 text-sm">
              <a href={`/api/files/${open.versionId}`} className="text-white/80 hover:text-white">
                Descarcă originalul
              </a>
              <span className="text-white/40">
                {openIndex === null ? '' : `${String(openIndex + 1)} din ${String(photos.length)}`}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Thumb({ photo }: { readonly photo: Photo }) {
  const [failed, setFailed] = useState(false);

  // Miniatura lipsă nu e o eroare: worker-ul o produce după upload, iar ruta
  // răspunde 404 până atunci. Substituentul spune exact asta.
  if (photo.versionId === null || failed) {
    return (
      <span className="flex aspect-square items-center justify-center bg-surface-sunken text-xs text-ink-subtle">
        se pregătește…
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/files/${photo.versionId}/thumb/${thumbnailVariant(160)}`}
      alt={photo.name}
      loading="lazy"
      onError={() => {
        setFailed(true);
      }}
      className="aspect-square w-full bg-surface-sunken object-cover"
    />
  );
}

function Arrow({
  direction,
  onClick,
  disabled,
}: {
  readonly direction: -1 | 1;
  readonly onClick: (delta: number) => void;
  readonly disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onClick(direction);
      }}
      disabled={disabled}
      aria-label={direction === 1 ? 'Poza următoare' : 'Poza precedentă'}
      className={cn(
        'shrink-0 rounded-full p-2 text-white/80',
        disabled ? 'invisible' : 'hover:bg-white/10 hover:text-white',
      )}
    >
      <span aria-hidden="true" className="text-2xl leading-none">
        {direction === 1 ? '›' : '‹'}
      </span>
    </button>
  );
}
