import {
  can,
  MFA_REQUIRED_ROLES,
  OFFICE_ROLES,
  PERMISSION_MATRIX,
  rolesRequireMfa,
  type Session,
} from '@damina/auth';
import {
  OFFICE_ROLE_LABELS,
  PERSONA_LABELS,
  PERSON_CATEGORIES,
  PERSON_CATEGORY_LABELS,
} from '@damina/contracts';
import {
  getPerson,
  listClients,
  listCompanies,
  listPersons,
  listQualifications,
  listSubcontractors,
  type PersonRow,
} from '@damina/services';
import { roRO } from '@damina/i18n';
import { Badge, Banner, CellMeta, CellTitle } from '@damina/ui';
import { saveCompanyAccess } from '../app/(office)/admin-actions';
import { AccountActions } from '../components/admin/account-actions';
import { AuditFeed } from '../components/admin/audit-feed';
import { CheckboxSet } from '../components/admin/checkbox-set';
import { PermissionMatrix } from '../components/admin/permission-matrix';
import { ProvisionAccount } from '../components/admin/provision-account';
import { AuditTrail } from '../components/detail/audit-trail';
import { DefinitionList, Empty } from '../components/detail/definition-list';
import { PhasePlaceholder } from '../components/detail/phase-placeholder';
import { defineEntity, type EntityContext } from './types';

/**
 * Administrare — persoane, roluri, acces pe firme, jurnal (pasul 02d).
 *
 * Ca si contractul in 04b: o intrare in registry, zero fisiere de pagina.
 * Singura exceptie din tot pasul e ruta `/api/admin/provision` — nu pentru ca
 * registry-ul n-ar fi ajuns, ci pentru ca acolo se atinge cheia de service, si
 * regula 6 din §4 cere ca ea sa aiba un singur loc grepabil.
 *
 * Ecranul de drepturi se randeaza din `PERMISSION_MATRIX`, nu dintr-o lista
 * scrisa aici — cerinta §3.10. Consecinta e cea care conteaza: nu poate exista
 * un ecran care promite un drept pe care codul nu-l da, pentru ca ecranul si
 * codul sunt acelasi fisier citit de doua ori.
 */

const canAdminister = (session: Session): boolean => can(session, 'admin.users');

const PERSONA_TONE = {
  office: 'brand',
  field: 'success',
  subcontractor: 'warning',
  client: 'neutral',
} as const;

/**
 * Cine NU poate primi cont, si de ce.
 *
 * Trei motive distincte, cu trei rezolvari diferite — un singur „nu se poate”
 * i-ar fi trimis pe toti la aceeasi persoana degeaba. Aceeasi regula ca la cele
 * patru erori de login din 02c.
 */
function accountBlockedReason(person: PersonRow): string | undefined {
  if (person.hasAccount) {
    return 'Persoana are deja cont. Parola se schimbă prin „Am uitat parola”, nu de aici.';
  }
  if (person.email === null) {
    return 'Completează întâi adresa de email în fișa persoanei — pe ea se face login-ul.';
  }
  if (!person.isActive) {
    return 'Persoana e dezactivată. Un cont creat acum n-ar putea intra în aplicație.';
  }
  return undefined;
}

