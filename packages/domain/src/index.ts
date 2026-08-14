/**
 * Reguli de business pure. Fara I/O, fara baza de date, fara retea.
 *
 * Regula de dependente (verificata de eslint-plugin-boundaries, blocanta in CI):
 * `domain` poate importa DOAR `shared`. Nu are voie sa vada `db`.
 *
 * Motivul: calculul de plafon, decizia de rutare, mecanica de re-alocare si CMP
 * trebuie sa fie testabile in milisecunde, fara sa porneasca un Postgres.
 *
 * Continutul propriu-zis vine in pasii 04-09.
 */

export const DOMAIN_PACKAGE_READY = true;
