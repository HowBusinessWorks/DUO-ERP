import { resolvePublicReportPhoto } from '@damina/services';
import { presignGet } from '@damina/storage';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * O poza din raportul web, servita clientului fara cont.
 *
 * Autorizarea e tokenul RAPORTULUI, iar poza trebuie sa fie dintre cele incluse
 * in versiunea lui — verificarea se face in serviciu, pe `included_work_unit_
 * ids`. Fara ea, un token de raport ar fi devenit o cheie catre orice fisier din
 * ERP, cu un id ghicit.
 *
 * Se serveste ca redirect semnat de scurta durata, ca la descarcarea din birou:
 * serverul nu vede octetii, iar linkul copiat moare in cateva minute.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; versionId: string }> },
): Promise<NextResponse> {
  const { token, versionId } = await context.params;

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(versionId)) {
    return new NextResponse(null, { status: 404 });
  }

  const photo = await resolvePublicReportPhoto(token, versionId);
  if (photo === null) {
    return new NextResponse(null, { status: 404 });
  }

  const url = await presignGet('docs', photo.blobKey, {
    contentType: photo.mime,
    disposition: 'inline',
    ttlSeconds: 300,
  });

  return NextResponse.redirect(url, {
    status: 302,
    headers: { 'Cache-Control': 'private, max-age=120' },
  });
}
