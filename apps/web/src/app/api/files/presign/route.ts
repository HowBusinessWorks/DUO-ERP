import { can } from '@damina/auth';
import { presignUpload } from '@damina/services';
import { NextResponse } from 'next/server';
import { apiError } from '../../../../lib/api-errors';
import { requireActor, requireSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Deschide un upload: intoarce `uploadId` si cate un URL presemnat per parte.
 *
 * Route Handler, nu server action, din doua motive care conteaza pe santier:
 * clientul are nevoie de `AbortController` ca sa poata renunta la un upload de
 * 200 MB, si de progres per parte. Server actions n-au nici una, nici alta.
 *
 * Ruta isi cheama singura `can()`: middleware-ul nu redirectioneaza `/api`
 * dinadins — un `fetch` ar urma redirect-ul si ar incerca sa citeasca JSON
 * dintr-o pagina HTML — deci poarta e aici.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireSession();
  if (!can(session, 'files.write')) {
    return NextResponse.json({ error: 'Nu ai dreptul să încarci fișiere.' }, { status: 403 });
  }

  const actor = await requireActor();

  try {
    const body: unknown = await request.json();
    return NextResponse.json(await presignUpload(actor, body as never));
  } catch (error) {
    return apiError(error);
  }
}