export const administrare = defineEntity<PersonRow>({
  slug: 'administrare',
  singular: 'Persoană',
  plural: 'Administrare',
  icon: 'settings',
  group: 'configuration',
  usesPeriod: false,
  canRead: canAdminister,
  readDeniedReason:
    'Administrarea utilizatorilor e rezervată rolului de administrator. Nu e o setare de ecran: politicile din baza de date refuză oricum scrierea pe persoane și pe drepturi.',
  canWrite: canAdminister,

  list: {
    load: (ctx, query) => listPersons(ctx.actor, { query: query.query, includeInactive: true }),
    rowKey: (row) => row.id,
    rowHref: (row) => `/administrare/${row.id}`,
    rowFlagged: (row) => !row.isActive,
    searchPlaceholder: 'Caută după nume sau email',
    notice:
      'Persoana e identitatea de business și există independent de contul de login. Un om intră în nomenclator înainte să aibă cu ce să se logheze.',
    empty: {
      title: 'Nicio persoană în sistem',
      body: 'Persoanele sunt cine semnează, cine pontează și cine primește cont. Fără ele, nimic din ce se întâmplă în aplicație nu are autor.',
      actionLabel: 'Adaugă prima persoană',
    },
    views: [
      { key: '', label: 'Utilizatori' },
      { key: 'drepturi', label: 'Matricea de drepturi' },
      { key: 'audit', label: 'Audit trail' },
      { key: 'firme', label: 'Firme și serii' },
      { key: 'praguri', label: 'Praguri și reguli' },
      { key: 'integrari', label: 'Integrări' },
    ],
    renderView: (_rows, view, ctx) => {
      if (view === 'drepturi') {
        return (
          <div className="space-y-4">
            <Banner
              tone="info"
              title="Tabelul ăsta e codul, nu o copie a lui"
              body="Se randează direct din matricea rol × drept din packages/auth. Nu poate arăta un drept pe care aplicația nu-l dă, și nici invers — n-ar avea de unde."
            />
            <PermissionMatrix matrix={PERMISSION_MATRIX} officeRoles={OFFICE_ROLES} />
          </div>
        );
      }
      if (view === 'audit') {
        return <AuditFeed ctx={ctx} />;
      }
      if (view === 'firme') {
        return <PhasePlaceholder phase={1} what="Firme și serii de documente" />;
      }
      if (view === 'praguri') {
        return <PhasePlaceholder phase={1} what="Praguri și reguli" />;
      }
      if (view === 'integrari') {
        return <PhasePlaceholder phase={1} what="Integrări" />;
      }
      // `null` inseamna „randeaza tabelul”, adica vederea implicita.
      return null;
    },
    columns: [
      {
        key: 'name',
        header: 'Nume',
        cell: (row) => (
          <span className="flex items-center gap-2">
            <CellTitle>{row.fullName}</CellTitle>
            {row.isActive ? null : <Badge tone="neutral">Dezactivat</Badge>}
          </span>
        ),
      },
      {
        key: 'persona',
        header: 'Spațiu',
        width: '9rem',
        cell: (row) => <Badge tone={PERSONA_TONE[row.persona]}>{PERSONA_LABELS[row.persona]}</Badge>,
      },
      {
        key: 'roles',
        header: 'Roluri de birou',
        hideBelow: 'md',
        cell: (row) =>
          row.officeRoles.length === 0 ? (
            <Empty />
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.officeRoles.map((role) => (
                <Badge key={role} tone="outline">
                  {OFFICE_ROLE_LABELS[role as keyof typeof OFFICE_ROLE_LABELS] ?? role}
                </Badge>
              ))}
            </span>
          ),
      },
      {
        key: 'companies',
        header: 'Firme',
        hideBelow: 'lg',
        cell: (row) =>
          row.companyNames.length === 0 ? <Empty /> : <CellMeta>{row.companyNames.join(', ')}</CellMeta>,
      },
      {
        key: 'account',
        header: 'Cont',
        width: '10rem',
        cell: (row) =>
          !row.hasAccount ? (
            <Badge tone="warning">Fără cont</Badge>
          ) : row.mustChangePassword ? (
            <Badge tone="brand">Parolă temporară</Badge>
          ) : (
            <Badge tone="success">Activ</Badge>
          ),
      },
    ],
  },

  detail: {
    load: async (ctx, id) => getPerson(ctx.actor, id).catch(() => null),
    header: (row) => ({
      title: row.fullName,
      breadcrumb: [
        { label: 'Configurare' },
        { label: 'Administrare', href: '/administrare' },
        { label: row.fullName },
      ],
      badges: [
        { label: PERSONA_LABELS[row.persona], tone: PERSONA_TONE[row.persona] },
        { label: PERSON_CATEGORY_LABELS[row.category], tone: 'outline' },
        ...(row.isActive ? [] : [{ label: 'Dezactivat', tone: 'warning' as const }]),
        ...(row.hasAccount ? [] : [{ label: 'Fără cont de login', tone: 'danger' as const }]),
      ],
      meta: [
        { label: 'Email', value: row.email ?? '—' },
        { label: 'Telefon', value: row.phone ?? '—' },
      ],
    }),

    tabs: [
      {
        slug: '',
        label: 'Prezentare',
        render: (row) => (
          <DefinitionList
            items={[
              { label: 'Nume complet', value: row.fullName },
              { label: 'Email', value: row.email ?? <Empty /> },
              { label: 'Telefon', value: row.phone ?? <Empty /> },
              { label: 'Spațiu de lucru', value: PERSONA_LABELS[row.persona] },
              { label: 'Categorie', value: PERSON_CATEGORY_LABELS[row.category] },
              { label: 'Calificare', value: row.qualificationName ?? <Empty /> },
              ...(row.subcontractorName === null
                ? []
                : [{ label: 'Subcontractant', value: row.subcontractorName }]),
              ...(row.clientName === null ? [] : [{ label: 'Client', value: row.clientName }]),
              { label: 'Activ', value: row.isActive ? 'Da' : 'Nu' },
            ]}
          />
        ),
      },

      {
        slug: 'roluri',
        label: 'Roluri de birou',
        count: (row) => (row.officeRoles.length === 0 ? undefined : row.officeRoles.length),
        render: (row) => (
          <div className="space-y-6">
            {row.persona === 'office' ? null : (
              <Banner
                tone="warning"
                title="Rolurile de birou n-au efect pentru spațiul ăsta"
                body="Ele decid ce vede un om al biroului. Pentru teren, subcontractanți și clienți, spațiul de lucru decide singur, iar rolurile rămân goale."
              />
            )}

            <section>
              <h2 className="mb-1 text-base font-semibold text-ink">Rolurile persoanei</h2>
              <p className="mb-3 max-w-prose text-sm text-ink-muted">
                Se propagă la următorul refresh de token, nu instantaneu: drepturile stau în JWT, iar
                el trăiește o oră.
              </p>
              <RoleEditor row={row} />
            </section>

            <section>
              <h2 className="mb-1 text-base font-semibold text-ink">
                Ce deschide și ce nu deschide combinația asta
              </h2>
              <p className="mb-3 max-w-prose text-sm text-ink-muted">
                Coloanele evidențiate sunt rolurile lui{' '}
                <span className="font-medium text-ink">{row.fullName}</span>.
              </p>
              <PermissionMatrix
                matrix={PERMISSION_MATRIX}
                officeRoles={OFFICE_ROLES}
                highlightRoles={row.officeRoles}
              />
            </section>
          </div>
        ),
      },

      {
        slug: 'firme',
        label: 'Acces pe firme',
        count: (row) => (row.companyIds.length === 0 ? undefined : row.companyIds.length),
        render: async (row, ctx) => {
          const companies = await listCompanies(ctx.actor);
          const portal = row.persona !== 'office' && row.persona !== 'field';

          return (
            <div className="space-y-4">
              {portal ? (
                <Banner
                  tone="warning"
                  title="Portalurile nu primesc acces pe firme"
                  body="Un subcontractant sau un client își vede propria fișă, nu firmele grupului. Un rând aici i-ar da un scop pe care ecranele lui nu-l așteaptă."
                />
              ) : (
                <p className="max-w-prose text-base text-ink-muted">
                  Selectorul de firmă din bara de sus nu poate ieși din lista asta, iar politicile
                  RLS filtrează pe aceleași id-uri. Fără nicio bifă, un om de birou vede tot grupul
                  doar dacă e administrator — regula există ca prima instalare să fie configurabilă.
                </p>
              )}

              <CheckboxSet
                options={companies.map((company) => ({
                  value: company.id,
                  label: company.name,
                  hint: company.cui ?? undefined,
                }))}
                selected={row.companyIds}
                target={{ kind: 'action', action: saveCompanyAccess }}
                personId={row.id}
                payloadKey="companyIds"
                saveLabel="Salvează accesul"
                emptyLabel="Nicio firmă în grup."
                blockedReason={
                  portal ? 'Persona asta nu primește acces pe firme din grup.' : undefined
                }
              />
            </div>
          );
        },
      },

      {
        slug: 'cont',
        label: 'Cont de login',
        render: (row, ctx) => (
          <div className="max-w-2xl space-y-5">
            <DefinitionList
              items={[
                {
                  label: 'Stare',
                  value: row.hasAccount ? 'Are cont de login' : 'Nu are cont încă',
                },
                { label: 'Adresa de login', value: row.email ?? <Empty /> },
                {
                  label: 'Parolă temporară',
                  value: !row.hasAccount ? (
                    <Empty />
                  ) : row.mustChangePassword ? (
                    'Da — n-a schimbat-o încă'
                  ) : (
                    'Nu — și-a pus parola lui'
                  ),
                },
                {
                  label: 'Verificare în doi pași',
                  value: rolesRequireMfa(row.persona, row.officeRoles) ? (
                    // Ce se poate SPUNE de aici e ce cere rolul. Daca si-a legat
                    // deja telefonul se afla doar de la GoTrue, cu cheia de
                    // service — adica dintr-o ruta, nu la randarea fisei.
                    'Obligatorie — o cere rolul lui'
                  ) : (
                    'Nu e obligatorie pentru rolurile lui'
                  ),
                },
              ]}
            />

            {row.hasAccount ? (
              <>
                <Banner
                  tone="info"
                  title="Contul există deja"
                  body="Parola nu se poate reciti și nu se poate reseta de aici, dinadins. Persoana folosește „Am uitat parola” de pe ecranul de login și primește un link pe email."
                />

                <section>
                  <h2 className="mb-1 text-base font-semibold text-ink">Când merge ceva prost</h2>
                  <p className="mb-3 max-w-prose text-sm text-ink-muted">
                    Închiderea sesiunilor îl scoate din aplicație acum, pe toate dispozitivele — a
                    plecat din firmă, și-a pierdut laptopul. Resetarea verificării în doi pași e
                    pentru telefonul schimbat: fără ea, cine și-a pierdut aplicația de autentificare
                    rămâne blocat definitiv în afara contului.
                  </p>
                  <AccountActions
                    personId={row.id}
                    personName={row.fullName}
                    isSelf={ctx.session.personId === row.id}
                  />
                </section>
              </>
            ) : (
              <section>
                <h2 className="mb-1 text-base font-semibold text-ink">Provizionează contul</h2>
                <p className="mb-3 max-w-prose text-sm text-ink-muted">
                  Se creează contul de login și se generează o parolă temporară, afișată o singură
                  dată pe ecranul tău. Nu se trimite niciun email — parola i-o dai tu, direct.
                </p>
                <ProvisionAccount
                  personId={row.id}
                  personName={row.fullName}
                  email={row.email}
                  blockedReason={accountBlockedReason(row)}
                />
              </section>
            )}
          </div>
        ),
      },

      {
        slug: 'istoric',
        label: 'Istoric',
        // Jurnalul persoanei se vede cu dreptul de administrare — e chiar
        // ecranul pe care se administreaza ea. Jurnalul GLOBAL, din vederea
        // `audit`, cere `audit.read`, care e strict mai ingust.
        render: (row, ctx) => <AuditTrail ctx={ctx} tableName="app.persons" recordId={row.id} />,
      },
    ],

    links: async (row, ctx) => {
      const companies = await listCompanies(ctx.actor, row.companyIds);
      return [
        {
          kind: 'related',
          title: 'Firme la care are acces',
          count: companies.length,
          items: companies.map((company) => ({
            label: company.name,
            href: '/administrare?view=firme',
            meta: company.cui ?? undefined,
          })),
        },
      ];
    },

    quickActions: (row) => [
      ...(row.hasAccount
        ? []
        : [
            {
              label: 'Creează contul de login',
              href: `/administrare/${row.id}/cont`,
              tone: 'primary' as const,
              ...(accountBlockedReason(row) === undefined
                ? {}
                : { disabledReason: accountBlockedReason(row) }),
            },
          ]),
      { label: 'Roluri de birou', href: `/administrare/${row.id}/roluri` },
      { label: 'Acces pe firme', href: `/administrare/${row.id}/firme` },
    ],
  },

  form: {
    schemaKey: 'administrare',
    loadLookups: async (ctx: EntityContext) => {
      const [qualifications, subcontractors, clients] = await Promise.all([
        listQualifications(ctx.actor),
        listSubcontractors(ctx.actor),
        listClients(ctx.actor),
      ]);
      return {
        qualifications: qualifications.map((q) => ({ value: q.id, label: q.name })),
        subcontractors: subcontractors.map((s) => ({ value: s.id, label: s.name })),
        clients: clients.map((c) => ({ value: c.id, label: c.name })),
      };
    },
    fields: (lookups) => [
      { name: 'fullName', label: 'Nume complet', control: 'text', required: true, full: true },
      {
        name: 'email',
        label: 'Email',
        control: 'text',
        hint: 'Adresa pe care se face login-ul. Poate lipsi până la provizionarea contului.',
      },
      { name: 'phone', label: 'Telefon', control: 'text' },
      {
        name: 'persona',
        label: 'Spațiu de lucru',
        control: 'select',
        required: true,
        hint: 'Decide în ce jumătate a aplicației intră omul. Nu se schimbă des.',
        options: Object.entries(PERSONA_LABELS).map(([value, label]) => ({ value, label })),
      },
      {
        name: 'category',
        label: 'Categorie',
        control: 'select',
        required: true,
        options: PERSON_CATEGORIES.map((value) => ({
          value,
          label: PERSON_CATEGORY_LABELS[value],
        })),
      },
      {
        name: 'qualificationId',
        label: 'Calificare',
        control: 'select',
        hint: 'De aici vine costul orei la pontaj.',
        options: [{ value: '', label: '— fără —' }, ...(lookups.qualifications ?? [])],
      },
      {
        name: 'subcontractorId',
        label: 'Subcontractant',
        control: 'select',
        hint: 'Obligatoriu pentru spațiul „Subcontractant”, interzis pentru restul.',
        options: [{ value: '', label: '— fără —' }, ...(lookups.subcontractors ?? [])],
      },
      {
        name: 'clientId',
        label: 'Client',
        control: 'select',
        hint: 'Obligatoriu pentru spațiul „Client”, interzis pentru restul.',
        options: [{ value: '', label: '— fără —' }, ...(lookups.clients ?? [])],
      },
      { name: 'isActive', label: 'Activă', control: 'checkbox' },
    ],
    toFormValues: (row) => ({
      fullName: row.fullName,
      email: row.email ?? '',
      phone: row.phone ?? '',
      persona: row.persona,
      category: row.category,
      qualificationId: row.qualificationId ?? '',
      subcontractorId: row.subcontractorId ?? '',
      clientId: row.clientId ?? '',
      isActive: row.isActive,
    }),
    blank: {
      fullName: '',
      email: '',
      phone: '',
      persona: 'office',
      category: 'angajat',
      qualificationId: '',
      subcontractorId: '',
      clientId: '',
      isActive: true,
    },
    createTitle: 'Adaugă persoană',
    editTitle: 'Modifică persoana',
    editable: true,
  },
});

/**
 * Casutele de rol, cu etichetele din `@damina/contracts`.
 *
 * Salvarea merge pe ruta, nu pe un server action: retragerea accesului la
 * preturi ii taie sesiunea celui vizat pe loc (verificarea #18), iar taierea
 * cere Admin API-ul GoTrue. Rolurile care CER verificare in doi pasi sunt
 * marcate, ca sa se vada ca bifa are si consecinta asta.
 */
function RoleEditor({ row }: { row: PersonRow }) {
  return (
    <CheckboxSet
      options={OFFICE_ROLES.map((role) => ({
        value: role,
        label: OFFICE_ROLE_LABELS[role],
        ...(MFA_REQUIRED_ROLES.includes(role) ? { hint: roRO.mfa.adminRequired } : {}),
      }))}
      selected={row.officeRoles}
      target={{ kind: 'endpoint', url: '/api/admin/roles' }}
      personId={row.id}
      payloadKey="roles"
      saveLabel="Salvează rolurile"
      emptyLabel="Niciun rol de birou definit."
      blockedReason={
        row.persona === 'office' ? undefined : 'Rolurile de birou se dau doar spațiului „Birou”.'
      }
    />
  );
}
