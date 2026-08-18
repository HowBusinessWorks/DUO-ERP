'use client';

import { REQUEST_TYPE_LABELS, REQUEST_TYPES } from '@damina/contracts';
import { Badge, Banner, Button, EmptyState, Input, Select, Textarea, useToast } from '@damina/ui';
import { Mail, MailX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { triageRequestAction } from '../../app/(office)/request-actions';

/**
 * Inbox › ecranul de triere (§3.5). **Ținta e 30 de secunde per cerere.**
 *
 * De aceea: focus automat pe primul câmp, `Ctrl+Enter` salvează și sare la
 * următoarea, iar coada rămâne vizibilă ca omul să știe cât mai are. Nimic din
 * ecran nu cere mouse-ul de mai multe ori decât o dată.
 *
 * Coloana stângă e emailul original când există. Când nu (cerere scrisă de
 * mână), rămâne descrierea — ecranul nu se schimbă, doar sursa. Așa ingestia
 * IMAP din 08c începe să curgă în el fără să se atingă nimic aici.
 */

export interface TriageRequest {
  readonly id: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly type: string;
  readonly source: string;
  readonly title: string;
  readonly description: string | null;
  readonly estimatedValue: string | null;
  readonly objectiveId: string | null;
  readonly contractId: string | null;
  readonly email: {
    readonly fromAddress: string;
    readonly subject: string | null;
    readonly receivedAt: string;
    readonly bodyText: string | null;
  } | null;
}

export interface TriageOption {
  readonly value: string;
  readonly label: string;
  /** Doar la contracte: firma lor, ca lista să nu ofere contracte străine. */
  readonly companyId?: string;
}

export interface InboxTriageProps {
  readonly requests: readonly TriageRequest[];
  readonly objectives: readonly TriageOption[];
  readonly contracts: readonly TriageOption[];
  readonly canTriage: boolean;
}

interface FormState {
  type: string;
  objectiveId: string;
  contractId: string;
  title: string;
  description: string;
  estimatedValue: string;
}

const blankFrom = (request: TriageRequest): FormState => ({
  type: request.type,
  objectiveId: request.objectiveId ?? '',
  contractId: request.contractId ?? '',
  title: request.title,
  description: request.description ?? '',
  estimatedValue: request.estimatedValue ?? '',
});

export function InboxTriage({ requests, objectives, contracts, canTriage }: InboxTriageProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [index, setIndex] = useState(0);
  const current = requests[index];
  const [form, setForm] = useState<FormState>(() =>
    current === undefined
      ? { type: 'solicitare', objectiveId: '', contractId: '', title: '', description: '', estimatedValue: '' }
      : blankFrom(current),
  );
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Formularul urmează coada: la fiecare cerere nouă se reîncarcă din ea, ca să
  // nu ducă valorile celei anterioare mai departe.
  useEffect(() => {
    if (current !== undefined) {
      setForm(blankFrom(current));
      setError(undefined);
    }
  }, [current]);

  function save(): void {
    if (current === undefined || saving) {
      return;
    }
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await triageRequestAction({
        requestId: current.id,
        type: form.type,
        objectiveId: form.objectiveId,
        contractId: form.contractId,
        contractObjectiveId: '',
        title: form.title,
        description: form.description,
        estimatedValue: form.estimatedValue,
      });
      setSaving(false);

      if (result.ok) {
        toast({ tone: 'success', title: 'Triată. Următoarea.' });
        // Rândul dispare din coadă abia după `router.refresh()`; până atunci
        // indexul avansează singur, ca ritmul să nu se rupă.
        setIndex((value) => Math.min(value + 1, Math.max(requests.length - 1, 0)));
        router.refresh();
      } else {
        setError(result.message);
      }
    })();
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<MailX className="size-5" aria-hidden="true" />}
        title="Inbox gol — nicio cerere neprocesată"
        body="Aici ajung cererile pe măsură ce intră: prin email pe cutia monitorizată, din constatările de inspecție sau scrise de mână. Trierea le completează obiectivul și contractul și le trece în evaluare."
      />
    );
  }

  if (current === undefined) {
    return (
      <EmptyState
        title="Ai triat tot"
        body="Coada s-a golit. Cererile triate sunt acum în evaluare."
      />
    );
  }

  const contractOptions = contracts.filter(
    (contract) => contract.companyId === undefined || contract.companyId === current.companyId,
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          save();
        }
      }}
    >
      {/* Coada: cât mai am de triat și unde sunt. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="brand">
          {String(index + 1)} din {String(requests.length)}
        </Badge>
        <span className="text-ink-muted">{current.companyName}</span>
        <Badge tone="outline">{current.source === 'email' ? 'din email' : current.source}</Badge>
        <span className="ml-auto flex gap-2">
          <Button
            size="sm"
            disabled={index === 0}
            onClick={() => {
              setIndex((value) => Math.max(value - 1, 0));
            }}
          >
            Înapoi
          </Button>
          <Button
            size="sm"
            disabled={index >= requests.length - 1}
            onClick={() => {
              setIndex((value) => Math.min(value + 1, requests.length - 1));
            }}
          >
            Sari peste
          </Button>
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* Stânga: sursa. Emailul original când există. */}
        <section className="min-h-0 overflow-auto rounded-lg border border-border bg-surface-sunken p-4">
          {current.email === null ? (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-ink-muted">
                <MailX className="size-4" aria-hidden="true" /> Fără email — cerere scrisă de mână
              </p>
              <h2 className="mt-2 text-base font-semibold text-ink">{current.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
                {current.description ?? 'Fără descriere.'}
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-ink-muted">
                <Mail className="size-4" aria-hidden="true" /> {current.email.fromAddress}
              </p>
              <h2 className="mt-2 text-base font-semibold text-ink">
                {current.email.subject ?? current.title}
              </h2>
              <p className="mt-0.5 text-xs text-ink-subtle">{current.email.receivedAt}</p>
              <p className="mt-3 whitespace-pre-wrap text-sm text-ink">
                {current.email.bodyText ?? 'Mesaj fără text.'}
              </p>
            </>
          )}
        </section>

        {/* Dreapta: formularul de triere. */}
        <section className="min-h-0 space-y-3 overflow-auto rounded-lg border border-border bg-surface p-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Titlu</span>
            <Input
              autoFocus
              value={form.title}
              onChange={(event) => {
                setForm((value) => ({ ...value, title: event.target.value }));
              }}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Tip</span>
              <Select
                options={REQUEST_TYPES.map((type) => ({
                  value: type,
                  label: REQUEST_TYPE_LABELS[type],
                }))}
                value={form.type}
                onChange={(event) => {
                  setForm((value) => ({ ...value, type: event.target.value }));
                }}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Valoare estimată</span>
              <Input
                inputMode="decimal"
                suffix="lei"
                value={form.estimatedValue}
                onChange={(event) => {
                  setForm((value) => ({ ...value, estimatedValue: event.target.value }));
                }}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Obiectiv</span>
              <Select
                options={objectives}
                placeholder="— alege obiectivul —"
                value={form.objectiveId}
                onChange={(event) => {
                  setForm((value) => ({ ...value, objectiveId: event.target.value }));
                }}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Contract</span>
              <Select
                options={contractOptions}
                placeholder="— alege contractul —"
                value={form.contractId}
                onChange={(event) => {
                  setForm((value) => ({ ...value, contractId: event.target.value }));
                }}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Descriere</span>
            <Textarea
              rows={4}
              value={form.description}
              onChange={(event) => {
                setForm((value) => ({ ...value, description: event.target.value }));
              }}
            />
          </label>

          {error === undefined ? null : (
            <Banner tone="danger" title="Trierea n-a mers" body={error} />
          )}

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              loading={saving}
              disabled={!canTriage || form.title.trim() === ''}
              disabledReason={
                canTriage ? undefined : 'Rolul tău nu poate tria cereri.'
              }
              onClick={save}
            >
              Salvează și treci mai departe
            </Button>
            <span className="text-xs text-ink-subtle">sau Ctrl+Enter</span>
          </div>
        </section>
      </div>
    </div>
  );
}
