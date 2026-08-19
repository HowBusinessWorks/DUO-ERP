import { roRO, type Dictionary } from './ro-RO';

export type { Dictionary } from './ro-RO';
export { roRO } from './ro-RO';

export const DEFAULT_LOCALE = 'ro-RO' as const;

export type Locale = typeof DEFAULT_LOCALE;

const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { 'ro-RO': roRO };

export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale];
}

/**
 * Toate caile de frunza din dictionar, ca uniune de siruri: `'common.save'`,
 * `'produse.fields.code'`, …
 *
 * De ce merita tipul asta: `t('produse.fiels.code')` nu compileaza. O cheie
 * lipsa devine eroare de build, nu un `undefined` afisat unui om in productie.
 * E acelasi lucru pe care il face un test de chei lipsa, dar la fiecare tastare.
 */
export type TranslationKey = LeafPaths<Dictionary>;

type LeafPaths<T> = T extends string
  ? never
  : {
      [K in keyof T & (string | number)]: T[K] extends string ? `${K}` : `${K}.${LeafPaths<T[K]>}`;
    }[keyof T & (string | number)];

/** Valorile care se interpoleaza in `{nume}`. */
export type TranslationParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Rezolva o cheie si interpoleaza parametrii.
 *
 * Nu arunca niciodata: daca o cheie lipseste in ciuda tipurilor (dictionar
 * incarcat dinamic, cod compilat cu `any` undeva), intoarce cheia insasi. Un
 * ecran cu "produse.fields.code" scris pe el e urat, dar reparabil; un ecran
 * care crapa la randare nu e.
 */
export function translate(
  dictionary: Dictionary,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const raw = resolve(dictionary, key);
  if (raw === undefined) {
    return key;
  }
  if (params === undefined) {
    return raw;
  }
  return raw.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function resolve(dictionary: Dictionary, key: string): string | undefined {
  let current: unknown = dictionary;
  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

export type Translator = (key: TranslationKey, params?: TranslationParams) => string;

/** Traducatorul legat de un dictionar. Asta se plimba prin componente. */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
  const dictionary = getDictionary(locale);
  return (key, params) => translate(dictionary, key, params);
}

/**
 * Traducatorul implicit.
 *
 * Aplicatia e monolingva azi (ro-RO) si nu are motiv sa nu fie. Importul direct
 * al lui `t` tine componentele curate, iar cand apare a doua limba se schimba
 * doar ce livreaza `t` — semnatura ramane.
 */
export const t: Translator = createTranslator();

/** Numele lunii, cu majuscula: „August”. Folosit de selectorul de perioadă. */
export function monthName(month: number, short = false): string {
  const key = (short ? 'period.monthsShort.' : 'period.months.') + String(month);
  const value = translate(roRO, key as TranslationKey);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** „Aug 2026” — eticheta scurtă din bara de sus. */
export function formatPeriodShort(year: number, month: number): string {
  return `${monthName(month, true)} ${String(year)}`;
}

/** „august 2026” — în propoziții. */
export function formatPeriodLong(year: number, month: number): string {
  return `${translate(roRO, ('period.months.' + String(month)) as TranslationKey)} ${String(year)}`;
}
