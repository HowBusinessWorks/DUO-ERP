import { Money } from '@damina/shared';

/**
 * Decizia de rutare (pasul 08, §0) — cea mai importanta decizie din firma.
 *
 * **Sistemul propune, omul confirma sau schimba, motivand.** Functia de aici e
 * doar jumatatea de propunere: pura, fara DB, testabila in milisecunde. Cine
 * decide efectiv scrie randul in `request_decisions` cu ambele — propunerea de
 * aici SI alegerea omului — niciodata doar rezultatul (regula 4 din pas).
 */

export type RoutingChoice =
  | 'interventie_mentenanta'
  | 'lucrare_delta'
  | 'lucrare_delta_multi_luna'
  | 'lucrare_componenta_lucrari'
  | 'contract_individual_nou'
  | 'amanata_backlog';

/** Ordinea de afisare de pe ecranul de Decizie (§3.5) — nu ordinea de prioritate. */
export const ROUTING_CHOICES: readonly RoutingChoice[] = [
  'interventie_mentenanta',
  'lucrare_delta',
  'lucrare_componenta_lucrari',
  'lucrare_delta_multi_luna',
  'contract_individual_nou',
  'amanata_backlog',
];

export interface RoutingOption {
  readonly choice: RoutingChoice;
  readonly available: boolean;
  /** Explicatia din ecran: motivul disponibilitatii SAU „✗ ...” cand nu e. */
  readonly reason: string;
  /** Doar pentru optiunile de Delta. */
  readonly targetPeriods?: readonly string[];
  /**
   * Doar pentru optiunile de Delta: cati lei din fiecare luna. Ecranul de
   * decizie scrie exact astea in alocari — fara el ar trebui sa reimparta
   * singur suma, si atunci ar exista doua adevaruri despre aceleasi alocari.
   */
  readonly split?: readonly DeltaSplitPart[];
  /** Doar pentru optiunile de Delta: cat la suta din plafonul liber ocupa. */
  readonly fillPercent?: number;
}

export interface RoutingProposal {
  readonly proposal: RoutingChoice;
  readonly options: readonly RoutingOption[];
}

/** Delta libera intr-o luna anume. */
export interface DeltaPeriodFree {
  readonly periodId: string;
  readonly free: Money;
}

export interface RoutingCeilings {
  /**
   * Delta libera, in ORDINE (luna curenta intai). Minim un element — fara nicio
   * luna deschisa, opțiunile de Delta sunt pur si simplu indisponibile.
   */
  readonly deltaFreeByPeriod: readonly DeltaPeriodFree[];
  /** Cat mai e liber pe componenta Lucrari a contractului. `null` = operatiunea nu e prevazuta acolo. */
  readonly lucrariCeilingFree: Money | null;
  /** Cererea are potential comercial — candidat pentru contract individual nou. */
  readonly isCommercialOpportunity: boolean;
}

export interface RouteRequestInput {
  readonly value: Money;
  readonly ceilings: RoutingCeilings;
  /** Pragul de mentenanta. Implicit 2.000 lei (§0). */
  readonly threshold?: Money;
}

/** O felie din impartirea pe luni: cati lei se aloca din luna asta. */
export interface DeltaSplitPart {
  readonly periodId: string;
  readonly amount: Money;
}

/**
 * Imparte o valoare pe lunile de Delta, §3.3: fiecare luna primeste cat are
 * liber, in ordine, iar restul cade pe ULTIMA.
 *
 * Restul pe ultima, nu proportional (cum face `splitAcrossPeriods` din
 * `funding`): aici lunile nu sunt egale intre ele, fiecare are plafonul ei, iar
 * o impartire proportionala ar depasi liberul lunii intai ca sa lase loc gol in
 * a treia. Cand valoarea incape in suma liberelor, ultima luna primeste doar
 * ce a ramas — deci nicio luna nu-si depaseste plafonul.
 *
 * Nu se pierde niciun ban la rotunjire: feliile se scad din valoare cu `Money`,
 * iar ultima primeste exact diferenta, nu o cifra recalculata.
 */
export function splitDeltaAcrossPeriods(
  value: Money,
  periods: readonly DeltaPeriodFree[],
): readonly DeltaSplitPart[] {
  if (periods.length === 0) {
    return [];
  }

  const parts: DeltaSplitPart[] = [];
  let remaining = value;
  for (let i = 0; i < periods.length; i += 1) {
    const period = periods[i]!;
    const isLast = i === periods.length - 1;
    // Ultima ia tot restul — si cand e mai mult decat liberul ei. Depasirea se
    // vede atunci in `available: false`, nu se ascunde intr-o felie taiata.
    const amount = isLast ? remaining : remaining.min(period.free).max(Money.ZERO);
    parts.push({ periodId: period.periodId, amount });
    remaining = remaining.sub(amount);
  }
  return parts;
}

const DEFAULT_THRESHOLD = Money.of(2000);

const round = (n: number): number => Math.round(n * 100) / 100;

const fmt = (m: Money): string => m.format();

