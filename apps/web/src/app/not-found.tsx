import Link from 'next/link';

/**
 * 404. Rar in aplicatia asta, dinadins: modulele neconstruite randeaza o stare
 * goala cu „vine in faza X”, nu 404 — ca sa nu se rupa nicio legatura si sa se
 * vada harta intreaga de la inceput. Aici ajungi doar cu un URL chiar gresit.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-3xl font-semibold text-ink">Pagina nu există</p>
      <p className="mt-2 text-base text-ink-muted">
        Linkul e greșit sau înregistrarea a fost ștearsă.
      </p>
      <Link
        href="/panou"
        className="mt-6 rounded-md bg-brand-600 px-4 py-2 text-base font-medium text-white hover:bg-brand-700"
      >
        Înapoi în Panou
      </Link>
    </main>
  );
}
