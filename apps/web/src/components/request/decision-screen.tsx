'use client';

import { ROUTING_CHOICE_LABELS } from '@damina/contracts';
import { Money as MoneyValue } from '@damina/shared';
import { Badge, Banner, Button, EmptyState, Input, Money, Select, Textarea, useToast } from '@damina/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { decideRoutingAction } from '../../app/(office)/request-actions';

/**
 * Ecranul de Decizie (§3.5) — cea mai importantă decizie din firmă.
 *
 * Regula care îi dă forma: **sistemul propune, omul confirmă sau schimbă,
 * motivând.** De aceea propunerea vine gata calculată de pe server (cu
 * `routeRequest` din `@damina/domain`, pe cifre citite live), iar ecranul nu
 * recalculează nimic — nici măcar feliile pe luni, care vin din `option.split`.
 * Două locuri care ar împărți aceeași sumă ar diverge exact în luna în care
 * contează.
 *
 * Opțiunile indisponibile rămân SELECTABILE, cu „✗ motivul" lângă ele. Nu e o
 * scăpare: un plafon depășit conștient e o decizie (care se scrie în jurnal, cu
 * motiv și autor), pe când o opțiune gri e un zid fără explicație. Ce nu se
 * poate ocoli e altundeva — cererea se citește cu `for update`, luna închisă e
 * refuzată de bază, iar promovarea peste plafon cere confirmare separată.
 */

export interface DecisionOption {
  readonly choice: string;
  readonly available: boolean;
  readonly reason: string;
  readonly targetPeriods?: readonly string[];
  readonly split?: readonly { readonly periodId: string; readonly amount: string }[];
  readonly fillPercent?: number;
}

export interface DecisionComponent {
  readonly id: string;
  readonly type: string;
  readonly name: string;
}

export interface DecisionScreenProps {
  readonly requestId: string;
  readonly requestTitle: string;
  readonly companyId: string;
  readonly objectiveId: string | null;
  readonly contractId: string | null;
  readonly contractCode: string | null;
  readonly estimatedValue: string | null;
  readonly components: readonly DecisionComponent[];
  readonly deltaMonths: readonly {
    readonly periodId: string;
    readonly label: string;
    readonly free: string;
  }[];
  readonly openPeriods: readonly { readonly id: string; readonly label: string }[];
  readonly lucrariCeilingFree: string | null;
  /** Contractele individuale ale firmei, cu componenta din care se plătesc. */
  readonly individualTargets: readonly {
    readonly contractId: string;
    readonly contractCode: string;
    readonly componentId: string;
  }[];
  readonly proposal: string;
  readonly options: readonly DecisionOption[];
  readonly canDecide: boolean;
  readonly blockedReason?: string;
}

const choiceLabel = (choice: string): string =>
  ROUTING_CHOICE_LABELS[choice as keyof typeof ROUTING_CHOICE_LABELS] ?? choice;

