/**
 * Payload-ul unui access token, fara verificare de semnatura.
 *
 * De ce e sigur asa: functia se cheama DOAR dupa ce `supabase.auth.getUser()`
 * a intrebat serverul Auth daca token-ul e valid. Un al doilea loc care verifica
 * semnatura ar insemna doua raspunsuri posibile la aceeasi intrebare, si nu ne
 * dorim sa aflam intr-o zi care din ele minte.
 *
 * Ce ne trebuie de aici sunt claim-urile custom puse de
 * `app.custom_access_token_hook` — ele exista in token, nu in obiectul `user`
 * intors de GoTrue.
 */
export function decodeAccessTokenClaims(accessToken: string): unknown {
  const parts = accessToken.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) {
    return null;
  }

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    // `atob` da octeti, nu caractere: numele cu diacritice s-ar strica fara
    // trecerea prin UTF-8.
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
