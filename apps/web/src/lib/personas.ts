import type { Persona } from '@damina/shared';

/**
 * Harta rute ↔ persone (§3.7).
 *
 * Regula pasului: **nu exista o ruta care sa serveasca doua persone.** Un om de
 * teren care nimereste pe `/contracte/...` primeste redirect catre spatiul lui,
 * nu 403 cu jumatate de continut — un 403 pe o ruta de birou tot ii confirma ca
 * ruta exista si ce e pe ea.
 *
 * Fisierul nu importa nimic din framework si nimic din `@damina/db`, ca sa poata
 * fi folosit si din middleware (care ruleaza pe Edge), si din layout-uri.
 * Verificarea se face in amandoua, dinadins: middleware-ul e ieftin si prinde
 * totul devreme, layout-ul e ultima poarta inainte de randare si nu poate fi
 * ocolit de o ruta uitata din matcher.
 */

export const LOGIN_PATH = '/login';
export const CHANGE_PASSWORD_PATH = '/parola-noua';
export const RESET_PATH = '/resetare';
/** Configurarea si dovedirea celui de-al doilea factor (§3.5, verificarea #16). */
export const MFA_PATH = '/doi-pasi';

/**
 * Ecranele care apartin autentificarii, nu unui spatiu de lucru.
 *
 * Cer sesiune — deci nu sunt publice — dar nu se supun rutarii pe persone: un om
 * de teren trimis la schimbarea parolei n-are ce cauta pe `/field` pana n-o
 * schimba. Sunt singurele rute din aplicatie care servesc toate cele patru
 * persone, si de aia sunt enumerate aici, o singura data.
 */
export const GATE_PATHS: readonly string[] = [CHANGE_PASSWORD_PATH, MFA_PATH];

export function isGatePath(pathname: string): boolean {
  return GATE_PATHS.includes(pathname);
}

/**
 * E o ruta de program, nu de om?
 *
 * Conteaza pentru ca porțile se aplica diferit: pe un ecran, refuzul e un
 * redirect; pentru un `fetch`, un redirect e mai rau decat un refuz — clientul
 * il urmeaza, primeste HTML cu status 200 si incearca sa-l citeasca drept JSON.
 * Rutele `/api` isi cer singure drepturile si raspund cu cod si mesaj.
 */
export function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

/** Rutele care nu cer sesiune. Tot ce nu e aici o cere. */
const PUBLIC_PREFIXES = [
  LOGIN_PATH,
  RESET_PATH,
  // Linkurile din emailurile Auth aterizeaza aici si schimba codul pe sesiune.
  '/auth/',
  // Deocamdata doar `/api/health`, chemat de monitorizare fara cont.
  '/api/',
] as const;

/** Unde aterizeaza fiecare persona dupa login. */
const HOME: Readonly<Record<Persona, string>> = {
  office: '/panou',
  field: '/field',
  subcontractor: '/portal/subcontractor',
  client: '/portal/client',
};

/** Prefixele care apartin EXCLUSIV unei persone. Restul sunt ale biroului. */
const OWNED: Readonly<Record<Persona, readonly string[]>> = {
  office: [],
  field: ['/field'],
  subcontractor: ['/portal/subcontractor'],
  client: ['/portal/client'],
};

export function homeFor(persona: Persona): string {
  return HOME[persona];
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function startsWithSegment(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Are voie persona asta pe ruta asta?
 *
 * Biroul primeste tot ce nu e revendicat de altcineva — modulele lui se adauga
 * in fiecare pas, iar o lista albă de prefixe de birou ar fi trebuit
 * actualizata la fiecare, si ar fi fost uitata exact cand conteaza. Spatiile
 * inguste sunt cele enumerate.
 */
export function canEnter(persona: Persona, pathname: string): boolean {
  const foreign = (Object.keys(OWNED) as Persona[])
    .filter((other) => other !== persona)
    .flatMap((other) => OWNED[other]);

  if (foreign.some((prefix) => startsWithSegment(pathname, prefix))) {
    return false;
  }

  const own = OWNED[persona];
  return own.length === 0 || own.some((prefix) => startsWithSegment(pathname, prefix));
}
