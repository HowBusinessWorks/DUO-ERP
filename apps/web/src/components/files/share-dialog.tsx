'use client';

import { t } from '@damina/i18n';
import { SHARE_PERMISSION_LABELS, SHARE_PERMISSIONS } from '@damina/contracts';
import { Button, Dialog, Field, Select, Table, useToast, type Column } from '@damina/ui';
import { Share2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { shareNodeAction, unshareNodeAction } from '../../app/(office)/file-actions';

/**
 * Partajarea unui nod, din interfață.
 *
 * Regula 6 a pasului, făcută vizibilă: **subcontractantul nu moștenește nimic.**
 * Nu vede folderul pentru că lucrează la contract — îl vede pentru că cineva i-a
 * dat acces la nodul ăsta, explicit, și scrie aici cine și când. Partajarea se
 * moștenește în jos, deci pusă pe un folder acoperă tot ce e sub el; textul o
 * spune, ca să nu se descopere prin surpriză.
 */

export interface ShareSubject {
  readonly id: string;
  readonly name: string;
  readonly type: 'person' | 'subcontractor';
}

export interface ExistingShare {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly subjectName: string | null;
  readonly permission: string;
}

export function ShareDialog({
  nodeId,
  nodeName,
  subjects,
  shares,
}: {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly subjects: readonly ShareSubject[];
  readonly shares: readonly ExistingShare[];
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(subjects[0]?.id ?? '');
  const [permission, setPermission] = useState<string>('read');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const chosen = subjects.find((candidate) => candidate.id === subject);

  const columns: readonly Column<ExistingShare>[] = [
    {
      key: 'name',
      header: 'Cine',
      cell: (row) => (
        <span>
          {row.subjectName ?? <span className="text-ink-subtle">(nu mai e vizibil)</span>}
          <span className="ml-1.5 text-xs text-ink-muted">
            {row.subjectType === 'subcontractor' ? 'subcontractant' : 'persoană'}
          </span>
        </span>
      ),
    },
    {
      key: 'permission',
      header: 'Ce poate',
      width: '11rem',
      cell: (row) => SHARE_PERMISSION_LABELS[row.permission as 'read'] ?? row.permission,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: '3rem',
      cell: (row) => (
        <button
          type="button"
          aria-label={`Retrage accesul pentru ${row.subjectName ?? row.subjectId}`}
          className="rounded p-1 text-ink-subtle hover:bg-surface-sunken hover:text-danger-600"
          onClick={() => {
            void (async () => {
              const result = await unshareNodeAction({
                nodeId,
                subjectType: row.subjectType,
                subjectId: row.subjectId,
              });
              toast(
                result.ok
                  ? { tone: 'success', title: 'Accesul a fost retras' }
                  : { tone: 'error', title: result.message },
              );
              router.refresh();
            })();
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ),
    },
  ];

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Share2 className="size-4" aria-hidden="true" />
        Partajează
        {shares.length === 0 ? null : ` (${String(shares.length)})`}
      </Button>

      {open ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setOpen(false);
              setError(undefined);
            }
          }}
          title={`Partajează „${nodeName}”`}
          description="Accesul se moștenește în jos: pus pe un folder, acoperă tot ce e sub el. Un subcontractant nu vede nimic altceva din arbore."
          size="md"
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t('common.close')}
              </Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={chosen === undefined}
                disabledReason={chosen === undefined ? 'Nu există cu cine partaja.' : undefined}
                onClick={() => {
                  void (async () => {
                    if (chosen === undefined) {
                      return;
                    }
                    setBusy(true);
                    setError(undefined);
                    const result = await shareNodeAction({
                      nodeId,
                      subjectType: chosen.type,
                      subjectId: chosen.id,
                      permission,
                    });
                    setBusy(false);
                    if (result.ok) {
                      toast({ tone: 'success', title: `Partajat cu ${chosen.name}` });
                      router.refresh();
                    } else {
                      setError(result.message);
                    }
                  })();
                }}
              >
                Dă acces
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="subject" label="Cu cine">
                {(props) => (
                  <Select
                    {...props}
                    value={subject}
                    onChange={(event) => {
                      setSubject(event.target.value);
                    }}
                    options={subjects.map((candidate) => ({
                      value: candidate.id,
                      label: `${candidate.name} · ${candidate.type === 'subcontractor' ? 'subcontractant' : 'persoană'}`,
                    }))}
                  />
                )}
              </Field>
              <Field name="permission" label="Ce poate face">
                {(props) => (
                  <Select
                    {...props}
                    value={permission}
                    onChange={(event) => {
                      setPermission(event.target.value);
                    }}
                    options={SHARE_PERMISSIONS.map((value) => ({
                      value,
                      label: SHARE_PERMISSION_LABELS[value],
                    }))}
                  />
                )}
              </Field>
            </div>

            {error === undefined ? null : (
              <p role="alert" className="text-sm font-medium text-danger-700">
                {error}
              </p>
            )}

            <Table
              columns={columns}
              rows={shares}
              rowKey={(row) => `${row.subjectType}:${row.subjectId}`}
              caption="Cine are deja acces"
              empty={
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-ink-muted">
                  Nimeni din afara firmei nu vede nodul ăsta.
                </p>
              }
            />
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
