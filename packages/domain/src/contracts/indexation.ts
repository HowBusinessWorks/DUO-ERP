import type { Money } from '@damina/shared';

/**
 * Indexarea contractelor multianuale.
 *
 * Regula 5 a pasului: **indexarea e ISTORICIZATA, nu recalculata.** Functiile de
 * aici produc valorile o singura data, la crearea contractului; de acolo incolo
 * ele traiesc in `app.contract_years` si nu se mai deriva niciodata din
 * `contracts.indexation_pct`. Un an in care s-a aplicat 0% pentru ca asa s-a
 * negociat trebuie sa ramana 0% si dupa ce cineva schimba procentul implicit.
 */

/** Data de business, `yyyy-mm-dd`. Fara ora, fara fus. */
export type BusinessDate = string;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function parse(date: BusinessDate): DateParts {
  const match = DATE_PATTERN.exec(date);
  if (match === null) {
    throw new RangeError(`Data invalida: "${date}". Format asteptat: "2026-03-01".`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Data invalida: "${date}".`);
  }
  return { year, month, day };
}

function format(parts: DateParts): BusinessDate {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Adauga ani calendaristici, cu ziua limitata la lungimea lunii.
 *
 * Un contract semnat pe 29 februarie 2028 are aniversarea pe 28 februarie 2029.
 * Fara limitare, `Date` ar rostogoli in 1 martie si toate lunile contractuale
 * s-ar decala cu o zi fata de facturare.
 */
export function addYears(date: BusinessDate, years: number): BusinessDate {
  const { year, month, day } = parse(date);
  const target = year + years;
  return format({ year: target, month, day: Math.min(day, daysInMonth(target, month)) });
}

/** Ziua dinaintea datei date. Folosita ca sfarsit INCLUSIV de an contractual. */
export function previousDay(date: BusinessDate): BusinessDate {
  const { year, month, day } = parse(date);
  if (day > 1) {
    return format({ year, month, day: day - 1 });
  }
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return format({ year: prevYear, month: prevMonth, day: daysInMonth(prevYear, prevMonth) });
}

export function compareDates(a: BusinessDate, b: BusinessDate): -1 | 0 | 1 {
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Valoarea unui an contractual, pornind de la valoarea anului 1.
 *
 * Doua lucruri care par detalii si nu sunt:
 *
 * 1. **Compunere pas cu pas, cu rotunjire la fiecare an**, nu `base × (1+p)^(n-1)`
 *    calculat dintr-o data. Contractul chiar se renegociaza an de an peste
 *    valoarea anului precedent, iar facturile emise in anul 2 sunt rotunjite la
 *    ban inainte ca anul 3 sa fie calculat. O formula „curata” ar produce, la
 *    anul 4, o valoare cu care nu se potriveste nicio factura.
 *
 * 2. **Cresterea se calculeaza ca SUMA, nu ca factor.** `Money` are doua
 *    zecimale prin definitie, deci un factor `1 + 0,035` construit ca `Money` ar
 *    deveni 1,04 si ar transforma 3,5% in 4%. Increment-ul, in schimb, e o suma
 *    de bani reala („crestem cu 2.500 lei”) si se rotunjeste corect la ban.
 *    `indexationPct` intra ca sir, nu ca `Money`, tocmai ca sa nu-si piarda
 *    zecimalele pe drum: `numeric(6,4)` are patru.
 *
 * `yearIndex` e 1-based: anul 1 nu are indexare, oricare ar fi procentul.
 */
export function applyIndexation(
  baseValue: Money,
  indexationPct: string | number,
  yearIndex: number,
): Money {
  if (!Number.isInteger(yearIndex) || yearIndex < 1) {
    throw new RangeError(`Index de an invalid: ${String(yearIndex)}. Anii se numara de la 1.`);
  }

  const pct = String(indexationPct);
  let value = baseValue;
  for (let year = 2; year <= yearIndex; year += 1) {
    value = value.add(value.mul(pct));
  }
  return value;
}

export interface ContractYearsInput {
  readonly startsOn: BusinessDate;
  readonly endsOn: BusinessDate;
  /** Abonamentul lunar al anului 1, neindexat. */
  readonly monthlyValue: Money;
  /** Fractie: 0.05 = 5%. Poate fi 0 — si atunci toti anii au aceeasi valoare. */
  readonly indexationPct: string | number;
}

export interface ContractYear {
  readonly yearIndex: number;
  readonly startsOn: BusinessDate;
  /** INCLUSIV: ziua dinaintea aniversarii, sau finalul contractului. */
  readonly endsOn: BusinessDate;
  readonly monthlyValue: Money;
  /** Cat s-a aplicat efectiv la intrarea in anul asta. Mereu 0 pe anul 1. */
  readonly indexationAppliedPct: string;
}

/**
 * Anii contractuali, cu aniversarea corecta.
 *
 * Un contract pe 4 ani semnat pe 1 martie 2026 are anii 01.03.2026–28.02.2027,
 * 01.03.2027–29.02.2028, si asa mai departe — nu ani calendaristici. Ultimul an
 * se taie la `endsOn`, deci un contract de 3 ani si jumatate produce 4 ani, din
 * care ultimul are 6 luni.
 */
export function buildContractYears(input: ContractYearsInput): ContractYear[] {
  if (compareDates(input.endsOn, input.startsOn) <= 0) {
    throw new RangeError('Contractul se termina inainte sa inceapa.');
  }

  const pct = String(input.indexationPct);
  const years: ContractYear[] = [];
  let cursor = input.startsOn;
  let index = 1;

  while (compareDates(cursor, input.endsOn) <= 0) {
    const anniversary = addYears(input.startsOn, index);
    const naturalEnd = previousDay(anniversary);
    const endsOn = compareDates(naturalEnd, input.endsOn) < 0 ? naturalEnd : input.endsOn;

    years.push({
      yearIndex: index,
      startsOn: cursor,
      endsOn,
      monthlyValue: applyIndexation(input.monthlyValue, pct, index),
      indexationAppliedPct: index === 1 ? '0' : pct,
    });

    if (compareDates(endsOn, input.endsOn) >= 0) {
      break;
    }
    cursor = anniversary;
    index += 1;
  }

  return years;
}

/** In ce an contractual cade o data. `null` daca e in afara contractului. */
export function contractYearAt(years: readonly ContractYear[], date: BusinessDate): ContractYear | null {
  return (
    years.find(
      (year) => compareDates(date, year.startsOn) >= 0 && compareDates(date, year.endsOn) <= 0,
    ) ?? null
  );
}
