'use client';

import { roRO } from '@damina/i18n';
import { Banner, Button, Input } from '@damina/ui';
import { useActionState } from 'react';
import { changePassword, requestPasswordReset, signIn } from './actions';
import { EMPTY_FORM_STATE, type AuthFormState } from './form-state';

/**
 * Formularele de autentificare.
 *
 * Sunt componente de client dintr-un singur motiv: `useActionState`, care tine
 * eroarea si starea „se lucreaza” fara sa treaca prin URL. Un mesaj de eroare
 * pus in query string ramane acolo dupa refresh si ajunge in istoricul
 * browser-ului — pe un ecran de login, cu emailul langa el.
 *
 * Parola NU trece prin starea componentului: campurile sunt necontrolate, iar
 * valoarea pleaca direct in `FormData`.
 */

function FormError({ state }: { state: AuthFormState }) {
  if (state.error === null) {
    return null;
  }
  return <Banner tone="danger" title={state.error} dense className="rounded-md border" />;
}

const LABEL = 'block text-sm font-medium text-ink';
const FIELD = 'flex flex-col gap-1.5';

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />
      <input type="hidden" name="next" value={next} />

      <div className={FIELD}>
        <label className={LABEL} htmlFor="email">
          {roRO.auth.email}
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          invalid={state.error !== null}
        />
      </div>

      <div className={FIELD}>
        <label className={LABEL} htmlFor="password">
          {roRO.auth.password}
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          invalid={state.error !== null}
        />
      </div>

      <Button type="submit" loading={pending} className="mt-1 w-full">
        {pending ? roRO.auth.signingIn : roRO.auth.signIn}
      </Button>
    </form>
  );
}

export function ResetForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />
      {/* Linkul din email trebuie sa se intoarca pe ACEEASI origine de pe care
          a plecat cererea — altfel un mediu de test trimite oamenii in productie. */}
      <input
        type="hidden"
        name="origin"
        value={typeof window === 'undefined' ? '' : window.location.origin}
      />

      <div className={FIELD}>
        <label className={LABEL} htmlFor="reset-email">
          {roRO.auth.email}
        </label>
        <Input id="reset-email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>

      <Button type="submit" loading={pending} className="w-full">
        {roRO.auth.resetSend}
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, EMPTY_FORM_STATE);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />

      <div className={FIELD}>
        <label className={LABEL} htmlFor="new-password">
          {roRO.auth.newPassword}
        </label>
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          autoFocus
          invalid={state.error !== null}
        />
        <p className="text-xs text-ink-subtle">{roRO.auth.passwordRule}</p>
      </div>

      <div className={FIELD}>
        <label className={LABEL} htmlFor="confirm-password">
          {roRO.auth.confirmPassword}
        </label>
        <Input
          id="confirm-password"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          invalid={state.error !== null}
        />
      </div>

      <Button type="submit" loading={pending} className="w-full">
        {roRO.auth.changeSubmit}
      </Button>
    </form>
  );
}
