import { searchEverything, type SearchGroup } from '@damina/services';
import { NextResponse } from 'next/server';
import { requireActor } from '../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Sursa de date a casetei Ctrl+K.
 *
 * Route Handler si nu server action: e o citire pura, apelata la fiecare tasta,
 * care are nevoie de `AbortController` din browser. Server actions nu se pot
 * anula, deci raspunsurile ar sosi in dezordine si caseta ar clipi.
 *
 * Prefixele care nu ating baza de date (`/` navigare, `>` comanda) se rezolva
 * in browser si nu ajung niciodata aici.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').trim();

  if (query.length < 2) {
    return NextResponse.json({ hits: [] });
  }

  const actor = await requireActor();

  // `@` cauta doar persoane; restul prefixelor isi vor grupurile in pasii care
  // aduc entitatile (cereri la 08, lucrari la 05).
  let only: readonly SearchGroup[] | undefined;
  let needle = query;
  if (query.startsWith('@')) {
    only = ['persons'];
    needle = query.slice(1);
  }

  if (needle.trim().length < 2) {
    return NextResponse.json({ hits: [] });
  }

  const hits = await searchEverything(actor, needle, only === undefined ? {} : { only });
  return NextResponse.json({ hits });
}
