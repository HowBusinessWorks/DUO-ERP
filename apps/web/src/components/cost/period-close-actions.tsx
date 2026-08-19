'use client';

import { t } from '@damina/i18n';
import { Button, Dialog, Field, Form, Textarea, useToast } from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import {
  beginPeriodClosing,
  closeAccountingPeriod,
  reopenAccountingPeriod,
} from '../../app/(office)/period-actions';

/**
 * Cele trei apasari de pe ecranul de inchidere.
 *
 * Doua din trei cer motiv scris, si dialogul nu-l poate ocoli: `reason` e
 * obligatoriu in schema, aceeasi pe care o valideaza si server action-ul. Nu
 * exista „inchide oricum".
 *
 * Butonul de inchidere e inactiv cand checklist-ul are randuri blocate — dar
 * asta e comoditate, nu aparare: serviciul reevalueaza si refuza si el.
 * Comoditatea explica DE CE, prin `disabledReason`, ca sa nu ramana omul cu un
 * buton gri si nicio idee.
 */

const reasonSchema = z.object({
  reason: z.string().trim().min(1, 'Scrie de ce.').max(500),
});

type ReasonValues = z.infer<typeof reasonSchema>;

function ReasonDialog({
  triggerLabel,
  triggerVariant,
  blockedReason,
  title,
  description,
  submitLabel,
  hint,
  formId,
  submit,
}: {
  readonly triggerLabel: string;
  readonly triggerVariant: 'primary' | 'secondary' | 'ghost';
  readonly blockedReason?: string;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly hint: string;
  readonly formId: string;
  submit(reason: string): Promise<{ ok: boolean; message?: string }>;
}) {
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
          schema={reasonSchema}
          defaultValues={{ reason: '' }}
          id={formId}
          onSubmit={(values: ReasonValues) => {
            void (async () => {
              setServerError(undefined);
              const result = await submit(values.reason);
              if (result.ok) {
                toast({ tone: 'success', title: submitLabel });
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
              error={serverError}
              open
              onOpenChange={(next) => {
                if (!next) {
                  setOpen(false);
                  setServerError(undefined);
                }
              }}
              isDirty={form.formState.isDirty}
              size="sm"
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
              <Field name="reason" label="Motivul" hint={hint} required>
                {(props) => (
                  <Textarea
                    {...props}
                    {...form.register('reason')}
                    rows={3}
                    placeholder="Se scrie o dată și rămâne în audit."
                  />
                )}
              </Field>
            </Dialog>
          )}
        </Form>
      ) : null}
    </>
  );
}

export function StartClosingButton({ periodId }: { readonly periodId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      onClick={() => {
        void (async () => {
          setBusy(true);
          const result = await beginPeriodClosing({ periodId });
          setBusy(false);
          if (result.ok) {
            toast({ tone: 'success', title: 'Luna a intrat în verificare' });
            router.refresh();
          } else {
            toast({ tone: 'error', title: result.message });
          }
        })();
      }}
    >
      Începe închiderea
    </Button>
  );
}

export function ClosePeriodButton({
  periodId,
  blockedReason,
}: {
  readonly periodId: string;
  readonly blockedReason?: string;
}) {
  return (
    <ReasonDialog
      triggerLabel="Închide luna"
      triggerVariant="primary"
      {...(blockedReason === undefined ? {} : { blockedReason })}
      title="Închide luna"
      description="După închidere, nicio scriere nu mai intră în luna asta. Mutările de finanțare trec automat pe documente de re-alocare."
      submitLabel="Închide luna"
      hint="De ce se închide acum. Ajunge în audit, lângă numele tău."
      formId="close-period-form"
      submit={async (reason) => closeAccountingPeriod({ periodId, reason })}
    />
  );
}

export function ReopenPeriodButton({ periodId }: { readonly periodId: string }) {
  return (
    <ReasonDialog
      triggerLabel="Redeschide luna"
      triggerVariant="ghost"
      title="Redeschide luna"
      description="Cifrele lunii redevin modificabile. Raportul deja trimis clientului NU se schimbă singur — dacă cifrele se mișcă, trebuie retrimis."
      submitLabel="Redeschide luna"
      hint="De ce se redeschide o lună raportată. Se citește peste șase luni."
      formId="reopen-period-form"
      submit={async (reason) => reopenAccountingPeriod({ periodId, reason })}
    />
  );
}
