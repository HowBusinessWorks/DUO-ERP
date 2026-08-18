import { can } from '@damina/auth';
import { folderForEntity } from '@damina/services';
import { EmptyState } from '@damina/ui';
import { FolderX } from 'lucide-react';
import { FileExplorer } from './file-explorer';
import type { EntityContext } from '../../registry/types';

/**
 * Tab-ul `Documente` al oricarei entitati.
 *
 * Arata EXACT folderul entitatii, nu un filtru peste tot arborele. Diferenta se
 * vede cand cineva muta un fisier: intr-un filtru ar disparea din vedere fara sa
 * se fi mutat nimic, iar aici se muta chiar folderul.
 *
 * Folderul se cauta pe `node_role` plus cheile entitatii, niciodata pe nume — e
 * regula arborelui de la 07a, si e motivul pentru care redenumirea unui folder
 * afisat nu strica nimic.
 *
 * Nodul deschis vine din segmentele de dupa slugul tab-ului
 * (`/activitate/{id}/documente/{nod}`): pagina fractala nu primeste
 * `searchParams`, dar primeste `sub` — exact pentru desfaceri ca asta.
 */
export async function EntityDocuments({
  ctx,
  scope,
  role,
  basePath,
  sub,
  notice,
}: {
  readonly ctx: EntityContext;
  readonly scope: {
    readonly contractId?: string;
    readonly objectiveId?: string;
    readonly workUnitId?: string;
    readonly stageId?: string;
  };
  readonly role: string;
  /** Ruta tab-ului, fara nod: `/activitate/{id}/documente`. */
  readonly basePath: string;
  readonly sub: readonly string[];
  readonly notice?: string;
}) {
  const rootId = await folderForEntity(ctx.actor, scope, role);

  if (rootId === null) {
    return (
      <EmptyState
        icon={<FolderX className="size-5" aria-hidden="true" />}
        title="Nu există încă un folder"
        body="Folderul se creează prin trigger, în aceeași tranzacție cu entitatea. Dacă lipsește, înregistrarea e dinaintea pasului 07 și are nevoie de backfill."
      />
    );
  }

  return (
    <FileExplorer
      actor={ctx.actor}
      rootId={rootId}
      nodeId={sub[0]}
      href={(id) => (id === rootId ? basePath : `${basePath}/${id}`)}
      canWrite={can(ctx.session, 'files.write')}
      notice={notice}
    />
  );
}