export function DecisionScreen(props: DecisionScreenProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [choice, setChoice] = useState(props.proposal);
  const [reason, setReason] = useState('');
  const [series, setSeries] = useState('L');
  const [individualContractId, setIndividualContractId] = useState(
    props.individualTargets[0]?.contractId ?? '',
  );
  const [validUntil, setValidUntil] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const value = MoneyValue.fromDb(props.estimatedValue);
  const selected = props.options.find((option) => option.choice === choice);
  const firstPeriod = props.openPeriods[0];

  const componentOfType = (type: string): DecisionComponent | undefined =>
    props.components.find((component) => component.type === type);

  // Ce lipsește ca decizia să se poată executa. Se spune ÎNAINTE de apăsare, nu
  // după: o cerere fără obiectiv n-are unde să pună lucrarea, iar mesajul „a
  // eșuat" venit de la server e cu un pas prea târziu.
  const missing = collectMissing();

  function collectMissing(): string | null {
    if (props.objectiveId === null) {
      return 'Cererea n-are obiectiv. Triaz-o întâi: unitatea de lucru se agață de un amplasament.';
    }
    if (props.contractId === null) {
      return 'Cererea n-are contract. Fără el nu se știe cine plătește.';
    }
    if (value.isZero()) {
      return 'Cererea n-are valoare estimată. Evaluează-o din catalogul de operațiuni.';
    }
    if (choice === 'amanata_backlog') {
      return null;
    }
    if (firstPeriod === undefined) {
      return 'Firma n-are nicio lună deschisă. Deschide luna și revino.';
    }
    if (choice === 'interventie_mentenanta' && componentOfType('mentenanta') === undefined) {
      return 'Contractul n-are componentă de Mentenanță.';
    }
    if (choice === 'lucrare_componenta_lucrari' && componentOfType('lucrari') === undefined) {
      return 'Contractul n-are componentă de Lucrări.';
    }
    if (
      (choice === 'lucrare_delta' || choice === 'lucrare_delta_multi_luna') &&
      (componentOfType('delta') === undefined || props.deltaMonths.length === 0)
    ) {
      return 'Contractul n-are Deltă cu plafon setat pe lunile deschise.';
    }
    if (choice === 'contract_individual_nou' && props.individualTargets.length === 0) {
      return 'Firma n-are niciun contract individual cu componentă. Contractul se creează întâi, din modulul Contracte.';
    }
    return null;
  }

  /**
   * Alocările alegerii curente.
   *
   * Feliile pe luni NU se recalculează aici: vin din `option.split`, produs de
   * `splitDeltaAcrossPeriods` în domain. Ecranul le traduce în alocări, atât.
   */
  function allocationsFor(): { contractId: string; componentId: string; periodId: string; allocatedAmount: string; allocatedPct: string; reason: string }[] {
    const contractId = props.contractId ?? '';
    const periodId = firstPeriod?.id ?? '';
    const amount = value.toDbString();

    if (choice === 'interventie_mentenanta') {
      const component = componentOfType('mentenanta');
      return component === undefined
        ? []
        : [{ contractId, componentId: component.id, periodId, allocatedAmount: amount, allocatedPct: '', reason }];
    }
    if (choice === 'lucrare_componenta_lucrari') {
      const component = componentOfType('lucrari');
      return component === undefined
        ? []
        : [{ contractId, componentId: component.id, periodId, allocatedAmount: amount, allocatedPct: '', reason }];
    }
    if (choice === 'lucrare_delta' || choice === 'lucrare_delta_multi_luna') {
      const component = componentOfType('delta');
      if (component === undefined) {
        return [];
      }
      const split = selected?.split ?? [{ periodId: props.deltaMonths[0]?.periodId ?? '', amount }];
      return split
        .filter((part) => !MoneyValue.fromDb(part.amount).isZero())
        .map((part) => ({
          contractId,
          componentId: component.id,
          periodId: part.periodId,
          allocatedAmount: MoneyValue.fromDb(part.amount).toDbString(),
          allocatedPct: '',
          reason,
        }));
    }
    if (choice === 'contract_individual_nou') {
      const target = props.individualTargets.find(
        (candidate) => candidate.contractId === individualContractId,
      );
      return target === undefined
        ? []
        : [
            {
              contractId: target.contractId,
              componentId: target.componentId,
              periodId,
              allocatedAmount: amount,
              allocatedPct: '',
              reason,
            },
          ];
    }
    return [];
  }

  function payload(): unknown {
    const base = {
      requestId: props.requestId,
      choice,
      systemProposal: props.proposal,
      reason,
    };

    if (choice === 'amanata_backlog') {
      return {
        ...base,
        backlog: {
          objectiveId: props.objectiveId ?? '',
          contractId: props.contractId ?? '',
          title: props.requestTitle,
          estimatedValue: value.toDbString(),
          validUntil,
        },
      };
    }

    return {
      ...base,
      creation: {
        workUnit: {
          companyId: props.companyId,
          type: choice === 'interventie_mentenanta' ? 'interventie' : 'lucrare',
          name: props.requestTitle,
          objectiveId: props.objectiveId ?? '',
          contractObjectiveId: '',
          responsiblePersonId: '',
          executorType: 'echipa_proprie',
          executorSubcontractorId: '',
          startsOn: '',
          endsOn: '',
          estimatedValue: value.toDbString(),
          costBudget: '',
        },
        allocations: allocationsFor(),
        assignments: [],
        series,
      },
    };
  }

  function submit(): void {
    void (async () => {
      setError(undefined);
      setSaving(true);
      const result = await decideRoutingAction(payload());
      setSaving(false);
      if (result.ok) {
        toast({
          tone: 'success',
          title:
            result.data.workUnitId === null
              ? 'Cererea a intrat în backlog.'
              : 'Decizie luată. Unitatea de lucru e creată și finanțată.',
        });
        router.refresh();
      } else {
        setError(result.message);
      }
    })();
  }

  if (!props.canDecide) {
    return (
      <EmptyState
        title="Nu poți lua decizia de rutare"
        body="Decizia creează unitatea de lucru și îi alocă finanțarea. Cere-i unui administrator dreptul dacă îți trebuie."
      />
    );
  }

  const deltaTotal = MoneyValue.sum(props.deltaMonths.map((month) => MoneyValue.fromDb(month.free)));

  return (
    <div className="space-y-4">
      {/* Antetul de cifre — exact cele două din mock-ul planului. */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3">
        <div>
          <p className="text-sm text-ink-muted">Valoare estimată</p>
          <Money value={value} emphasis />
        </div>
        <div className="text-right">
          <p className="text-sm text-ink-muted">
            {props.contractCode === null ? 'Fără contract' : `Contract ${props.contractCode}`} ·
            Deltă liberă
          </p>
          <Money value={deltaTotal} emphasis />
          <p className="mt-0.5 text-xs text-ink-subtle">
            {props.deltaMonths.length === 0
              ? 'nicio lună de Deltă cu plafon setat'
              : props.deltaMonths
                  .map((month) => `${month.label}: ${MoneyValue.fromDb(month.free).format()}`)
                  .join(' · ')}
            {' · citit live, la fiecare deschidere a ecranului'}
          </p>
        </div>
      </div>

      {props.blockedReason === undefined ? null : (
        <Banner tone="warning" title="Luna e închisă" body={props.blockedReason} />
      )}

      {/* Propunerea sistemului, apoi restul. Ordinea din §3.5. */}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-ink">
          Sistemul propune: <strong>{choiceLabel(props.proposal)}</strong>
        </legend>

        {props.options.map((option) => (
          <label
            key={option.choice}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 ${
              option.choice === choice
                ? 'border-brand-500 bg-brand-50'
                : 'border-border bg-surface hover:bg-surface-hover'
            }`}
          >
            <input
              type="radio"
              name="routing-choice"
              className="mt-1"
              checked={option.choice === choice}
              onChange={() => {
                setChoice(option.choice);
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{choiceLabel(option.choice)}</span>
                {option.choice === props.proposal ? (
                  <Badge tone="brand">propunerea sistemului</Badge>
                ) : null}
                {option.available ? null : <Badge tone="warning">indisponibilă</Badge>}
              </span>
              <span className="mt-0.5 block text-sm text-ink-muted">{option.reason}</span>
              {option.split === undefined || option.split.length < 2 ? null : (
                <span className="mt-1 block text-xs text-ink-subtle">
                  {option.split
                    .map((part, index) => {
                      const month = props.deltaMonths.find(
                        (candidate) => candidate.periodId === part.periodId,
                      );
                      return `${month?.label ?? `luna ${String(index + 1)}`}: ${MoneyValue.fromDb(part.amount).format()}`;
                    })
                    .join(' · ')}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {selected?.available === false ? (
        <Banner
          tone="warning"
          title="Alegi o opțiune pe care sistemul o refuză"
          body={`${selected.reason}. Poți să o iei oricum — dar motivul de mai jos e singurul lucru care o va explica peste șase luni.`}
        />
      ) : null}

      {/* Câmpurile care depind de alegere. */}
      {choice === 'amanata_backlog' ? (
        <label className="block max-w-xs">
          <span className="mb-1 block text-sm font-medium text-ink">Valabilă până la</span>
          <Input
            type="date"
            value={validUntil}
            onChange={(event) => {
              setValidUntil(event.target.value);
            }}
          />
          <span className="mt-1 block text-xs text-ink-subtle">
            Opțional. După data asta propunerea devine <strong>expirată</strong>, nu ștearsă.
          </span>
        </label>
      ) : (
        <div className="flex flex-wrap gap-4">
          <label className="block w-40">
            <span className="mb-1 block text-sm font-medium text-ink">Serie</span>
            <Input
              value={series}
              onChange={(event) => {
                setSeries(event.target.value);
              }}
            />
            <span className="mt-1 block text-xs text-ink-subtle">Codul se alocă fără goluri.</span>
          </label>

          {choice === 'contract_individual_nou' ? (
            <label className="block w-72">
              <span className="mb-1 block text-sm font-medium text-ink">Contractul individual</span>
              <Select
                options={props.individualTargets.map((target) => ({
                  value: target.contractId,
                  label: target.contractCode,
                }))}
                value={individualContractId}
                onChange={(event) => {
                  setIndividualContractId(event.target.value);
                }}
              />
              <span className="mt-1 block text-xs text-ink-subtle">
                Contractul se creează din modulul Contracte. Decizia doar leagă lucrarea de el.
              </span>
            </label>
          ) : null}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">
          Motiv <span className="text-danger-700">*</span>
        </span>
        <Textarea
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          placeholder="De ce asta și nu altceva. Ajunge în jurnalul de decizii, cu autor și dată."
        />
      </label>

      {missing === null ? null : <Banner tone="warning" title="Mai lipsește ceva" body={missing} />}
      {error === undefined ? null : <Banner tone="danger" title="Decizia n-a mers" body={error} />}

      <Button
        variant="primary"
        loading={saving}
        disabled={reason.trim() === '' || missing !== null}
        disabledReason={
          reason.trim() === '' ? 'Scrie motivul deciziei. Fără el, decizia nu se salvează.' : missing ?? undefined
        }
        onClick={submit}
      >
        {choice === 'amanata_backlog' ? 'Amână în backlog' : 'Decide și creează UL'}
      </Button>
    </div>
  );
}
