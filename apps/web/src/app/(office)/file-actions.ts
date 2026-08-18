'use server';

import { can } from '@damina/auth';
import {
  createFolderInputSchema,
  moveNodeInputSchema,
  renameNodeInputSchema,
} from '@damina/contracts';
import { createFolder, moveNode, renameNode, restoreNode, trashNode } from '@damina/services';
import { z } from 'zod';
import { createAction, type ActionResult } from '../../lib/action';
import { requireSession } from '../../lib/session';

/**
 * Cele cinci apasari din arborele de fisiere: folder nou, redenumire, mutare,
 * stergere, restaurare.
 *
 * Toate cinci sunt scrieri de STRUCTURA, deci trec prin server actions. Uploadul
 * si descarcarea NU sunt aici, ci in `/api/files/*`: byte-ii nu trec niciodata
 * prin server, iar clientul are nevoie de `AbortController` si de progres per
 * parte, lucruri pe care un server action nu le poate da.
 *
 * Poarta e dubla, ca peste tot: `files.write` aici, pentru un mesaj in romana,
 * si politicile RLS in baza, care sunt cele care chiar apara. Un nod pe care
 * omul nu are voie sa-l atinga nu e „refuzat" de codul asta — pur si simplu nu
 * exista pentru el, si `update`-ul atinge zero randuri.
 */

const nodeIdSchema = z.object({ nodeId: z.string().uuid() });

async function guard(): Promise<ActionResult<never> | undefined> {
  const session = await requireSession();
  if (!can(session, 'files.write')) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Rolul tău nu poate modifica fișiere.',
    };
  }
  return undefined;
}

export async function createFolderAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied !== undefined) {
    return denied;
  }
  return createAction({
    schema: createFolderInputSchema,
    run: async (actor, _values, rawInput) => createFolder(actor, rawInput as never),
  })(raw);
}

export async function renameNodeAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied !== undefined) {
    return denied;
  }
  return createAction({
    schema: renameNodeInputSchema,
    reason: 'redenumire nod de fișiere',
    run: async (actor, _values, rawInput) => renameNode(actor, rawInput as never),
  })(raw);
}

export async function moveNodeAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied !== undefined) {
    return denied;
  }
  return createAction({
    schema: moveNodeInputSchema,
    reason: 'mutare nod de fișiere',
    run: async (actor, _values, rawInput) => moveNode(actor, rawInput as never),
  })(raw);
}

export async function trashNodeAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied !== undefined) {
    return denied;
  }
  return createAction({
    schema: nodeIdSchema,
    reason: 'ștergere în coșul de gunoi',
    run: async (actor, values) => trashNode(actor, values.nodeId),
  })(raw);
}

export async function restoreNodeAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard();
  if (denied !== undefined) {
    return denied;
  }
  return createAction({
    schema: nodeIdSchema,
    reason: 'restaurare din coșul de gunoi',
    run: async (actor, values) => restoreNode(actor, values.nodeId),
  })(raw);
}
