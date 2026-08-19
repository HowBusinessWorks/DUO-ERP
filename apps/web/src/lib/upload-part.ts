/**
 * Urcarea UNEI parti in R2, cu progres.
 *
 * Traieste separat fiindca o folosesc doua locuri foarte diferite —
 * `UploadZone` (birou, fisiere de pana la 4 GB) si coada de poze a terenului —
 * iar a doua copie ar fi ramas in urma exact la mesajul de ETag, adica la
 * singurul simptom mut din tot lantul de upload.
 *
 * `XMLHttpRequest`, nu `fetch`: `fetch` nu are progres la urcare, iar pe o
 * conexiune de santier o bara nemiscata e acelasi lucru cu o aplicatie blocata.
 */

/** Aruncata cand omul a renuntat. Se recunoaste dupa mesaj, peste tot. */
export const ABORTED = 'anulat';

export function putPart(
  url: string,
  body: Blob,
  onProgress: (sent: number) => void,
  register?: (xhr: XMLHttpRequest) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    register?.(xhr);
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
      reject(new Error(ABORTED));
    };
    xhr.send(body);
  });
}

/** sha256 in hex, cand fisierul e destul de mic cat sa merite citit intreg. */
export async function sha256Hex(blob: Blob, maxBytes: number): Promise<string | undefined> {
  if (blob.size > maxBytes) {
    return undefined;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Mesajul de eroare al serverului, cand e JSON. Altfel, codul de stare. */
export async function readError(response: Response): Promise<string> {
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
