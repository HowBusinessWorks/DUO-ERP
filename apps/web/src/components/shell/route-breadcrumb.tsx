'use client';

import { t } from '@damina/i18n';
import { ChevronRight, Home } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Breadcrumb-ul [1] din bara globala: traseul de RUTA.
 *
 * E altceva decat breadcrumb-ul [2] din antetul entitatii, care e SEMANTIC
 * (nume, nu ID-uri). Amandoua exista dinadins: unul spune unde esti in
 * aplicatie, celalalt spune pe ce obiect esti. Cine le uneste pierde unul.
 */
export function RouteBreadcrumb({ labels }: { labels: Readonly<Record<string, string>> }) {
  const pathname = usePathname();
  // ID-urile LIPSESC din traseul de ruta, nu se inlocuiesc cu „…”: un breadcrumb
  // care se termina in trei puncte nu spune nimic si arata ca o eroare. Numele
  // entitatii sta oricum in antetul de dedesubt, unde poate fi citit.
  const raw = pathname.split('/').filter((segment) => segment !== '');
  const segments = raw
    // Href-ul se pastreaza pe traseul REAL: `/clienti/<id>/istoric` are ultima
    // veriga tot la `/clienti/<id>/istoric`, nu la `/clienti/istoric`.
    .map((segment, index) => ({ segment, href: `/${raw.slice(0, index + 1).join('/')}` }))
    .filter(({ segment }) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment));

  return (
    <nav aria-label={t('a11y.breadcrumb')} className="min-w-0">
      <ol className="flex items-center gap-1 text-sm text-ink-muted">
        <li className="flex items-center">
          <Link href="/panou" className="flex items-center hover:text-ink" aria-label="Panou">
            <Home className="size-3.5" aria-hidden="true" />
          </Link>
        </li>
        {segments.map(({ segment, href }, index) => {
          const label = labels[segment] ?? decodeURIComponent(segment);
          const last = index === segments.length - 1;

          return (
            <li key={href} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3 shrink-0 text-ink-subtle" aria-hidden="true" />
              {last ? (
                <span className="truncate font-medium text-ink">{label}</span>
              ) : (
                <Link href={href} className="truncate hover:text-ink">
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
