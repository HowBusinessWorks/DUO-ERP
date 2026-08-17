import { EmptyState } from '@damina/ui';
import Link from 'next/link';

/**
 * Graficul etapelor (Gantt). Serveste doua ecrane: tab-ul Etape al unei lucrari si
 * Calendarul general (§3.4).
 *
 * Trei decizii care nu sunt de stil:
 *
 * 1. **Datele se scriu ca text, nu doar ca poziție a barei.** O bara spune „cam
 *    pe-aici"; raportul de luna are nevoie de ziua exacta. Iar informatia care se
 *    vede doar la hover nu exista pe telefon si nici pentru cititorul de ecran.
 * 2. **Zero animatie.** Graficul nu se deseneaza singur la scroll: e un tabel de
 *    date care se citeste, nu un efect.
 * 3. **Etapele au voie sa se suprapuna in timp** si graficul le arata asa cum
 *    sunt. Un grafic care le-ar alinia frumos ar fi minciuna comoda a softului.
 */

export interface TimelineStage {
  readonly id: string;
  readonly position: number;
  readonly name: string;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  /** Unde duce clicul pe etapa. Absent la etapele fara pagina proprie. */
  readonly href?: string;
  /** Lucrarea, cand graficul e cel general si aduna mai multe. */
  readonly groupLabel?: string;
}

const dayMs = 86_400_000;

const parse = (value: string | null): number | null => {
  if (value === null) {
    return null;
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) ? null : time;
};

const dateFormat = new Intl.DateTimeFormat('ro-RO', { day: '2-digit', month: 'short' });

const formatRange = (from: string | null, to: string | null): string => {
  const start = parse(from);
  const end = parse(to);
  if (start === null && end === null) {
    return '—';
  }
  if (start !== null && end !== null) {
    return `${dateFormat.format(start)} – ${dateFormat.format(end)}`;
  }
  return dateFormat.format((start ?? end) as number);
};

interface Span {
  readonly left: number;
  readonly width: number;
}

/** Fereastra graficului: de la prima data planificata sau reala, pana la ultima. */
function windowOf(stages: readonly TimelineStage[]): { from: number; to: number } | null {
  const times = stages
    .flatMap((stage) => [
      parse(stage.plannedStart),
      parse(stage.plannedEnd),
      parse(stage.actualStart),
      parse(stage.actualEnd),
    ])
    .filter((time): time is number => time !== null);

  if (times.length === 0) {
    return null;
  }
  const from = Math.min(...times);
  const to = Math.max(...times);
  // O singura zi ar da lățime zero si bara ar dispărea. O zi devine o zi.
  return { from, to: to === from ? from + dayMs : to };
}

function spanOf(
  from: string | null,
  to: string | null,
  frame: { from: number; to: number },
): Span | null {
  const start = parse(from);
  const end = parse(to);
  if (start === null && end === null) {
    return null;
  }
  const total = frame.to - frame.from;
  const s = start ?? (end as number);
  const e = end ?? (start as number);
  return {
    left: ((s - frame.from) / total) * 100,
    // Minimum 2% ca o etapa de o zi sa ramana vizibila intr-un grafic de trei luni.
    width: Math.max(((e - s) / total) * 100, 2),
  };
}

export function StageTimeline({ stages }: { readonly stages: readonly TimelineStage[] }) {
  const frame = windowOf(stages);

  if (stages.length === 0) {
    return (
      <EmptyState
        title="Nicio etapă"
        body="Etapele taie lucrarea în bucăți cu buget și grafic propriu. Fiecare are pagina ei, cu aceleași tab-uri ca lucrarea."
        size="sm"
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="sr-only">
          Graficul etapelor: perioada planificată și cea realizată, pe fiecare etapă.
        </caption>
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
            <th scope="col" className="w-8 py-2 pr-2 font-medium">
              #
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Etapă
            </th>
            <th scope="col" className="w-40 py-2 pr-3 font-medium">
              Planificat
            </th>
            <th scope="col" className="w-40 py-2 pr-3 font-medium">
              Realizat
            </th>
            <th scope="col" className="py-2 font-medium">
              Grafic
            </th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => {
            const planned = frame === null ? null : spanOf(stage.plannedStart, stage.plannedEnd, frame);
            const actual = frame === null ? null : spanOf(stage.actualStart, stage.actualEnd, frame);
            const done = stage.actualEnd !== null;

            return (
              <tr key={stage.id} className="border-b border-line/60 last:border-0 align-middle">
                <td data-numeric className="py-2.5 pr-2 tabular-nums text-ink-muted">
                  {stage.position}
                </td>
                <td className="max-w-[16rem] py-2.5 pr-3">
                  {stage.groupLabel === undefined ? null : (
                    <span className="block truncate text-xs text-ink-muted">{stage.groupLabel}</span>
                  )}
                  {stage.href === undefined ? (
                    <span className="block truncate font-medium text-ink" title={stage.name}>
                      {stage.name}
                    </span>
                  ) : (
                    <Link
                      href={stage.href}
                      className="block truncate font-medium text-brand-700 hover:underline"
                      title={stage.name}
                    >
                      {stage.name}
                    </Link>
                  )}
                </td>
                <td data-numeric className="py-2.5 pr-3 tabular-nums text-ink-muted">
                  {formatRange(stage.plannedStart, stage.plannedEnd)}
                </td>
                <td data-numeric className="py-2.5 pr-3 tabular-nums">
                  <span className={done ? 'text-success-700' : 'text-ink-muted'}>
                    {formatRange(stage.actualStart, stage.actualEnd)}
                  </span>
                </td>
                <td className="py-2.5">
                  {planned === null && actual === null ? (
                    <span className="text-xs text-ink-subtle">fără date</span>
                  ) : (
                    <div className="relative h-6 w-full min-w-[12rem] rounded bg-surface-muted">
                      {planned === null ? null : (
                        <div
                          className="absolute top-1 h-2 rounded-full bg-brand-200"
                          style={{ left: `${planned.left}%`, width: `${planned.width}%` }}
                          aria-hidden="true"
                        />
                      )}
                      {actual === null ? null : (
                        <div
                          className={`absolute bottom-1 h-2 rounded-full ${
                            done ? 'bg-success-600' : 'bg-brand-500'
                          }`}
                          style={{ left: `${actual.left}%`, width: `${actual.width}%` }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-3 flex flex-wrap items-center gap-4 text-xs text-ink-subtle">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-6 rounded-full bg-brand-200" aria-hidden="true" /> planificat
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-6 rounded-full bg-brand-500" aria-hidden="true" /> în execuție
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-6 rounded-full bg-success-600" aria-hidden="true" /> încheiat
        </span>
      </p>
    </div>
  );
}
