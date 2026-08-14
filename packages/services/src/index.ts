/**
 * Use-case-uri: orchestreaza `domain` + `db` + `jobs` + `storage`.
 *
 * E singurul strat care are voie sa deschida tranzactii. Un use-case = o
 * tranzactie = o unitate atomica. Cand un job trebuie lansat impreuna cu o
 * mutatie, enqueue-ul intra in aceeasi tranzactie — daca ea da rollback,
 * jobul dispare cu ea.
 *
 * In pasul 01 exista doar verificarea de sanatate. Use-case-urile de business
 * vin in pasii 04-10.
 */
export { checkHealth } from './health';
export type { HealthReport, ComponentStatus } from './health';
