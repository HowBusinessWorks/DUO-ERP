import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { CHANGE_PASSWORD_PATH, LOGIN_PATH } from '../../../../lib/personas';
import { supabaseServer } from '../../../../lib/supabase/server';

/**
 * Aterizarea linkurilor trimise de Supabase Auth pe email (resetare de parola,
 * confirmare de adresa).
 *
 * Linkul poarta un `token_hash` de unica folosinta; aici se schimba pe o
 * sesiune, iar apoi omul e dus unde trebuie. Codul NU ajunge niciodata intr-o
 * pagina randata: ar ramane in istoricul browser-ului si in `Referer`.
 */
const ALLOWED_TYPES: readonly EmailOtpType[] = ['recovery', 'email', 'invite', 'magiclink'];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  const next = params.get('next');

  if (tokenHash === null || type === null || !ALLOWED_TYPES.includes(type as EmailOtpType)) {
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });

  if (error !== null) {
    // Link expirat sau deja folosit. Ecranul de login are drumul catre o noua
    // cerere de resetare.
    return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  }

  const target =
    next !== null && next.startsWith('/') && !next.startsWith('//') ? next : CHANGE_PASSWORD_PATH;

  return NextResponse.redirect(new URL(target, request.url));
}
