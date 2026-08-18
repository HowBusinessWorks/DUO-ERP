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
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
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

/** Cate parti poate avea un upload. R2 permite 10.000; noi nu avem de ce. */
export const MAX_UPLOAD_PARTS = Math.ceil(MAX_VIDEO_BYTES / UPLOAD_PART_BYTES) + 1;

export const presignUploadInputSchema = z.object({
  /** Folderul in care aterizeaza fisierul. */
  parentId: uuidSchema,
  filename: nodeNameSchema,
  size: z
    .number()
    .int()
    .positive('Fișierul e gol.')
    .max(MAX_VIDEO_BYTES, 'Fișierul depășește limita maximă de 500 MB.'),
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

export const SHARE_PERMISSION_LABELS: Readonly<
  Record<(typeof SHARE_PERMISSIONS)[number], string>
> = {
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
