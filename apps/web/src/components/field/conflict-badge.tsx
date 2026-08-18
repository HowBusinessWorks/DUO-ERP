'use client';

import { CountBadge } from '@damina/ui';
import Link from 'next/link';
import { useSync } from './sync-provider';

/**
 * Contorul de conflicte din antet.
 *
 * Nu apare cand nu e nimic — o pastila „0" invata omul s-o ignore, si atunci
 * n-o mai vede nici cand devine 1.
 */
export function ConflictBadge() {
  const { blocked } = useSync();

  if (blocked === 0) {
    return null;
  }

  return (
    <Link href="/field/conflicte" aria-label={`${String(blocked)} de rezolvat`}>
      <CountBadge count={blocked} label="de rezolvat" tone="danger" />
    </Link>
  );
}
