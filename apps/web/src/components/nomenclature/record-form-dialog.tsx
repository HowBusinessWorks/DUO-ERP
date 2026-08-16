'use client';

import {
  clientInputSchema,
  contractInputSchema,
  objectiveInputSchema,
  productInputSchema,
  qualificationInputSchema,
  rateCardInputSchema,
  subcontractorInputSchema,
  supplierInputSchema,
} from '@damina/contracts';
import { t } from '@damina/i18n';
import {
  Button,
  Checkbox,
  DateInput,
  Dialog,
  Field,
  FieldRow,
  Form,
  Input,
  Select,
  Textarea,
  useFormContext,
  useToast,
} from '@damina/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { z } from 'zod';
import { GeoField } from '../objective/geo-field';
import type { ActionResult } from '../../lib/action';
import type { FormFieldSpec } from '../../registry/types';

/**
 * Formularul oricarui nomenclator, desenat din descrierea din registry.
 *
 * Schemele Zod sunt importate AICI, in browser, din acelasi `@damina/contracts`
 * pe care il foloseste server action-ul. O schema nu poate traversa granita
 * server→client ca proprietate (nu e serializabila), dar poate fi importata de
 * ambele parti — si atunci nu exista doua definitii care sa divergheze.
 */
const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  produse: productInputSchema,
  furnizori: supplierInputSchema,
  clienti: clientInputSchema,
  subcontractanti: subcontractorInputSchema,
  calificari: qualificationInputSchema,
  tarife: rateCardInputSchema,
  contracte: contractInputSchema,
  obiective: objectiveInputSchema,
};

export interface RecordFormDialogProps {
  readonly module: string;
  readonly fields: readonly FormFieldSpec[];
  readonly blank: Readonly<Record<string, unknown>>;
  readonly createTitle: string;
  readonly editTitle: string;
  readonly triggerLabel: string;
  /** Inregistrarile deja existente, ca formularul de editare sa aiba valorile. */
  readonly editable: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly canEdit: boolean;
  readonly save: (
    module: string,
    id: string | null,
    raw: unknown,
  ) => Promise<ActionResult<{ id: string }>>;
  /** Scrierea e blocata: luna inchisa, rol fara drept. Butonul spune de ce. */
  readonly blockedReason?: string;
}

export function RecordFormDialog({
  module,
  fields,
  blank,
  createTitle,
  editTitle,
  triggerLabel,
  editable,
  canEdit,
  save,
  blockedReason,
}: RecordFormDialogProps) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();

  // Deschiderea din URL: `?new=1` din butonul ＋ si din comenzi, `?edit={id}`
  // din actiunile rapide ale paginii de detaliu. Asa o actiune de pe alt ecran
  // poate deschide formularul fara stare globala.
  const editId = params.get('edit');
  const wantsNew = params.get('new') !== null;
  const [manual, setManual] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>(undefined);

  const open = manual || wantsNew || (editId !== null && editId in editable);
  const editing = editId !== null && editId in editable ? editId : null;

  const close = useCallback(() => {
    setManual(false);
    setServerError(undefined);
    if (wantsNew || editId !== null) {
      router.replace(`/${module}`);
    }
  }, [module, router, wantsNew, editId]);

  const schema = SCHEMAS[module];
  if (schema === undefined) {
    return null;
  }

  const defaults = editing === null ? blank : (editable[editing] ?? blank);

  return (
    <>
      <Button
        variant="primary"
        onClick={() => {
          setManual(true);
        }}
        disabled={!canEdit || blockedReason !== undefined}
        disabledReason={
          blockedReason ?? (canEdit ? undefined : 'Rolul tău nu poate modifica nomenclatoarele.')
        }
      >
        {triggerLabel}
      </Button>

      {open ? (
        <FormDialog
          key={editing ?? 'new'}
          module={module}
          schema={schema}
          fields={fields}
          defaults={defaults}
          editing={editing}
          title={editing === null ? createTitle : editTitle}
          serverError={serverError}
          onClose={close}
          onSubmit={async (values) => {
            setServerError(undefined);
            const result = await save(module, editing, values);
            if (result.ok) {
              toast({ tone: 'success', title: t('form.saved') });
              close();
              router.refresh();
            } else {
              setServerError(result.message);
            }
          }}
        />
      ) : null}
    </>
  );
}

