'use client';

import {
  closeWorkUnitInputSchema,
  moveFundingInputSchema,
  promoteWorkUnitInputSchema,
  workStageInputSchema,
} from '@damina/contracts';
import { t } from '@damina/i18n';
import {
  Banner,
  Button,
  Dialog,
  Field,
  FieldRow,
  Form,
  Input,
  Select,
  Textarea,
  useToast,
  type UseFormReturn,
} from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { z } from 'zod';
import {
  closeWorkUnitAction,
  createWorkUnitStage,
  moveWorkUnitFunding,
  promoteWorkUnit,
} from '../../app/(office)/work-unit-actions';

/**
 * Cele patru scrieri de pe ecranul unei unitati de lucru.
 *
 * Stau intr-un fisier pentru ca au aceeasi anatomie — buton, `Form`, `Dialog`,
 * motiv scris, `router.refresh()` — si pentru ca trei din patru cer acelasi lucru
 * de la om: sa spuna DE CE. Patru fisiere ar fi insemnat sa fie scris de patru
 * ori, si a patra copie ar fi fost cea care uita motivul.
 */

// ── Schelet comun ────────────────────────────────────────────────────────────

interface ShellProps<Schema extends z.ZodType> {
  readonly triggerLabel: string;
  readonly triggerVariant?: 'primary' | 'secondary' | 'ghost';
  readonly blockedReason?: string;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly formId: string;
  readonly schema: Schema;
  readonly defaults: z.output<Schema>;
  submit(values: z.output<Schema>): Promise<{ ok: boolean; message?: string; toast?: string }>;
  children(form: UseFormReturn<z.output<Schema>>): ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
}

/**
 * Generic peste schema, nu peste `unknown`.
 *
 * Un wrapper care ar sterge tipul schemei ar cere `any` la definire si `as never`
 * la fiecare `register` — adica exact in punctul in care un nume de camp scris
 * greșit trebuie sa pice la compilare, nu la rulare.
 */
function ActionDialog<Schema extends z.ZodType>({
  triggerLabel,
  triggerVariant = 'secondary',
  blockedReason,
  title,
  description,
  submitLabel,
  formId,
  schema,
  defaults,
  submit,
  children,
  size = 'sm',
}: ShellProps<Schema>) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const { toast } = useToast();
  const router = useRouter();

  return (
    <>
      <Button
        variant={triggerVariant}
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        disabled={blockedReason !== undefined}
        disabledReason={blockedReason}
      >
        {triggerLabel}
      </Button>

      {open ? (
        <Form
          schema={schema}
          defaultValues={defaults as never}
          id={formId}
          serverError={serverError}
          onSubmit={(values) => {
            void (async () => {
              setServerError(undefined);
              const result = await submit(values);
              if (result.ok) {
                toast({ tone: 'success', title: result.toast ?? t('form.saved') });
                setOpen(false);
                router.refresh();
              } else {
                setServerError(result.message);
              }
            })();
          }}
        >
          {(form) => (
            <Dialog
              open
              onOpenChange={(next) => {
                if (!next) {
                  setOpen(false);
                  setServerError(undefined);
                }
              }}
              isDirty={form.formState.isDirty}
              size={size}
              title={title}
              description={description}
              footer={
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setOpen(false);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    form={formId}
                    variant="primary"
                    loading={form.formState.isSubmitting}
                  >
                    {submitLabel}
                  </Button>
                </>
              }
            >
              {children(form)}
            </Dialog>
          )}
        </Form>
      ) : null}
    </>
  );
}

// ── Promovarea ───────────────────────────────────────────────────────────────

const PRESERVED_LABELS: Readonly<Record<string, string>> = {
  id: 'Identificatorul intern',
  code: 'Codul din serie',
  objective: 'Obiectivul',
  photos: 'Pozele',
  hours: 'Orele pontate',
  materials: 'Consumurile de material',
  documents: 'Documentele și folderul',
};

const ADDED_LABELS: Readonly<Record<string, string>> = {
  deviz: 'Devizul',
  stages: 'Etapele, cu grafic',
};

/**
 * Confirmarea promovarii. Arata EXPLICIT ce se pastreaza si ce se adauga (§3.4).
 *
 * Cele doua liste nu sunt scrise aici: vin din `canPromote`, ca sa nu poata
 * ajunge sa spuna altceva decat ce face serviciul. Aici se traduc, si atat.
 */
