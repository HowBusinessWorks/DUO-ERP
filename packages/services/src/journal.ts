import type { AppendJournalEntryInput } from '@damina/contracts';
import { appendJournalEntryInputSchema } from '@damina/contracts';
import { schema, withActor, type Actor } from '@damina/db';
import { uuidv7 } from '@damina/shared';
import { translateDbError } from './db-errors';

/**
 * Jurnalul de santier (pasul 10, §3.5).
 *
 * **Se adauga, nu se rescrie.** Spre deosebire de `saveInspection` si
 * `saveIntervention`, care REScriu tot setul de linii, aici fiecare trimitere
 * produce o intrare noua. De aceea ecranul de teren nu are nevoie sa porneasca
 * de la felie: nu poate sterge munca nimanui, fiindca nu sterge nimic — capcana
 * care a costat doua migrari la 10c-2 nu se aplica aici.
 *
 * Idempotenta la retrimitere o da `app.applied_mutations`, ca la orice mutatie:
 * acelasi `id` de client aplicat de doua ori intoarce rezultatul memorat, fara
 * sa reexecute. Fara ea, o retrimitere dupa o cadere de retea ar fi produs a
 * doua consemnare identica, iar jurnalul ar fi devenit greu de citit exact in
 * zilele cu semnal prost — adica in cele care conteaza.
 *
 * **Cine consemneaza vine din actor**, nu din payload: pe teren, omul din
 * sesiune E omul care scrie, iar un `personId` de pe sarma ar fi insemnat ca se
 * poate consemna in numele altuia.
 */
export async function appendJournalEntry(
  actor: Actor,
  input: AppendJournalEntryInput,
): Promise<{ readonly id: string }> {
  const values = appendJournalEntryInputSchema.parse(input);
  const id = uuidv7();

  try {
    await withActor(actor, async (tx) => {
      await tx.insert(schema.journalEntries).values({
        id,
        workUnitId: values.workUnitId,
        stageId: values.stageId,
        personId: actor.personId,
        entryDate: values.entryDate,
        text: values.text,
      });
    });
  } catch (error) {
    return translateDbError(error);
  }

  return { id };
}
