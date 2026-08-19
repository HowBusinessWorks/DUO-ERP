import { z } from 'zod';
import { businessDateSchema, uuidSchema } from './primitives';

/**
 * Jurnalul de santier (pasul 10, §3.5).
 *
 * Trei lucruri lipsesc dinadins din schema, si toate trei ar fi costat cate un
 * tap pe un ecran care are voie la unul singur (§0):
 *
 *  - **cine consemneaza** — se ia din sesiune, nu de pe ecran. Un `personId`
 *    trimis de client ar fi insemnat ca omul poate scrie in jurnal in numele
 *    altuia, si tocmai asta e ce trebuie sa nu se poata;
 *  - **titlu, categorie, ora** — jurnalul e text liber, exact cum se scrie pe
 *    santier. Structura care nu se citeste niciodata inapoi e doar frecare;
 *  - **poza** — pleaca prin coada `media`, in folderul unitatii, ca peste tot.
 */
export const appendJournalEntryInputSchema = z.object({
  workUnitId: uuidSchema,
  /** Etapa, cand lucrarea are etape. Sirul gol = fara etapa. */
  stageId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
  /** Data consemnarii pe hartie. Separata de momentul in care ajunge la server. */
  entryDate: businessDateSchema,
  text: z.string().trim().min(1, 'Scrie ce s-a întâmplat.').max(4000),
});

export type AppendJournalEntryInput = z.input<typeof appendJournalEntryInputSchema>;
