import { formatPeriodLong, t } from '@damina/i18n';
import { Banner } from '@damina/ui';
import { Lock } from 'lucide-react';
import type { PeriodContext } from '@damina/services';

/**
 * Lacatul, in banda de sub antet (§30.10).
 *
 * Apare pe ORICE ecran care depinde de luna, nu doar pe cele de scriere. Cine
 * citeste o cifra dintr-o luna inchisa trebuie sa stie ca e finala; cine
 * incearca sa scrie trebuie sa afle inainte de a completa formularul, nu dupa
 * ce apasa Salvează si primeste eroarea trigger-ului.
 */
export function PeriodLockBanner({
  period,
  totalCompanies,
}: {
  period: PeriodContext;
  totalCompanies: number;
}) {
  if (!period.locked) {
    return null;
  }

  const label = formatPeriodLong(period.year, period.month);
  const partial = period.closedCompanyNames.length < totalCompanies;

  return (
    <Banner
      tone="warning"
      icon={<Lock className="size-4" aria-hidden="true" />}
      title={
        partial
          ? t('period.mixedCompanies', {
              period: label,
              closed: period.closedCompanyNames.length,
              total: totalCompanies,
            })
          : t('period.lockedTitle', { period: label })
      }
      body={
        partial
          ? `Închisă la: ${period.closedCompanyNames.join(', ')}. Scrierile sunt blocate până schimbi luna sau selecția de firme.`
          : t('period.lockedBody', { period: label })
      }
    />
  );
}
