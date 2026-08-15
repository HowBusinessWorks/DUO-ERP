'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly body?: string;
}

interface ToastContextValue {
  readonly toast: (input: Omit<Toast, 'id'>) => void;
  readonly dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Erorile raman pe ecran pana sunt inchise. Confirmarile pleaca singure. */
const DURATION: Readonly<Record<ToastTone, number>> = {
  success: 4000,
  info: 5000,
  warning: 7000,
  error: 0,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, 'id'>) => {
      const id = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) => [...current.slice(-2), { ...input, id }]);
      const duration = DURATION[input.tone];
      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error('useToast se foloseste doar sub <ToastProvider>.');
  }
  return context;
}

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const TONES: Readonly<Record<ToastTone, string>> = {
  success: 'border-success-200 bg-success-50 text-success-700',
  error: 'border-danger-200 bg-danger-50 text-danger-700',
  warning: 'border-warning-200 bg-warning-50 text-warning-700',
  info: 'border-brand-200 bg-brand-50 text-brand-700',
};

/**
 * Colt dreapta-jos, maximum trei mesaje.
 *
 * `aria-live="polite"` si nu `assertive`: un mesaj de confirmare nu are voie sa
 * intrerupa cititorul de ecran in mijlocul unei propozitii. Erorile blocante nu
 * sunt toast-uri — sunt in formular, langa campul vinovat.
 */
function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: readonly Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-md',
              TONES[item.tone],
            )}
          >
            <Icon className="mt-px size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium">{item.title}</p>
              {item.body === undefined ? null : (
                <p className="mt-0.5 text-sm opacity-90">{item.body}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                onDismiss(item.id);
              }}
              aria-label="Închide mesajul"
              className="-mt-0.5 -mr-1 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
