'use client';

import { contractObjectiveInputSchema } from '@damina/contracts';
import { t } from '@damina/i18n';
import {
  Button,
  DateInput,
  Dialog,
  Field,
  FieldRow,
  Form,
  Select,
  Textarea,
  useToast,
} from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  changeInspectionProfile,
  closeObjectiveLink,
  saveObjectiveLink,
} from '../../app/(office)/contract-actions';

export interface Option {
  readonly value: string;
  readonly label: string;
}

/**
 * Adaugarea unui obiectiv in contract.
 *
 * PROFILUL DE INSPECTIE SE ALEGE AICI, pe legatura — nu pe obiectiv (regula 3 a
 * pasului). Acelasi bazin poate fi inspectat lunar pe contractul unei firme si
 * trimestrial pe al alteia, si asta nu e o exceptie, e cazul obisnuit.
 */
export function LinkObjectiveDialog({
  contractId,
  objectives,
  profiles,
  blockedReason,
}: {
  readonly contractId: string;
  readonly objectives: readonly Option[];
  readonly profiles: readonly Option[];
  readonly blockedReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const { toast } = useToast();
  const router = useRouter();
  const formId = 'link-objective';

  return (
    <>
      <Button
        variant="primary"
        onClick={() => {
          setOpen(true);
        }}
        disabled={blockedReason !== undefined}
        disabledReason={blockedReason}
      >
        Adaugă obiectiv
      </Button>

      {open ? (
        <Form
          schema={contractObjectiveInputSchema}
          defaultValues={
            {
              contractId,
              objectiveId: '',
              validFrom: new Date().toISOString().slice(0, 10),
              validTo: '',
              inspectionProfileId: '',
            } as never
          }
          id={formId}
          onSubmit={(values) => {
            void (async () => {
              setServerError(undefined);
              const result = await saveObjectiveLink(values);
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
                title="Adaugă un obiectiv în contract"
                description="Legătura are perioadă proprie: obiectivele intră și ies din contract în cei 4 ani, iar istoricul rămâne."
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
                    name="objectiveId"
                    label="Obiectiv"
                    required
                    className="sm:col-span-2"
                    hint="Obiectivele sunt nomenclator comun celor 5 firme."
                  >
                    {(props) => (
                      <Select
                        {...props}
                        {...form.register('objectiveId')}
                        options={objectives}
                        placeholder={t('form.selectPlaceholder')}
                      />
                    )}
                  </Field>

                  <Field name="validFrom" label="Intră în contract la" required>
                    {(props) => <DateInput {...props} {...form.register('validFrom')} />}
                  </Field>

                  <Field
                    name="validTo"
                    label="Iese la"
                    hint="Lasă gol dacă rămâne până la finalul contractului."
                  >
                    {(props) => <DateInput {...props} {...form.register('validTo')} />}
                  </Field>

                  <Field
                    name="inspectionProfileId"
                    label="Profil de inspecție"
                    className="sm:col-span-2"
                    hint="Profilul stă pe legătură, nu pe obiectiv: același obiectiv poate avea frecvențe diferite pe contracte diferite."
                  >
                    {(props) => (
                      <Select
                        {...props}
                        {...form.register('inspectionProfileId')}
                        options={profiles}
                        placeholder="Fără profil"
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

/**
 * Actiunile pe o legatura existenta: schimbarea profilului si scoaterea din
 * contract. Amandoua cer MOTIV SCRIS, si amandoua sunt mutari de bani.
 */
export function LinkRowActions({
  linkId,
  objectiveName,
  currentProfileId,
  profiles,
  blockedReason,
}: {
  readonly linkId: string;
  readonly objectiveName: string;
  readonly currentProfileId: string | null;
  readonly profiles: readonly Option[];
  readonly blockedReason?: string;
}) {
  const [mode, setMode] = useState<'profil' | 'scoate' | null>(null);
  const [reason, setReason] = useState('');
  const [profileId, setProfileId] = useState(currentProfileId ?? '');
  const [validTo, setValidTo] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const close = (): void => {
    setMode(null);
    setReason('');
    setError(undefined);
  };

  const submit = (): void => {
    void (async () => {
      setBusy(true);
      setError(undefined);
      const result =
        mode === 'profil'
          ? await changeInspectionProfile(linkId, profileId === '' ? null : profileId, reason)
          : await closeObjectiveLink(linkId, validTo, reason);
      setBusy(false);
      if (result.ok) {
        toast({ tone: 'success', title: t('form.saved') });
        close();
        router.refresh();
      } else {
        setError(result.message);
      }
    })();
  };

  return (
    <>
      <div className="flex justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={blockedReason !== undefined}
          disabledReason={blockedReason}
          onClick={() => {
            setMode('profil');
          }}
        >
          Profil
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={blockedReason !== undefined}
          disabledReason={blockedReason}
          onClick={() => {
            setMode('scoate');
          }}
        >
          Scoate
        </Button>
      </div>

      {mode === null ? null : (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) {
              close();
            }
          }}
          size="sm"
          title={
            mode === 'profil'
              ? `Profil de inspecție · ${objectiveName}`
              : `Scoate din contract · ${objectiveName}`
          }
          description={
            mode === 'profil'
              ? 'Profilul se schimbă pe legătura cu ACEST contract. Pe alte contracte obiectivul își păstrează frecvențele lui.'
              : 'Legătura nu se șterge — se închide la data aleasă. Istoricul obiectivului rămâne intact.'
          }
          footer={
            <>
              <Button variant="ghost" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" loading={busy} onClick={submit}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {error === undefined ? null : (
              <p className="rounded border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
                {error}
              </p>
            )}

            {mode === 'profil' ? (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink">Profil</span>
                <Select
                  id="profil"
                  value={profileId}
                  onChange={(event) => {
                    setProfileId(event.target.value);
                  }}
                  options={profiles}
                  placeholder="Fără profil"
                  invalid={false}
                />
              </label>
            ) : (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-ink">Iese din contract la</span>
                <DateInput
                  id="valid-to"
                  value={validTo}
                  onChange={(event) => {
                    setValidTo(event.target.value);
                  }}
                  invalid={false}
                />
              </label>
            )}

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Motivul</span>
              <Textarea
                id="motiv"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                placeholder="Obiectivul trece pe contractul 4701, de la 1 septembrie."
                invalid={false}
              />
              <span className="mt-1 block text-xs text-ink-subtle">
                Obligatoriu. Ajunge în audit trail.
              </span>
            </label>
          </div>
        </Dialog>
      )}
    </>
  );
}
