import { AppError } from '@damina/shared';
import { NextResponse } from 'next/server';

/**
 * Traduce o eroare de use-case in raspuns HTTP.
 *
 * Stă aici, nu in fisierele de ruta: App Router accepta doar handlere si
 * configurare exportate dintr-un `route.ts`, iar un export in plus e eroare de
 * build.
 *
 * Ce NU face: nu inventeaza un mesaj pentru erorile neasteptate. Alea se
 * re-arunca si ajung la handler-ul global, care le logheaza. Un `catch` care
 * transforma orice in „a apărut o eroare" e felul cel mai sigur de a nu afla
 * niciodata ce s-a stricat.
 */
const STATUS: Readonly<Partial<Record<string, number>>> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  PRICE_FORBIDDEN: 403,
  CONFLICT: 409,
  PERIOD_CLOSED: 409,
};

export function apiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      {
        status: STATUS[error.code] ?? 400,
      },
    );
  }
  throw error;
}