export function PromoteDialog({
  workUnitId,
  code,
  preserves,
  adds,
  blockedReason,
}: {
  readonly workUnitId: string;
  readonly code: string;
  readonly preserves: readonly string[];
  readonly adds: readonly string[];
  readonly blockedReason?: string;
}) {
  return (
    <ActionDialog
      triggerLabel="Promovează în lucrare"
      triggerVariant="primary"
      blockedReason={blockedReason}
      title={`Promovează ${code} în lucrare`}
      description="Unitatea își păstrează identitatea. Nu se copiază nimic și nu se mută nimic — se adaugă structura de lucrare."
      submitLabel="Promovează"
      formId={`promote-${workUnitId}`}
      schema={promoteWorkUnitInputSchema}
      defaults={{ workUnitId, reason: '' }}
      submit={async (values) => {
        const result = await promoteWorkUnit(values);
        return result.ok
          ? { ok: true, toast: `${code} e acum lucrare.` }
          : { ok: false, message: result.message };
      }}
      size="md"
    >
      {(form) => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <section className="rounded-md border border-success-200 bg-success-50 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-success-800">
                Se păstrează
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-ink">
                {preserves.map((key) => (
                  <li key={key}>{PRESERVED_LABELS[key] ?? key}</li>
                ))}
              </ul>
            </section>

            <section className="rounded-md border border-brand-200 bg-brand-50 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-800">
                Se adaugă
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-ink">
                {adds.map((key) => (
                  <li key={key}>{ADDED_LABELS[key] ?? key}</li>
                ))}
              </ul>
            </section>
          </div>

          <Field
            name="reason"
            label="Motiv"
            required
            hint="De ce e mai mare decât părea. Ajunge în istoricul unității."
          >
            {(props) => <Textarea {...props} {...form.register('reason')} rows={3} />}
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

// ── Mutarea finantarii ───────────────────────────────────────────────────────

export interface MoveFundingOption {
  readonly value: string;
  readonly label: string;
}

/**
 * MUTA FINANTAREA (§3.4).
 *
 * Ecranul spune **care dintre cele doua mecanici se va aplica**, inainte de
 * confirmare — si textul vine din `previewFundingMove`, nu din interfata. Daca
 * ecranul ar decide singur, ar putea promite o mecanica si tranzactia ar face
 * cealalta.
 *
 * La fel de important e ce scrie jos: ce NU se schimba niciodata. Lista aia e
 * motivul pentru care mutarea e sigura, si de aceea se citeste inainte de buton,
 * nu intr-un ajutor ascuns.
 */
export function MoveFundingDialog({
  workUnitId,
  allocationId,
  code,
  fromLabel,
  amountLabel,
  periodIsClosed,
  currentPeriodLabel,
  contractOptions,
  componentOptions,
  periodOptions,
  defaultContractId,
  blockedReason,
}: {
  readonly workUnitId: string;
  readonly allocationId: string;
  readonly code: string;
  readonly fromLabel: string;
  readonly amountLabel: string;
  readonly periodIsClosed: boolean;
  readonly currentPeriodLabel: string | null;
  readonly contractOptions: readonly MoveFundingOption[];
  readonly componentOptions: readonly MoveFundingOption[];
  readonly periodOptions: readonly MoveFundingOption[];
  readonly defaultContractId: string;
  readonly blockedReason?: string;
}) {
  return (
    <ActionDialog
      triggerLabel="Mută finanțarea"
      blockedReason={blockedReason}
      title={`Mută finanțarea · ${code}`}
      description={`De la: ${fromLabel}. Costurile deja înregistrate se mută cu unitatea de lucru.`}
      submitLabel="Mută finanțarea"
      formId={`move-${allocationId}`}
      schema={moveFundingInputSchema}
      defaults={{
        workUnitId,
        allocationId,
        toContractId: defaultContractId,
        toComponentId: '',
        toPeriodId: '',
        reason: '',
      }}
      submit={async (values) => {
        const result = await moveWorkUnitFunding(values);
        if (!result.ok) {
          return { ok: false, message: result.message };
        }
        return {
          ok: true,
          toast:
            result.data.reallocationNumber === null
              ? 'Finanțarea s-a mutat. Alocarea veche e supersedată.'
              : `Document de re-alocare ${result.data.reallocationNumber} emis.`,
        };
      }}
      size="md"
    >
      {(form) => (
        <div className="space-y-4">
          <Banner
            tone={periodIsClosed ? 'warning' : 'info'}
            title={periodIsClosed ? 'Luna e închisă 🔒' : 'Luna e deschisă'}
            body={
              periodIsClosed
                ? `Se emite un document de re-alocare în luna curentă${
                    currentPeriodLabel === null ? '' : ` (${currentPeriodLabel})`
                  }: scoate suma din componenta veche, o pune pe cea nouă. Ambele mișcări rămân vizibile, iar luna raportată nu se rescrie.`
                : 'Se rescrie analitica „descărcat” pe liniile de cost existente. Alocarea veche devine supersedată, cea nouă activă.'
            }
          />

          <dl className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-muted p-3 text-sm">
            <div>
              <dt className="text-xs text-ink-muted">Se mută</dt>
              <dd data-numeric className="font-semibold tabular-nums text-ink">
                {amountLabel}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">De la</dt>
              <dd className="font-medium text-ink">{fromLabel}</dd>
            </div>
          </dl>

          <FieldRow columns={2}>
            <Field name="toContractId" label="Contract" required>
              {(props) => (
                <Select
                  {...props}
                  {...form.register('toContractId')}
                  options={contractOptions}
                />
              )}
            </Field>

            <Field name="toComponentId" label="Componentă" required>
              {(props) => (
                <Select
                  {...props}
                  {...form.register('toComponentId')}
                  options={componentOptions}
                  placeholder="Alege componenta"
                />
              )}
            </Field>
          </FieldRow>

          <Field
            name="toPeriodId"
            label="Luna"
            required
            hint="Doar luni deschise. O lună închisă nu poate primi finanțare mutată."
          >
            {(props) => (
              <Select
                {...props}
                {...form.register('toPeriodId')}
                options={periodOptions}
                placeholder="Alege luna"
              />
            )}
          </Field>

          <Field
            name="reason"
            label="Motiv"
            required
            hint="Obligatoriu. Fără el nu se salvează — și tot el explică mutarea peste șase luni."
          >
            {(props) => <Textarea {...props} {...form.register('reason')} rows={3} />}
          </Field>

          <p className="text-xs text-ink-subtle">
            Nu se schimbă niciodată: data documentului, obiectivul și analitica{' '}
            <strong>„folosit”</strong>. Istoricul obiectivului rămâne intact.
          </p>
        </div>
      )}
    </ActionDialog>
  );
}

// ── Etapa noua ───────────────────────────────────────────────────────────────

export function StageDialog({
  workUnitId,
  nextPosition,
  blockedReason,
}: {
  readonly workUnitId: string;
  readonly nextPosition: number;
  readonly blockedReason?: string;
}) {
  return (
    <ActionDialog
      triggerLabel="Adaugă etapă"
      blockedReason={blockedReason}
      title={`Etapa ${String(nextPosition)}`}
      description="Etapele există doar pe lucrări. Poziția se dă automat, în ordinea adăugării."
      submitLabel="Adaugă etapa"
      formId={`stage-${workUnitId}`}
      schema={workStageInputSchema}
      defaults={{
        workUnitId,
        name: '',
        plannedStart: '',
        plannedEnd: '',
        materialBudget: '',
        laborBudget: '',
        pctOfWork: '',
      }}
      submit={async (values) => {
        const result = await createWorkUnitStage(values);
        return result.ok ? { ok: true } : { ok: false, message: result.message };
      }}
      size="md"
    >
      {(form) => (
        <div className="space-y-4">
          <Field name="name" label="Denumirea etapei" required>
            {(props) => (
              <Input
                {...props}
                {...form.register('name')}
                placeholder="ex. Montaj pompe noi"
              />
            )}
          </Field>

          <FieldRow columns={2}>
            <Field name="plannedStart" label="Început planificat">
              {(props) => <Input {...props} {...form.register('plannedStart')} type="date" />}
            </Field>
            <Field name="plannedEnd" label="Sfârșit planificat">
              {(props) => <Input {...props} {...form.register('plannedEnd')} type="date" />}
            </Field>
          </FieldRow>

          <FieldRow columns={2}>
            <Field
              name="materialBudget"
              label="Buget de material"
              hint="Nu se vede în teren: coloanele de bani nu ies din birou."
            >
              {(props) => (
                <Input
                  {...props}
                  {...form.register('materialBudget')}
                  inputMode="decimal"
                  suffix="lei"
                />
              )}
            </Field>
            <Field name="laborBudget" label="Buget de manoperă">
              {(props) => (
                <Input
                  {...props}
                  {...form.register('laborBudget')}
                  inputMode="decimal"
                  suffix="lei"
                />
              )}
            </Field>
          </FieldRow>

          <Field
            name="pctOfWork"
            label="Cât cântărește în lucrare"
            hint="Ponderile scrise fac bara de progres să spună adevărul. Fără ele, progresul se numără pe etape."
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('pctOfWork')}
                inputMode="decimal"
                suffix="%"
              />
            )}
          </Field>
        </div>
      )}
    </ActionDialog>
  );
}

// ── Inchiderea ───────────────────────────────────────────────────────────────

export function CloseWorkUnitDialog({
  workUnitId,
  code,
  blockedReason,
}: {
  readonly workUnitId: string;
  readonly code: string;
  readonly blockedReason?: string;
}) {
  return (
    <ActionDialog
      triggerLabel="Închide unitatea"
      blockedReason={blockedReason}
      title={`Închide ${code}`}
      description="După închidere nu se mai pot înregistra costuri noi pe unitatea asta."
      submitLabel="Închide"
      formId={`close-${workUnitId}`}
      schema={closeWorkUnitInputSchema}
      defaults={{ workUnitId, reason: '' }}
      submit={async (values) => {
        const result = await closeWorkUnitAction(values);
        return result.ok
          ? { ok: true, toast: `${code} e închisă.` }
          : { ok: false, message: result.message };
      }}
    >
      {(form) => (
        <Field
          name="reason"
          label="Motiv"
          required
          hint="Ce s-a terminat și pe baza cărui document. Rămâne în istoric."
        >
          {(props) => <Textarea {...props} {...form.register('reason')} rows={3} />}
        </Field>
      )}
    </ActionDialog>
  );
}
