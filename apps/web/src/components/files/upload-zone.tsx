'use client';

import { CHECKSUM_MAX_BYTES } from '@damina/contracts';
import { Button, ProgressBar, cn } from '@damina/ui';
import { CloudUpload, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type DragEvent } from 'react';

/**
 * Uploadul din browser, direct in R2.
 *
 * Trei lucruri fac codul asta mai lung decat un `<input type="file">`, si toate
 * trei vin din santier, nu din estetica:
 *
 * 1. **Retry per parte, nu pe fisier.** O parte cazuta se retrimite singura, de
 *    trei ori, cu pauza crescatoare. Pe un video de 2 GB, un retry pe fisier ar
 *    insemna sa se ia totul de la capat pentru 8 MB pierduti — adica, practic,
 *    sa nu se termine niciodata.
 * 2. **`XMLHttpRequest`, nu `fetch`.** `fetch` nu are progres la urcare. Pentru
 *    un fisier care se urca minute intregi, o bara nemiscata e acelasi lucru cu
 *    o aplicatie blocata.
 * 3. **Suma de control doar sub 32 MB.** `crypto.subtle` nu are hashing pe flux:
 *    ar trebui citit tot fisierul in memorie, iar serverul l-ar descarca inapoi
 *    din R2 ca sa-l verifice. La un document merita; la 2 GB, nu.
 *
 * Byte-ii nu trec prin serverul aplicatiei niciodata: `presign` da URL-uri,
 * browserul urca direct, `complete` verifica ce a ajuns acolo.
 */

interface UploadState {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly sent: number;
  readonly state: 'hashing' | 'uploading' | 'finishing' | 'done' | 'error' | 'canceled';
  readonly message?: string;
}

interface PresignResponse {
  readonly versionId: string;
  readonly partSize: number;
  readonly partUrls: readonly string[];
}

/** Cate parti se trimit in paralel. Peste 3, conexiunile slabe se sufoca. */
const PART_CONCURRENCY = 3;
const PART_ATTEMPTS = 3;

const STATE_LABELS: Readonly<Record<UploadState['state'], string>> = {
  hashing: 'se pregătește',
  uploading: 'se urcă',
  finishing: 'se verifică',
  done: 'gata',
  error: 'a eșuat',
  canceled: 'anulat',
};

function putPart(
  url: string,
  body: Blob,
  onProgress: (sent: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open('PUT', url, true);
    xhr.upload.onprogress = (event) => {
      onProgress(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`R2 a răspuns cu ${String(xhr.status)}.`));
        return;
      }
      const etag = xhr.getResponseHeader('ETag');
      if (etag === null || etag === '') {
        // Fara asta simptomul e mut: uploadul pare ca merge, dar `complete` cade
        // cu „partea n-are eticheta". Cauza e intotdeauna aceeasi.
        reject(
          new Error(
            'R2 nu a returnat eticheta părții (ETag). Bucket-ul are nevoie de „ExposeHeaders: ETag" în regulile CORS.',
          ),
        );
        return;
      }
      resolve(etag);
    };
    xhr.onerror = () => {
      reject(new Error('Conexiunea s-a întrerupt.'));
    };
    xhr.onabort = () => {
      reject(new Error('anulat'));
    };
    xhr.send(body);
  });
}

async function sha256Hex(file: File): Promise<string | undefined> {
  if (file.size > CHECKSUM_MAX_BYTES) {
    return undefined;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      return String((body as { error: unknown }).error);
    }
  } catch {
    /* raspunsul nu era JSON — ramane mesajul generic */
  }
  return `Serverul a răspuns cu ${String(response.status)}.`;
}

