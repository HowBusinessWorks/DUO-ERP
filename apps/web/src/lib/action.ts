import 'server-only';

import { getDictionary, translate, type TranslationKey } from '@damina/i18n';
import { AppError } from '@damina/shared';
import { revalidateTag } from 'next/cache';
import type { z } from 'zod';
import { requireActor } from './session';

/**
 * Rezultatul unei mutatii, asa cum il primeste formularul.
 *
 * Deliberat NU o exceptie: erorile asteptate (`AppError`) sunt parte din flux,
 * nu accidente. Formularul le afiseaza langa camp sau deasupra, si ramane pe
 * ecran cu datele omului intacte.
 */
export type ActionResult<T = void> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Invelisul unic al tuturor mutatiilor (PLAN_TEHNIC §7.4):
 *
 *   Zod → actor → use-case → AppError tradus in romana → revalidateTag
 *
 * Aceeasi schema Zod valideaza si in browser (`react-hook-form`), si aici. Nu
 * sunt doua validari tinute sincron — e acelasi obiect importat de doua ori.
 * Verificarea din browser exista pentru viteza raspunsului; asta de aici e cea
 * care conteaza, pentru ca e singura pe care omul nu o poate ocoli.
 */
export function createAction<Schema extends z.ZodType, Result>(config: {
  readonly schema: Schema;
  /**
   * `input` e valoarea VALIDATA, `raw` cea primita de la formular.
   *
   * Use-case-urile din `services` isi parseaza singure intrarea, cu aceeasi
   * schema — deci lor li se da `raw`, nu `input`. Diferenta nu e stilistica:
   * schemele au transformari (`'' → null`), iar rezultatul lor nu mai trece a
   * doua oara prin ele. Un `category` lasat gol ar fi ajuns `null` aici si ar fi
   * picat la re-parsare in serviciu, cu ZodError, nu cu mesaj in romana.
   */
  readonly run: (
    actor: Awaited<ReturnType<typeof requireActor>>,
    input: z.output<Schema>,
    raw: unknown,
  ) => Promise<Result>;
  /** Ce se invalideaza dupa succes. Fiecare use-case isi declara tagurile. */
  readonly tags?: readonly string[] | ((result: Result, input: z.output<Schema>) => readonly string[]);
  /** Motivul scris, pentru operatiile ireversibile (§30.5). Ajunge in audit. */
  readonly reason?: string;
}): (raw: unknown) => Promise<ActionResult<Result>> {
  return async (raw: unknown): Promise<ActionResult<Result>> => {
    const parsed = config.schema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        ok: false,
        code: 'VALIDATION_FAILED',
        message: first?.message ?? messageFor('VALIDATION_FAILED'),
      };
    }

    try {
      const actor = await requireActor(config.reason);
      const result = await config.run(actor, parsed.data as z.output<Schema>, raw);

      const tags =
        typeof config.tags === 'function'
          ? config.tags(result, parsed.data as z.output<Schema>)
          : (config.tags ?? []);
      for (const tag of tags) {
        revalidateTag(tag);
      }

      return { ok: true, data: result };
    } catch (error) {
      if (AppError.is(error)) {
        // Mesajul specific al erorii bate traducerea generica a codului: „Există
        // deja un produs cu codul CIM-42” ajuta mai mult decat „Conflict”.
        return { ok: false, code: error.code, message: error.message || messageFor(error.code) };
      }
      throw error;
    }
  };
}

/** Codurile din `AppError` se mapeaza 1:1 pe mesaje din dictionar. */
export function messageFor(code: string): string {
  const dictionary = getDictionary();
  const key = `errors.${code}`;
  const message = translate(dictionary, key as TranslationKey);
  return message === key ? translate(dictionary, 'common.unknownError') : message;
}

/** Tagurile structurate din PLAN_TEHNIC §7.3. */
export const tags = {
  nomenclature: (module: string): string => `nomenclature:${module}`,
  entity: (module: string, id: string): string => `${module}:${id}`,
  period: (companyId: string, year: number, month: number): string =>
    `period:${companyId}:${String(year)}-${String(month).padStart(2, '0')}`,
  queue: (personId: string): string => `queue:${personId}`,
} as const;
