'use client';

import { t } from '@damina/i18n';
import { Button, cn, CountBadge, EmptyState } from '@damina/ui';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

export interface NotificationItem {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly href: string | null;
  readonly actionKind: string | null;
  readonly createdAt: string;
  readonly read: boolean;
}

const timeFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Clopotelul: evenimente punctuale, citite o data (§28).
 *
 * NU e coada de lucru si NU e alerta. Ce ajunge aici s-a intamplat deja si nu
 * cere nimic — „ti s-a aprobat devizul”. Ce cere ceva de la om ajunge in coada,
 * cu badge in sidebar; ce persista pana se rezolva ajunge in banner, ca alerta.
 * Cele trei nu se amesteca, si asta e cea mai comuna greseala din ERP-uri.
 */
export function NotificationBell({
  items,
  unread,
  onMarkRead,
  onMarkAllRead,
}: {
  items: readonly NotificationItem[];
  unread: number;
  onMarkRead: (id: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-label={
          unread > 0 ? t('notifications.unreadCount', { count: unread }) : t('notifications.title')
        }
        className="relative"
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 ? (
          <CountBadge
            count={unread}
            label={t('notifications.unreadCount', { count: unread })}
            tone="danger"
            className="absolute -top-0.5 -right-0.5"
          />
        ) : null}
      </Button>

      {open ? (
        <div className="absolute top-full right-0 z-40 mt-1.5 w-96 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold text-ink">{t('notifications.title')}</p>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => {
                  startTransition(() => {
                    void onMarkAllRead();
                  });
                }}
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                {t('notifications.markAllRead')}
              </button>
            ) : null}
          </header>

          {items.length === 0 ? (
            <EmptyState
              title={t('notifications.empty')}
              body={t('notifications.emptyHint')}
              size="sm"
            />
          ) : (
            <ul className="scrollbar-thin max-h-96 divide-y divide-border overflow-y-auto">
              {items.map((item) => {
                const content = (
                  <>
                    <div className="flex items-baseline justify-between gap-2">
                      <p
                        className={cn(
                          'text-base',
                          item.read ? 'text-ink-muted' : 'font-medium text-ink',
                        )}
                      >
                        {item.title}
                      </p>
                      <time dateTime={item.createdAt} className="shrink-0 text-xs text-ink-subtle">
                        {timeFormat.format(new Date(item.createdAt))}
                      </time>
                    </div>
                    {item.body === null ? null : (
                      <p className="mt-0.5 text-sm text-ink-muted">{item.body}</p>
                    )}
                  </>
                );

                return (
                  <li key={item.id} className={item.read ? '' : 'bg-brand-50/40'}>
                    {item.href === null ? (
                      <div className="px-3 py-2.5">{content}</div>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={() => {
                          setOpen(false);
                          startTransition(() => {
                            void onMarkRead(item.id);
                          });
                        }}
                        className="block px-3 py-2.5 hover:bg-surface-hover"
                      >
                        {content}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
