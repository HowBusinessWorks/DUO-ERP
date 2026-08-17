import { z } from 'zod';
import { officeRoleSchema, personaSchema, uuidSchema } from './primitives';

/**
 * Schemele ecranului de administrare (pasul 02d).
 *
 * Persoana e identitatea de business; contul GoTrue e altceva si se
 * provizioneaza separat. Formularul de aici NU atinge parola si nu cunoaste
 * `auth_user_id` — legatura o face ruta `/api/admin/provision`, singurul loc din
 * `apps/web` care are voie sa vada cheia de service.
 */

const trimmed = (max: number): z.ZodString => z.string().trim().max(max);

const requiredText = (max: number, message = 'Câmpul e obligatoriu.'): z.ZodString =>
  trimmed(max).min(1, message);

export const PERSON_CATEGORIES = [
  'angajat',
  'sef_santier',
  'subcontractant',
  'client_user',
] as const;

export const personCategorySchema = z.enum(PERSON_CATEGORIES);

export type PersonCategory = z.infer<typeof personCategorySchema>;

export const PERSONA_LABELS: Readonly<Record<z.infer<typeof personaSchema>, string>> = {
  office: 'Birou',
  field: 'Teren',
  subcontractor: 'Subcontractant',
  client: 'Client',
};

export const PERSON_CATEGORY_LABELS: Readonly<Record<PersonCategory, string>> = {
  angajat: 'Angajat de birou',
  sef_santier: 'Șef de șantier',
  subcontractant: 'Om al subcontractantului',
  client_user: 'Om al clientului',
};

export const OFFICE_ROLE_LABELS: Readonly<Record<z.infer<typeof officeRoleSchema>, string>> = {
  pm: 'Project manager',
  devizist: 'Devizist',
  achizitii: 'Achiziții',
  magazie: 'Magazie',
  flota: 'Flotă',
  financiar: 'Financiar',
  admin: 'Administrator',
};

/**
 * Emailul e OPTIONAL in baza (o persoana poate exista in nomenclator fara sa
 * aiba cont), dar devine obligatoriu la provizionare — verificarea sta acolo,
 * nu aici, ca sa se poata introduce un om inainte sa i se stie adresa.
 */
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email('Scrie o adresă de email validă.')
  .or(z.literal(''))
  .transform((value) => (value === '' ? null : value));

export const personInputSchema = z
  .object({
    fullName: requiredText(200, 'Numele e obligatoriu.'),
    email: optionalEmail,
    phone: trimmed(40).transform((v) => (v === '' ? null : v)),
    persona: personaSchema,
    category: personCategorySchema,
    qualificationId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
    subcontractorId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
    clientId: uuidSchema.or(z.literal('')).transform((v) => (v === '' ? null : v)),
    isActive: z.boolean(),
  })
  // Aceleasi doua `check`-uri ca in baza (`persons_subcontractor_consistent`,
  // `persons_client_consistent`), verificate aici doar ca sa iasa mesaj in
  // romana sub camp in loc de un 23514 din Postgres. Adevarul ramane in baza.
  .refine((v) => (v.persona === 'subcontractor') === (v.subcontractorId !== null), {
    message: 'Persona „Subcontractant” cere o firmă subcontractantă, iar celelalte o interzic.',
    path: ['subcontractorId'],
  })
  .refine((v) => (v.persona === 'client') === (v.clientId !== null), {
    message: 'Persona „Client” cere un client, iar celelalte îl interzic.',
    path: ['clientId'],
  });

export type PersonInput = z.output<typeof personInputSchema>;

/** Rolurile de birou ale unei persoane, ca set complet — nu adaugare/stergere. */
export const officeRolesInputSchema = z.object({
  personId: uuidSchema,
  roles: z.array(officeRoleSchema),
});

/** Firmele la care are acces, tot ca set complet. Sursa pentru `company_ids` din JWT. */
export const companyAccessInputSchema = z.object({
  personId: uuidSchema,
  companyIds: z.array(uuidSchema),
});

/**
 * Provizionarea contului. Un singur camp: restul se citeste din persoana.
 *
 * Parola NU e in schema, nici la intrare, nici la iesire — se genereaza pe
 * server si se intoarce o singura data, in raspunsul apelului care a creat
 * contul. Nu se scrie nicaieri si nu se mai poate cere a doua oara.
 */
export const provisionAccountInputSchema = z.object({
  personId: uuidSchema,
});

export type OfficeRolesInput = z.output<typeof officeRolesInputSchema>;
export type CompanyAccessInput = z.output<typeof companyAccessInputSchema>;
export type ProvisionAccountInput = z.output<typeof provisionAccountInputSchema>;
