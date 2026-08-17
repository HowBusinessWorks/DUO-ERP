'use client';

import { roRO } from '@damina/i18n';
import { Banner, Button, Input } from '@damina/ui';
import { useActionState, useState, type ReactNode } from 'react';
import { verifyMfaCode } from './actions';
import { EMPTY_FORM_STATE, type AuthFormState } from './form-state';

/**
 * Ecranele verificarii in doi pasi (TOTP).
 *
 * Doua formulare pe aceeasi actiune: unul la prima configurare (cu QR si cheie
 * manuala), unul la fiecare login ulterior (doar codul). Sunt componente de
 * client din acelasi motiv ca `forms.tsx`: `useActionState` tine eroarea in
 * memorie, nu in URL — un cod gresit nu are ce cauta in istoricul browser-ului.
 *
 * Titlul si textul introductiv sunt randate de pagina; aici incepe direct
 * continutul.
 */

function FormError({ state }: { state: AuthFormState }) {
  if (state.error === null) {
    return null;
  }
  return <Banner tone="danger" title={state.error} dense className="rounded-md border" />;
}

const LABEL = 'block text-sm font-medium text-ink';
const FIELD = 'flex flex-col gap-1.5';

/** Bulina cu numarul pasului. Ordinea conteaza: nu poti scrie codul inainte sa scanezi. */
function StepNumber({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700"
    >
      {n}
    </span>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <StepNumber n={n} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Campul de cod. Identic pe ambele ecrane — sase cifre, tastatura numerica pe
 * telefon si completare automata din SMS/aplicatie acolo unde sistemul o ofera.
 */
function CodeField({ id, invalid }: { id: string; invalid: boolean }) {
  return (
    <div className={FIELD}>
      <label className={LABEL} htmlFor={id}>
        {roRO.mfa.code}
      </label>
      <Input
        id={id}
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
        invalid={invalid}
        className="text-center indent-[0.35em] font-mono text-base tracking-[0.35em]"
      />
      <p className="text-xs text-ink-subtle">{roRO.mfa.codeHint}</p>
    </div>
  );
}

/** Cheia bruta e un sir lung fara spatii; in grupe de patru se poate citi de pe ecran. */
function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(' ');
}

function SecretBlock({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // Se copiaza cheia bruta, nu varianta cu spatii de pe ecran.
    void navigator.clipboard
      .writeText(secret)
      .then(() => {
        setCopied(true);
      })
      .catch(() => {
        setCopied(false);
      });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p id="mfa-secret-label" className="text-xs text-ink-muted">
        {roRO.mfa.secretLabel}
      </p>
      <div className="flex items-start gap-1.5 rounded-md border border-border bg-surface-sunken p-2">
        <code className="min-w-0 flex-1 font-mono text-xs leading-5 break-all text-ink select-all">
          {groupSecret(secret)}
        </code>
        <Button
          variant="ghost"
          size="icon"
          onClick={copy}
          aria-labelledby="mfa-secret-label"
          className="-my-0.5"
          icon={copied ? <CheckIcon /> : <CopyIcon />}
        />
      </div>
      <p aria-live="polite" className="text-xs text-success-700">
        {copied ? roRO.mfa.secretCopied : ''}
      </p>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true" focusable="false">
      <rect
        x="5.75"
        y="5.75"
        width="8.5"
        height="8.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10.25 3.75A1.5 1.5 0 0 0 8.75 2.25h-5.5A1.5 1.5 0 0 0 1.75 3.75v5.5a1.5 1.5 0 0 0 1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true" focusable="false">
      <path
        d="M3 8.5 6.25 11.75 13 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MfaEnrollForm({
  factorId,
  qrCode,
  secret,
}: {
  readonly factorId: string;
  readonly qrCode: string;
  readonly secret: string;
}) {
  const [state, action, pending] = useActionState(verifyMfaCode, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-5">
      <FormError state={state} />
      <input type="hidden" name="factorId" value={factorId} />

      <Step n={1}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">{roRO.mfa.enrollStep1}</p>

          {/* Codul QR pe fundal alb, cu chenar: fundalul paginii e usor racit, iar
              unele aplicatii de scanare pierd contrastul pe gri. */}
          <div className="self-center rounded-md border border-border bg-surface p-3 shadow-xs">
            {/*
              `<img>`, nu `next/image`: sursa e un data URI cu SVG-ul pe care il
              intoarce GoTrue, deci nu exista nicio cerere de retea de optimizat
              si niciun fisier de servit. Trecut prin optimizator, ar fi devenit
              un round-trip in plus pentru o imagine deja in pagina.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrCode} alt="Cod QR pentru aplicația de autentificare" className="size-40" />
          </div>

          <p className="text-xs text-ink-subtle">{roRO.mfa.enrollApps}</p>

          <SecretBlock secret={secret} />
        </div>
      </Step>

      <Step n={2}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink">{roRO.mfa.enrollStep2}</p>
          <CodeField id="mfa-enroll-code" invalid={state.error !== null} />
        </div>
      </Step>

      <Button type="submit" variant="primary" loading={pending} className="w-full">
        {pending ? roRO.mfa.verifying : roRO.mfa.verify}
      </Button>
    </form>
  );
}

export function MfaChallengeForm({ factorId }: { readonly factorId: string }) {
  const [state, action, pending] = useActionState(verifyMfaCode, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />
      <input type="hidden" name="factorId" value={factorId} />

      <CodeField id="mfa-challenge-code" invalid={state.error !== null} />

      <Button type="submit" variant="primary" loading={pending} className="w-full">
        {pending ? roRO.mfa.verifying : roRO.mfa.verify}
      </Button>

      {/* Omul fara telefon trebuie sa afle pe loc pe cine suna, nu dupa a treia incercare. */}
      <p className="border-t border-border pt-3 text-xs text-ink-subtle">{roRO.mfa.lockedOut}</p>
    </form>
  );
}
