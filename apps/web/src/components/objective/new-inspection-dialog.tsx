'use client';

import { createInspectionInputSchema } from '@damina/contracts';
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
  useToast,
} from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createInspectionAction } from '../../app/(office)/sheet-actions';

/**
 * Deschiderea unei inspectii, de la obiectiv (verificarile #1 si #2).
 *
 * Intrebarea care se pune prima nu e „ce fisa", ci **pe ce contract**: acelasi
 * obiectiv poate fi pe doua contracte, cu doua profile de inspectie diferite, iar
 * fisa vine din profilul legaturii, nu dintr-o lista globala. De aceea contractul
 * e primul camp, iar fisele se schimba sub el.
 *
 * Formularul generic de Activitate NU deschide inspectii — `createWorkUnitFromForm`
 * le refuza explicit, fiindca acolo n-ar exista legatura din care se ia fisa, si
 * ar iesi o inspectie fara checklist.
 */

export interface InspectionChecklistOption {
  readonly id: string;
  readonly label: string;
}

export interface InspectionLink {
  readonly contractObjectiveId: string;
  readonly companyId: string;
  readonly label: string;
  readonly checklists: readonly InspectionChecklistOption[];
  readonly series: readonly string[];
}

export function NewInspectionDialog({
  objectiveId,
  objectiveName,
  links,
  blockedReason,
}: {
  readonly objectiveId: string;
  readonly objectiveName: string;
  readonly links: readonly InspectionLink[];
  readonly blockedReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const { toast } = useToast();
  const router = useRouter();

  const first = links[0];
  const unusable =
    blockedReason ??
    (first === undefined
      ? 'Obiectivul n-are nicio legătură de contract cu profil de inspecție. Profilul se pune pe legătură, în tab-ul Contracte.'
      : undefined);

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        disabled={unusable !== undefined}
        disabledReason={unusable}
      >
        Inspecție nouă
      </Button>

      {open && first !== undefined ? (
        <Form
          schema={createInspectionInputSchema}
          id={`inspectie-${objectiveId}`}
          serverError={serverError}
          defaultValues={
            {
              companyId: first.companyId,
              objectiveId,
              contractObjectiveId: first.contractObjectiveId,
              name: `Inspecție ${objectiveName}`,
              series: first.series[0] ?? '',
              performedOn: new Date().toISOString().slice(0, 10),
              performedBy: '',
              responsiblePersonId: '',
              checklistId: first.checklists[0]?.id ?? '',
            } as never
          }
          onSubmit={(values) => {
            void (async () => {
              setServerError(undefined);
              const result = await createInspectionAction(values);
              if (result.ok) {
                toast({ tone: 'success', title: `Inspecția ${result.data.code} e deschisă` });
                setOpen(false);
                router.push(`/activitate/${result.data.id}`);
              } else {
                setServerError(result.message);
              }
            })();
          }}
        >
          {(form) => {
            const chosen =
              links.find(
                (link) => link.contractObjectiveId === form.watch('contractObjectiveId'),
              ) ?? first;

            return (
              <Dialog
                open
                onOpenChange={(next) => {
                  if (!next) {
                    setOpen(false);
                    setServerError(undefined);
                  }
                }}
                isDirty={form.formState.isDirty}
                size="md"
                title="Inspecție nouă"
                description="Fișa se încarcă din profilul de inspecție al contractului ales. Nu se alege liber."
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
                    <Button type="submit" variant="primary" form={`inspectie-${objectiveId}`}>
                      Deschide fișa
                    </Button>
                  </>
                }
              >
                <div className="space-y-4">
                  <Field
                    name="contractObjectiveId"
                    label="Pe contractul"
                    required
                    hint="Profilul de inspecție al legăturii decide ce fișă se completează."
                  >
                    {(props) => (
                      <Select
                        {...props}
                        options={links.map((link) => ({
                          value: link.contractObjectiveId,
                          label: link.label,
                        }))}
                        {...form.register('contractObjectiveId', {
                          onChange: (event: { target: { value: string } }) => {
                            const next = links.find(
                              (link) => link.contractObjectiveId === event.target.value,
                            );
                            if (next !== undefined) {
                              form.setValue('companyId', next.companyId);
                              form.setValue('series', next.series[0] ?? '');
                              form.setValue('checklistId', next.checklists[0]?.id ?? '');
                            }
                          },
                        })}
                      />
                    )}
                  </Field>

                  <Field
                    name="checklistId"
                    label="Fișa"
                    hint={
                      chosen.checklists.length > 1
                        ? 'Profilul cere mai multe fișe. Alege pe care o completezi acum.'
                        : 'Profilul cere o singură fișă, deja aleasă.'
                    }
                  >
                    {(props) => (
                      <Select
                        {...props}
                        options={chosen.checklists.map((checklist) => ({
                          value: checklist.id,
                          label: checklist.label,
                        }))}
                        {...form.register('checklistId')}
                      />
                    )}
                  </Field>

                  <Field name="name" label="Denumire" required>
                    {(props) => <Input {...props} {...form.register('name')} />}
                  </Field>

                  <FieldRow columns={2}>
                    <Field
                      name="series"
                      label="Serie de numerotare"
                      required
                      hint="Codul se alocă fără goluri din seria firmei."
                    >
                      {(props) => (
                        <Select
                          {...props}
                          options={chosen.series.map((series) => ({
                            value: series,
                            label: series,
                          }))}
                          {...form.register('series')}
                        />
                      )}
                    </Field>
                    <Field
                      name="performedOn"
                      label="Data executării"
                      required
                      hint="Rămâne data documentului. Luna de raportare se pune abia la validare."
                    >
                      {(props) => (
                        <Input {...props} type="date" {...form.register('performedOn')} />
                      )}
                    </Field>
                  </FieldRow>

                  {chosen.series.length === 0 ? (
                    <Banner
                      tone="warning"
                      title="Firma n-are serie pentru inspecții"
                      body="Fără serie, codul fișei n-are de unde se aloca. Se adaugă din administrare, ca serie de tip „inspecție”."
                    />
                  ) : null}
                </div>
              </Dialog>
            );
          }}
        </Form>
      ) : null}
    </>
  );
}
