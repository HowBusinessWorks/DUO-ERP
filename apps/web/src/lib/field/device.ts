/**
 * Identitatea dispozitivului (pasul 10, §3.2).
 *
 * **Nu e sesiunea, și nu e omul.** Ordinea cozii de mutații e per dispozitiv:
 * două telefoane ale aceluiași om au cozi și cursoare independente, iar cel
 * lăsat în mașină o săptămână n-are voie să creadă că a primit ce a primit
 * celălalt.
 *
 * Trăiește în `localStorage`, nu într-un cookie: un cookie pleacă la fiecare
 * cerere, expiră și poate fi șters de politici de browser care n-au nicio treabă
 * cu ce încearcă să facă asta. Aici e o etichetă lipită pe telefon.
 */

const KEY = 'damina.field.deviceId';

/** Id-ul telefonului. Se creează la prima folosire și rămâne. */
export function deviceId(): string {
  if (typeof localStorage === 'undefined') {
    // Randare pe server: nu există dispozitiv, și nici nu trebuie. Valoarea nu
    // ajunge niciodată într-o cerere reală — codul de sincronizare rulează doar
    // în browser.
    return 'server';
  }

  const existing = localStorage.getItem(KEY);
  if (existing !== null && existing !== '') {
    return existing;
  }

  const created = crypto.randomUUID();
  localStorage.setItem(KEY, created);
  return created;
}

/**
 * Uită dispozitivul. Următorul pull e complet.
 *
 * Există pentru depanare: e echivalentul de pe telefon al ștergerii cursorului
 * din `app.sync_cursors`, descris în `docs/field-sync.md`.
 */
export function forgetDevice(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(KEY);
  }
}
