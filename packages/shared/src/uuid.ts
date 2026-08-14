/**
 * UUID v7 — generat pe client.
 *
 * De ce nu bigserial: aplicatia de teren creeaza fise de interventie, poze si
 * linii de necesar FARA retea. Ele au nevoie de identitate inainte sa atinga
 * serverul. v7 pastreaza ordinea temporala in primii 48 de biti, deci indexul
 * B-tree nu se fragmenteaza ca la v4, iar sincronizarea nu remapeaza ID-uri.
 *
 * Layout (RFC 9562):
 *   0-5   unix_ts_ms  48 biti
 *   6     versiune (7) 4 biti + rand_a high 4 biti
 *   7     rand_a low   8 biti
 *   8     varianta (0b10) 2 biti + rand_b high 6 biti
 *   9-15  rand_b       56 biti
 */

const HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ultimul milisecund folosit si contorul din el — asigura ordonarea stricta. */
let lastTimestamp = -1;
let sequence = 0;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function uuidv7(): string {
  let timestamp = Date.now();

  if (timestamp === lastTimestamp) {
    sequence += 1;
    if (sequence > 0xfff) {
      // Am epuizat contorul de 12 biti in aceeasi milisecunda: imprumutam din
      // urmatoarea. Ceasul "sare" cu 1ms, dar ordinea ramane stricta.
      timestamp = lastTimestamp + 1;
      lastTimestamp = timestamp;
      sequence = 0;
    }
  } else {
    if (timestamp < lastTimestamp) {
      // Ceasul sistemului a dat inapoi (NTP, fus orar pe mobil). Nu regresam.
      timestamp = lastTimestamp + 1;
    }
    lastTimestamp = timestamp;
    sequence = 0;
  }

  const bytes = new Uint8Array(16);

  // 48 de biti de timestamp. Impartim in doua jumatati ca sa ramanem pe intregi sigure.
  const high = Math.floor(timestamp / 0x100000000);
  const low = timestamp >>> 0;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;

  // versiune 7 + contorul de 12 biti in rand_a
  bytes[6] = 0x70 | ((sequence >>> 8) & 0x0f);
  bytes[7] = sequence & 0xff;

  const random = randomBytes(8);
  // varianta RFC (0b10) in primii 2 biti
  bytes[8] = 0x80 | ((random[0] as number) & 0x3f);
  for (let i = 1; i < 8; i += 1) {
    bytes[8 + i] = random[i] as number;
  }

  const h = (i: number): string => HEX[bytes[i] as number] as string;
  return (
    h(0) +
    h(1) +
    h(2) +
    h(3) +
    '-' +
    h(4) +
    h(5) +
    '-' +
    h(6) +
    h(7) +
    '-' +
    h(8) +
    h(9) +
    '-' +
    h(10) +
    h(11) +
    h(12) +
    h(13) +
    h(14) +
    h(15)
  );
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Extrage momentul crearii dintr-un UUID v7. `null` daca nu e v7. */
export function timestampFromUuidv7(uuid: string): Date | null {
  if (!isUuid(uuid)) {
    return null;
  }
  const hex = uuid.replace(/-/g, '');
  if (hex[12] !== '7') {
    return null;
  }
  return new Date(Number.parseInt(hex.slice(0, 12), 16));
}
