/**
 * Starea formularelor de autentificare.
 *
 * Sta separat de `actions.ts` pentru ca un fisier `'use server'` nu are voie sa
 * exporte decat functii asincrone — orice altceva devine eroare la build. Nu e o
 * subtilitate de framework fara rost: tot ce se exporta dintr-un fisier de
 * server actions capata un endpoint, si o constanta nu poate fi chemata prin
 * retea.
 */
export interface AuthFormState {
  readonly error: string | null;
}

export const EMPTY_FORM_STATE: AuthFormState = { error: null };
