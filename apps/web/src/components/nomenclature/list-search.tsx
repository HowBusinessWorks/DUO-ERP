'use client';

import { Input } from '@damina/ui';
import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Cautarea din capul unei liste.
 *
 * Filtrul traieste in URL, nu in stare de client: lista filtrata se poate
 * trimite pe chat, se poate pune la favorite si supravietuieste unui refresh.
 * Serverul filtreaza, deci merge la fel si la 40 de randuri, si la 40 de mii.
 */
export function ListSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');

  useEffect(() => {
    const current = params.get('q') ?? '';
    if (value === current) {
      return;
    }
    // 250 ms de la ultima tasta: sub atat se trimite o navigare pentru fiecare
    // litera, si serverul lucreaza de cinci ori degeaba pentru un cuvant.
    const timer = setTimeout(() => {
      router.replace(value === '' ? pathname : `${pathname}?q=${encodeURIComponent(value)}`);
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [value, params, pathname, router]);

  return (
    <span className="relative">
      <Search
        className="pointer-events-none absolute inset-y-0 left-2.5 my-auto size-3.5 text-ink-subtle"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-64 pl-8"
      />
    </span>
  );
}
