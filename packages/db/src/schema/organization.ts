import { uuidv7 } from '@damina/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from './citext';
import { app, officeRoleEnum, personCategoryEnum, personaEnum } from './enums';
import { companies } from './companies';

/** Coloane pe care le poarta orice tabela de nomenclator. */
const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Clientii. Un client poate fi o firma din grup (`is_intercompany`) — atunci
 * factura interna are contrapartida in aceeasi baza.
 */
export const clients = app.table(
  'clients',
  {
    id: id(),
    name: text('name').notNull(),
    cui: text('cui'),
    address: jsonb('address'),
    paymentTermDays: smallint('payment_term_days').notNull().default(70),
    // Sablonul de raport lunar per client. Tabela vine in pasul 10.
    reportTemplateId: uuid('report_template_id'),
    isIntercompany: boolean('is_intercompany').notNull().default(false),
    intercompanyCompanyId: uuid('intercompany_company_id').references(() => companies.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    // Daca e client intern, trebuie sa stim CARE firma din grup e. Si invers:
    // un client extern nu are ce cauta cu o firma din grup atasata.
    check(
      'clients_intercompany_consistent',
      sql`(${t.isIntercompany}) = (${t.intercompanyCompanyId} is not null)`,
    ),
  ],
);

export const subcontractors = app.table('subcontractors', {
  id: id(),
  name: text('name').notNull(),
  cui: text('cui'),
  address: jsonb('address'),
  specialties: text('specialties').array(),
  /** Garantia de buna executie retinuta din fiecare situatie de lucrari. */
  warrantyRetentionPct: numeric('warranty_retention_pct', { precision: 6, scale: 4 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const suppliers = app.table('suppliers', {
  id: id(),
  name: text('name').notNull(),
  cui: text('cui'),
  address: jsonb('address'),
  defaultLeadTimeDays: smallint('default_lead_time_days'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

/** Calificari: instalator, electrician, zidar. Comune celor 5 firme. */
export const qualifications = app.table('qualifications', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

/**
 * Tarifele orare, ISTORICIZATE — salariile cresc pe durata unui contract de 4
 * ani, iar un pontaj din martie trebuie sa ramana evaluat la tariful din
 * martie. Nu se face niciodata UPDATE; se inchide intervalul si se adauga rand.
 *
 * Constrangerea `exclude` care interzice intervalele suprapuse pe aceeasi
 * calificare se adauga manual in migrare: drizzle nu o poate exprima.
 */
export const rateCards = app.table(
  'rate_cards',
  {
    id: id(),
    qualificationId: uuid('qualification_id')
      .notNull()
      .references(() => qualifications.id),
    validFrom: date('valid_from').notNull(),
    /** `null` = tariful curent, fara data de sfarsit. */
    validTo: date('valid_to'),
    hourlySalary: numeric('hourly_salary', { precision: 14, scale: 2 }).notNull(),
    /** Fractie, nu multiplicator: 0.4500 inseamna 45% taxe peste salariu. */
    taxCoefficient: numeric('tax_coefficient', { precision: 6, scale: 4 }).notNull(),
    unproductivityCoefficient: numeric('unproductivity_coefficient', {
      precision: 6,
      scale: 4,
    }).notNull(),
    /**
     * Costul real al orei. Taxele se aplica pe salariu, iar neproductivitatea
     * peste costul deja incarcat — ora nelucrata costa cat una completa.
     */
    hourlyCost: numeric('hourly_cost', { precision: 14, scale: 2 }).generatedAlwaysAs(
      sql`round(hourly_salary * (1 + tax_coefficient) * (1 + unproductivity_coefficient), 2)`,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    check('rate_cards_valid_range', sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
    check('rate_cards_salary_positive', sql`${t.hourlySalary} > 0`),
  ],
);

/**
 * Identitatea de business. `auth_user_id` leaga 1:1 de `auth.users` din
 * Supabase si e null pana la provizionarea contului (PLAN_TEHNIC 8.3) — o
 * persoana exista in nomenclator inainte sa aiba cu ce sa se logheze.
 */
export const persons = app.table(
  'persons',
  {
    id: id(),
    authUserId: uuid('auth_user_id').unique(),
    persona: personaEnum('persona').notNull(),
    category: personCategoryEnum('category').notNull(),
    fullName: text('full_name').notNull(),
    email: citext('email').unique(),
    phone: text('phone'),
    qualificationId: uuid('qualification_id').references(() => qualifications.id),
    subcontractorId: uuid('subcontractor_id').references(() => subcontractors.id),
    clientId: uuid('client_id').references(() => clients.id),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    // Egalitate, nu implicatie: persona 'subcontractor' CERE firma, iar orice
    // alta persona o INTERZICE. Asta face imposibil un utilizator de birou
    // legat din greseala de un subcontractant, care ar trece prin RLS.
    check(
      'persons_subcontractor_consistent',
      sql`(${t.persona} = 'subcontractor') = (${t.subcontractorId} is not null)`,
    ),
    check(
      'persons_client_consistent',
      sql`(${t.persona} = 'client') = (${t.clientId} is not null)`,
    ),
  ],
);

/** La ce firme din grup are acces o persoana. Sursa pentru `company_ids` din JWT. */
export const personCompanyAccess = app.table(
  'person_company_access',
  {
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.personId, t.companyId] })],
);

/** Rolurile de birou. Nu schimba aplicatia, doar ce e vizibil si activ in ea. */
export const personOfficeRoles = app.table(
  'person_office_roles',
  {
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    role: officeRoleEnum('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.role] })],
);

/** Echipa, nu omul: gestiunea de materiale se tine per echipa. */
export const teams = app.table('teams', {
  id: id(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  name: text('name').notNull(),
  leadPersonId: uuid('lead_person_id').references(() => persons.id),
  // Gestiunea echipei. `app.locations` vine in pasul 06; cheia straina se
  // adauga acolo, ca sa nu blocam pasul asta pe o tabela care nu exista.
  locationId: uuid('location_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

/** Apartenenta la echipa e istoricizata — oamenii se muta intre echipe. */
export const teamMembers = app.table(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.personId, t.validFrom] }),
    check('team_members_valid_range', sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`),
  ],
);

/**
 * SSM: instructaje, permise de lucru, autorizatii ISCIR. O autorizatie expirata
 * BLOCHEAZA asignarea persoanei pe o lucrare — nu avertizeaza. Trigger-ul care
 * impune asta se creeaza aici si se ataseaza in pasul 05, pe
 * `work_unit_assignments`.
 */
export const personAuthorizations = app.table(
  'person_authorizations',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    issuedAt: date('issued_at').notNull(),
    expiresAt: date('expires_at'),
    // Documentul scanat. `app.nodes` vine in pasul 07.
    documentNodeId: uuid('document_node_id'),
    createdAt: createdAt(),
  },
  (t) => [
    // Intrebarea pusa la fiecare asignare: "ce autorizatii are omul asta si
    // pana cand". Indexul e exact pe ea.
    index('person_authorizations_person_expires_idx').on(t.personId, t.expiresAt),
    check(
      'person_authorizations_valid_range',
      sql`${t.expiresAt} is null or ${t.expiresAt} >= ${t.issuedAt}`,
    ),
  ],
);

export type Client = typeof clients.$inferSelect;
export type Subcontractor = typeof subcontractors.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type Qualification = typeof qualifications.$inferSelect;
export type RateCard = typeof rateCards.$inferSelect;
export type Person = typeof persons.$inferSelect;
export type NewPerson = typeof persons.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type PersonAuthorization = typeof personAuthorizations.$inferSelect;
