/**
 * Coduri de eroare stabile. Sunt parte din contractul aplicatiei: UI-ul si
 * aplicatia de teren se ramifica pe ele, deci nu se redenumesc, doar se adauga.
 */
export const APP_ERROR_CODES = [
  /** Perioada contabila e inchisa — modificarea e refuzata de trigger-ul din DB. */
  'PERIOD_CLOSED',
  /** Persona curenta nu are voie sa vada sau sa scrie coloane de pret. */
  'PRICE_FORBIDDEN',
  /** Autorizatia / imputernicirea folosita a expirat. */
  'AUTHORIZATION_EXPIRED',
  /** Cantitatea depaseste ce permite contractul sau plafonul. */
  'QUANTITY_EXCEEDS_CONTRACT',
  /** Datele de intrare nu trec schema Zod sau o regula de domeniu. */
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'FORBIDDEN',
  /** Conflict de stare: alt actor a modificat intre timp, sau incalcare de unicitate. */
  'CONFLICT',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/**
 * Eroare asteptata, cu cod stabil si payload structurat.
 *
 * Erorile *neasteptate* raman `Error` obisnuit si urca pana la handler-ul global.
 * `AppError` inseamna "stiam ca se poate intampla si avem ce sa-i spunem omului".
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly payload: Readonly<Record<string, unknown>>;

  constructor(code: AppErrorCode, message?: string, payload: Record<string, unknown> = {}) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.payload = Object.freeze({ ...payload });
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static is(value: unknown): value is AppError {
    return value instanceof AppError;
  }

  static periodClosed(periodKey: string): AppError {
    return new AppError('PERIOD_CLOSED', `Perioada ${periodKey} este inchisa.`, { periodKey });
  }

  static notFound(entity: string, id?: string): AppError {
    return new AppError('NOT_FOUND', `${entity} inexistent.`, id === undefined ? {} : { id });
  }

  static forbidden(reason?: string): AppError {
    return new AppError('FORBIDDEN', reason ?? 'Acces interzis.');
  }

  static validation(details: Record<string, unknown>): AppError {
    return new AppError('VALIDATION_FAILED', 'Datele trimise nu sunt valide.', details);
  }

  toJSON(): { code: AppErrorCode; message: string; payload: Record<string, unknown> } {
    return { code: this.code, message: this.message, payload: { ...this.payload } };
  }
}
