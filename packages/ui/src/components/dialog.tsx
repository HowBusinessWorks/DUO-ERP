'use client';

import { t } from '@damina/i18n';
import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  /**
   * Formularul are modificari nesalvate.
   *
   * Cand e `true`, orice incercare de inchidere trece printr-o confirmare. Se
   * leaga direct la `formState.isDirty` din react-hook-form.
   */
  readonly isDirty?: boolean;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  /** Ascunde X-ul: dialoguri care CER un raspuns (confirmari distructive). */
  readonly hideClose?: boolean;
}

const SIZES = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-5xl' } as const;

/**
 * Fereastra modala.
 *
 * REGULA 1 DIN §30, implementata O SINGURA DATA, aici: **modala nu se inchide
 * la click in afara ei**. Nu e o preferinta — s-au pierdut date reale din
 * cauza asta, iar o regula reimplementata pe fiecare ecran e o regula care se
 * pierde pe al treilea ecran.
 *
 * Concret, in componenta asta:
 *  - clicul pe fundal nu face nimic (nu exista handler care sa inchida);
 *  - Escape e interceptat (`cancel` → `preventDefault`) si trece prin aceeasi
 *    poarta ca butonul de inchidere;
 *  - cand `isDirty` e adevarat, poarta cere confirmare explicita.
 *
 * Se foloseste `<dialog>` nativ, nu un `div` cu `position: fixed`: primim de la
 * browser capcana de focus, `inert` pe restul paginii, stratul de sus si
 * comportamentul corect cu cititoarele de ecran. Un dialog scris de mana le
 * rateaza pe cel putin doua.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  isDirty = false,
  footer,
  children,
  size = 'md',
  hideClose = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    if (!open) {
      setConfirming(false);
    }
  }, [open]);

  /** Singura poarta de iesire. Tot ce inchide dialogul trece pe aici. */
  const requestClose = useCallback(() => {
    if (isDirty) {
      setConfirming(true);
      return;
    }
    onOpenChange(false);
  }, [isDirty, onOpenChange]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    // `cancel` = Escape. Il oprim si il trimitem prin poarta, ca sa nu existe o
    // a doua cale de iesire care ocoleste confirmarea.
    const onCancel = (event: Event): void => {
      event.preventDefault();
      requestClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
    };
  }, [requestClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      // Fara `onClick` pe fundal. Absenta lui E regula.
      className={cn(
        'w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-0 text-ink shadow-lg',
        'backdrop:bg-ink/35 backdrop:backdrop-blur-[2px]',
        'my-auto',
        SIZES[size],
      )}
    >
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold text-balance text-ink">
            {title}
          </h2>
          {description === undefined ? null : (
            <p id={descriptionId} className="mt-1 text-base text-ink-muted">
              {description}
            </p>
          )}
        </div>
        {hideClose ? null : (
          <Button
            variant="ghost"
            size="icon"
            onClick={requestClose}
            aria-label={t('a11y.closeDialog')}
            className="-mt-1 -mr-1.5"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </header>

      <div className="scrollbar-thin max-h-[min(70vh,44rem)] overflow-y-auto px-5 py-4">
        {children}
      </div>

      {footer === undefined ? null : (
        <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-sunken/60 px-5 py-3">
          {footer}
        </footer>
      )}

      {confirming ? (
        <UnsavedConfirm
          onKeep={() => {
            setConfirming(false);
          }}
          onDiscard={() => {
            setConfirming(false);
            onOpenChange(false);
          }}
        />
      ) : null}
    </dialog>
  );
}

/**
 * Stratul de confirmare, desenat PESTE continutul dialogului.
 *
 * Nu e un al doilea `<dialog>`: doua modale suprapuse incurca focusul si
 * cititoarele de ecran. Aici focusul se muta pe butonul sigur („Rămâi în
 * formular”), care e si cel implicit.
 */
function UnsavedConfirm({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-label={t('dialog.unsavedTitle')}
      className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface/92 px-6 backdrop-blur-[1px]"
    >
      <div className="max-w-sm text-center">
        <p className="text-lg font-semibold text-ink">{t('dialog.unsavedTitle')}</p>
        <p className="mt-1.5 text-base text-ink-muted">{t('dialog.unsavedBody')}</p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button variant="ghost" onClick={onDiscard}>
            {t('dialog.unsavedDiscard')}
          </Button>
          <Button ref={keepRef} variant="primary" onClick={onKeep}>
            {t('dialog.unsavedKeep')}
          </Button>
        </div>
      </div>
    </div>
  );
}
