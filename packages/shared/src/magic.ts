/**
 * Ce fel de fisier e, dupa continut — nu dupa extensie si nu dupa ce declara
 * browserul (regula 5 din pasul 07).
 *
 * De ce conteaza: `Content-Type` din request e text scris de client. Un HTML
 * urcat ca `aviz.pdf`, servit inapoi cu tipul declarat, ruleaza JavaScript pe
 * domeniul aplicatiei — cu sesiunea utilizatorului in el. Singura aparare care
 * nu depinde de bunavointa clientului e sa ne uitam la primii octeti.
 *
 * Scris de mana, fara dependenta, pentru ca lista de formate pe care le acceptam
 * e scurta si inchisa: poze, video, PDF si documentele Office. Orice altceva e
 * respins la `complete`, deci un format necunoscut nu ajunge niciodata sa fie
 * servit inapoi.
 */

/** Cat citim din fisier ca sa-l recunoastem. Mai mult n-are rost. */
export const MAGIC_BYTES_NEEDED = 64;

interface Signature {
  readonly mime: string;
  readonly offset: number;
  readonly bytes: readonly number[];
  /** Verificare suplimentara pentru containerele care impart acelasi antet. */
  readonly extra?: (head: Uint8Array) => boolean;
}

const ASCII = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

const SIGNATURES: readonly Signature[] = [
  { mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', offset: 0, bytes: ASCII('GIF8') },
  { mime: 'application/pdf', offset: 0, bytes: ASCII('%PDF-') },
  {
    // RIFF....WEBP — antetul RIFF e comun cu WAV si AVI, de aici verificarea.
    mime: 'image/webp',
    offset: 0,
    bytes: ASCII('RIFF'),
    extra: (head) => matches(head, 8, ASCII('WEBP')),
  },
  {
    // ftyp la offset 4; sub-tipul spune daca e poza (HEIC) sau video (MP4).
    mime: 'image/heic',
    offset: 4,
    bytes: ASCII('ftyp'),
    extra: (head) =>
      ['heic', 'heix', 'hevc', 'mif1', 'heim'].some((brand) => matches(head, 8, ASCII(brand))),
  },
  { mime: 'video/mp4', offset: 4, bytes: ASCII('ftyp') },
  { mime: 'video/quicktime', offset: 4, bytes: ASCII('moov') },
  { mime: 'video/x-matroska', offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  /*
   * Documentele Office moderne sunt arhive ZIP, deci antetul e acelasi pentru
   * .docx, .xlsx si .zip. Nu incercam sa le despartim aici — ar insemna sa
   * despachetam arhiva. Le tratam ca ZIP si lasam extensia sa decida eticheta
   * afisata; ce conteaza pentru securitate e ca NU e HTML.
   */
  { mime: 'application/zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/msword', offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0] },
];

function matches(head: Uint8Array, offset: number, bytes: readonly number[]): boolean {
  if (head.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => head[offset + index] === byte);
}

/**
 * Tipul real, sau `undefined` daca nu recunoastem antetul.
 *
 * `undefined` inseamna „respinge", nu „lasa sa treaca": lista e albă, nu neagra.
 * O lista neagra de tipuri periculoase se ocoleste cu urmatorul format inventat;
 * una alba se ocoleste doar convingandu-ne sa adaugam ceva in ea.
 */
export function sniffMime(head: Uint8Array): string | undefined {
  for (const signature of SIGNATURES) {
    if (!matches(head, signature.offset, signature.bytes)) {
      continue;
    }
    if (signature.extra !== undefined && !signature.extra(head)) {
      continue;
    }
    return signature.mime;
  }
  return undefined;
}

/** Formatele pe care worker-ul stie sa le prelucreze in miniaturi. */
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'];

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.includes(mime);
}

export function isVideoMime(mime: string): boolean {
  return mime.startsWith('video/');
}
