'use client';

import 'leaflet/dist/leaflet.css';

import type { Map as LeafletMap, Marker } from 'leaflet';
import { useEffect, useRef, useState } from 'react';

/**
 * Harta obiectivelor.
 *
 * O SINGURA componenta pentru amandoua treburile din §3.5: afiseaza pin-urile
 * listei si, cand primeste `onPick`, seteaza coordonatele la click. Doua
 * componente ar fi insemnat doua proiectii, doua zoom-uri implicite si doua
 * feluri de a gresi latitudinea cu longitudinea.
 *
 * Leaflet se incarca DINAMIC, in `useEffect`. Motivul nu e performanta: modulul
 * atinge `window` la import, deci pe server ar arunca la randare. Cu `import()`
 * in efect, el nu exista niciodata in afara browserului.
 *
 * Foaia de stil vine din pachet (`leaflet/dist/leaflet.css`), nu de pe un CDN:
 * o harta care se desfigureaza pentru ca unpkg e jos nu e o harta.
 *
 * Tile-urile sunt OSM. Nu e o alegere de stil: sunt singurele fara cheie de API
 * si fara cost per afisare, iar §3.5 cere harta pe un ecran deschis toata ziua.
 */

export interface MapPin {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly label: string;
  readonly meta?: string;
  readonly href?: string;
}

export interface ObjectiveMapProps {
  readonly pins: readonly MapPin[];
  /** Cand e dat, clicul pe harta ALEGE coordonatele in loc sa nu faca nimic. */
  readonly onPick?: (lat: number, lng: number) => void;
  /** Pinul mutabil al selectiei, cand harta e folosita ca alegator. */
  readonly picked?: { readonly lat: number; readonly lng: number } | null;
  readonly className?: string;
  readonly height?: string;
}

/** Centrul Romaniei, folosit cand nu exista niciun pin de incadrat. */
const FALLBACK_CENTER: [number, number] = [45.9432, 24.9668];

export function ObjectiveMap({
  pins,
  onPick,
  picked = null,
  className,
  height = '100%',
}: ObjectiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const pickedMarkerRef = useRef<Marker | null>(null);
  // `onPick` se schimba la fiecare randare a parintelui; tinut intr-un ref,
  // harta nu se reconstruieste pentru asta.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    void (async () => {
      const L = await import('leaflet');
      if (cancelled || containerRef.current === null) {
        return;
      }

      map = L.map(containerRef.current, { scrollWheelZoom: true }).setView(FALLBACK_CENTER, 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);

      const bounds: [number, number][] = [];
      for (const pin of pins) {
        const marker = L.circleMarker([pin.lat, pin.lng], {
          radius: 7,
          weight: 2,
          color: '#0f6f83',
          fillColor: '#12a3bf',
          fillOpacity: 0.85,
        }).addTo(map);

        const meta = pin.meta === undefined ? '' : `<div>${escapeHtml(pin.meta)}</div>`;
        const link =
          pin.href === undefined
            ? ''
            : `<a href="${escapeHtml(pin.href)}" style="color:#0f6f83;font-weight:600">Deschide</a>`;
        marker.bindPopup(`<strong>${escapeHtml(pin.label)}</strong>${meta}${link}`);
        bounds.push([pin.lat, pin.lng]);
      }

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }

      map.on('click', (event) => {
        const handler = pickRef.current;
        if (handler === undefined) {
          return;
        }
        handler(Number(event.latlng.lat.toFixed(7)), Number(event.latlng.lng.toFixed(7)));
      });

      mapRef.current = map;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      pickedMarkerRef.current = null;
    };
    // Lista de dependente e goala DINADINS. Pin-urile vin din server si sunt
    // stabile cat tine randarea paginii; o dependenta pe ele ar reconstrui harta
    // la fiecare re-randare a parintelui, pierzand zoom-ul si pozitia omului.
    // Cand se schimba filtrul listei, se schimba si ruta, deci componenta se
    // monteaza din nou oricum.
  }, []);

  // Pinul selectiei traieste separat de cele ale listei: se muta des, si nu are
  // ce cauta in incadrarea initiala.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || map === null) {
      return;
    }

    void (async () => {
      const L = await import('leaflet');
      if (picked === null) {
        pickedMarkerRef.current?.remove();
        pickedMarkerRef.current = null;
        return;
      }
      if (pickedMarkerRef.current === null) {
        pickedMarkerRef.current = L.marker([picked.lat, picked.lng]).addTo(map);
      } else {
        pickedMarkerRef.current.setLatLng([picked.lat, picked.lng]);
      }
      map.setView([picked.lat, picked.lng], Math.max(map.getZoom(), 13));
    })();
  }, [picked, ready]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className={className}
      role="application"
      aria-label="Harta obiectivelor"
    />
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
