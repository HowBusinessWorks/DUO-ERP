'use server';

import { revalidatePath } from 'next/cache';
import { writeContext } from '../../lib/context';

/**
 * Schimbarea contextului global (I8).
 *
 * `revalidatePath('/', 'layout')` si nu un tag: contextul de firma si de luna
 * intra in TOATE interogarile de sub el, inclusiv in badge-urile din sidebar si
 * in bannerul de luna inchisa. O invalidare partiala ar lasa shell-ul pe firma
 * veche cat timp continutul e deja pe cea noua — exact contradictia pe care I8
 * o interzice.
 */

export async function setSelectedCompanies(companyIds: readonly string[]): Promise<void> {
  await writeContext({ companyIds });
  revalidatePath('/', 'layout');
}

export async function setConsolidation(mode: 'consolidated' | 'gross'): Promise<void> {
  await writeContext({ consolidation: mode });
  revalidatePath('/', 'layout');
}

export async function setPeriod(year: number, month: number): Promise<void> {
  await writeContext({ year, month });
  revalidatePath('/', 'layout');
}
