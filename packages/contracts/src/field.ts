import { z } from 'zod';
import { createRequestInputSchema } from './requests';
import {
  saveInspectionInputSchema,
  saveInterventionInputSchema,
  saveTimesheetInputSchema,
} from './sheets';
import { uuidSchema } from './primitives';

/**
 * Sincronizarea aplicatiei de teren (pasul 10, §3.2).
 *
 * **Payload-ul unei mutatii e validat cu ACEEASI schema Zod ca use-case-ul.**
 * Nu una paralela, „pentru sync": o a doua schema ar fi inceput identica si ar
 * fi ramas in urma la prima regula noua, iar diferenta s-ar fi vazut abia pe
 * telefonul cuiva, in subsol, cu reteaua cazuta.
 *
 * De aceea harta de mai jos leaga fiecare tip de mutatie de schema lui reala.
 * Ca sa adaugi un tip nou: pui perechea aici, apoi executantul in
 * `packages/services/src/field-sync.ts`. Nu exista al treilea loc.
 */

/**
 * Tipurile pe care le poate trimite terenul.
 *
 * Fiecare are un use-case in spate SI un ecran care il produce. Regula are doua
 * jumatati, si a doua a fost invatata scump:
 *
 *  - un tip **fara executant** ar accepta mutatii pe care nu le poate aplica
 *    nimeni, iar telefonul ar crede ca a trimis;
 *  - un tip **pe care rolul de teren nu-l poate rula** e la fel de rau. Asa a
 *    stat `consumption.save` de la 10a pana la 10c-3: exista, avea executant,
 *    era testat — dar toate testele lui rulau cu actor de birou, iar din rolul
 *    `app_field` ar fi cazut cu 42501 la prima trimitere reala.
 *
 * `consumption.save` a fost SCOS, si nu din lipsa unui grant: emiterea bonului
 * citeste CMP-ul gestiunii si scrie in registrul de cost, adica exact ce
 * interzice regula „zero lei pe teren". Consumul pleaca de pe teren prin fisa de
 * interventie, iar biroul il materializeaza la validare — drum care exista si e
 * testat. Decizia utilizatorului, 19 august.
 *
 * `journal.append`, `sl.verify-line`, `equipment.request` si
 * `equipment.observation` apar in §3.5 ca ecrane, dar tabelele lor vin cu
 * fazele 2 si 4.
 */
export const MUTATION_TYPES = [
  'inspection.save',
  'intervention.save',
  'timesheet.save',
  'material.request',
] as const;

export type MutationType = (typeof MUTATION_TYPES)[number];

/** Schema de payload a fiecarui tip. Aceeasi pe care o parseaza serviciul. */
export const MUTATION_PAYLOAD_SCHEMAS = {
  'inspection.save': saveInspectionInputSchema,
  'intervention.save': saveInterventionInputSchema,
  'timesheet.save': saveTimesheetInputSchema,
  'material.request': createRequestInputSchema,
} as const satisfies Record<MutationType, z.ZodTypeAny>;

/**
 * O mutatie, asa cum pleaca de pe telefon.
 *
 * `payload` ramane `unknown` aici dinadins: se valideaza in serviciu, cu schema
 * tipului, si abia acolo. Daca ar fi fost un `discriminatedUnion` complet,
 * o mutatie cu payload invalid ar fi facut sa cada **tot lotul** la parsare —
 * adica o fisa scrisa gresit ar fi blocat si pozele, si pontajul, si tot ce
 * mai astepta in coada, fara sa spuna care.
 */
export const mutationSchema = z.object({
  /** UUID v7 generat pe CLIENT. Cheia de idempotenta. Nu se remapeaza. */
  id: uuidSchema,
  type: z.enum(MUTATION_TYPES),
  payload: z.unknown(),
  /** Versiunea pe care a vazut-o clientul, pentru detectia de conflict. */
  baseVersion: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export type FieldMutation = z.infer<typeof mutationSchema>;

/**
 * Cate mutatii intr-un lot.
 *
 * Nu e o limita de performanta, e una de RASPUNS: lotul se aplica secvential,
 * iar un telefon care a stat o saptamana offline trebuie sa primeasca un
 * raspuns inainte sa expire cererea. Restul cozii pleaca in lotul urmator —
 * ordinea se pastreaza oricum.
 */
export const MAX_MUTATIONS_PER_PUSH = 100;

/**
 * Lotul de push.
 *
 * `deviceId` nu e optional: **ordinea cozii e per dispozitiv**, iar doua
 * telefoane ale aceluiasi om au cozi independente. Fara el, mutatiile celui
 * lasat in masina s-ar amesteca in ordinea celui din mana.
 */
export const pushMutationsInputSchema = z.object({
  deviceId: z.string().trim().min(1, 'Dispozitivul trebuie identificat.').max(120),
  /** Ordonate crescator dupa `createdAt`. Se aplica secvential, in ordine. */
  mutations: z.array(mutationSchema).min(1).max(MAX_MUTATIONS_PER_PUSH),
});

export type PushMutationsInput = z.input<typeof pushMutationsInputSchema>;

/** Rezultatul unei mutatii, asa cum il vede telefonul. */
export const mutationOutcomeSchema = z.object({
  id: uuidSchema,
  status: z.enum(['applied', 'duplicate', 'failed', 'skipped']),
  result: z.unknown().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});

export type MutationOutcome = z.infer<typeof mutationOutcomeSchema>;

/** Ce cere telefonul la pull. Cursorul e opac — forma lui e treaba serverului. */
export const pullSyncInputSchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  since: z.string().trim().max(120).optional(),
});

export type PullSyncInput = z.input<typeof pullSyncInputSchema>;
