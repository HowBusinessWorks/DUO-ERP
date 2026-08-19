'use client';

import { t } from '@damina/i18n';
import { nodeNameSchema } from '@damina/contracts';
import { Button, Dialog, Field, Form, Input, Select, useToast } from '@damina/ui';
import { FolderPlus, FolderSymlink, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import {
  createFolderAction,
  moveNodeAction,
  renameNodeAction,
  restoreNodeAction,
  trashNodeAction,
} from '../../app/(office)/file-actions';
import type { ActionResult } from '../../lib/action';

/**
 * Apasarile din arborele de fisiere: folder nou, redenumire, mutare, stergere,
 * restaurare.
 *
 * Nodurile de sistem (`is_system`) nu primesc butoane deloc — nu gri, ci absente
 * (§30.5). Baza le respinge oricum, prin `app.guard_node_system`, dar un buton
 * care exista si apoi da eroare invata omul ca aplicatia e capricioasa.
 */

export interface NodeSummary {
  readonly id: string;
  readonly name: string;
  readonly isSystem: boolean;
}

const nameSchema = z.object({ name: nodeNameSchema });
type NameValues = z.infer<typeof nameSchema>;

/** Dialogul de nume, folosit si la folder nou, si la redenumire. */
function NameDialog({
  title,
  submitLabel,
  defaultName,
  formId,
  onClose,
  submit,
}: {
  readonly title: string;
  readonly submitLabel: string;
  readonly defaultName: string;
  readonly formId: string;
  readonly onClose: () => void;
  readonly submit: (name: string) => Promise<ActionResult<{ id: string }>>;
}) {
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const { toast } = useToast();
  const router = useRouter();

  return (
    <Form
      schema={nameSchema}
      defaultValues={{ name: defaultName }}
      id={formId}
      onSubmit={(values: NameValues) => {
        void (async () => {
          setServerError(undefined);
          const result = await submit(values.name);
          if (result.ok) {
            toast({ tone: 'success', title: submitLabel });
            onClose();
            router.refresh();
          } else {
            setServerError(result.message);
          }
        })();
      }}
    >
      {(form) => (
        <Dialog
          error={serverError}
          open
          onOpenChange={(next) => {
            if (!next) {
              onClose();
            }
          }}
          title={title}
          isDirty={form.formState.isDirty}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                form={formId}
                variant="primary"
                loading={form.formState.isSubmitting}
              >
                {submitLabel}
              </Button>
            </>
          }
        >
          <Field name="name" label="Nume" required>
            {(props) => <Input {...props} {...form.register('name')} autoFocus />}
          </Field>
        </Dialog>
      )}
    </Form>
  );
}

export function NewFolderButton({ parentId }: { readonly parentId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        <FolderPlus className="size-4" aria-hidden="true" />
        Folder nou
      </Button>
      {open ? (
        <NameDialog
          title="Folder nou"
          submitLabel="Creează"
          defaultName=""
          formId={`new-folder-${parentId}`}
          onClose={() => {
            setOpen(false);
          }}
          submit={(name) => createFolderAction({ parentId, name })}
        />
      ) : null}
    </>
  );
}

/**
 * Cele trei actiuni de pe un rand.
 *
 * `folders` sunt tintele posibile ale mutarii: folderul de deasupra si celelalte
 * foldere din folderul curent. Nu e un arbore de ales — mutarea la distanta se
 * face din doua pasi, exact ca in orice explorer, si asa nu apare un al doilea
 * ecran de navigare care sa se abata de la primul.
 */
export function NodeActions({
  node,
  folders,
}: {
  readonly node: NodeSummary;
  readonly folders: readonly { readonly id: string; readonly name: string }[];
}) {
  const [dialog, setDialog] = useState<'rename' | 'move' | 'trash' | null>(null);
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState(folders[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  if (node.isSystem) {
    return (
      <span className="text-xs text-ink-subtle" title="Folderele de sistem nu se pot modifica">
        sistem
      </span>
    );
  }

  const close = (): void => {
    setDialog(null);
    setServerError(undefined);
  };

  const run = async (action: () => Promise<ActionResult<{ id: string }>>, done: string) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      toast({ tone: 'success', title: done });
      close();
      router.refresh();
    } else {
      setServerError(result.message);
    }
  };

  return (
    <span className="flex items-center justify-end gap-1">
      <IconButton
        label={`Redenumește ${node.name}`}
        onClick={() => {
          setDialog('rename');
        }}
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </IconButton>
      {folders.length === 0 ? null : (
        <IconButton
          label={`Mută ${node.name}`}
          onClick={() => {
            setDialog('move');
          }}
        >
          <FolderSymlink className="size-3.5" aria-hidden="true" />
        </IconButton>
      )}
      <IconButton
        label={`Șterge ${node.name}`}
        onClick={() => {
          setDialog('trash');
        }}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </IconButton>

      {dialog === 'rename' ? (
        <NameDialog
          title={`Redenumește „${node.name}”`}
          submitLabel="Redenumește"
          defaultName={node.name}
          formId={`rename-${node.id}`}
          onClose={close}
          submit={(name) => renameNodeAction({ nodeId: node.id, name })}
        />
      ) : null}

      {dialog === 'move' ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) {
              close();
            }
          }}
          title={`Mută „${node.name}”`}
          description="Mutarea e un singur rând schimbat în baza de date, oricâte fișiere ar fi dedesubt. Nimic nu se copiază."
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                loading={busy}
                onClick={() => {
                  void run(() => moveNodeAction({ nodeId: node.id, parentId: target }), 'Mutat');
                }}
              >
                Mută
              </Button>
            </>
          }
        >
          <Field name="target" label="Unde">
            {(props) => (
              <Select
                {...props}
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                }}
                options={folders.map((folder) => ({ value: folder.id, label: folder.name }))}
              />
            )}
          </Field>
          {serverError === undefined ? null : (
            <p role="alert" className="mt-2 text-sm font-medium text-danger-700">
              {serverError}
            </p>
          )}
        </Dialog>
      ) : null}

      {dialog === 'trash' ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) {
              close();
            }
          }}
          title={`Șterge „${node.name}”?`}
          description="Se mută în coșul de gunoi. Numele redevine liber imediat, iar conținutul se poate restaura 30 de zile."
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={close}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => {
                  void run(() => trashNodeAction({ nodeId: node.id }), 'Mutat în coș');
                }}
              >
                Șterge
              </Button>
            </>
          }
        >
          {serverError === undefined ? (
            <p className="text-sm text-ink-muted">
              Ștergerea e instantanee chiar și pentru un folder cu mii de poze.
            </p>
          ) : (
            <p role="alert" className="text-sm font-medium text-danger-700">
              {serverError}
            </p>
          )}
        </Dialog>
      ) : null}
    </span>
  );
}

export function RestoreButton({
  nodeId,
  name,
}: {
  readonly nodeId: string;
  readonly name: string;
}) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  return (
    <Button
      size="sm"
      variant="ghost"
      loading={busy}
      onClick={() => {
        void (async () => {
          setBusy(true);
          const result = await restoreNodeAction({ nodeId });
          setBusy(false);
          toast(
            result.ok
              ? { tone: 'success', title: `„${name}” a fost restaurat` }
              : { tone: 'error', title: result.message },
          );
          router.refresh();
        })();
      }}
    >
      <RotateCcw className="size-3.5" aria-hidden="true" />
      Restaurează
    </Button>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1"
    >
      {children}
    </button>
  );
}
