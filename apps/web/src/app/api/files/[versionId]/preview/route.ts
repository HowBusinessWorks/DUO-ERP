import { can } from '@damina/auth';
import { previewUrl } from '@damina/services';
import { NextResponse } from 'next/server';
import { apiError } from '../../../../../lib/api-errors';
import { requireActor, requireSession } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Fisierul deschis IN PAGINA, nu salvat pe disc.
 *
 * Diferenta fata de `/api/files/[versionId]` e o singura litera de antet
 * (`inline` in loc de `attachment`), dar consecinta nu e mica — de aceea
 * dispozitia nu e un parametru al rutei, ci o decizie a serviciului, care o
 * acorda doar pozelor si PDF-urilor. Tipul cu care compara vine din magic bytes,
 * si e acoperit de semnatura.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ versionId: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  if (!can(session, 'files.read')) {
    return NextResponse.json({ error: 'Nu ai dreptul să vezi fișierele.' }, { status: 403 });
  }

  const { versionId } = await context.params;
  const actor = await requireActor();

  try {
    const target = await previewUrl(actor, versionId);
    return NextResponse.redirect(target.url, {
      status: 302,
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (error) {
    return apiError(error);
  }
}
