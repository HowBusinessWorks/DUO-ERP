'use client';

/** Ultima plasa: o eroare neasteptata nu are voie sa lase un ecran alb. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-3xl font-semibold text-ink">Ecranul n-a putut fi afișat</p>
      <p className="mt-2 text-base text-ink-muted">
        Eroarea a fost înregistrată. Reîncarcă pagina; dacă persistă, anunță IT-ul.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-brand-600 px-4 py-2 text-base font-medium text-white hover:bg-brand-700"
      >
        Încearcă din nou
      </button>
    </main>
  );
}
