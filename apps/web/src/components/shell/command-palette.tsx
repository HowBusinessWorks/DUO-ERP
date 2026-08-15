'use client';

import { t } from '@damina/i18n';
import { cn } from '@damina/ui';
import { CornerDownLeft, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavItem } from '../../registry/navigation';

interface Hit {
  readonly group: string;
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly href: string;
}

const GROUP_LABEL: Readonly<Record<string, string>> = {
  navigation: t('search.groups.navigation'),
  commands: t('search.groups.commands'),
  companies: t('search.groups.companies'),
  persons: t('search.groups.persons'),
  produse: t('search.groups.produse'),
  furnizori: t('search.groups.furnizori'),
  clienti: t('search.groups.clienti'),
  subcontractanti: t('search.groups.subcontractanti'),
  calificari: t('search.groups.calificari'),
};

/**
 * Cautarea globala, Ctrl+K (§5.3).
 *
 * Un singur camp, rezultate grupate pe tip, cu prefixe:
 *   `/` navigare la modul · `>` comanda · `@` persoana · `#` cerere · `L-` lucrare
 *
 * `/` si `>` se rezolva LOCAL, fara sa atinga baza de date: navigarea si
 * comenzile sunt lucruri pe care aplicatia le stie despre ea insasi. Doar
 * cautarea de date pleaca pe retea, si numai dupa doua litere.
 *
 * De ce nu e un `<dialog>` ca restul modalelor: aici clicul in afara TREBUIE sa
 * inchida. Regula §30.1 protejeaza datele nesalvate; o casuta de cautare nu are
 * ce sa piarda, si o modala de cautare care nu se inchide la click ar fi doar
 * enervanta. Regula se aplica unde a fost scrisa, nu peste tot mecanic.
 */
export function CommandPalette({ modules }: { modules: readonly NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K / Cmd+K de oriunde din aplicatie.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery('');
      setHits([]);
      setActiveIndex(0);
    }
  }, [open]);

  const localHits = useCallback(
    (raw: string): readonly Hit[] => {
      const value = raw.trim();

      if (value.startsWith('/')) {
        const needle = value.slice(1).toLowerCase();
        return modules
          .filter((module) => module.label.toLowerCase().includes(needle))
          .slice(0, 8)
          .map((module) => ({
            group: 'navigation',
            id: module.slug,
            title: module.label,
            subtitle: module.phase === 0 ? null : `disponibil din faza ${String(module.phase)}`,
            href: `/${module.slug}`,
          }));
      }

      if (value.startsWith('>')) {
        const needle = value.slice(1).toLowerCase();
        const commands: readonly Hit[] = [
          {
            group: 'commands',
            id: 'close-period',
            title: t('search.commands.closePeriod'),
            subtitle: null,
            href: '/bani/inchidere',
          },
          {
            group: 'commands',
            id: 'new-product',
            title: t('search.commands.newProduct'),
            subtitle: null,
            href: '/produse?new=1',
          },
          {
            group: 'commands',
            id: 'panel',
            title: t('search.commands.goToPanel'),
            subtitle: null,
            href: '/panou',
          },
        ];
        return commands.filter((command) => command.title.toLowerCase().includes(needle));
      }

      return [];
    },
    [modules],
  );

  useEffect(() => {
    const value = query.trim();
    setActiveIndex(0);

    if (value.startsWith('/') || value.startsWith('>')) {
      setHits(localHits(value));
      setLoading(false);
      return;
    }

    if (value.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }

    // Se asteapta 180 ms de la ultima tasta: sub atat, se trimit cinci cereri
    // pentru un cuvant de cinci litere si raspunsurile sosesc in dezordine.
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        .then((response) => response.json() as Promise<{ hits: Hit[] }>)
        .then((payload) => {
          setHits(payload.hits);
          setLoading(false);
        })
        .catch(() => {
          /* abort sau retea — caseta ramane pe ce avea */
        });
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, localHits]);

  const go = useCallback(
    (hit: Hit | undefined): void => {
      if (hit === undefined) {
        return;
      }
      setOpen(false);
      router.push(hit.href);
    },
    [router],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="flex h-8 w-full max-w-80 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-ink-subtle transition-colors hover:border-border-strong hover:text-ink-muted"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate text-left">{t('topbar.searchPlaceholder')}</span>
        <kbd className="rounded border border-border bg-surface-sunken px-1 font-sans text-xs text-ink-subtle">
          {t('topbar.searchHint')}
        </kbd>
      </button>
    );
  }

  const grouped = groupHits(hits);

  return (
    <>
      <div
        role="presentation"
        onClick={() => {
          setOpen(false);
        }}
        className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('search.title')}
        className="fixed top-[12vh] left-1/2 z-50 w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5">
          <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, hits.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                go(hits[activeIndex]);
              }
            }}
            placeholder={t('search.placeholder')}
            aria-label={t('search.title')}
            className="h-12 flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-ink-subtle"
          />
          {loading ? <span className="text-xs text-ink-subtle">…</span> : null}
        </div>

        <div className="scrollbar-thin max-h-[min(24rem,50vh)] overflow-y-auto p-1.5">
          {hits.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="text-base text-ink-muted">
                {query.trim().length < 2 ? t('search.empty') : t('search.noResults', { query })}
              </p>
              <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-sm text-ink-subtle">
                {[
                  t('search.hints.request'),
                  t('search.hints.work'),
                  t('search.hints.person'),
                  t('search.hints.module'),
                  t('search.hints.command'),
                ].map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>
          ) : (
            grouped.map(([group, items]) => (
              <section key={group} className="mb-1 last:mb-0">
                <p className="px-2 py-1 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
                  {GROUP_LABEL[group] ?? group}
                </p>
                <ul>
                  {items.map((hit) => {
                    const index = hits.indexOf(hit);
                    return (
                      <li key={`${hit.group}-${hit.id}`}>
                        <button
                          type="button"
                          onMouseEnter={() => {
                            setActiveIndex(index);
                          }}
                          onClick={() => {
                            go(hit);
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
                            index === activeIndex ? 'bg-brand-50 text-brand-900' : 'text-ink',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-base font-medium">
                            {hit.title}
                          </span>
                          {hit.subtitle === null ? null : (
                            <span className="shrink-0 text-sm text-ink-subtle">{hit.subtitle}</span>
                          )}
                          {index === activeIndex ? (
                            <CornerDownLeft
                              className="size-3.5 shrink-0 text-ink-subtle"
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function groupHits(hits: readonly Hit[]): [string, Hit[]][] {
  const map = new Map<string, Hit[]>();
  for (const hit of hits) {
    const bucket = map.get(hit.group);
    if (bucket === undefined) {
      map.set(hit.group, [hit]);
    } else {
      bucket.push(hit);
    }
  }
  return [...map.entries()];
}
