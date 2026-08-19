'use client';

import { Field, Input, useFormContext } from '@damina/ui';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';

/**
 * Coordonatele obiectivului: doua campuri SI harta pe care se pune pinul.
 *
 * §3.5 cere explicit ca pinul sa se foloseasca „si la selectia coordonatelor,
 * nu doar la afisare”. Sunt doua drumuri catre aceeasi pereche de numere:
 * clicul pe harta scrie in campuri, iar tastarea in campuri muta pinul. Cine are
 * coordonatele dintr-un GPS le lipeste; cine stie doar unde e statia o arata.
 *
 * Harta se incarca cu `next/dynamic` si `ssr: false`: Leaflet atinge `window`
 * la import, deci nu are ce cauta in randarea de server.
 */

const ObjectiveMap = dynamic(async () => (await import('./objective-map')).ObjectiveMap, {
  ssr: false,
  loading: () => (
    <div className="grid h-56 place-items-center rounded-lg border border-dashed border-border bg-surface-sunken text-sm text-ink-subtle">
      Se încarcă harta…
    </div>
  ),
});

export function GeoField({
  latName,
  lngName,
  label,
  hint,
}: {
  readonly latName: string;
  readonly lngName: string;
  readonly label: string;
  readonly hint?: string;
}) {
  const form = useFormContext();
  const lat = form.watch(latName) as unknown;
  const lng = form.watch(lngName) as unknown;

  const picked = useMemo(() => {
    const latitude = toNumber(lat);
    const longitude = toNumber(lng);
    return latitude === null || longitude === null ? null : { lat: latitude, lng: longitude };
  }, [lat, lng]);

  return (
    <div className="sm:col-span-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name={latName} label={`${label} — latitudine`}>
          {(props) => (
            <Input
              {...props}
              {...form.register(latName)}
              inputMode="decimal"
              placeholder="44,4268"
            />
          )}
        </Field>
        <Field name={lngName} label={`${label} — longitudine`} hint={hint}>
          {(props) => (
            <Input
              {...props}
              {...form.register(lngName)}
              inputMode="decimal"
              placeholder="26,1025"
            />
          )}
        </Field>
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-border">
        <ObjectiveMap
          pins={[]}
          picked={picked}
          height="14rem"
          onPick={(nextLat, nextLng) => {
            // `shouldDirty` conteaza: fara el, o coordonata pusa DOAR de pe
            // harta n-ar marca formularul ca modificat, iar inchiderea lui n-ar
            // mai cere confirmare — adica exact munca omului s-ar pierde tacut.
            form.setValue(latName, String(nextLat), { shouldDirty: true, shouldValidate: true });
            form.setValue(lngName, String(nextLng), { shouldDirty: true, shouldValidate: true });
          }}
        />
      </div>
      <p className="mt-1 text-xs text-ink-subtle">
        Click pe hartă ca să pui pinul. Lasă ambele goale dacă obiectivul n-are coordonate — una
        singură nu se poate desena.
      </p>
    </div>
  );
}

function toNumber(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
