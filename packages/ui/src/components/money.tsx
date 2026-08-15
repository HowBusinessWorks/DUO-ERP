import type { Money as MoneyValue } from '@damina/shared';
import { cn } from '../lib/cn';

export interface MoneyProps {
  /**
   * DOAR `Money`. Nu `number`, nu `string`.
   *
   * Tipul e regula, nu o preferinta: un `number` care ajunge pe ecran a trecut
   * printr-un float undeva, iar la a treia insumare 0,01 lei lipseste dintr-o
   * situatie de lucrari. Conversia se face explicit, la marginea sistemului,
   * cu `Money.fromDb()` — nu pe tacute, in JSX.
   */
  readonly value: MoneyValue;
  /** Ascunde „lei” cand unitatea e deja scrisa in capul coloanei. */
  readonly currency?: boolean;
  /** Coloreaza minusul in rosu. Implicit da — un minus ratat costa bani. */
  readonly signed?: boolean;
  readonly className?: string;
  /** Cifra mare din antet sau din Panou. */
  readonly emphasis?: boolean;
}

/**
 * Afisarea unei sume, in format ro-RO: „41.800,00 lei”.
 *
 * Cifrele sunt tabulare (token-ul global), deci coloanele de sume se aliniaza
 * pe virgula fara sa fie nevoie de nimic per ecran.
 */
export function Money({
  value,
  currency = true,
  signed = true,
  className,
  emphasis = false,
}: MoneyProps) {
  const negative = value.isNegative();
  const text = currency ? value.format() : value.toString().replace('.', ',');

  return (
    <span
      data-numeric
      className={cn(
        'tabular-nums whitespace-nowrap',
        emphasis ? 'text-xl font-semibold' : 'font-medium',
        signed && negative ? 'text-danger-700' : 'text-ink',
        className,
      )}
    >
      {text}
    </span>
  );
}

/**
 * Locul unei sume pe care persona curenta nu are voie sa o vada.
 *
 * Exista ca sa NU fie folosit: izolarea pretului se face la nivel de date, prin
 * roluri Postgres fara `select` pe coloana (decizia 3). Componenta acopera
 * singurul caz legitim — o coloana de tabel comuna mai multor roluri de birou,
 * unde randul exista si suma lipseste. Daca ajunge sa fie folosita pe un ecran
 * intreg, decupajul e gresit si trebuie facut din rute, nu din UI.
 */
export function MoneyHidden({ className }: { className?: string }) {
  return (
    <span
      aria-label="Ascuns"
      title="Nu ai acces la informațiile de preț."
      className={cn('tracking-widest text-ink-subtle select-none', className)}
    >
      ····
    </span>
  );
}
