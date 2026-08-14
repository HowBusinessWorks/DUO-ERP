import { uuidv7 } from '@damina/shared';
import { optionalEnv } from './env';

/**
 * Cheile din R2 sunt UUID opac, FARA cale semantica.
 *
 * Adica `blobs/{uuid}`, niciodata `contracte/4700/poze/...`. Motivul e cel din
 * PLAN_TEHNIC §9.1: arborele de foldere traieste in Postgres, deci mutarea unui
 * folder cu 100.000 de fisiere e un singur `UPDATE parent_id` si zero operatii
 * pe R2. Daca ierarhia ar fi in cheie, aceeasi mutare ar insemna 100.000 de
 * copieri urmate de 100.000 de stergeri.
 */

export type BucketName = 'docs' | 'derived' | 'tmp' | 'archive';

/**
 * Prefix optional pentru toate cheile.
 *
 * Exista pentru cazul in care Damina imparte un bucket cu altcineva: tot ce
 * scriem sta sub prefixul asta si nu atinge restul. Cand fiecare mediu isi
 * capata bucket-urile lui, `R2_KEY_PREFIX` ramane gol si cheile sunt curate.
 */
function keyPrefix(): string {
  const raw = optionalEnv('R2_KEY_PREFIX').trim().replace(/^\/+|\/+$/g, '');
  if (raw === '') {
    return '';
  }
  if (!/^[a-z0-9][a-z0-9_/-]{0,63}$/.test(raw)) {
    throw new Error(`R2_KEY_PREFIX invalid: "${raw}".`);
  }
  return `${raw}/`;
}

/** Cheia unei versiuni de fisier: continutul binar propriu-zis. */
export function blobKey(): string {
  return `${keyPrefix()}blobs/${uuidv7()}`;
}

/** Cheia unui artefact derivat (miniatura, previzualizare, PDF randat). */
export function derivedKey(fileVersionId: string, variant: string): string {
  if (!/^[a-z0-9_-]{1,32}$/.test(variant)) {
    throw new Error(`Nume de varianta invalid: "${variant}".`);
  }
  return `${keyPrefix()}derived/${fileVersionId}/${variant}`;
}

/** Cheia unui artefact temporar de job. Bucket-ul tmp expira automat la 7 zile. */
export function tmpKey(prefix: string): string {
  if (!/^[a-z0-9_.-]{1,64}$/.test(prefix)) {
    throw new Error(`Prefix temporar invalid: "${prefix}".`);
  }
  return `${keyPrefix()}tmp/${prefix}/${uuidv7()}`;
}
