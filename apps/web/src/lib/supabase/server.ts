import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { requireSupabaseConfig } from './config';

/**
 * Clientul Supabase al unei cereri, pe server.
 *
 * Cookie-urile de sesiune sunt `httpOnly` + `secure` + `sameSite=lax` (§3.5):
 * token-ul nu e vizibil din JavaScript-ul paginii, deci un XSS nu-l poate fura.
 * Consecinta directa e ca autentificarea se face prin server actions, nu din
 * browser — clientul de browser n-ar avea ce citi.
 *
 * `supabase-js` se foloseste NUMAI pentru auth. Datele merg prin Drizzle, cu
 * rolul de persona potrivit (§3.5, regula 6).
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const config = requireSupabaseConfig();
  const store = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(items: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const item of items) {
            store.set(item.name, item.value, {
              ...item.options,
              httpOnly: true,
              sameSite: 'lax',
              secure: process.env.NODE_ENV === 'production',
              path: '/',
            });
          }
        } catch {
          // Un Server Component nu poate scrie cookie-uri. Nu e o problema:
          // reimprospatarea token-ului se face in middleware, care poate, iar
          // aici tot ce ratam e o scriere pe care middleware-ul o repeta la
          // urmatoarea cerere. Fara `catch`, randarea ar cadea la fiecare
          // token expirat.
        }
      },
    },
  });
}
