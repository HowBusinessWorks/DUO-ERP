import { z } from 'zod';
import { uuidSchema } from './primitives';

/**
 * Arborele de fisiere: upload, descarcare, organizare, partajare.
 *
 * Regula pasului care se citeste direct din forma schemelor: **serverul nu vede
 * niciodata byte-ii**. `presignUploadInput` descrie ce se va urca, nu ce s-a
 * urcat; `completeUploadInput` descrie ce s-a urcat efectiv, ca sa poata fi
 * verificat. Nu exista nicaieri un camp cu continut de fisier.
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);

const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);

/**
 * Numele unui fisier sau folder.
 *
 * Fara separator de cale si fara caracterele pe care Windows le refuza: un nume
 * care nu se poate scrie pe disc face descarcarea in masa sa cada tocmai la
 * fisierul care conteaza. Verificarea e si in baza (`nodes_name_no_slash`),
 * pentru ca formularul nu e singura cale de scriere.
 */
export const nodeNameSchema = requiredText(255, 'Numele e obligatoriu.').refine(
  (name) => !/[/\\:*?"<>|]/.test(name) && name !== '.' && name !== '..',
  'Numele nu poate conține / \\ : * ? " < > | și nu poate fi „." sau „..".',
);

/** Limitele din §3.2, in octeti. Verificate la presign SI la complete. */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
/**
 * Video: 4 GB.
 *
 * Nu e o limita tehnica — R2 duce 5 TB pe obiect — ci una de politica, si a fost
 * ridicata de la 500 MB pentru ca filmarile reale de santier ajung la ~2 GB.
 * Dublul nevoii curente exista ca sa nu cada tocmai filmarea lunga, adica exact
 * aia pentru care cineva s-a urcat pe schela.
 */
export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

/**
 * Marimea unei parti de upload.
 *
 * 8 MB e compromisul dintre doua neplaceri de santier: parti mari inseamna ca un
 * retry arunca mai mult efort, iar parti mici inseamna prea multe URL-uri
 * presemnate si prea multe dus-intors. R2 cere minimum 5 MB pe toate partile in
 * afara de ultima.
 */
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;

/**
 * Marimea partii pentru un fisier anume.
 *
 * Partea creste cu fisierul dintr-un motiv practic: la 8 MB fix, un video de
 * 4 GB ar cere 512 de URL-uri presemnate intr-un singur raspuns — sute de
 * kiloocteti de JSON pentru un singur upload. Peste 1 GB partea se dubleaza, si
 * numarul de parti ramane intre 64 si 128 indiferent de marime.
 *
 * Ce se pierde: un retry arunca 32 MB in loc de 8 MB. Se pierde insa doar la
 * fisierele mari, unde oricum se trimit sute de megaocteti.
 */
export function uploadPartBytes(size: number): number {
  if (size <= 1024 * 1024 * 1024) {
    return UPLOAD_PART_BYTES;
  }
  if (size <= 2 * 1024 * 1024 * 1024) {
    return 2 * UPLOAD_PART_BYTES;
  }
  return 4 * UPLOAD_PART_BYTES;
}

/** Cate parti poate avea un upload. R2 permite 10.000; noi nu avem de ce. */
export const MAX_UPLOAD_PARTS = Math.ceil(MAX_VIDEO_BYTES / uploadPartBytes(MAX_VIDEO_BYTES)) + 1;

/**
 * Cat traiesc URL-urile presemnate ale unui upload.
 *
 * 15 minute ajung pentru un document, dar un video de 2 GB pe o conexiune de
 * santier de 10 Mbps dureaza ~27 de minute: cu TTL fix, URL-urile ar expira
 * exact la jumatatea uploadului care conteaza cel mai mult. Formula presupune
 * un minim de 200 KB/s sustinut si taie la 12 ore — sub timpul dupa care
 * `files.cleanup` considera uploadul abandonat (24 h), ca sa nu existe fereastra
 * in care URL-ul mai merge dar randul din baza a plecat.
 */
export function uploadTtlSeconds(size: number): number {
  const needed = Math.ceil(size / (200 * 1024));
  return Math.min(Math.max(needed, 15 * 60), 12 * 60 * 60);
}

/**
 * Peste atat, browserul NU mai calculeaza suma de control.
 *
 * `crypto.subtle` nu are hashing pe flux, deci suma se poate calcula doar citind
 * tot fisierul in memorie — si serverul, ca s-o verifice, ar trebui sa descarce
 * inapoi din R2 tot ce tocmai s-a urcat. La documente si poze e ieftin si merita;
 * la un video de 2 GB ar fi 4 GB de trafic in plus pentru un fisier pe care
 * `complete` il verifica oricum pe marimea reala si pe magic bytes.
 */
export const CHECKSUM_MAX_BYTES = 32 * 1024 * 1024;

export const presignUploadInputSchema = z.object({
  /** Folderul in care aterizeaza fisierul. */
  parentId: uuidSchema,
  filename: nodeNameSchema,
  size: z
    .number()
    .int()
    .positive('Fișierul e gol.')
    .max(MAX_VIDEO_BYTES, 'Fișierul depășește limita maximă de 4 GB.'),
  /** Ce zice browserul. Se pastreaza ca indiciu, dar NU se are incredere in el. */
  declaredMime: trimmed(255).optional(),
  /** sha256 in hex, calculat in browser. Verificat la `complete`. */
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, 'Suma de control trebuie să fie sha256 în hexazecimal.')
    .optional(),
  /*
   * Coordonatele din `navigator.geolocation`, cand aplicatia le are. Se salveaza
   * SEPARAT de cele din EXIF, cu `geo_source = 'device'`: la 700 de obiective,
   * dovada ca inspectia s-a facut acolo trebuie sa spuna si de unde stie.
   */
  deviceLat: z.number().min(-90).max(90).optional(),
  deviceLng: z.number().min(-180).max(180).optional(),
  deviceAccuracy: z.number().nonnegative().optional(),
});

export type PresignUploadInput = z.infer<typeof presignUploadInputSchema>;

export const completeUploadInputSchema = z.object({
  versionId: uuidSchema,
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(MAX_UPLOAD_PARTS),
        etag: requiredText(128),
      }),
    )
    .min(1, 'Uploadul nu are nicio parte.')
    .max(MAX_UPLOAD_PARTS),
});

export type CompleteUploadInput = z.infer<typeof completeUploadInputSchema>;

export const createFolderInputSchema = z.object({
  parentId: uuidSchema,
  name: nodeNameSchema,
});

export const renameNodeInputSchema = z.object({
  nodeId: uuidSchema,
  name: nodeNameSchema,
});

export const moveNodeInputSchema = z.object({
  nodeId: uuidSchema,
  parentId: uuidSchema,
});

export const SHARE_PERMISSIONS = ['read', 'write', 'manage'] as const;

export const SHARE_PERMISSION_LABELS: Readonly<Record<(typeof SHARE_PERMISSIONS)[number], string>> =
  {
    read: 'Citire',
    write: 'Citire și încărcare',
    manage: 'Administrare',
  };

export const shareNodeInputSchema = z.object({
  nodeId: uuidSchema,
  subjectType: z.enum(['person', 'subcontractor']),
  subjectId: uuidSchema,
  permission: z.enum(SHARE_PERMISSIONS).default('read'),
});

export type ShareNodeInput = z.infer<typeof shareNodeInputSchema>;

/** Variantele de miniatura produse de worker, in pixeli pe latura mare. */
export const THUMBNAIL_WIDTHS = [160, 480, 1200] as const;

export const thumbnailVariant = (width: number): string => `thumb${String(width)}`;
