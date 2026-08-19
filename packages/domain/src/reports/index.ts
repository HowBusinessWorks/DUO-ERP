/**
 * Raportul lunar catre client — regulile care nu tin de baza de date
 * (pasul 10, §3.6).
 *
 * Sunt trei, si toate trei exista ca sa nu fie scrise in `if`-uri raspandite
 * prin ecran si prin serviciu:
 *
 *  1. **ordinea starilor** — generat, citit, aprobat, inghetat, trimis. Un
 *     raport care se poate ingheta fara aprobare nu mai are pas de control;
 *  2. **progresul** — „312 din 480", nu un procent rotunjit care sta pe 99%;
 *  3. **blocajul facturii** — factura de mentenanta se poate emite doar dupa
 *     aprobarea interna. Regula traieste aici, nu in ecranul de facturare care
 *     va aparea abia in faza 5.
 */

export const REPORT_STATUSES = ['building', 'review', 'approved', 'frozen', 'sent'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type ReportAction = 'generate' | 'approve' | 'freeze' | 'send';

/**
 * Din ce stari e permisa fiecare actiune.
 *
 * `generate` lipseste din `building` dinadins: cat timp jobul lucreaza, a doua
 * apasare n-are ce sa produca. Dar e permisa din `frozen` si `sent` — asa apare
 * versiunea 2, fara ca versiunea 1 sa fie atinsa (verificarea #24).
 */
const ALLOWED: Readonly<Record<ReportAction, readonly ReportStatus[]>> = {
  generate: ['review', 'approved', 'frozen', 'sent'],
  approve: ['review'],
  freeze: ['approved'],
  send: ['frozen'],
};

export interface ReportTransition {
  readonly ok: boolean;
  /** Starea de dupa actiune. Egala cu cea de dinainte cand `ok` e fals. */
  readonly next: ReportStatus;
  /** De ce nu se poate, in romana. Ajunge direct pe ecran. */
  readonly reason?: string;
}

const NEXT: Readonly<Record<ReportAction, ReportStatus>> = {
  generate: 'building',
  approve: 'approved',
  freeze: 'frozen',
  send: 'sent',
};

const REFUSAL: Readonly<Record<ReportAction, string>> = {
  generate: 'Raportul se generează deja. Așteaptă să termine.',
  approve: 'Se aprobă doar un raport generat și necitit încă. Generează-l întâi.',
  freeze: 'Se îngheață doar un raport aprobat intern.',
  send: 'Se trimite doar un raport înghețat — altfel ce pleacă la client se poate schimba după.',
};

export function reportTransition(current: ReportStatus, action: ReportAction): ReportTransition {
  if (!ALLOWED[action].includes(current)) {
    return { ok: false, next: current, reason: REFUSAL[action] };
  }
  return { ok: true, next: NEXT[action] };
}

export interface ReportProgress {
  readonly done: number;
  readonly total: number;
  readonly percent: number;
  /** „312 din 480 poze". Fraza care spune daca sa astepti sau sa chemi pe cineva. */
  readonly label: string;
}

export function reportProgress(done: number, total: number, unit = 'poze'): ReportProgress {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeDone = Math.min(Math.max(0, Math.trunc(done)), safeTotal === 0 ? 0 : safeTotal);
  // Total zero inseamna „inca nu stiu cate", nu „zero la suta gata": procentul
  // ramane 0 si eticheta spune ca se pregateste. Un 100% pe nimic ar fi minciuna
  // cea mai enervanta posibila.
  const percent = safeTotal === 0 ? 0 : Math.round((safeDone / safeTotal) * 100);
  return {
    done: safeDone,
    total: safeTotal,
    percent,
    label:
      safeTotal === 0 ? 'se pregătește…' : `${String(safeDone)} din ${String(safeTotal)} ${unit}`,
  };
}

/**
 * Se poate emite factura de mentenanta pe luna asta?
 *
 * Ecranul de facturare e faza 5, dar regula se scrie acum, ca precondition:
 * fara raport aprobat intern, factura pleaca pe cifre pe care nu le-a citit
 * nimeni. `approved` e pragul, nu `frozen` — inghetul tine de trimitere, iar
 * factura poate merge in acelasi plic.
 */
export function canIssueMaintenanceInvoice(status: ReportStatus | null): boolean {
  return status === 'approved' || status === 'frozen' || status === 'sent';
}
