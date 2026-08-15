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
  const segments = pathname.split('/').filter((segment) => segment !== '');

  return (
    <nav aria-label={t('a11y.breadcrumb')} className="min-w-0">
      <ol className="flex items-center gap-1 text-sm text-ink-muted">
        <li className="flex items-center">
          <Link href="/panou" className="flex items-center hover:text-ink" aria-label="Panou">
            <Home className="size-3.5" aria-hidden="true" />
          </Link>
        </li>
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join('/')}`;
          const label = labels[segment] ?? decodeURIComponent(segment);
          const last = index === segments.length - 1;
          // ID-urile nu se afiseaza in traseul de ruta: sunt zgomot. Numele
          // entitatii sta in antetul de dedesubt, unde poate fi citit.
          const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment);

          return (
            <li key={href} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3 shrink-0 text-ink-subtle" aria-hidden="true" />
              {last || isId ? (
                <span className={`truncate ${last ? 'font-medium text-ink' : ''}`}>
                  {isId ? '…' : label}
                </span>
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
