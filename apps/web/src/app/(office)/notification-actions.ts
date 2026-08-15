'use server';

import { markAllNotificationsRead, markNotificationRead } from '@damina/services';
import { revalidatePath } from 'next/cache';
import { requireActor, requireSession } from '../../lib/session';

export async function markRead(id: string): Promise<void> {
  const actor = await requireActor();
  await markNotificationRead(actor, id);
  revalidatePath('/', 'layout');
}

export async function markAllRead(): Promise<void> {
  const session = await requireSession();
  const actor = await requireActor();
  await markAllNotificationsRead(actor, session.personId);
  revalidatePath('/', 'layout');
}
