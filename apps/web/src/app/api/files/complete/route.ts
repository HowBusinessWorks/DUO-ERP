import { can } from '@damina/auth';
import { completeUpload } from '@damina/services';
import { NextResponse } from 'next/server';
import { apiError } from '../../../../lib/api-errors';
import { requireActor, requireSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Inchide uploadul, si abia aici se verifica ce a ajuns efectiv in R2:
 * `ContentLength` real, magic bytes, suma de control. Ce cade la oricare dintre
 * ele nu ramane pe jumatate — blobul se sterge si versiunea nu devine niciodata
 * cea curenta.
 *
 * Pana la apelul asta, fisierul exista in R2 dar NU e vizibil nicaieri in
 * aplicatie: nodul nu are `current_version_id`, iar versiunea e `uploading`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireSession();
  if (!can(session, 'files.write')) {
    return NextResponse.json({ error: 'Nu ai dreptul să încarci fișiere.' }, { status: 403 });
  }

  const actor = await requireActor('finalizare upload');

  try {
    const body: unknown = await request.json();
    return NextResponse.json(await completeUpload(actor, body as never));
  } catch (error) {
    return apiError(error);
  }
}