function deltaOption(
  choice: 'lucrare_delta' | 'lucrare_delta_multi_luna',
  periods: readonly DeltaPeriodFree[],
  value: Money,
): RoutingOption {
  if (periods.length === 0) {
    return { choice, available: false, reason: '✗ nicio lună de Deltă deschisă' };
  }
  const free = Money.sum(periods.map((p) => p.free));
  const available = value.lte(free) && value.gt(Money.ZERO);
  const fillPercent = free.isZero()
    ? 0
    : round((value.toUnsafeNumber() / free.toUnsafeNumber()) * 100);
  const periodsLabel = periods.map((p) => p.periodId).join(', ');
  if (!available) {
    return {
      choice,
      available: false,
      reason: `✗ ${fmt(value)} > ${fmt(free)} disponibil în ${periodsLabel}`,
      targetPeriods: periods.map((p) => p.periodId),
    };
  }
  return {
    choice,
    available: true,
    reason: `${fmt(value)} ≤ ${fmt(free)} disponibil · umple Delta la ${fillPercent}%`,
    targetPeriods: periods.map((p) => p.periodId),
    split: splitDeltaAcrossPeriods(value, periods),
    fillPercent,
  };
}

/**
 * Propunerea sistemului + toate optiunile alternative, fiecare cu motivul
 * pentru care e sau nu disponibila (verificarile #6, #7, #8 ale pasului).
 *
 * Ordinea de prioritate a propunerii, nu si de afisare:
 *   1. sub prag           → Mentenanta
 *   2. incape intr-o luna → Delta (o luna)
 *   3. e prevazuta in contract si incape in plafonul Lucrari → componenta Lucrari
 *   4. incape pe 2-3 luni → Delta ×2-3 luni
 *   5. e oportunitate     → contract individual nou
 *   6. altfel             → backlog
 */
export function routeRequest(input: RouteRequestInput): RoutingProposal {
  const { value, ceilings } = input;
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const firstMonth = ceilings.deltaFreeByPeriod[0];
  const upTo3Months = ceilings.deltaFreeByPeriod.slice(0, 3);

  const mentenanta: RoutingOption = value.lte(threshold)
    ? { choice: 'interventie_mentenanta', available: true, reason: `${fmt(value)} ≤ pragul de ${fmt(threshold)}` }
    : { choice: 'interventie_mentenanta', available: false, reason: `✗ peste pragul de ${fmt(threshold)}` };

  const deltaOneMonth = deltaOption(
    'lucrare_delta',
    firstMonth === undefined ? [] : [firstMonth],
    value,
  );

  const lucrari: RoutingOption =
    ceilings.lucrariCeilingFree === null
      ? { choice: 'lucrare_componenta_lucrari', available: false, reason: '✗ operațiunea nu e prevăzută în contract' }
      : value.lte(ceilings.lucrariCeilingFree)
        ? {
            choice: 'lucrare_componenta_lucrari',
            available: true,
            reason: `${fmt(value)} ≤ ${fmt(ceilings.lucrariCeilingFree)} plafon Lucrări disponibil`,
          }
        : {
            choice: 'lucrare_componenta_lucrari',
            available: false,
            reason: `✗ ${fmt(value)} > ${fmt(ceilings.lucrariCeilingFree)} plafon Lucrări disponibil`,
          };

  // Multi-luna: minimul de luni (2 sau 3) care umple valoarea, in ordine.
  let multiLuna: RoutingOption = { choice: 'lucrare_delta_multi_luna', available: false, reason: '✗ nu sunt destule luni de Deltă deschise' };
  for (let n = 2; n <= upTo3Months.length; n += 1) {
    const candidate = deltaOption('lucrare_delta_multi_luna', upTo3Months.slice(0, n), value);
    if (candidate.available) {
      multiLuna = candidate;
      break;
    }
    multiLuna = candidate;
  }

  const oportunitate: RoutingOption = ceilings.isCommercialOpportunity
    ? { choice: 'contract_individual_nou', available: true, reason: 'cererea e o oportunitate comercială' }
    : { choice: 'contract_individual_nou', available: false, reason: '✗ nu e marcată ca oportunitate comercială' };

  const backlog: RoutingOption = { choice: 'amanata_backlog', available: true, reason: 'poate aștepta — intră în backlog' };

  const options: readonly RoutingOption[] = [
    mentenanta,
    deltaOneMonth,
    lucrari,
    multiLuna,
    oportunitate,
    backlog,
  ];

  let proposal: RoutingChoice;
  if (mentenanta.available) {
    proposal = 'interventie_mentenanta';
  } else if (deltaOneMonth.available) {
    proposal = 'lucrare_delta';
  } else if (lucrari.available) {
    proposal = 'lucrare_componenta_lucrari';
  } else if (multiLuna.available) {
    proposal = 'lucrare_delta_multi_luna';
  } else if (oportunitate.available) {
    proposal = 'contract_individual_nou';
  } else {
    proposal = 'amanata_backlog';
  }

  return { proposal, options };
}
