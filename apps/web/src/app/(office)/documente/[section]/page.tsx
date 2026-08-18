import { EmptyState } from '@damina/ui';
import { Construction } from 'lucide-react';
import { notFound } from 'next/navigation';
import { findNavItem } from '../../../../registry/navigation';

export const dynamic = 'force-dynamic';

/**
 * Sub-sectiunile modulului Documente care inca nu exista: procese verbale,
 * sabloane, expirari.
 *
 * Exista fiindca de la 07c arborele de fisiere e real, deci modulul arata
 * construit — iar o intrare de meniu care duce la 404 intr-un modul viu se
 * citeste ca aplicatie stricata, nu ca functie care n-a venit inca. Aceeasi
 * regula ca la `[module]/page.tsx`: navigarea merge, ecranul explica.
 */
export default async function DocumentsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const child = findNavItem('documente')?.children?.find((entry) => entry.slug === section);
  if (child === undefined) {
    notFound();
  }

  return (
    <div className="p-5">
      <h1 className="mb-4 text-2xl font-semibold">{child.label}</h1>
      <EmptyState
        icon={<Construction className="size-5" aria-hidden="true" />}
        title={`${child.label} vine mai târziu`}
        body="Secțiunea e prevăzută în plan, dar încă nu e construită. Arborele de fișiere, din care se va hrăni, funcționează deja."
      />
    </div>
  );
}
