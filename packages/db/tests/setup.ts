import { inject } from 'vitest';

/**
 * Pointeaza pachetul catre containerul efemer. Ruleaza inainte de importurile
 * fisierelor de test, iar `client.ts` citeste variabilele abia la prima
 * conexiune — deci ordinea e sigura.
 */
const url = inject('databaseUrl');

process.env['DATABASE_URL'] = url;
process.env['DATABASE_URL_SESSION'] = url;
