import { mfaBypassed } from '@damina/auth';
import { countWorkQueue } from '@damina/services';
import { ToastProvider } from '@damina/ui';
import type { ReactNode } from 'react';
import { LiveSync } from '../../components/shell/live-sync';
import { Sidebar } from '../../components/shell/sidebar';
import { Topbar } from '../../components/shell/topbar';
import { getAppContext } from '../../lib/context';
import { requireWorkspace } from '../../lib/session';
import { NAVIGATION } from '../../registry/navigation';
import { entityRegistry } from '../../registry/entities';

/**
 * `(office)` — aplicatia de birou. Shell-ul in cinci benzi din §4.
 *
 * Banda [1] bara globala si banda [4] continutul stau aici. Benzile [2] antet,
 * [3] tab-uri si [5] Legaturi apartin paginii de entitate, pentru ca depind de
 * entitatea deschisa.
 *
 * `force-dynamic` pe tot spatiul de birou: regula de cache din §7.3 spune ca
 * orice ecran care afiseaza lei se randeaza la fiecare cerere. In birou, aproape
 * fiecare ecran ajunge sa afiseze lei, iar un plafon vechi de 30 de secunde
 * afisat la o decizie de rutare costa mai mult decat toate randarile economisite.
 */
export const dynamic = 'force-dynamic';

export default async function OfficeLayout({ children }: { children: ReactNode }) {
  // Poarta de persona, inaintea oricarei interogari: un om de teren ajuns aici
  // nu trebuie sa declanseze nici macar numaratoarea de cozi a biroului.
  await requireWorkspace('office');
  const ctx = await getAppContext();

  // Badge-urile: cate lucruri asteapta de la MINE, in firmele pe care le privesc.
  const queue = await countWorkQueue(ctx.actor, ctx.session.personId, ctx.selectedCompanyIds);
  const byKind = new Map(queue.map((row) => [row.kind, row.count]));

  const badges: Record<string, number> = {};
  for (const item of NAVIGATION) {
    const total = (item.queueKinds ?? []).reduce((sum, kind) => sum + (byKind.get(kind) ?? 0), 0);
    if (total > 0) {
      badges[item.slug] = total;
    }
  }

  // Modulele la care persona curenta nu are drept LIPSESC din meniu (§30.5).
  const visibleModules = NAVIGATION.filter((item) => {
    const entity = entityRegistry[item.slug];
    return entity?.canRead === undefined ? true : entity.canRead(ctx.session);
  });

  return (
    <ToastProvider>
      <div data-shell="office" className="flex h-dvh overflow-hidden bg-canvas text-ink">
        <a
          href="#continut"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md"
        >
          Sari la conținut
        </a>

        <Sidebar items={visibleModules} badges={badges} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar ctx={ctx} usesPeriod={true} />

          {/*
           * Banda de mediu nesigur.
           *
           * Cand `MFA_ENFORCED=0` opreste poarta de al doilea factor, faptul se
           * VEDE — pe fiecare ecran, la fiecare om. Garantia nu sta intr-o
           * variabila de mediu pe care o citeste cineva daca se gandeste s-o
           * caute; sta aici, unde nu se poate uita.
           *
           * Nu e `Banner`: aia e banda de CONTEXT, care se citeste si se ignora.
           * Asta trebuie sa deranjeze cat timp e pornita.
           */}
          {mfaBypassed() ? (
            <p
              role="status"
              className="border-b border-danger-300 bg-danger-100 px-4 py-1.5 text-center text-sm font-medium text-danger-900"
            >
              Verificarea în doi pași e <strong>oprită</strong> în acest mediu
              (<code className="font-mono text-xs">MFA_ENFORCED=0</code>). Rolurile de admin și
              financiar intră fără al doilea factor — nu folosi mediul ăsta cu date reale.
            </p>
          ) : null}

          <div id="continut" className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
            {children}
          </div>
        </div>

        <LiveSync personId={ctx.session.personId} />
      </div>
    </ToastProvider>
  );
}
