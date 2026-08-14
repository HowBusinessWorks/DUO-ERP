import { roRO, type Dictionary } from './ro-RO';

export type { Dictionary } from './ro-RO';
export { roRO } from './ro-RO';

export const DEFAULT_LOCALE = 'ro-RO' as const;

export type Locale = typeof DEFAULT_LOCALE;

const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { 'ro-RO': roRO };

export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale];
}
