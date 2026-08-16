'use client';

import { costCeilingInputSchema, revenueCeilingInputSchema } from '@damina/contracts';
import { t } from '@damina/i18n';
import { Button, Dialog, Field, FieldRow, Form, Input, Textarea, useToast } from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { saveCostCeiling, saveRevenueCeiling } from '../../app/(office)/contract-actions';

/**
 * Formularul unui plafon.
 *
 * DOUA moduri, nu unul cu un comutator: `cost` scrie `cost_ceiling`, `venit`
 * scrie `revenue_ceiling`, si nu exista drum intre ele. Regula 1 a pasului cere
 * ca cele trei numere sa nu se amestece „nici in DB, nici pe ecran, nici in
 * numele variabilelor” — un singur formular cu un `select` de tip ar fi fost
 * exact locul in care se amesteca.
 *
 * MOTIVUL e obligatoriu si la prima setare, nu doar la modificare (verificarea
 * #5). Un plafon nu se pune „ca sa fie”, si cine il pune stie de ce.
 */

export interface CeilingDialogProps {
  readonly kind: 'cost' | 'venit';
  readonly componentId: string;
  readonly componentName: string;
  /** Luna. `null` pe randul anual al componentei Lucrari. */
  readonly periodId: string | null;
  /** Anul contractual. `null` pe plafoanele lunare. */
  readonly contractYearId: string | null;
  readonly scopeLabel: string;
  readonly currentCeiling: string | null;
  readonly currentAllocatedRevenue: string | null;
  readonly triggerLabel: string;
  /** Luna inchisa, rol fara drept. Butonul spune de ce, nu doar se face gri. */
  readonly blockedReason?: string;
}

export function CeilingDialog({
  kind,
  componentId,
  componentName,
  periodId,
  contractYearId,
  scopeLabel,
  currentCeiling,
  currentAllocatedRevenue,
  triggerLabel,
  blockedReason,
}: CeilingDialogProps) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const { toast } = useToast();
  const router = useRouter();

  const formId = `ceiling-${componentId}-${periodId ?? contractYearId ?? 'x'}`;
  const cost = kind === 'cost';

  const defaults = cost
    ? {
        componentId,
        periodId: periodId ?? '',
        contractYearId: contractYearId ?? '',
        allocatedRevenue: currentAllocatedRevenue ?? '',
        costCeiling: currentCeiling ?? '',
        reason: '',
      }
    : {
        componentId,
        periodId: periodId ?? '',
        allocatedRevenue: currentAllocatedRevenue ?? '',
        revenueCeiling: currentCeiling ?? '',
        reason: '',
      };

  return (
    <>
      <Button
        variant="secondary"
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
          // Cast la granita: `defaults` e construit chiar deasupra, in forma pe
          // care o cere schema aleasa. Interiorul ramane tipizat.
          schema={cost ? costCeilingInputSchema : revenueCeilingInputSchema}
          defaultValues={defaults as never}
          id={formId}
          serverError={serverError}
          onSubmit={(values) => {
            void (async () => {
              setServerError(undefined);
              const result = cost
                ? await saveCostCeiling(values)
                : await saveRevenueCeiling(values);
              if (result.ok) {
                toast({ tone: 'success', title: t('form.saved') });
                setOpen(false);
                router.refresh();
              } else {
                setServerError(result.message);
              }
            })();
          }}
        >
          {(form) => {
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
                size="sm"
                title={
                  cost ? `Plafon de cost · ${componentName}` : `Plafon de venit · ${componentName}`
                }
                description={
                  cost
                    ? `${scopeLabel} · cât avem voie să cheltuim pe componenta asta.`
                    : `${scopeLabel} · cât putem încasa. Ce nu se umple până la finalul lunii se pierde definitiv.`
                }
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
                      {t('common.save')}
                    </Button>
                  </>
                }
              >
                <FieldRow columns={2}>
                  <Field
                    name={cost ? 'costCeiling' : 'revenueCeiling'}
                    label={cost ? 'Plafon de cost' : 'Plafon de venit'}
                    required
                    hint={
                      cost
                        ? 'Limita de cheltuială. Peste 80% ecranul avertizează.'
                        : 'Ținta de umplere, setată manual. Nu e o limită de cheltuială.'
                    }
                  >
                    {(props) => (
                      <Input
                        {...props}
                        {...form.register(cost ? 'costCeiling' : 'revenueCeiling')}
                        inputMode="decimal"
                        suffix="lei"
                      />
                    )}
                  </Field>

                  <Field
                    name="allocatedRevenue"
                    label="Venit alocat"
                    hint="Cât încasăm pe componentă. E al treilea număr, separat de plafon."
                  >
                    {(props) => (
                      <Input
                        {...props}
                        {...form.register('allocatedRevenue')}
                        inputMode="decimal"
                        suffix="lei"
                      />
                    )}
                  </Field>

                  <Field
                    name="reason"
                    label="Motivul modificării"
                    required
                    hint="Ajunge în audit trail. Peste șase luni, asta e tot ce va explica cifra."
                    className="sm:col-span-2"
                  >
                    {(props) => (
                      <Textarea
                        {...props}
                        {...form.register('reason')}
                        placeholder="Renegociere cu clientul, ședința din 12 august."
                      />
                    )}
                  </Field>
                </FieldRow>
              </Dialog>
            );
          }}
        </Form>
      ) : null}
    </>
  );
}
