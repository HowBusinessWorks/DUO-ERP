import { can } from '@damina/auth';
import { downloadUrl } from '@damina/services';
import { NextResponse } from 'next/server';
import { apiError } from '../../../../lib/api-errors';
import { requireActor, requireSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Poarta de descarcare. NU exista niciodata un URL R2 direct in HTML-ul paginii.
 *
 * Verifica dreptul prin RLS, apoi emite un URL presemnat de 60 de secunde si
 * intoarce 302. `Content-Type` si `Content-Disposition` vin DIN BAZA si sunt
 * acoperite de semnatura: un HTML urcat ca „aviz.pdf" nu se poate servi ca HTML,
 * oricat ar insista clientul.
 *
 * Fereastra de 60 de secunde in care link-ul copiat functioneaza si din alt
 * browser e limitarea acceptata a modelului (verificarea #13 a pasului): e
 * pretul pentru „serverul nu vede byte-ii".
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ versionId: string }> },
): Promise<NextResponse> {
  const session = await requireSession();
  if (!can(session, 'files.read')) {
    return NextResponse.json({ error: 'Nu ai dreptul să descarci fișiere.' }, { status: 403 });
  }

  const { versionId } = await context.params;
  const actor = await requireActor();

  try {
    const target = await downloadUrl(actor, versionId);
    // `no-store`: redirect-ul contine un URL semnat cu viata scurta, deci un
    // proxy care l-ar pastra ar servi mai tarziu un link deja mort.
    return NextResponse.redirect(target.url, {
      status: 302,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
