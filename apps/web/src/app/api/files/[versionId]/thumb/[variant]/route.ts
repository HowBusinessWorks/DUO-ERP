import { can } from '@damina/auth';
import { thumbnailUrl } from '@damina/services';
import { NextResponse } from 'next/server';
import { apiError } from '../../../../../../lib/api-errors';
import { requireActor, requireSession } from '../../../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Miniaturile. Aceeasi poarta ca descarcarea, cu doua diferente care vin din
 * felul in care sunt folosite: `inline` (se vad in pagina) si TTL mai lung — o
 * galerie de 300 de poze ar cere altfel 300 de semnaturi la fiecare derulare.
 *
 * `404` inseamna „inca nu e gata", nu „nu exista": worker-ul le produce dupa
 * upload, iar galeria stie sa arate un substituent pana atunci.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ versionId: string; variant: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  if (!can(session, 'files.read')) {
    return NextResponse.json({ error: 'Nu ai dreptul să vezi fișierele.' }, { status: 403 });
  }

  const { versionId, variant } = await context.params;
  const actor = await requireActor();

  try {
    const target = await thumbnailUrl(actor, versionId, variant);
    if (target === null) {
      return NextResponse.json({ error: 'Miniatura nu e gata încă.' }, { status: 404 });
    }
    return NextResponse.redirect(target.url, {
      status: 302,
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (error) {
    return apiError(error);
  }
}
