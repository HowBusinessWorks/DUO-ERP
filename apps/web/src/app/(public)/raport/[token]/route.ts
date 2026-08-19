import { readPublicReport } from '@damina/services';
import { getObjectBytes } from '@damina/storage';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Raportul lunar deschis de client prin link tokenizat, fara cont (§3.6, #25).
 *
 * Ruta serveste **artefactul inghetat**, byte cu byte, asa cum l-a scris jobul
 * in arhiva. Nu recompune raportul din baza de date, si asta e chiar rostul ei:
 * o fisa corectata luna urmatoare n-are cum sa schimbe ce citeste clientul in
 * linkul primit (#23). Ce s-a schimbat apare in raportul lunii urmatoare, ca
 * ajustare.
 *
 * E ruta, nu pagina React, tocmai ca documentul sa plece intreg — cu antetul,
 * stilurile si structura lui —, nu turnat intr-un layout care i-ar schimba
 * infatisarea de la o versiune de aplicatie la alta.
 *
 * `X-Frame-Options: DENY` si `Content-Security-Policy` restrictiv: documentul
 * are stil inline, dar n-are voie sa execute nimic. `img-src` include `https:`
 * pentru ca poza pleaca prin ruta noastra si ajunge, prin redirect semnat, pe
 * R2 — CSP judeca URL-ul final, nu pe cel cerut.
 * Tokenul e autorizarea, deci pagina se comporta ca un document, nu ca o
 * aplicatie.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;
  const version = await readPublicReport(token);

  if (version === null) {
    return notice(404, 'Link invalid', 'Adresa nu corespunde niciunui raport.');
  }

  if (version.expired) {
    return notice(
      410,
      'Linkul a expirat',
      'Raportul a fost emis acum mai bine de șase luni. Cere o copie persoanei de contact din contract.',
    );
  }

  const bytes = await getObjectBytes('archive', version.archiveKey);

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}

function notice(status: number, title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:24px;font:15px/1.5 system-ui,sans-serif">
<h1 style="font-size:20px">${title}</h1><p style="color:#5b6472">${body}</p></body></html>`;

  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