function FormDialog({
  module,
  schema,
  fields,
  defaults,
  editing,
  title,
  serverError,
  onClose,
  onSubmit,
}: {
  module: string;
  schema: z.ZodType;
  fields: readonly FormFieldSpec[];
  defaults: Readonly<Record<string, unknown>>;
  editing: string | null;
  title: string;
  serverError: string | undefined;
  onClose: () => void;
  onSubmit: (values: unknown) => Promise<void>;
}) {
  const formId = `form-${module}`;

  return (
    <Form
      schema={schema}
      // `defaults` vine din registry si e deja in forma pe care o asteapta
      // schema. Cast-ul e la granita, nu in interior.
      defaultValues={defaults as never}
      id={formId}
      onSubmit={(values) => {
        void onSubmit(values);
      }}
      serverError={serverError}
    >
      {(form) => {
        // `isDirty` merge in Dialog: la inchidere cu modificari nesalvate,
        // se cere confirmare (§30.1). Regula traieste in componenta, nu aici.
        // Se citeste direct din `formState` (proxy react-hook-form, care
        // reranda `Form` la schimbare) — o copie in `useState` ar insemna
        // setState in timpul randarii altei componente.
        return (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next) {
                onClose();
              }
            }}
            title={title}
            isDirty={form.formState.isDirty}
            size="md"
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    onClose();
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
                  {t('common.save')}
                </Button>
              </>
            }
          >
            <FieldRow columns={2}>
              {fields.map((spec) => (
                <FieldControl key={spec.name} spec={spec} editing={editing !== null} />
              ))}
            </FieldRow>
          </Dialog>
        );
      }}
    </Form>
  );
}

function FieldControl({ spec, editing }: { spec: FormFieldSpec; editing: boolean }) {
  const form = useFormContext();
  const readOnly = editing && spec.readOnlyOnEdit === true;

  if (spec.control === 'geo') {
    return (
      <GeoField
        latName={spec.name}
        lngName={spec.pairedWith ?? ''}
        label={spec.label}
        hint={spec.hint}
      />
    );
  }

  if (spec.control === 'checkbox') {
    return (
      <div className={spec.full === true ? 'sm:col-span-2' : undefined}>
        <Checkbox
          id={`chk-${spec.name}`}
          label={spec.label}
          hint={spec.hint}
          {...form.register(spec.name)}
        />
      </div>
    );
  }

  return (
    <Field
      name={spec.name}
      label={spec.label}
      hint={spec.hint}
      required={spec.required}
      className={spec.full === true ? 'sm:col-span-2' : undefined}
    >
      {(props) => {
        const registration = form.register(spec.name);

        if (spec.control === 'textarea') {
          return (
            <Textarea
              {...props}
              {...registration}
              placeholder={spec.placeholder}
              readOnly={readOnly}
            />
          );
        }
        if (spec.control === 'select') {
          return (
            <Select
              {...props}
              {...registration}
              options={spec.options ?? []}
              placeholder={spec.required === true ? t('form.selectPlaceholder') : '—'}
              disabled={readOnly}
            />
          );
        }
        if (spec.control === 'date') {
          return <DateInput {...props} {...registration} readOnly={readOnly} />;
        }
        return (
          <Input
            {...props}
            {...registration}
            // `inputMode="decimal"` si nu `type="number"`: pe `number`, rotita
            // mouse-ului schimba valoarea la scroll, iar separatorul zecimal
            // romanesc nu se poate tasta.
            inputMode={spec.control === 'number' ? 'decimal' : undefined}
            placeholder={spec.placeholder}
            suffix={spec.suffix}
            readOnly={readOnly}
          />
        );
      }}
    </Field>
  );
}
