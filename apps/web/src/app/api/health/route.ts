import { checkHealth } from '@damina/services';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/health
 *
 * Intoarce 200 daca totul e verde, 503 daca ceva e cazut — ca un load balancer
 * sau un uptime monitor sa poata reactiona fara sa parseze corpul.
 */
export async function GET(): Promise<NextResponse> {
  const report = await checkHealth();
  return NextResponse.json(report, { status: report.status === 'ok' ? 200 : 503 });
}