export function UploadZone({ parentId }: { readonly parentId: string }) {
  const router = useRouter();
  const [uploads, setUploads] = useState<readonly UploadState[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** XHR-urile vii, ca sa poata fi oprite. Cheia e id-ul uploadului. */
  const live = useRef(new Map<string, Set<XMLHttpRequest>>());

  const patch = useCallback((id: string, next: Partial<UploadState>) => {
    setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, id: string): Promise<void> => {
      const xhrs = new Set<XMLHttpRequest>();
      live.current.set(id, xhrs);

      try {
        patch(id, { state: 'hashing' });
        const checksum = await sha256Hex(file);

        patch(id, { state: 'uploading' });
        const presign = await fetch('/api/files/presign', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            parentId,
            filename: file.name,
            size: file.size,
            declaredMime: file.type === '' ? undefined : file.type,
            checksumSha256: checksum,
          }),
        });
        if (!presign.ok) {
          patch(id, { state: 'error', message: await readError(presign) });
          return;
        }
        const plan = (await presign.json()) as PresignResponse;

        // Progresul se aduna din ce a raportat FIECARE parte, nu din cate parti
        // s-au terminat: altfel bara sta nemiscata minute intregi la un video.
        const sentByPart = new Map<number, number>();
        const bump = (part: number, sent: number): void => {
          sentByPart.set(part, sent);
          let total = 0;
          for (const value of sentByPart.values()) {
            total += value;
          }
          patch(id, { sent: total });
        };

        const etags = new Array<string>(plan.partUrls.length);
        let next = 0;
        const worker = async (): Promise<void> => {
          for (;;) {
            const index = next;
            next += 1;
            const url = plan.partUrls[index];
            if (url === undefined) {
              return;
            }
            const chunk = file.slice(index * plan.partSize, (index + 1) * plan.partSize);

            let lastError: unknown;
            for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt += 1) {
              try {
                etags[index] = await putPart(
                  url,
                  chunk,
                  (sent) => {
                    bump(index, sent);
                  },
                  (xhr) => xhrs.add(xhr),
                );
                bump(index, chunk.size);
                lastError = undefined;
                break;
              } catch (error) {
                lastError = error;
                if (error instanceof Error && error.message === 'anulat') {
                  throw error;
                }
                // Se reia PARTEA, nu fisierul. Ce s-a trimis din ea se pierde;
                // restul fisierului, nu.
                bump(index, 0);
                await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
              }
            }
            if (lastError !== undefined) {
              throw lastError;
            }
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(PART_CONCURRENCY, plan.partUrls.length) }, worker),
        );

        patch(id, { state: 'finishing', sent: file.size });
        const complete = await fetch('/api/files/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            versionId: plan.versionId,
            parts: etags.map((etag, index) => ({ partNumber: index + 1, etag })),
          }),
        });
        if (!complete.ok) {
          patch(id, { state: 'error', message: await readError(complete) });
          return;
        }

        patch(id, { state: 'done' });
        router.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Uploadul a eșuat.';
        patch(id, message === 'anulat' ? { state: 'canceled' } : { state: 'error', message });
      } finally {
        live.current.delete(id);
      }
    },
    [parentId, patch, router],
  );

  const start = useCallback(
    (files: FileList | null) => {
      if (files === null) {
        return;
      }
      for (const file of Array.from(files)) {
        const id = `${String(Date.now())}-${file.name}-${String(Math.random()).slice(2, 8)}`;
        setUploads((current) => [
          ...current,
          { id, name: file.name, size: file.size, sent: 0, state: 'hashing' },
        ]);
        void uploadOne(file, id);
      }
    },
    [uploadOne],
  );

  const cancel = useCallback((id: string) => {
    for (const xhr of live.current.get(id) ?? []) {
      xhr.abort();
    }
  }, []);

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragging(false);
          start(event.dataTransfer.files);
        }}
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm',
          dragging ? 'border-brand-500 bg-brand-50/60' : 'border-border bg-surface-sunken',
        )}
      >
        <span className="flex items-center gap-2 text-ink-muted">
          <CloudUpload className="size-4" aria-hidden="true" />
          Trage fișiere aici, sau alege-le de pe disc.
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          Alege fișiere
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            start(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      {uploads.length === 0 ? null : (
        <ul className="space-y-2">
          {uploads.map((item) => (
            <li key={item.id} className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{item.name}</span>
                <span className="flex items-center gap-2 text-xs text-ink-muted">
                  {STATE_LABELS[item.state]}
                  {item.state === 'uploading' || item.state === 'hashing' ? (
                    <button
                      type="button"
                      onClick={() => {
                        cancel(item.id);
                      }}
                      className="text-ink-subtle hover:text-danger-600"
                      aria-label={`Renunță la ${item.name}`}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              </div>
              {item.state === 'uploading' || item.state === 'finishing' ? (
                <ProgressBar
                  className="mt-1.5"
                  tone="brand"
                  value={item.size === 0 ? 0 : Math.round((item.sent / item.size) * 100)}
                  label={item.name}
                />
              ) : null}
              {item.message === undefined ? null : (
                <p className="mt-1 text-xs text-danger-600">{item.message}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
