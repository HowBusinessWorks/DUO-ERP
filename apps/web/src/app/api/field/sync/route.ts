import { canWriteSheets } from '@damina/auth';
import { pullSyncInputSchema, pushMutationsInputSchema } from '@damina/contracts';
import { markPulled, pushMutations, readCursor } from '@damina/services';
import { NextResponse, type NextRequest } from 'next/server';
import { apiError } from '../../../../lib/api-errors';
import { fieldSyncLimiter } from '../../../../lib/field-sync-limits';
import { requireActor, requireSession } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * `/api/field/sync` — singura poartă a aplicației de teren (pasul 10, §3.2).
 *
 * `GET` întoarce cursorul dispozitivului; `POST` urcă lotul de mutații. Ruta își
 * verifică singură sesiunea și dreptul, ca toate rutele `/api`: middleware-ul
 * nu redirectează `/api` dinadins — un `fetch` care primește 307 către HTML îl
 * urmează și încearcă să citească JSON dintr-o pagină.
 *
 * Limitarea de rată e pe **(persoană, dispozitiv)**, nu pe IP: un telefon în
 * roaming își schimbă adresa între două cereri, iar o limită pe IP ar fi oprit
 * exact omul care are semnal prost — adică pe cel pentru care există tot pasul
 * ăsta.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (!canWriteSheets(session)) {
    return NextResponse.json(
      { error: 'Rolul tău nu poate trimite fișe de pe teren.', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  const body: unknown = await request.json();
  const parsed = pushMutationsInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Lotul de mutații nu e valid.',
        code: 'VALIDATION_FAILED',
      },
      { status: 400 },
    );
  }

  const verdict = fieldSyncLimiter.hit(`${session.personId}:${parsed.data.deviceId}`);
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error: 'Prea multe sincronizări într-un timp scurt. Se reia singură.',
        code: 'RATE_LIMITED',
      },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(verdict.retryAfterMs / 1000)) } },
    );
  }

  try {
    const actor = await requireActor('sincronizare de teren');
    const result = await pushMutations(actor, parsed.data);

    /*
     * 200 chiar și când coada s-a oprit: lotul a fost PRIMIT și procesat, iar
     * rezultatul fiecărei mutații e în corp. Un 4xx aici ar fi spus clientului
     * „n-am înțeles cererea", și l-ar fi pus să retrimită tot lotul — inclusiv
     * mutațiile deja aplicate.
     */
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

/** Cursorul dispozitivului. `null` = n-a sincronizat niciodată → pull complet. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession();
  if (!canWriteSheets(session)) {
    return NextResponse.json({ error: 'Fără acces.', code: 'FORBIDDEN' }, { status: 403 });
  }

  const parsed = pullSyncInputSchema.safeParse({
    deviceId: request.nextUrl.searchParams.get('deviceId') ?? '',
    since: request.nextUrl.searchParams.get('since') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Dispozitivul trebuie identificat.', code: 'VALIDATION_FAILED' },
      { status: 400 },
    );
  }

  try {
    const actor = await requireActor();
    const current = await readCursor(actor, parsed.data.deviceId);
    const next = await markPulled(actor, parsed.data.deviceId);

    return NextResponse.json({
      /** Cursorul de DINAINTE: el spune de unde s-a cerut felia. */
      since: current?.cursor ?? null,
      cursor: next.cursor,
      /** Felia propriu-zisă sosește cu 10b, odată cu snapshot-ul din Dexie. */
      full: current === null,
    });
  } catch (error) {
    return apiError(error);
  }
}
