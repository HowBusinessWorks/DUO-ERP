'use client';

import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Singurul lucru din aplicatie care are voie sa se miste singur pe ecran
 * (PLAN_TEHNIC §13.1): badge-urile de coada si clopotelul.
 *
 * NICIODATA date de business. Un ecran care se rearanjeaza sub degetul omului
 * in timp ce completeaza un deviz e o sursa de erori, nu o functionalitate.
 *
 * Cum: componenta nu tine niciun numar. Asculta doar „s-a schimbat ceva la
 * mine” si cere `router.refresh()` — serverul recalculeaza badge-urile si
 * trimite noul shell. Numerele raman intr-un singur loc, pe server, si nu pot
 * sa se dezacordeze de restul paginii.
 *
 * Fallback: reimprospatare la 60 s. Cand Realtime nu e configurat sau conexiunea
 * pica, badge-urile raman corecte cu intarziere de un minut in loc sa inghete.
 */
export function LiveSync({ personId }: { personId: string }) {
  const router = useRouter();

  useEffect(() => {
    // Plasa de siguranta, mereu activa: nu depinde de nicio configurare.
    const interval = setInterval(() => {
      router.refresh();
    }, 60_000);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url === undefined || key === undefined || url === '' || key === '') {
      return () => {
        clearInterval(interval);
      };
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });
    let channel: RealtimeChannel | null = null;

    try {
      channel = supabase
        .channel(`me:${personId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'app',
            table: 'work_queue_items',
            filter: `person_id=eq.${personId}`,
          },
          () => {
            router.refresh();
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'app',
            table: 'notifications',
            filter: `person_id=eq.${personId}`,
          },
          () => {
            router.refresh();
          },
        )
        .subscribe();
    } catch {
      // Realtime indisponibil: ramane intervalul de 60 s.
    }

    return () => {
      clearInterval(interval);
      if (channel !== null) {
        void supabase.removeChannel(channel);
      }
    };
  }, [personId, router]);

  return null;
}
