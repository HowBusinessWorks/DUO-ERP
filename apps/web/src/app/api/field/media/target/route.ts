import { can } from '@damina/auth';
import { photoFolderFor } from '@damina/services';
import { NextResponse } from 'next/server';
import { apiError } from '../../../../../lib/api-errors';
import { requireActor, requireSession } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Unde se duce o poza de teren: unitate de lucru → folder.
 *
 * Exista fiindca telefonul nu poate sti id-uri de foldere. Poza se face in
 * subsol, cu reteaua cazuta; ce retine ecranul e unitatea de lucru si faza. Abia
 * la urcare — deci oricand exista retea — se afla folderul.
 *
 * Route handler si nu server action, ca tot ce tine de upload: uploaderul de
 * poze e o bucla de client care trebuie sa poata chema asta intre doua poze,
 * fara sa reincarce nimic.
 *
 * Ce NU face: nu creeaza foldere. Arborele unei unitati e construit de trigger
 * la creare (`app.build_work_unit_folders`), iar un folder aparut din teren ar
 * fi insemnat ca poza a aterizat langa restul, nu in el.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await requireSession();
  if (!can(session, 'files.write')) {
    return NextResponse.json({ error: 'Nu ai dreptul să încarci fișiere.' }, { status: 403 });
  }

  const actor = await requireActor();

  try {
    const body = (await request.json()) as {
      workUnitId?: unknown;
      phase?: unknown;
    };
    if (typeof body.workUnitId !== 'string' || body.workUnitId === '') {
      return NextResponse.json({ error: 'Lipsește unitatea de lucru.' }, { status: 400 });
    }
    const phase = body.phase === 'inainte' || body.phase === 'dupa' ? body.phase : undefined;

    const parentId = await photoFolderFor(actor, body.workUnitId, phase);
    if (parentId === null) {
      // RLS-ul a raspuns „nimic": ori unitatea nu e a mea, ori n-are arbore.
      // Mesajul e acelasi dinadins — nu confirmam existenta unei unitati straine.
      return NextResponse.json(
        { error: 'Unitatea de lucru nu are folder de poze.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ parentId });
  } catch (error) {
    return apiError(error);
  }
}
